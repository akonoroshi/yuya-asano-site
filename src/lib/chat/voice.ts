// Shino's voice in the browser. Off until the visitor turns it on (the Voice button in the top
// bar), or starts a voice conversation. The choice is kept for the tab.
//
// What she says comes from the controller's events (controller.ts), cut into units by speech.ts:
//   - curated lines (answers, "Did you mean …?", fillers, errors): pre-recorded clips in
//     public/voice/<lang>/<key>.mp3, listed in public/voice/manifest.json. No network beyond
//     the file itself, and no TTS server needed.
//   - LLM replies: each sentence arrives as a signed chat:say event and is voiced by POST
//     /api/tts, unless a clip exists (the off-topic redirects, for example).
// Both are made by the same TTS server, so they sound the same. A sentence with no clip and no
// live voice is skipped silently; the caption still shows everything.
//
// Events out (window CustomEvents):
//   character:speech-start  { analyser }  her voice starts; read the AnalyserNode for lip sync
//   character:speech-end                  it ended, or was stopped (barge-in, a new reply, closing)
//   character:voice-state   { enabled }   the Voice setting changed
import { speechKey, speechUnits } from "./speech.ts";
import type { Lang } from "./types.ts";

const STORAGE_KEY = "chat:voice"; // "on" | "off", per tab
const GAP_MS = 120; // between units, so sentences don't run together
const MAX_LIVE_FAILURES = 2; // then stop asking the server for the rest of the page view
const CLIP_CACHE = 64;

interface VoiceManifest {
  fingerprint: string;
  keys: Set<string>;
}

interface Segment {
  buffer: Promise<AudioBuffer | null>;
}

const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class VoicePlayer {
  readonly lang: Lang;
  private on = false;
  private chosen = false; // the visitor has turned voice on or off in this tab
  private audio: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private manifest: Promise<VoiceManifest | null> | null = null;
  private clips = new Map<string, Promise<AudioBuffer | null>>();
  private gen = 0; // bumped on every stop: running loops and pending fetches for older replies give up
  private queue: Segment[] = [];
  private open = false; // the current reply may still add units
  private playing = false;
  private speaking = false;
  private source: AudioBufferSourceNode | null = null;
  private wake: (() => void) | null = null;
  private liveFailures = 0;
  private liveOff = false;
  private spoke = false; // anything said on this page yet

  constructor(lang: Lang) {
    this.lang = lang;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      this.chosen = saved === "on" || saved === "off";
      this.on = saved === "on";
    } catch {
      /* storage disabled: voice starts off on every page */
    }
    if (this.on) this.loadManifest();

    const on = (name: string, fn: (detail: Record<string, unknown>) => void) =>
      window.addEventListener(name, (e) => fn(((e as CustomEvent).detail ?? {}) as Record<string, unknown>));
    on("chat:reply-start", (d) => {
      if (!this.on) return;
      this.begin();
      if (typeof d.text === "string") this.addText(d.text);
    });
    on("chat:filler", (d) => this.on && this.open && typeof d.text === "string" && this.addText(d.text));
    on("chat:say", (d) => {
      if (this.on && this.open && typeof d.text === "string" && typeof d.exp === "number" && typeof d.sig === "string") {
        this.addLive(d.text, d.exp, d.sig);
      }
    });
    on("chat:reply-error", (d) => this.on && this.open && typeof d.text === "string" && this.addText(d.text));
    on("chat:reply-end", () => this.close());
    on("chat:filler-cancel", () => this.stop());
    on("voice:barge-in", () => this.stop());
    on("chat:close", () => this.stop());
    document.addEventListener("visibilitychange", () => document.hidden && this.stop());
    window.addEventListener("pagehide", () => this.stop());
  }

  get enabled() {
    return this.on;
  }

  /** The Voice button. Call from a click handler: browsers only allow audio after a gesture. */
  setEnabled(on: boolean) {
    this.chosen = true;
    this.apply(on);
  }

  /** Starting a voice conversation turns voice on, unless the visitor turned it off in this tab. */
  autoEnable() {
    if (!this.chosen && !this.on) this.apply(true);
  }

  /** Lets audio play: call on any click or key press in the chat (mobile browsers require it). */
  unlock() {
    if (!this.on) return;
    const ctx = this.context();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
  }

  /** Says a line now (the opening line, when voice is turned on before anything else was said). */
  sayOnce(text: string) {
    if (!this.on || this.spoke) return;
    this.begin();
    this.addText(text);
    this.close();
  }

  private apply(on: boolean) {
    this.on = on;
    try {
      sessionStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      /* fine: it just won't carry over */
    }
    if (on) {
      this.unlock();
      this.loadManifest();
    } else this.stop();
    emit("character:voice-state", { enabled: on });
  }

  private context(): AudioContext {
    if (!this.audio) {
      this.audio = new AudioContext();
      this.analyser = this.audio.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.connect(this.audio.destination);
    }
    return this.audio;
  }

  private loadManifest(): Promise<VoiceManifest | null> {
    this.manifest ??= fetch("/voice/manifest.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((m: Record<string, { fingerprint?: string; keys?: string[] }> | null) => {
        const v = m?.[this.lang];
        return v?.fingerprint ? { fingerprint: v.fingerprint, keys: new Set(v.keys ?? []) } : null;
      })
      .catch(() => null);
    return this.manifest;
  }

  /* ---------- Building the queue ---------- */

  /** A new reply: whatever was playing stops. */
  private begin() {
    this.stop();
    this.open = true;
    this.spoke = true;
  }

  private close() {
    this.open = false;
    this.notify();
  }

  /** Wakes the play loop if it's waiting for the next unit. */
  private notify() {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private push(buffer: Promise<AudioBuffer | null>) {
    this.queue.push({ buffer });
    this.notify();
    if (!this.playing) {
      this.playing = true;
      void this.loop(this.gen);
    }
  }

  private addText(text: string) {
    for (const unit of speechUnits(this.lang, text)) this.push(this.clip(unit));
  }

  private addLive(unit: string, exp: number, sig: string) {
    const gen = this.gen;
    this.push(
      this.clip(unit).then((clip) => {
        if (clip || this.liveOff || gen !== this.gen) return clip;
        return this.live(unit, exp, sig);
      }),
    );
  }

  /** The pre-recorded clip for a unit, or null if there is none. */
  private async clip(unit: string): Promise<AudioBuffer | null> {
    const m = await this.loadManifest();
    if (!m) return null;
    const key = await speechKey(m.fingerprint, this.lang, unit);
    if (!m.keys.has(key)) {
      console.debug("[voice] no clip for:", unit);
      return null;
    }
    let clip = this.clips.get(key);
    if (!clip) {
      clip = fetch(`/voice/${this.lang}/${key}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => this.context().decodeAudioData(b))
        .catch(() => null);
      this.clips.set(key, clip);
      if (this.clips.size > CLIP_CACHE) this.clips.delete(this.clips.keys().next().value!);
    }
    return clip;
  }

  /** One sentence of an LLM reply, voiced by the TTS server through /api/tts. */
  private async live(text: string, exp: number, sig: string): Promise<AudioBuffer | null> {
    const m = await this.loadManifest();
    if (!m) return null; // no clips recorded yet, so no fingerprint to match
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: this.lang, text, exp, sig, fp: m.fingerprint }),
      });
      if (res.status === 409) {
        // The server's voice no longer matches the clips: stay silent rather than mix voices.
        this.liveOff = true;
        console.warn("[voice] the live voice doesn't match the recorded clips; rerun npm run chat:voice");
        return null;
      }
      if (!res.ok) throw new Error(String(res.status));
      return await this.context().decodeAudioData(await res.arrayBuffer());
    } catch {
      if (++this.liveFailures >= MAX_LIVE_FAILURES) this.liveOff = true;
      return null;
    }
  }

  /* ---------- Playing ---------- */

  private async loop(gen: number) {
    while (gen === this.gen) {
      const seg = this.queue.shift();
      if (!seg) {
        if (!this.open) break;
        await new Promise<void>((r) => (this.wake = r));
        continue;
      }
      const buffer = await seg.buffer;
      if (gen !== this.gen) return;
      if (!buffer) continue;
      if (!(await this.play(buffer, gen))) return;
      if (gen === this.gen && (this.queue.length || this.open)) await sleep(GAP_MS);
    }
    if (gen === this.gen) {
      this.playing = false;
      this.endSpeech();
    }
  }

  /** Plays one buffer to the end. Returns false if audio isn't allowed yet (no gesture). */
  private async play(buffer: AudioBuffer, gen: number): Promise<boolean> {
    const ctx = this.context();
    if (ctx.state !== "running") await ctx.resume().catch(() => {});
    if (ctx.state !== "running" || gen !== this.gen) {
      if (gen === this.gen) this.stop();
      return false;
    }
    if (!this.speaking) {
      this.speaking = true;
      emit("character:speech-start", { analyser: this.analyser });
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser!);
    this.source = src;
    await new Promise<void>((resolve) => {
      src.onended = () => resolve();
      src.start();
    });
    if (this.source === src) this.source = null;
    return true;
  }

  /** Stops speaking and drops everything queued. */
  stop() {
    this.gen++;
    this.queue = [];
    this.open = false;
    this.playing = false;
    const src = this.source;
    this.source = null;
    try {
      src?.stop();
    } catch {
      /* already stopped */
    }
    this.notify();
    this.endSpeech();
  }

  private endSpeech() {
    if (!this.speaking) return;
    this.speaking = false;
    emit("character:speech-end");
  }
}
