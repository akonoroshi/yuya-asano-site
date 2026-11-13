// Extra phrasings generated at build time, so the fuzzy step matches the way visitors actually
// ask. The FAQ addresses Yuya as "you" ("What did you do at ETS?"), but visitors talk to Shino,
// who talks about Yuya in the third person, so they ask "What did he do at ETS?" or "What did
// Yuya do at ETS?". Japanese needs no variants: its phrasings mostly drop the subject, and
// normalize.ts strips a leading 「浅野さんは」 instead.

/** Auxiliary + "you" -> the third-person form ("are you" -> "is he"). */
const AUX: Record<string, string> = {
  are: "is", were: "was", have: "has", do: "does",
  did: "did", can: "can", could: "could", would: "would", will: "will", should: "should",
};
/** "you" + verb -> the third-person form ("you are" -> "he is"). */
const AFTER: Record<string, string> = { are: "is", were: "was", have: "has", do: "does" };

// "you" as an object ("talk to you", "nice to meet you") usually means Shino, not Yuya.
const OBJECT_YOU = /\b(?:to|with|about|for|from|at|ask|tell|show|call|meet|reach|contact|hire|thank)\s+you\b|\byou\s*[?.!]*$/i;

const keepCase = (from: string, to: string) => (from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);

function rewrite(text: string, subject: string, possessive: string): string {
  return (
    text
      .replace(/\b(are|were|have|do|did|can|could|would|will|should)\s+you\b/gi, (m, aux: string) =>
        keepCase(m, `${AUX[aux.toLowerCase()]} ${subject}`),
      )
      .replace(/\byou\s+(are|were|have|do)\b/gi, (m, verb: string) => keepCase(m, `${subject} ${AFTER[verb.toLowerCase()]}`))
      .replace(/\byou're\b/gi, (m) => keepCase(m, `${subject} is`))
      .replace(/\byou've\b/gi, (m) => keepCase(m, `${subject} has`))
      .replace(/\byourself\b/gi, (m) => keepCase(m, "himself"))
      .replace(/\byours?\b/gi, (m) => keepCase(m, possessive))
      .replace(/\byou\b/gi, (m) => keepCase(m, subject))
  );
}

/**
 * "he" and "Yuya" versions of an English phrasing that addresses Yuya as "you". Returns no
 * variants for phrasings without "you", or where "you" is an object (it usually means Shino).
 */
export function thirdPersonVariants(text: string): string[] {
  if (!/\byou(?:r|rs|rself|'re|'ve)?\b/i.test(text) || OBJECT_YOU.test(text)) return [];
  const out = [rewrite(text, "he", "his"), rewrite(text, "Yuya", "Yuya's")];
  return [...new Set(out)].filter((v) => v !== text);
}

// Common ways to ask about a topic by name. Each topic's chip label is wrapped in these at build
// time, so "Tell me about ETS internship" or 「研究テーマについて教えてください」 matches as a
// whole question and gets the answer directly. Less common frames fall through to containment.
const FRAMES: Record<"en" | "ja", ((x: string) => string)[]> = {
  en: [
    (x) => `Tell me about ${x}`, (x) => `Tell me more about ${x}`, (x) => `Can you tell me about ${x}?`,
    (x) => `Could you tell me about ${x}?`, (x) => `What can you tell me about ${x}?`, (x) => `I'd like to know about ${x}`,
    (x) => `I want to know about ${x}`, (x) => `What about ${x}?`, (x) => `How about ${x}?`,
  ],
  ja: [
    (x) => `${x}について教えてください`, (x) => `${x}について教えて`, (x) => `${x}について詳しく教えてください`,
    (x) => `${x}について知りたいです`, (x) => `${x}について聞きたいです`, (x) => `${x}のことを教えてください`,
    (x) => `${x}のことを聞きたいです`, (x) => `${x}は？`, (x) => `${x}はどうですか`,
  ],
};
// Labels that are already a frame ("About Yuya", 「浅野について」) would make broken sentences.
const ALREADY_FRAMED = { en: /^(about|how|what|why|who|tell)\b/i, ja: /(について|とは)$/ };

/** A topic's label in the common frames, or nothing if the label doesn't fit one. */
export function framedVariants(label: string, lang: "en" | "ja"): string[] {
  const x = label.trim();
  if (!x || ALREADY_FRAMED[lang].test(x)) return [];
  // In English the label goes mid-sentence: lowercase its first letter unless it's a name or an
  // acronym ("ETS internship", "SigIQ internship" stay as they are).
  const mid = lang === "en" && /^[A-Z][a-z]/.test(x) && !/^[A-Z][a-z]+[A-Z]/.test(x) ? x[0].toLowerCase() + x.slice(1) : x;
  return FRAMES[lang].map((f) => f(mid));
}

