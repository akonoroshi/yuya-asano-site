// Turn-taking for conversation mode: when the visitor has finished speaking, when to nod, and
// when speech over Shino counts as an interruption. Everything here is pure (no DOM, no audio),
// so it runs in Node for the unit tests; conversation.ts feeds it microphone levels and
// recognizer text in the browser.
import { normalizeText } from "./normalize.ts";
import type { Lang } from "./types.ts";

/** All the timing and loudness thresholds in one place. Tune them with real phones. */
export const TURN_CONFIG = {
  vad: {
    frameMs: 20, // how often conversation.ts samples the microphone level
    onsetDb: 12, // louder than the noise floor by this much: speech
    offsetDb: 8, // quieter than floor + this: not speech (lower than onset, so it doesn't flicker)
    onsetMs: 60, // speech must last this long to count (ignores clicks and taps)
    hangoverMs: 160, // short dips inside a word don't end the speech
    floorStartDb: -55, // starting guess for the room's noise floor
    floorRise: 0.02, // per frame, how fast the floor follows a louder room (slow)
    // …and during speech, much slower still. Speech has gaps between words that pull the floor
    // back down; steady noise (a fan) has none, so the floor catches up and the "speech" ends.
    floorRiseSpeaking: 0.003,
    floorFall: 0.2, // per frame, how fast it follows a quieter room (fast)
    minFloorDb: -80,
  },
  endOfTurn: {
    completeMs: 600, // silence that ends a turn that sounds finished ("…is he open to roles")
    defaultMs: 900,
    continuingMs: 1400, // silence that ends a turn ending mid-phrase ("…and", 「…けど」)
    noTextMs: 2500, // voice was heard but the recognizer has no words yet
    finalGraceMs: 500, // after the silence, wait this long for the recognizer's final result
  },
  bargeIn: {
    minSpeechMs: 500, // speech over Shino this long is an interruption…
    // …and so is any recognized word that isn't a backchannel, however short.
  },
  nod: {
    afterPauseMs: [250, 450] as [number, number], // nod this long into a pause (random in range)
    minSpeechMs: 600, // only after the visitor has said something, not after a cough
    cooldownMs: { en: 2500, ja: 1600 } as Record<Lang, number>, // あいづち come more often in Japanese
  },
  idleStopMs: 90_000, // stop listening after this long with no speech, so the mic isn't left on
};

/* ---------- Voice activity from microphone levels ---------- */

export type VadEvent = { type: "speech-start"; at: number } | { type: "speech-end"; at: number };

/**
 * Speech/no-speech from frame levels (dBFS), with a noise floor that adapts to the room.
 * Feed one level per frame; returns the events that frame produced.
 */
export class VadTracker {
  floor: number;
  speaking = false;
  /** When the current speech started (ms), or when the last one did. */
  speechStartedAt = 0;
  /** When the last frame above the offset level was seen (ms). */
  lastLoudAt = -Infinity;
  private aboveSince: number | null = null;
  private cfg: typeof TURN_CONFIG.vad;

  constructor(cfg = TURN_CONFIG.vad) {
    this.cfg = cfg;
    this.floor = cfg.floorStartDb;
  }

  push(db: number, now: number): VadEvent[] {
    const c = this.cfg;
    const level = Math.max(db, c.minFloorDb);
    const events: VadEvent[] = [];
    if (level > this.floor + c.offsetDb) this.lastLoudAt = now;

    if (!this.speaking) {
      if (level > this.floor + c.onsetDb) {
        this.aboveSince ??= now;
        if (now - this.aboveSince >= c.onsetMs) {
          this.speaking = true;
          this.speechStartedAt = this.aboveSince;
          events.push({ type: "speech-start", at: this.aboveSince });
        }
      } else {
        this.aboveSince = null;
        const rate = level > this.floor ? c.floorRise : c.floorFall;
        this.floor = Math.max(c.minFloorDb, this.floor + (level - this.floor) * rate);
      }
    } else {
      const rate = level > this.floor ? c.floorRiseSpeaking : c.floorFall;
      this.floor = Math.max(c.minFloorDb, this.floor + (level - this.floor) * rate);
    }
    if (this.speaking && now - this.lastLoudAt >= c.hangoverMs) {
      this.speaking = false;
      this.aboveSince = null;
      events.push({ type: "speech-end", at: this.lastLoudAt });
    }
    return events;
  }

  /** How long the current speech has lasted, or 0 when silent. */
  speechMs(now: number): number {
    return this.speaking ? now - this.speechStartedAt : 0;
  }
}

/** Root-mean-square level of a block of samples, in dBFS (-100 for silence). */
export function levelDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100;
}

/* ---------- Does the transcript sound finished? ---------- */

// Web Speech results rarely have punctuation, so this goes by the last word.
const EN_CONTINUING = new Set(
  ("and but or so because cause since if when while though although that which who whose whom " +
    "the a an to of in on at for with about from into like as than then " +
    "my your his her their our its is are was were be been am do does did can could would should will " +
    "um uh er erm hmm mm well also plus maybe what's how's").split(" "),
);
// Japanese turns that end like this are usually going on: conjunctive particles, て/で forms,
// hesitations, and "the …" demonstratives.
const JA_CONTINUING = [
  "けど", "けれど", "けれども", "ですが", "ますが", "から", "ので", "のに", "とか", "って", "たり",
  "し", "て", "で", "と", "が", "を", "に", "は", "も", "の",
  "えーと", "えっと", "えー", "あの", "あのー", "その", "そのー", "まあ", "なんか",
];
// …and these usually close a question or request.
const JA_COMPLETE = ["か", "ですか", "ますか", "でしょうか", "ください", "教えて", "おしえて", "ですね", "ますね", "たい", "です", "ます", "の？", "？", "?"];
const EN_QUESTION_START = /^(what|who|where|when|why|how|which|is|are|does|do|did|can|could|would|will|has|have|tell)\b/;

export type Completeness = "complete" | "continuing" | "unknown";

export function completeness(text: string, lang: Lang): Completeness {
  const t = text.trim();
  if (!t) return "unknown";
  if (lang === "ja") {
    const s = t.replace(/[\s。．.、,！!]+$/u, "");
    // Longest match first, so 「ですか」 wins over 「か」 and 「けど」 over 「ど」.
    const ends = (list: string[]) => list.some((w) => s.endsWith(w));
    if (/[？?]$/u.test(t) || ends(JA_COMPLETE.filter((w) => w.length > 1))) return "complete";
    if (ends(JA_CONTINUING)) return "continuing";
    if (s.endsWith("か")) return "complete";
    return "unknown";
  }
  if (/[?.!]$/.test(t)) return "complete";
  const words = t.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").trim().split(/\s+/);
  const last = words[words.length - 1] ?? "";
  if (EN_CONTINUING.has(last)) return "continuing";
  // "what is his dissertation about" is finished; a lone "so" or "Emma" may not be.
  if (words.length >= 3 && EN_QUESTION_START.test(words[0])) return "complete";
  return "unknown";
}

/** How much silence ends the turn, given what the recognizer has heard so far. */
export function endOfTurnDelay(text: string, lang: Lang, cfg = TURN_CONFIG.endOfTurn): number {
  if (!text.trim()) return cfg.noTextMs;
  const c = completeness(text, lang);
  return c === "complete" ? cfg.completeMs : c === "continuing" ? cfg.continuingMs : cfg.defaultMs;
}

/* ---------- Backchannels and interruptions ---------- */

const EN_BACKCHANNEL = new Set([
  "mm", "mmm", "hmm", "mhm", "mm hmm", "mm hm", "uh huh", "uh-huh", "mm-hmm", "yeah", "yes", "yep", "yup",
  "ok", "okay", "right", "sure", "i see", "oh", "ah", "aha", "cool", "nice", "wow", "got it", "oh nice",
  "oh cool", "oh wow", "ha", "haha", "true", "interesting",
]);
const JA_BACKCHANNEL = [
  "うん", "ううん", "はい", "ええ", "へえ", "へー", "ほう", "ほー", "あー", "おー", "ああ", "おお", "ふーん", "ふうん",
  "なるほど", "そうなんだ", "そうなんですね", "そうですね", "そうですか", "そっか", "すごい", "すごいですね", "たしかに", "確かに",
].map((w) => normalizeText(w, "ja"));
const HESITATION = { en: new Set(["um", "uh", "er", "erm", "hmm", "mm", "mmm", "ah"]), ja: ["エート", "エット", "アノー", "アノ", "エー", "ンー", "ウーン"] };

/** "Mm-hmm", 「うん」 and the like: "keep going", not a turn of its own. */
export function isBackchannel(text: string, lang: Lang): boolean {
  if (lang === "ja") {
    let s = normalizeText(text, "ja");
    if (!s) return false;
    // 「うんうん」「はいはい、なるほど」: strip known backchannels until nothing is left.
    for (let changed = true; s && changed; ) {
      changed = false;
      for (const w of JA_BACKCHANNEL) {
        if (w && s.startsWith(w)) {
          s = s.slice(w.length);
          changed = true;
        }
      }
    }
    return s === "";
  }
  const s = text.toLowerCase().replace(/[^\p{L}' -]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!s) return false;
  if (EN_BACKCHANNEL.has(s)) return true;
  // "yeah yeah", "oh okay", "uh huh right"
  const words = s.split(" ");
  return words.length <= 4 && words.every((w, i) => EN_BACKCHANNEL.has(w) || EN_BACKCHANNEL.has(`${words[i - 1]} ${w}`) || EN_BACKCHANNEL.has(`${w} ${words[i + 1]}`));
}

/** Only "um", 「えーと」: never sent as a question. */
export function isHesitation(text: string, lang: Lang): boolean {
  if (lang === "ja") {
    const s = normalizeText(text, "ja").replace(/ー+/g, "ー");
    return !!s && HESITATION.ja.some((h) => s === h || s === h.replace(/ー$/, ""));
  }
  const words = text.toLowerCase().replace(/[^\p{L} ]+/gu, " ").trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => HESITATION.en.has(w));
}

/**
 * While Shino is talking: is the visitor interrupting? Long enough speech is, and so is any
 * recognized word that isn't a backchannel. "Mm-hmm" over her means keep going.
 */
export function isBargeIn(speechMs: number, transcript: string, lang: Lang, cfg = TURN_CONFIG.bargeIn): boolean {
  const t = transcript.trim();
  if (t && !isBackchannel(t, lang) && !isHesitation(t, lang)) return true;
  if (t && isBackchannel(t, lang)) return false;
  return speechMs >= cfg.minSpeechMs;
}

/* ---------- Nodding while the visitor talks ---------- */

/**
 * Decides when Shino nods: a short way into a pause, after some speech, at most once per pause,
 * and not again until the cooldown has passed. `random` is injectable for the tests.
 */
export class NodScheduler {
  private lastNodAt = -Infinity;
  private noddedThisPause = false;
  private target = 0;
  private lang: Lang;
  private cfg: typeof TURN_CONFIG.nod;
  private random: () => number;

  constructor(lang: Lang, cfg = TURN_CONFIG.nod, random = Math.random) {
    this.lang = lang;
    this.cfg = cfg;
    this.random = random;
    this.pickTarget();
  }

  private pickTarget() {
    const [lo, hi] = this.cfg.afterPauseMs;
    this.target = lo + (hi - lo) * this.random();
  }

  /** Call when speech resumes, so the next pause can get a nod. */
  speechResumed() {
    this.noddedThisPause = false;
    this.pickTarget();
  }

  /**
   * Call every frame during a pause in the visitor's turn. `pauseMs` is the silence so far,
   * `spokenMs` how much the visitor has said in this turn. Returns true when it's time to nod.
   */
  shouldNod(now: number, pauseMs: number, spokenMs: number, turnEndMs: number): boolean {
    if (this.noddedThisPause || spokenMs < this.cfg.minSpeechMs) return false;
    if (pauseMs < this.target || pauseMs >= turnEndMs) return false;
    if (now - this.lastNodAt < this.cfg.cooldownMs[this.lang]) return false;
    this.noddedThisPause = true;
    this.lastNodAt = now;
    return true;
  }
}

/* ---------- Answering "Did you mean …?" out loud ---------- */

export type ConfirmRole = "yes" | "as-said" | "else";

const CONFIRM: Record<Lang, Record<ConfirmRole, string[]>> = {
  en: {
    yes: ["yes", "yeah", "yep", "yup", "yes please", "correct", "right", "that's right", "that's it", "exactly", "sure", "uh huh", "mm hmm", "the first one", "first one", "yes that's right", "yeah that's right"],
    "as-said": ["no", "nope", "no thanks", "not really", "not quite", "that's not it", "wrong", "ask what i said", "what i said", "the second one", "second one", "no that's not it"],
    else: ["something else", "never mind", "nevermind", "cancel", "forget it", "skip"],
  },
  ja: {
    yes: ["はい", "うん", "ええ", "そうです", "そう", "合ってます", "合っています", "あってます", "あっています", "それです", "お願いします", "はいそうです", "はいお願いします"],
    "as-said": ["いいえ", "いや", "違います", "ちがいます", "違う", "ちがう", "違いますね", "話したとおり", "話した通り", "いいえ違います"],
    else: ["ほかのこと", "他のこと", "別のこと", "べつのこと", "ほかの質問", "他の質問", "やめます", "やめる", "キャンセル"],
  },
};

const confirmKey = (text: string, lang: Lang) =>
  lang === "ja" ? normalizeText(text, "ja") : text.toLowerCase().replace(/[’`]/g, "'").replace(/[^\p{L}' ]+/gu, " ").replace(/\s+/g, " ").trim();

const CONFIRM_KEYS: Record<Lang, [string, ConfirmRole][]> = {
  en: Object.entries(CONFIRM.en).flatMap(([role, list]) => list.map((w) => [confirmKey(w, "en"), role as ConfirmRole] as [string, ConfirmRole])),
  ja: Object.entries(CONFIRM.ja).flatMap(([role, list]) => list.map((w) => [confirmKey(w, "ja"), role as ConfirmRole] as [string, ConfirmRole])),
};

/**
 * A spoken answer to "Did you mean …?". Returns null for anything longer or different, which
 * is then treated as a new question ("no, I meant his ETS internship").
 */
export function parseConfirm(text: string, lang: Lang): ConfirmRole | null {
  const key = confirmKey(text, lang);
  if (!key) return null;
  for (const [k, role] of CONFIRM_KEYS[lang]) if (key === k) return role;
  // A short reply that starts with a clear yes: "yes please do", 「はい、それで」
  if (lang === "en") {
    const words = key.split(" ");
    if (words.length <= 3 && ["yes", "yeah", "yep", "yup", "correct"].includes(words[0])) return "yes";
  } else if (key.length <= 6 && /^(ハイ|ウン|エエ|ソウデス)/.test(key)) return "yes";
  return null;
}

/* ---------- Joining the recognizer's results into one turn ---------- */

/**
 * Continuous recognition splits a turn into segments, each with its own alternatives. The turn's
 * alternatives are the earlier segments' best guesses followed by each alternative of the last
 * segment, best first and without duplicates. A trailing interim (not yet final) is the last
 * segment with a single alternative.
 */
export function combineSegments(segments: string[][], lang: Lang): string[] {
  const parts = segments.map((alts) => alts.map((a) => a.trim()).filter(Boolean)).filter((alts) => alts.length);
  if (!parts.length) return [];
  const sep = lang === "ja" ? "" : " ";
  const prefix = parts.slice(0, -1).map((alts) => alts[0]).join(sep);
  const joined = parts[parts.length - 1].map((a) => (prefix ? `${prefix}${sep}${a}` : a));
  return [...new Set(joined)];
}

/** Joins a retracted question with what the visitor said next, keeping every alternative. */
export function prependToAlternatives(prefix: string, alternatives: string[], lang: Lang): string[] {
  const sep = lang === "ja" ? "" : " ";
  const p = prefix.trim();
  if (!alternatives.length) return p ? [p] : [];
  return [...new Set(alternatives.map((a) => (p ? `${p}${sep}${a.trim()}` : a.trim())))];
}
