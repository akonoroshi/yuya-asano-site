// Conversation mode: the microphone stays on, and the page (not the browser) decides when the
// visitor has finished a turn. Two inputs, combined every frame:
//   - loudness from the microphone (Web Audio), for when speech starts and stops (VadTracker)
//   - the recognizer's words (Web Speech API, continuous), for what was said and whether it
//     sounds finished (endOfTurnDelay)
// The timing rules live in turn.ts, so they can be unit-tested; this file is the browser glue.
//
// Window events, for the character and the voice player (see README-chat.md):
//   voice:listening   { on, reason? }  the microphone turned on or off
//   voice:speech-start                 the visitor started speaking
//   voice:backchannel                  a good moment to nod while the visitor talks
//   voice:barge-in                     the visitor is talking over Shino: stop her voice
//   voice:turn-end    { alternatives } the visitor finished a turn
import { createRecognition, canRecognizeLocally, markPhrasesUnsupported, report, speechSupported, type Recognition } from "./asr.ts";
import {
  combineSegments,
  endOfTurnDelay,
  isBackchannel,
  isBargeIn,
  isHesitation,
  levelDb,
  NodScheduler,
  TURN_CONFIG,
  VadTracker,
} from "./turn.ts";
import type { Lang } from "./types.ts";

export type StopReason = "user" | "idle" | "hidden" | "not-allowed" | "unsupported" | "failed";

export interface ConversationHandlers {
  /** The words heard so far in this turn ("" when the turn ends). */
  onInterim(text: string): void;
  /** The visitor has clearly started a real turn (not "mm-hmm", not a cough). Once per turn. */
  onUserTalking(): void;
  /** A finished turn: alternatives best first. */
  onTurn(alternatives: string[]): void;
  /** A turn that turned out to be nothing (noise, "um", "mm-hmm" over Shino). */
  onTurnDropped(): void;
  onStop(reason: StopReason): void;
}

const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

// If the recognizer keeps ending right after it starts, continuous mode doesn't work here.
const RESTART_DELAY_MS = 250;
const MAX_QUICK_RESTARTS = 4;
const QUICK_RESTART_WINDOW_MS = 10_000;

interface Segment {
  final: boolean;
  alts: string[];
}

export class ConversationListener {
  private lang: Lang;
  private phrases: string[];
  private h: ConversationHandlers;
  private active = false;
  private local = false;

  // Microphone level
  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private vad = new VadTracker();
  private timer: ReturnType<typeof setInterval> | null = null;

  // Recognition
  private rec: Recognition | null = null;
  private shareTrack = true; // pass our microphone track to recognizers that accept one
  private consumed = 0; // results before this index belong to earlier turns
  private resultCount = 0; // results in this recognition session so far
  private segments: Segment[] = []; // this turn, in this recognition session
  private carry: string[][] = []; // this turn, from a session that ended mid-turn
  private lastResultAt = -Infinity;
  private restarts: number[] = [];

  // Turn state
  private inTurn = false;
  private spokenMs = 0; // speech in this turn, from the microphone level
  private talkingSignalled = false;
  private startedOverShino = false;
  private finalWaitSince: number | null = null;
  private lastActivityAt = 0;
  private nods: NodScheduler;

  // Shino
  private shinoSpeaking = false;
  private bargedThisSpeech = false;

  constructor(lang: Lang, phrases: string[], handlers: ConversationHandlers) {
    this.lang = lang;
    this.phrases = phrases;
    this.h = handlers;
    this.nods = new NodScheduler(lang);
  }

  get isActive() {
    return this.active;
  }

  /**
   * Turns the microphone on. Call from a click or tap: browsers only allow audio to start from
   * one. Rejects with "not-allowed" or "unsupported".
   */
  async start(): Promise<void> {
    if (this.active) return;
    if (!speechSupported()) throw "unsupported" satisfies StopReason;
    // The level meter is optional: without it, turns end on pauses in the recognizer's results.
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.audio = new AudioContext();
      await this.audio.resume();
      const source = this.audio.createMediaStreamSource(this.stream);
      this.analyser = this.audio.createAnalyser();
      this.analyser.fftSize = 1024;
      this.samples = new Float32Array(this.analyser.fftSize);
      source.connect(this.analyser);
    } catch (e) {
      const name = (e as DOMException)?.name;
      this.releaseAudio();
      if (name === "NotAllowedError" || name === "SecurityError") throw "not-allowed" satisfies StopReason;
      console.warn("[chat] microphone level unavailable; ending turns on recognizer pauses:", e);
    }
    this.local = await canRecognizeLocally(this.lang);
    this.active = true;
    this.lastActivityAt = performance.now();
    this.startRecognition();
    if (!this.active) return; // the recognizer refused to start; onStop has been called
    this.timer = setInterval(() => this.tick(), TURN_CONFIG.vad.frameMs);
    emit("voice:listening", { on: true });
  }

  stop(reason: StopReason = "user") {
    if (!this.active) return;
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const rec = this.rec;
    this.rec = null;
    rec?.abort();
    this.releaseAudio();
    this.resetTurn();
    this.h.onInterim("");
    emit("voice:listening", { on: false, reason });
    this.h.onStop(reason);
  }

  /**
   * Whether Shino is talking. While she is, speech that's more than a backchannel is an
   * interruption (voice:barge-in), and "mm-hmm" isn't taken as a question.
   */
  setSpeaking(on: boolean) {
    if (on === this.shinoSpeaking) return;
    this.shinoSpeaking = on;
    this.bargedThisSpeech = false;
    if (on) this.lastActivityAt = performance.now();
  }

  private releaseAudio() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.audio?.close().catch(() => {});
    this.audio = null;
    this.analyser = null;
    this.samples = null;
  }

  /* ---------- Recognition ---------- */

  private startRecognition() {
    if (!this.active) return;
    const rec = createRecognition(this.lang, { local: this.local, phrases: this.phrases, continuous: true });
    this.rec = rec;
    this.consumed = 0;
    this.resultCount = 0;
    let fatal: string | null = null;
    rec.onresult = (e) => {
      if (this.rec !== rec) return;
      this.resultCount = e.results.length;
      const segs: Segment[] = [];
      for (let i = this.consumed; i < e.results.length; i++) {
        const r = e.results[i];
        const alts: string[] = [];
        for (let k = 0; k < r.length; k++) alts.push(r[k].transcript.trim());
        segs.push({ final: r.isFinal, alts: alts.filter(Boolean) });
      }
      this.segments = segs.filter((s) => s.alts.length);
      this.lastResultAt = performance.now();
      this.lastActivityAt = this.lastResultAt;
      if (!this.inTurn && this.segments.length) this.beginTurn(this.lastResultAt);
      this.h.onInterim(this.currentText());
    };
    rec.onerror = (e) => {
      if (this.rec !== rec) return;
      if (e.error === "no-speech" || e.error === "aborted") return;
      fatal = e.error;
    };
    rec.onend = () => {
      if (this.rec !== rec) return; // stopped on purpose, or replaced
      this.rec = null;
      // Keep what this session heard of the current turn; the next session starts its own results.
      if (this.inTurn && this.segments.length) this.carry.push(...this.segments.map((s) => s.alts));
      this.segments = [];
      if (!this.active) return;
      if (fatal === "not-allowed" || fatal === "service-not-allowed") return this.stop("not-allowed");
      if (fatal === "phrases-not-supported") markPhrasesUnsupported();
      else if (fatal === "audio-capture" && this.shareTrack) this.shareTrack = false; // try the recognizer's own capture
      else if (fatal === "language-not-supported") return this.stop("unsupported");
      // Sessions end on their own now and then (long silence, network). Restart, unless it
      // keeps ending right away: then continuous mode doesn't work in this browser.
      const now = performance.now();
      this.restarts = this.restarts.filter((t) => now - t < QUICK_RESTART_WINDOW_MS);
      this.restarts.push(now);
      if (this.restarts.length > MAX_QUICK_RESTARTS && now - this.lastResultAt > QUICK_RESTART_WINDOW_MS) return this.stop("failed");
      setTimeout(() => this.startRecognition(), RESTART_DELAY_MS);
    };
    const track = this.shareTrack ? this.stream?.getAudioTracks()[0] : undefined;
    try {
      // Browsers that don't take a track ignore the argument and use the default microphone.
      rec.start(track);
    } catch (e) {
      if (track) {
        this.shareTrack = false;
        try {
          rec.start();
          return;
        } catch {
          /* fall through */
        }
      }
      console.warn("[chat] continuous recognition failed to start:", e);
      this.rec = null;
      this.stop("failed");
    }
  }

  private currentText(): string {
    return combineSegments([...this.carry, ...this.segments.map((s) => s.alts)], this.lang)[0] ?? "";
  }

  /* ---------- The frame loop ---------- */

  private tick() {
    if (!this.active) return;
    const now = performance.now();
    const hasLevel = !!(this.analyser && this.samples);
    if (hasLevel) {
      this.analyser!.getFloatTimeDomainData(this.samples!);
      for (const ev of this.vad.push(levelDb(this.samples!), now)) {
        if (ev.type === "speech-start") {
          this.lastActivityAt = now;
          this.nods.speechResumed();
          this.finalWaitSince = null;
          if (!this.inTurn) this.beginTurn(ev.at);
          emit("voice:speech-start");
        } else this.spokenMs += Math.max(0, ev.at - this.vad.speechStartedAt);
      }
    }
    const text = this.currentText();

    // Is this turn real? While Shino talks, that's also when to stop her voice.
    const speakingNow = this.vad.speechMs(now);
    if (this.inTurn && !this.talkingSignalled && isBargeIn(this.spokenMs + speakingNow, text, this.lang)) {
      this.talkingSignalled = true;
      this.h.onUserTalking();
    }
    if (this.shinoSpeaking && !this.bargedThisSpeech && (this.vad.speaking || text) && isBargeIn(speakingNow, text, this.lang)) {
      this.bargedThisSpeech = true;
      emit("voice:barge-in");
    }

    if (this.inTurn && !this.vad.speaking) {
      // Silence so far: from the level meter if it heard this turn, else from the recognizer.
      const heard = hasLevel && this.spokenMs > 0;
      const pauseMs = now - (heard ? this.vad.lastLoudAt : this.lastResultAt);
      const endMs = endOfTurnDelay(text, this.lang);
      if (heard && !this.shinoSpeaking && this.nods.shouldNod(now, pauseMs, this.spokenMs, endMs)) emit("voice:backchannel");
      if (pauseMs >= endMs) this.finishTurn(now);
    }

    // Don't leave the microphone on in an empty room.
    if (!this.inTurn && !this.shinoSpeaking && now - this.lastActivityAt > TURN_CONFIG.idleStopMs) this.stop("idle");
  }

  private beginTurn(at: number) {
    this.inTurn = true;
    this.spokenMs = 0;
    this.talkingSignalled = false;
    this.startedOverShino = this.shinoSpeaking;
    this.finalWaitSince = null;
    this.lastActivityAt = at;
  }

  private finishTurn(now: number) {
    // The recognizer's final result (with its alternatives) usually lands just after the
    // silence. Wait briefly for it; if it doesn't come, use the interim words.
    const last = this.segments[this.segments.length - 1];
    if (last && !last.final) {
      this.finalWaitSince ??= now;
      if (now - this.finalWaitSince < TURN_CONFIG.endOfTurn.finalGraceMs) return;
    }
    const alternatives = combineSegments([...this.carry, ...this.segments.map((s) => s.alts)], this.lang);
    const lastFinal = [...this.segments].reverse().find((s) => s.final);
    const overShino = this.startedOverShino;
    // Results up to here belong to this turn, including an interim that may still finalize.
    if (this.rec) this.consumed = this.resultCount;
    this.resetTurn();
    this.h.onInterim("");
    const top = alternatives[0] ?? "";
    if (!top || isHesitation(top, this.lang) || (overShino && isBackchannel(top, this.lang))) {
      this.h.onTurnDropped();
      return;
    }
    if (lastFinal) report(this.lang, lastFinal.alts.length, this.local, "conversation");
    emit("voice:turn-end", { alternatives });
    this.h.onTurn(alternatives);
  }

  private resetTurn() {
    this.inTurn = false;
    this.spokenMs = 0;
    this.talkingSignalled = false;
    this.startedOverShino = false;
    this.finalWaitSince = null;
    this.segments = [];
    this.carry = [];
  }
}
