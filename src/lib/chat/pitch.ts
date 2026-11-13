// When Shino nods while the visitor talks: Ward & Tsukahara's low-pitch rule.
//
// Ward, N. & Tsukahara, W. (2000). Prosodic features which cue back-channel responses in English
// and Japanese. Journal of Pragmatics 32(8), 1177-1207. A region of low pitch late in an
// utterance invites a backchannel, in both languages; the onset of a pause adds little beyond it.
// Their rules, with the parameters used here (PITCH_RULE):
//   English:  pitch below the 26th percentile for 110 ms, after 700 ms of speech, no
//             backchannel in the last 800 ms: backchannel 700 ms later.
//   Japanese: below the 28th percentile for 110 ms, after 700 ms of speech, none in the last
//             1.0 s: backchannel 350 ms later (Japanese listeners respond about twice as fast).
// The percentile is the visitor's own pitch range, learned as they talk. When the rule fires,
// conversation.ts says a spoken backchannel if one is due (TURN_CONFIG.vocal), or nods. Nods also
// come in pauses and during long stretches (ListeningNods, turn.ts), whether or not this fires.
//
// Pure: frames go in, decisions come out, so the tests run it on synthetic signals.
import type { Lang } from "./types.ts";

export const PITCH_RULE = {
  percentile: { en: 26, ja: 28 } as Record<Lang, number>,
  minLowMs: 110, // the low-pitch region must last this long
  minSpeechMs: 700, // and come after this much speech in the turn
  delayMs: { en: 700, ja: 350 } as Record<Lang, number>, // then nod this much later
  refractoryMs: { en: 800, ja: 1000 } as Record<Lang, number>, // not within this long of the last nod
  // Unvoiced frames shorter than this inside a low region (a consonant) don't end it.
  bridgeMs: 40,
  calibrationFrames: 50, // voiced frames (about 1 s of voice) before the percentile is trusted
  historyFrames: 1500, // the percentile follows the last ~30 s of voice
};

export const PITCH_ESTIMATE = {
  minHz: 60,
  maxHz: 500,
  targetRate: 12_000, // samples are decimated to about this rate first, to keep it cheap
  threshold: 0.15, // YIN: below this, the frame is voiced
};

/**
 * Fundamental frequency of a frame of samples (Hz), or null if it isn't voiced. YIN (de Cheveigné
 * & Kawahara, 2002) on a decimated copy: about 50k operations per 20 ms frame.
 */
export function estimatePitch(samples: Float32Array, sampleRate: number, cfg = PITCH_ESTIMATE): number | null {
  // Decimate by averaging (a crude low-pass, enough for F0 under 500 Hz).
  const factor = Math.max(1, Math.floor(sampleRate / cfg.targetRate));
  const rate = sampleRate / factor;
  const n = Math.floor(samples.length / factor);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += samples[i * factor + k];
    x[i] = s / factor;
  }
  const minLag = Math.max(2, Math.floor(rate / cfg.maxHz));
  const maxLag = Math.min(Math.floor(rate / cfg.minHz), Math.floor(n / 2));
  if (maxLag <= minLag + 2) return null;
  const w = n - maxLag; // integration window
  // Difference function and its cumulative mean normalization.
  const d = new Float32Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let i = 0; i < w; i++) {
      const diff = x[i] - x[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  let running = 0;
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  // The first dip below the threshold, then down to its local minimum.
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < cfg.threshold) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // Parabolic interpolation around the minimum, for sub-sample precision.
  const a = cmnd[tau - 1] ?? cmnd[tau];
  const b = cmnd[tau];
  const c = cmnd[tau + 1] ?? cmnd[tau];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  return rate / (tau + Math.max(-0.5, Math.min(0.5, shift)));
}

/** The visitor's pitch range: percentiles over their recent voiced frames. */
export class PitchRange {
  private history: number[] = [];
  private sorted: number[] | null = null;
  private cfg: typeof PITCH_RULE;

  constructor(cfg = PITCH_RULE) {
    this.cfg = cfg;
  }

  add(hz: number) {
    this.history.push(hz);
    if (this.history.length > this.cfg.historyFrames) this.history.shift();
    this.sorted = null;
  }

  get calibrated() {
    return this.history.length >= this.cfg.calibrationFrames;
  }

  /** The pitch below which `p` percent of the visitor's voiced frames fall. */
  percentile(p: number): number {
    this.sorted ??= [...this.history].sort((a, b) => a - b);
    if (!this.sorted.length) return 0;
    const i = Math.min(this.sorted.length - 1, Math.max(0, Math.floor((p / 100) * this.sorted.length)));
    return this.sorted[i];
  }
}

/**
 * The rule itself. Feed one frame at a time; it returns the time to nod when a low-pitch region
 * has qualified, or null. The caller nods at that time unless the turn has ended or Shino is
 * talking by then, and reports nods with `nodded` (pause nods included) for the refractory period.
 */
export class LowPitchRule {
  readonly range: PitchRange;
  private lang: Lang;
  private cfg: typeof PITCH_RULE;
  private lowSince: number | null = null;
  private lastLowAt = -Infinity;
  private firedThisRegion = false;
  private lastNodAt = -Infinity;
  private pendingAt: number | null = null;

  constructor(lang: Lang, cfg = PITCH_RULE, range = new PitchRange(cfg)) {
    this.lang = lang;
    this.cfg = cfg;
    this.range = range;
  }

  /**
   * One frame: `hz` is the pitch (null if unvoiced), `spokenMs` how much the visitor has said in
   * this turn so far. Returns a nod time when the rule fires.
   */
  push(now: number, hz: number | null, spokenMs: number): number | null {
    const c = this.cfg;
    let fired: number | null = null;
    if (hz !== null) {
      // Judge against the range before this frame joins it.
      const low = this.range.calibrated && hz < this.range.percentile(c.percentile[this.lang]);
      this.range.add(hz);
      if (low) {
        this.lowSince ??= now;
        this.lastLowAt = now;
        if (
          !this.firedThisRegion &&
          now - this.lowSince >= c.minLowMs &&
          spokenMs >= c.minSpeechMs &&
          now - this.lastNodAt >= c.refractoryMs[this.lang] &&
          this.pendingAt === null
        ) {
          this.firedThisRegion = true;
          this.pendingAt = now + c.delayMs[this.lang];
          fired = this.pendingAt;
        }
      } else this.endRegion();
    } else if (now - this.lastLowAt > c.bridgeMs) this.endRegion();
    return fired;
  }

  /** A nod that's due now, if any (consumes it). */
  due(now: number): boolean {
    if (this.pendingAt === null || now < this.pendingAt) return false;
    this.pendingAt = null;
    return true;
  }

  /** Drops a pending nod (the turn ended, or Shino started talking). */
  cancel() {
    this.pendingAt = null;
    this.endRegion();
  }

  /** Any nod, by this rule or the pause fallback, starts the refractory period. */
  nodded(now: number) {
    this.lastNodAt = now;
  }

  get calibrated() {
    return this.range.calibrated;
  }

  private endRegion() {
    this.lowSince = null;
    this.firedThisRegion = false;
  }
}
