// Keeps the caption in step with Shino's voice. With voice on, each sentence of a reply appears
// while its audio plays, spread over the clip's length, instead of all at once (LLM replies) or
// at a fixed typing speed (curated answers). The voice player reports each unit as it starts
// (voice:unit); the pacer finds that unit in the reply (spokenSpans) and reveals up to it.
//
// When there's no audio for a unit (no clip yet, the TTS server is down), that unit is typed out
// at the normal speed. When no audio comes at all, or the voice stops (barge-in, Voice turned
// off, closing the chat), the rest is shown without waiting.
//
// Pure apart from timers, which are injectable, so the tests run it on a fake clock.
import { spokenSpans } from "./speech.ts";
import type { Lang } from "./types.ts";

export const PACER_CONFIG = {
  typingCps: 75, // the caption's normal speed, for units without audio
  tickMs: 40,
  // Reveal a unit slightly faster than its audio, so the caption never lags the voice.
  audioFraction: 0.92,
  // A sentence that's ready but whose audio hasn't started after this long is typed out anyway
  // (and if no audio has come in this reply at all, the voice is taken to be unavailable).
  waitForAudioMs: 3000,
};

export interface PacerClock {
  now(): number;
  every(ms: number, fn: () => void): () => void; // returns a cancel function
}

const realClock: PacerClock = {
  now: () => performance.now(),
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export class CaptionPacer {
  private lang: Lang;
  private reveal: (pos: number) => void;
  private clock: PacerClock;
  private cfg: typeof PACER_CONFIG;

  private text = "";
  private final = false;
  private spans: { unit: string; end: number }[] = [];
  private cursor = 0; // spans before this have started (or been typed)
  private shown = 0; // characters revealed so far
  private anim: { from: number; to: number; start: number; ms: number } | null = null;
  private audioUntil = -Infinity; // audio is playing until then (any unit, a filler included)
  private heardAudio = false;
  private readySince: number | null = null; // when the unit at the cursor became ready to show
  private unpaced = false; // no audio is coming: show text as it arrives
  private cancel: (() => void) | null = null;
  private resolveDone!: () => void;
  readonly done: Promise<void>;

  constructor(lang: Lang, reveal: (pos: number) => void, clock: PacerClock = realClock, cfg = PACER_CONFIG) {
    this.lang = lang;
    this.reveal = reveal;
    this.clock = clock;
    this.cfg = cfg;
    this.done = new Promise((r) => (this.resolveDone = r));
    this.cancel = clock.every(cfg.tickMs, () => this.tick());
  }

  /** The reply so far (plain text, tags removed). `final` once nothing more will arrive. */
  update(text: string, final: boolean) {
    this.text = text;
    this.final = final;
    this.spans = spokenSpans(this.lang, text);
    this.tick();
  }

  /** Audio for a unit started; it lasts `ms`. Units not in this reply (a filler) only count as audio. */
  unitStarted(unit: string, ms: number) {
    const now = this.clock.now();
    this.audioUntil = now + ms;
    const i = this.find(unit);
    if (i < 0) return;
    this.heardAudio = true;
    this.startUnit(i, ms * this.cfg.audioFraction);
  }

  /** A unit had no audio: type it out. */
  unitSkipped(unit: string) {
    const i = this.find(unit);
    if (i >= 0) this.startUnit(i, this.typingMs(i));
  }

  /** The voice stopped for good: show everything, now and as it arrives. */
  stop() {
    this.unpaced = true;
    this.anim = null;
    this.tick();
  }

  /** Stops the timer without revealing anything (the reply was abandoned). */
  dispose() {
    this.cancel?.();
    this.cancel = null;
  }

  private find(unit: string): number {
    const u = norm(unit);
    for (let i = this.cursor; i < this.spans.length; i++) if (norm(this.spans[i].unit) === u) return i;
    return -1;
  }

  private startOf(i: number) {
    return i > 0 ? this.spans[i - 1].end : 0;
  }

  private typingMs(i: number) {
    return ((this.spans[i].end - this.startOf(i)) / this.cfg.typingCps) * 1000;
  }

  private startUnit(i: number, ms: number) {
    // Anything before this unit (a unit with no audio we never heard about) appears at once.
    this.show(this.startOf(i));
    this.anim = { from: this.startOf(i), to: this.spans[i].end, start: this.clock.now(), ms: Math.max(ms, 1) };
    this.cursor = i + 1;
    this.readySince = null;
  }

  private show(pos: number) {
    const p = Math.min(pos, this.text.length);
    if (p > this.shown) {
      this.shown = p;
      this.reveal(p);
    }
  }

  /** Whether the unit at the cursor is complete (later text exists, or the reply is final). */
  private cursorReady() {
    return this.cursor < this.spans.length && (this.final || this.cursor < this.spans.length - 1);
  }

  private tick() {
    if (!this.cancel) return;
    const now = this.clock.now();
    if (this.unpaced) {
      this.show(this.text.length);
    } else {
      if (this.anim) {
        const t = Math.min(1, (now - this.anim.start) / this.anim.ms);
        this.show(Math.floor(this.anim.from + (this.anim.to - this.anim.from) * t));
        if (t >= 1) this.anim = null;
      }
      if (!this.anim && this.cursorReady()) {
        this.readySince ??= Math.max(now, this.audioUntil);
        if (now - Math.max(this.readySince, this.audioUntil) >= this.cfg.waitForAudioMs) {
          if (!this.heardAudio) {
            // Nothing has played in this reply: the voice isn't coming. Don't wait per sentence.
            this.unpaced = true;
            this.show(this.text.length);
          } else this.startUnit(this.cursor, this.typingMs(this.cursor));
        }
      }
    }
    if (this.final && !this.anim && (this.unpaced || this.cursor >= this.spans.length)) {
      this.show(this.text.length);
      if (this.shown >= this.text.length || !this.text) {
        this.dispose();
        this.resolveDone();
      }
    }
  }
}
