// Known speech-recognition mishearings, fixed before anything else sees the transcript. English
// recognizers rarely produce "Yuya": they hear "you yeah", "you ya", and the like. Left alone,
// those reach the curated answers only through the phonetic step (always confirmed with "Did you
// mean …?"), and the LLM never learns the question was about Yuya.
//
// Applied to spoken input only (asr.ts and conversation.ts, and the eval's voice rows), never to
// typed text. Add new variants here when you hear them.
import type { Lang } from "./types.ts";

// "you yeah", "you ya", "yu yah", "yoo-ya", "you yeah's" (the 's stays: "Yuya's"), and one-word
// spellings like "youya" or "yoya". Not after "thank": "thank you yeah" is thanks.
const EN_YUYA =
  /(?<!\bthank\s)(?<!\bthanks\s)\b(?:you|yu|yoo)[\s-]*(?:yeah|yea|yah|ya|yuh)\b|\b(?:youya|yuyah|yooya|yoya)\b/gi;

export function repairTranscript(text: string, lang: Lang): string {
  if (lang === "ja") {
    return text.replace(/佐野|浅尾|朝野|麻野|浅埜|朝尾/g, "浅野")
      .replace(/朝の(?=さん|氏|先生)/g, "浅野");
  }
  return text.replace(EN_YUYA, "Yuya");
}

/** The same repair for a recognizer's alternatives, best first and without duplicates. */
export function repairAlternatives(alternatives: string[], lang: Lang): string[] {
  return [...new Set(alternatives.map((a) => repairTranscript(a, lang)))];
}
