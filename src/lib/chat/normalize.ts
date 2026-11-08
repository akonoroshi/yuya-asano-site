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
  if (lang === "ja") return toKatakana(s).replace(/[\s\p{P}\p{S}]/gu, "");
  return s
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !EN_DROP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .join(" ");
}
