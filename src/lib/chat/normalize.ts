import type { Lang } from "./types.ts";

const EN_DROP = new Set(["a", "an", "the"]);

/** Hiragana -> katakana, so えま and エマ compare equal. */
export function toKatakana(s: string): string {
  return s.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/**
 * Text normalization for fuzzy matching. English drops articles and a plural "s",
 * the kinds of small differences the paper's 96% fuzzy threshold was meant to tolerate.
 */
export function normalizeText(text: string, lang: Lang): string {
  const s = text.normalize("NFKC").toLowerCase();
  if (lang === "ja") return toKatakana(jaSubject(s)).replace(/[\s\p{P}\p{S}]/gu, "");
  return s
    // "Yuya Asano" and "Asano" are the same person as "Yuya" in every phrasing.
    .replace(/\byuya\s+asano\b/g, "yuya")
    .replace(/\basano\b/g, "yuya")
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !EN_DROP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}

// Japanese visitors add a subject the phrasings leave out (「浅野さんはETSで何をしましたか」 vs
// 「ETSでは何をしましたか」), and use 浅野さん where the phrasings may say 浅野. So, on both
// sides: drop honorifics after his name, and drop a leading "浅野は / 浅野の / 彼は" and the like.
const JA_NAME = "(?:浅野|あさの|アサノ|ゆうや|ユウヤ)";
const JA_HONORIFIC = new RegExp(`(${JA_NAME})(?:さん|くん|君|氏)`, "g");
const JA_LEADING_SUBJECT = new RegExp(`^\\s*(?:${JA_NAME}|彼)(?:は|が|って|の)\\s*`);

function jaSubject(s: string): string {
  const t = s.replace(JA_HONORIFIC, "$1");
  const stripped = t.replace(JA_LEADING_SUBJECT, "");
  return stripped || t; // never strip a phrasing down to nothing
}
