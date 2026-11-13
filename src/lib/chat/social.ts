// Social remarks: "thanks", "hi", "bye", "cool". These get a short curated reply instead of an LLM
// call, however they're combined ("ok thanks, that was really helpful!", 「なるほど、ありがとうござい
// ます」). Fuzzy matching compares whole sentences, so it only catches the exact phrasings; this works
// like the backchannel check in turn.ts instead: strip known phrases until nothing is left. Anything
// else in the text (a real question) means it isn't a social remark, and normal matching runs.
//
// Runs before fuzzy matching for typed and spoken input (route.ts), so the eval measures it too.
// "Yes" and "no" are left out on purpose: they answer "Did you mean …?".
import { normalizeText } from "./normalize.ts";
import type { Lang } from "./types.ts";

export type SocialKind = "farewell" | "thanks" | "greeting" | "ack";

/** The curated topic that answers each kind (faq.ts). */
export const SOCIAL_TOPIC: Record<SocialKind, string> = { farewell: "farewell", thanks: "thanks", greeting: "greeting", ack: "ack" };

// When a remark mixes kinds, the first of these wins: "ok thanks, bye" is a farewell.
const STRENGTH: SocialKind[] = ["farewell", "thanks", "greeting", "ack"];

const PHRASES: Record<Lang, Record<SocialKind | "filler", string[]>> = {
  en: {
    farewell: [
      "bye", "bye bye", "goodbye", "good bye", "see you", "see ya", "see you later", "that's all", "that is all", "that's it",
      "i'm done", "im done", "i am done", "have a good day", "have a nice day", "have a great day", "take care", "good night",
    ],
    thanks: [
      "thanks", "thank you", "thank u", "thx", "ty", "many thanks", "much appreciated", "appreciate it", "i appreciate it",
      "appreciated", "that's helpful", "that was helpful", "that's very helpful", "that helps", "that helped", "helpful",
    ],
    greeting: ["hi", "hello", "hey", "hey there", "hi there", "hello there", "good morning", "good afternoon", "good evening", "nice to meet you"],
    ack: [
      "ok", "okay", "cool", "nice", "great", "awesome", "perfect", "got it", "gotcha", "i see", "interesting", "wow", "neat",
      "sounds good", "makes sense", "that makes sense", "alright", "all right", "sure", "fair enough", "good to know",
      "amazing", "impressive", "love it", "that's cool", "that's interesting", "that's great", "that's awesome", "that's neat",
    ],
    // Allowed around the phrases above, but not a remark on their own.
    filler: [
      "so", "much", "very", "really", "a", "lot", "for", "the", "info", "information", "answer", "answers", "help", "your",
      "you", "shino", "again", "oh", "ah", "well", "and", "that", "that's", "this", "it", "it's", "is", "was", "all",
      "everything", "just", "now", "too",
    ],
  },
  ja: {
    farewell: ["さようなら", "さよなら", "またね", "また来ます", "バイバイ", "以上です", "おわります", "終わります", "失礼します", "失礼しました", "おやすみなさい", "じゃあね"],
    thanks: ["ありがとうございました", "ありがとうございます", "どうもありがとう", "ありがとう", "どうも", "助かりました", "助かります", "参考になりました", "勉強になりました", "感謝します"],
    greeting: ["こんにちは", "こんばんは", "おはようございます", "おはよう", "はじめまして", "よろしくお願いします", "よろしく"],
    ack: [
      "なるほど", "そうなんですね", "そうなんだ", "そうですか", "へえ", "へー", "すごいですね", "すごい", "わかりました", "分かりました",
      "了解です", "了解", "いいですね", "いいね", "面白いですね", "おもしろいですね", "面白い", "おもしろい", "興味深いです", "興味深い",
      "さすが", "素晴らしい", "すばらしい", "オッケー",
    ],
    filler: ["しのさん", "しの", "本当に", "ほんとうに", "とても", "すごく", "色々", "いろいろ", "詳しく", "です", "ね", "よ", "あ", "あー", "えー"],
  },
};

type Entry = { kind: SocialKind | "filler"; key: string };

// English: phrases as word sequences, longest first. Japanese: normalized strings, longest first.
const ENTRIES: Record<Lang, Entry[]> = { en: [], ja: [] };
for (const lang of ["en", "ja"] as const) {
  for (const [kind, list] of Object.entries(PHRASES[lang]) as [SocialKind | "filler", string[]][]) {
    for (const p of list) ENTRIES[lang].push({ kind, key: lang === "en" ? enKey(p) : normalizeText(p, "ja") });
  }
  ENTRIES[lang].sort((a, b) => b.key.length - a.key.length);
}

function enKey(text: string): string {
  return text.toLowerCase().replace(/[’`]/g, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** The kind of social remark this is, or null if it's anything else (or contains a question). */
export function classifySocial(text: string, lang: Lang): SocialKind | null {
  const found = new Set<SocialKind>();
  if (lang === "en") {
    let rest = enKey(text);
    if (!rest) return null;
    while (rest) {
      const e = ENTRIES.en.find((x) => rest === x.key || rest.startsWith(`${x.key} `));
      if (!e) return null;
      if (e.kind !== "filler") found.add(e.kind);
      rest = rest.slice(e.key.length).trimStart();
    }
  } else {
    let rest = normalizeText(text, "ja");
    if (!rest) return null;
    while (rest) {
      const e = ENTRIES.ja.find((x) => x.key && rest.startsWith(x.key));
      if (!e) return null;
      if (e.kind !== "filler") found.add(e.kind);
      rest = rest.slice(e.key.length);
    }
  }
  return STRENGTH.find((k) => found.has(k)) ?? null;
}

// Only these may sit between a leading pleasantry and the question ("ok so, what…"): the full
// filler list above has words like "is" and "that" that start real questions.
const PREFIX_FILLER = { en: new Set(["so", "and", "oh", "ah", "well", "then", "shino", "um", "uh"]), ja: ["しのさん", "しの", "あの", "えっと", "では", "じゃあ"] };

/**
 * A question with a pleasantry in front ("thanks, what did he do at ETS?", 「なるほど。では、
 * ETSでは何をしましたか」) without the pleasantry, so matching sees just the question. Returns the
 * text unchanged if it doesn't start with one, or if nothing would be left.
 */
export function stripSocialPrefix(text: string, lang: Lang): string {
  if (lang === "en") {
    const words = text.trim().split(/\s+/);
    let i = 0;
    let social = false;
    while (i < words.length) {
      // The longest social phrase starting at word i (phrases are at most 5 words).
      let took = 0;
      for (let n = Math.min(5, words.length - i); n >= 1 && !took; n--) {
        const key = enKey(words.slice(i, i + n).join(" "));
        const e = ENTRIES.en.find((x) => x.kind !== "filler" && x.key === key);
        if (e) took = n;
      }
      if (took) {
        social = true;
        i += took;
      } else if (PREFIX_FILLER.en.has(enKey(words[i]))) i++;
      else break;
    }
    return social && i < words.length ? words.slice(i).join(" ") : text;
  }
  let rest = text.normalize("NFKC").trim();
  let social = false;
  const skip = () => (rest = rest.replace(/^[\s\p{P}\p{S}]+/u, ""));
  for (skip(); rest; skip()) {
    const phrase = (Object.entries(PHRASES.ja) as [SocialKind | "filler", string[]][])
      .filter(([k]) => k !== "filler")
      .flatMap(([, list]) => list)
      .sort((a, b) => b.length - a.length)
      .find((p) => rest.startsWith(p));
    if (phrase) {
      social = true;
      rest = rest.slice(phrase.length);
      continue;
    }
    const filler = PREFIX_FILLER.ja.find((f) => rest.startsWith(f));
    if (!filler) break;
    rest = rest.slice(filler.length);
  }
  return social && rest ? rest : text;
}

