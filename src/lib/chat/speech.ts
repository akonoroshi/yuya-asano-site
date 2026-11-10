// What Shino says out loud, split into the units her voice is recorded in. Shared by the browser
// (to find pre-recorded clips), the Worker (to sign live LLM sentences), and
// scripts/chat/render-voice.mjs (to pre-record curated lines), so all three cut text the same way.
// That matters: a clip is found by a hash of its exact unit text (speechKey).
//
// A unit is one sentence (very long sentences are cut at a comma). Pronunciation fixes are not
// applied here: the TTS server applies its lexicon (tts-server/lexicon.json), so the text in a
// unit is what the visitor reads, minus link targets.
//
// Like everything in src/lib/chat, this file uses only type syntax that Node can strip.
import type { Lang } from "./types.ts";

/** Longest unit sent to the TTS server; longer sentences are cut at a comma or a space. */
export const MAX_UNIT: Record<Lang, number> = { en: 280, ja: 110 };

const LINK_RE = /\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g; // same as the caption's renderText
const URL_RE = /\bhttps?:\/\/[^\s)]+/g;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

// English words that end with a period but don't end a sentence.
const ABBREV = new Set(["e.g", "i.e", "etc", "vs", "dr", "mr", "mrs", "ms", "prof", "st", "no", "fig", "approx", "ph.d", "u.s"]);

/** The text as it should be spoken: link labels without their URLs, emails read out, no bare URLs. */
export function speechText(lang: Lang, text: string): string {
  return text
    .replace(LINK_RE, "$1")
    .replace(EMAIL_RE, (m) => speakEmail(lang, m))
    .replace(URL_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

function speakEmail(lang: Lang, email: string): string {
  const [user, domain] = email.split("@");
  const dot = lang === "ja" ? " ドット " : " dot ";
  const at = lang === "ja" ? " アット " : " at ";
  return user.split(".").join(dot) + at + domain.split(".").join(dot);
}

/** Splits spoken text into units: sentences, with very long ones cut at a comma. */
export function speechUnits(lang: Lang, text: string): string[] {
  const s = speechText(lang, text);
  if (!s) return [];
  const sentences = lang === "ja" ? splitJa(s) : splitEn(s);
  return sentences.flatMap((x) => cutLong(lang, x)).filter((x) => /[\p{L}\p{N}]/u.test(x));
}

/*
 * English: a sentence ends at . ! ? … or : (plus closing quotes), followed by a space and a
 * capital letter, digit, or opening quote. The colon is included so that a lead-in like "Like I
 * said earlier:" is its own unit, and the answer after it matches its pre-recorded clip.
 */
const EN_END = /([.!?…:]+["”’)\]]*)\s+(?=["“‘(\[]?[A-Z0-9])/g;

function splitEn(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (const m of s.matchAll(EN_END)) {
    const end = m.index! + m[1].length;
    const piece = s.slice(start, end);
    if (m[1].startsWith(".") && !m[1].startsWith("..") && notSentenceEnd(piece)) continue;
    out.push(piece.trim());
    start = m.index! + m[0].length;
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

/** "e.g." or a middle initial ("Diane J.") before the period. */
function notSentenceEnd(piece: string): boolean {
  const word = /(\S+)\.["”’)\]]*$/.exec(piece)?.[1] ?? "";
  return ABBREV.has(word.toLowerCase()) || /^[A-Z]$/.test(word);
}

/** Japanese: after 。！？!? (and any closing brackets). */
function splitJa(s: string): string[] {
  const out: string[] = [];
  const re = /[。！？!?]+[」』）)】"”]*/g;
  let start = 0;
  for (const m of s.matchAll(re)) {
    const end = m.index! + m[0].length;
    out.push(s.slice(start, end).trim());
    start = end;
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

function cutLong(lang: Lang, s: string): string[] {
  const max = MAX_UNIT[lang];
  if (s.length <= max) return [s];
  const head = s.slice(0, max);
  // Prefer the last comma (or similar) in the first `max` characters, then a space.
  let cut = Math.max(...[...head.matchAll(/[,、，;；:：—]/g)].map((m) => m.index! + 1), -1);
  if (cut < max * 0.3 && lang === "en") cut = head.lastIndexOf(" ");
  if (cut < max * 0.3) cut = max;
  return [s.slice(0, cut).trim(), ...cutLong(lang, s.slice(cut).trim())].filter(Boolean);
}

/**
 * The same units for text that arrives in chunks (LLM replies, in the Worker). A unit is
 * returned once it can't change any more: when the next one has begun. flush() returns the
 * rest. The units returned in total are exactly speechUnits() of the whole text.
 */
export class SpeechSegmenter {
  private lang: Lang;
  private text = "";
  private emitted = 0;

  constructor(lang: Lang) {
    this.lang = lang;
  }

  push(chunk: string): string[] {
    this.text += chunk;
    const units = speechUnits(this.lang, this.text);
    // The last unit may still grow. (With trailing text after a sentence end, the last unit is
    // the new sentence; without it, the sentence itself might not be over: "No. 7" vs "No.")
    const ready = units.slice(this.emitted, Math.max(this.emitted, units.length - 1));
    this.emitted += ready.length;
    return ready;
  }

  flush(): string[] {
    const units = speechUnits(this.lang, this.text);
    const rest = units.slice(this.emitted);
    this.emitted = units.length;
    return rest;
  }
}

/**
 * The file name of a unit's clip: a hash of the voice's fingerprint, the language, and the unit.
 * The fingerprint changes whenever the voice would sound different (engine, model, speaker,
 * lexicon), so an old clip is never played with a new voice.
 */
export async function speechKey(fingerprint: string, lang: Lang, unit: string): Promise<string> {
  const data = new TextEncoder().encode(`${fingerprint}\n${lang}\n${unit}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest.slice(0, 10), (b) => b.toString(16).padStart(2, "0")).join("");
}
