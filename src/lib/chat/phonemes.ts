// Phoneme strings for the phonetic matching step.
//
// Every phoneme is encoded as ONE character, so a pronunciation is a plain string and the
// LCS runs over characters. English and Japanese use separate alphabets and are never mixed.
//
// The same code runs at build time (for the FAQ context), in the browser (for ASR hypotheses),
// and in the eval script, so both sides of a comparison are always converted identically.
import { toKatakana } from "./normalize.ts";

/* ---------------- English: ARPAbet ---------------- */

/** The 39 ARPAbet phonemes used by CMUdict (stress digits are stripped). */
export const ARPABET = [
  "AA", "AE", "AH", "AO", "AW", "AY", "B", "CH", "D", "DH", "EH", "ER", "EY", "F", "G", "HH",
  "IH", "IY", "JH", "K", "L", "M", "N", "NG", "OW", "OY", "P", "R", "S", "SH", "T", "TH",
  "UH", "UW", "V", "W", "Y", "Z", "ZH",
] as const;
const EN_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLM";
const EN_CODE = new Map<string, string>(ARPABET.map((p, i) => [p, EN_CHARS[i]]));
const EN_VOWELS = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);
export const EN_VOWEL_CHARS = new Set([...EN_VOWELS].map((p) => EN_CODE.get(p)!));

/** "F AO1 S AH0 T" -> encoded string. Unknown symbols are skipped. */
export function encodeArpabet(pron: string): string {
  let out = "";
  for (const raw of pron.trim().split(/\s+/)) {
    const c = EN_CODE.get(raw.replace(/\d/g, "").toUpperCase());
    if (c) out += c;
  }
  return out;
}

export function decodeEnglish(ph: string): string {
  return [...ph].map((c) => ARPABET[EN_CHARS.indexOf(c)] ?? "?").join(" ");
}

const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
const under100 = (n: number): string[] => (n < 20 ? [ONES[n]] : n % 10 ? [TENS[Math.floor(n / 10)], ONES[n % 10]] : [TENS[n / 10]]);

/**
 * Digits as words, the way people say them: 30 -> thirty, 2025 -> twenty twenty five,
 * other numbers digit by digit. ASR output and the FAQ may write numbers either way, and
 * CMUdict has no entries for digits.
 */
function numberWords(d: string): string[] {
  const n = Number(d);
  if (d.length <= 2) return under100(n);
  if (d.length === 4 && n >= 1100 && n < 2100) {
    const hi = Math.floor(n / 100);
    const lo = n % 100;
    if (lo === 0) return [...under100(hi), "hundred"];
    return [...under100(hi), ...(lo < 10 ? ["oh", ONES[lo]] : under100(lo))];
  }
  return [...d].map((c) => ONES[Number(c)]);
}

/** Lowercase words as CMUdict keys them (apostrophes kept: "don't", "yuya's"); numbers spelled out. */
export function englishWords(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/(\d)([a-z])|([a-z])(\d)/g, "$1$3 $2$4") // 3d -> 3 d
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean)
    .flatMap((w) => (/^\d+$/.test(w) ? numberWords(w) : [w]));
}

export interface PhonemeResult {
  ph: string;
  oov: string[]; // words with no pronunciation; they are skipped (treated as a gap)
}

/** dict: word -> encoded pronunciation (built from CMUdict plus terms.ts overrides). */
export function makeEnglishPhonemizer(dict: Record<string, string>) {
  return (text: string): PhonemeResult => {
    let ph = "";
    const oov: string[] = [];
    for (const w of englishWords(text)) {
      const p = dict[w] ?? (w.endsWith("'s") ? dict[w.slice(0, -2)] : undefined);
      if (p) ph += p;
      else oov.push(w);
    }
    return { ph, oov };
  };
}

/* ---------------- Japanese: kana -> consonant + vowel tokens ---------------- */
//
// Each mora becomes consonant and vowel tokens (カ -> k a), so カ and タ share a vowel while
// カ and ト share nothing. Palatalized morae are split (キャ -> k y a) so they still get partial
// credit against カ. ッ, ン, and the long-vowel mark have their own handling.

type Mora = [consonant: string, vowel: string];
const BASE = new Map<string, Mora>();
function row(kana: string, cons: string | string[]) {
  [...kana].forEach((k, i) => {
    if (k === "・") return;
    BASE.set(k, [Array.isArray(cons) ? cons[i] : cons, "aiueo"[i]]);
  });
}
row("アイウエオ", "");
row("カキクケコ", "k");
row("ガギグゲゴ", "g");
row("サシスセソ", ["s", "sh", "s", "s", "s"]);
row("ザジズゼゾ", ["z", "j", "z", "z", "z"]);
row("タチツテト", ["t", "ch", "ts", "t", "t"]);
row("ダヂヅデド", ["d", "j", "z", "d", "d"]);
row("ナニヌネノ", "n");
row("ハヒフヘホ", ["h", "h", "f", "h", "h"]);
row("バビブベボ", "b");
row("パピプペポ", "p");
row("マミムメモ", "m");
row("ヤ・ユ・ヨ", "y");
row("ラリルレロ", "r");
row("ワヰ・ヱヲ", ["w", "", "", "", ""]);
BASE.set("ヴ", ["v", "u"]);
BASE.set("ヵ", ["k", "a"]);
BASE.set("ヶ", ["k", "e"]);
row("ァィゥェォ", ""); // small vowels on their own

const SMALL_Y = new Map([["ャ", "a"], ["ュ", "u"], ["ョ", "o"]]);
const SMALL_V = new Map([["ァ", "a"], ["ィ", "i"], ["ゥ", "u"], ["ェ", "e"], ["ォ", "o"]]);
const INHERENTLY_PALATAL = new Set(["sh", "ch", "j"]);

/** Katakana (or hiragana) -> tokens such as ["k","y","a","N"]. Non-kana characters are skipped. */
export function kanaToTokens(input: string): string[] {
  const s = toKatakana(input);
  const out: string[] = [];
  let lastVowel = "";
  const push = (c: string, v: string) => {
    if (c) out.push(c);
    out.push(v);
    lastVowel = v;
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1] ?? "";
    if (ch === "ッ") { out.push("Q"); continue; }
    if (ch === "ン") { out.push("N"); continue; }
    if (ch === "ー") { if (lastVowel) out.push(lastVowel); continue; }
    if (ch === "ヮ") { push("w", "a"); continue; }
    const base = BASE.get(ch);
    if (!base) continue;
    const [c] = base;
    if (SMALL_Y.has(next)) {
      // キャ -> k y a, シャ -> sh a, イャ -> y a
      const v = SMALL_Y.get(next)!;
      if (!c) push("y", v);
      else if (INHERENTLY_PALATAL.has(c)) push(c, v);
      else { out.push(c); push("y", v); }
      i++;
      continue;
    }
    if (SMALL_V.has(next) && !SMALL_V.has(ch)) {
      // ファ -> f a, ティ -> t i, ウィ -> w i, イェ -> y e, ヴァ -> v a
      const v = SMALL_V.get(next)!;
      push(c || (ch === "ウ" ? "w" : ch === "イ" ? "y" : ""), v);
      i++;
      continue;
    }
    push(c, base[1]);
  }
  return out;
}

const JA_CODE = new Map<string, string>([
  ...[..."aiueokgsztdnhbpmyrwfvj"].map((c) => [c, c] as [string, string]),
  ["sh", "S"], ["ch", "C"], ["ts", "T"], ["N", "N"], ["Q", "Q"],
]);
export const JA_VOWEL_CHARS = new Set([..."aiueo"]);

export function encodeJapanese(tokens: string[]): string {
  return tokens.map((t) => JA_CODE.get(t) ?? "").join("");
}

/** The subset of a kuromoji token this code reads. */
export interface KuromojiToken {
  surface_form: string;
  pronunciation?: string;
}
export interface Tokenizer {
  tokenize(text: string): KuromojiToken[];
}

const KANJI_DIGITS = "〇一二三四五六七八九";

/**
 * Arabic numerals -> kanji numerals (30 -> 三十, 2025 -> 二千二十五), so kuromoji gives them a
 * reading. Recognizers write "30秒" or "三十秒"; both now get the same phonemes.
 */
export function kanjiNumeral(d: string): string {
  const n = Number(d);
  if (d.length > 4 || n === 0) return [...d].map((c) => KANJI_DIGITS[Number(c)]).join("");
  let out = "";
  for (const [unit, value] of [["千", 1000], ["百", 100], ["十", 10]] as const) {
    const k = Math.floor((n % (value * 10)) / value);
    if (k) out += (k > 1 ? KANJI_DIGITS[k] : "") + unit;
  }
  return out + (n % 10 ? KANJI_DIGITS[n % 10] : "");
}

const KANA_ONLY = /^[\u3041-\u3096\u30a1-\u30fa\u30fc]+$/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * termReadings: surface -> katakana, e.g. { SigIQ: "シグアイキュー", 浅野: "アサノ" }.
 * Terms are replaced by their readings before tokenizing, so names kuromoji would misread
 * or split (and Latin words it has no pronunciation for) still get the right phonemes.
 */
export function makeJapanesePhonemizer(tokenizer: Tokenizer, termReadings: Record<string, string>) {
  const keys = Object.keys(termReadings).sort((a, b) => b.length - a.length);
  const lookup = new Map(keys.map((k) => [k.toLowerCase(), termReadings[k]]));
  const re = keys.length ? new RegExp(keys.map(escapeRe).join("|"), "gi") : null;
  return (text: string): PhonemeResult => {
    let s = text.normalize("NFKC");
    if (re) s = s.replace(re, (m) => lookup.get(m.toLowerCase()) ?? m);
    s = s.replace(/\d+/g, kanjiNumeral);
    let ph = "";
    const oov: string[] = [];
    for (const t of tokenizer.tokenize(s)) {
      const surface = t.surface_form;
      const pron = t.pronunciation && t.pronunciation !== "*" ? t.pronunciation : KANA_ONLY.test(surface) ? surface : "";
      if (pron) ph += encodeJapanese(kanaToTokens(pron));
      else if (/[\p{L}\p{N}]/u.test(surface)) oov.push(surface);
    }
    return { ph, oov };
  };
}
