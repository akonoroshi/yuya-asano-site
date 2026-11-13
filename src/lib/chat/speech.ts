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

// An email address is long to listen to and is on screen anyway, so it's never read out. After a
// colon ("Email is the best way to reach him: …") the sentence simply ends; anywhere else (often
// in LLM replies, "email him at …") it becomes "the address on screen".
const EMAIL_AFTER_COLON_RE = /\s*[:：]\s*[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const EMAIL_SPOKEN: Record<Lang, string> = { en: "the address on screen", ja: "画面のアドレス" };

/** The text as it should be spoken: link labels without their URLs, no email addresses, no bare URLs. */
export function speechText(lang: Lang, text: string): string {
  return spokenWithMap(lang, text).spoken;
}

// Sticky versions, tried at each position in one pass (same patterns and priority as above).
const sticky = (re: RegExp) => new RegExp(re.source, "y");
const STICKY = { link: sticky(LINK_RE), emailAfterColon: sticky(EMAIL_AFTER_COLON_RE), email: sticky(EMAIL_RE), url: sticky(URL_RE) };

/**
 * speechText, plus where each spoken character came from in the displayed text: `map[i]` is the
 * index in `text` just after spoken character i. The caption uses it to show each sentence while
 * its audio plays (spokenSpans).
 */
function spokenWithMap(lang: Lang, text: string): { spoken: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  const put = (s: string, end: (k: number) => number) => {
    for (let k = 0; k < s.length; k++) {
      out.push(s[k]);
      map.push(end(k));
    }
  };
  const at = (re: RegExp, i: number) => {
    re.lastIndex = i;
    return re.exec(text);
  };
  for (let i = 0; i < text.length; ) {
    let m: RegExpExecArray | null;
    if ((m = at(STICKY.link, i))) {
      // "[label](url)": the label is spoken; its last character also covers the URL part.
      const label = m[1];
      const labelStart = i + 1;
      const end = i + m[0].length;
      put(label, (k) => (k === label.length - 1 ? end : labelStart + k + 1));
      i = end;
    } else if ((m = at(STICKY.emailAfterColon, i))) {
      // Nothing spoken; the next spoken character (usually the period) covers it.
      i += m[0].length;
    } else if ((m = at(STICKY.email, i))) {
      const end = i + m[0].length;
      put(EMAIL_SPOKEN[lang], () => end);
      i = end;
    } else if ((m = at(STICKY.url, i))) {
      i += m[0].length;
    } else {
      put(text[i], () => i + 1);
      i++;
    }
  }
  // Collapse whitespace runs to one space and trim, keeping the map in step.
  const spoken: string[] = [];
  const smap: number[] = [];
  for (let k = 0; k < out.length; k++) {
    if (/\s/.test(out[k])) {
      if (!spoken.length || spoken[spoken.length - 1] === " ") continue;
      spoken.push(" ");
      smap.push(map[k]);
    } else {
      spoken.push(out[k]);
      smap.push(map[k]);
    }
  }
  while (spoken[spoken.length - 1] === " ") {
    spoken.pop();
    smap.pop();
  }
  return { spoken: spoken.join(""), map: smap };
}

/**
 * Where each spoken unit is in the displayed text: `end` is the index in `text` where its
 * caption is complete. Units are exactly speechUnits(lang, text), in order.
 */
export function spokenSpans(lang: Lang, text: string): { unit: string; end: number }[] {
  const { spoken, map } = spokenWithMap(lang, text);
  const spans: { unit: string; end: number }[] = [];
  let from = 0;
  for (const unit of speechUnits(lang, text)) {
    const i = spoken.indexOf(unit, from);
    if (i < 0) break; // can't happen: units are pieces of the spoken text
    from = i + unit.length;
    spans.push({ unit, end: map[from - 1] });
  }
  // The last unit's caption includes anything after it that isn't spoken (a trailing URL).
  if (spans.length) spans[spans.length - 1].end = Math.max(spans[spans.length - 1].end, trimmedEnd(text));
  return spans;
}

const trimmedEnd = (text: string) => text.replace(/\s+$/, "").length;

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
