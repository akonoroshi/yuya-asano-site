// The two routing steps, kept separate so the browser can run the fuzzy step instantly on the
// main thread and the phonetic step in a Web Worker. The eval script runs both in sequence.
import { classifySocial, SOCIAL_TOPIC, stripSocialPrefix } from "./social.ts";
import { containRoute, fuzzyRoute, MATCH_CONFIG, phonemeRoute } from "./match.ts";
import { normalizeText } from "./normalize.ts";
import type { PhonemeResult } from "./phonemes.ts";
import type { ChatContext, RouteResult } from "./types.ts";

export interface RouteInput {
  /** Typed text, or the ASR alternatives best-first when the visitor spoke and didn't edit. */
  alternatives: string[];
  source: "typed" | "voice";
}

/** Step 1, for every input. */
export function routeFuzzy(input: RouteInput, ctx: ChatContext): RouteResult {
  // Social remarks first ("thanks, that was helpful", "cool"): a short curated reply, however
  // they're combined. A real question never consists only of these phrases (social.ts).
  const social = classifySocial(input.alternatives[0] ?? "", ctx.lang);
  if (social && ctx.answers[SOCIAL_TOPIC[social]]) return { kind: "faq", id: SOCIAL_TOPIC[social], confirm: false, via: "social", score: 1 };
  // "Thanks, what did he do at ETS?": match the question without the pleasantry.
  const alts = input.alternatives.map((a) => normalizeText(stripSocialPrefix(a, ctx.lang), ctx.lang));
  return fuzzyRoute(alts, ctx.entries, MATCH_CONFIG[ctx.lang]);
}

// Social replies make no sense as "Did you mean …?" suggestions inside a longer question.
const SOCIAL_IDS = new Set(Object.values(SOCIAL_TOPIC));

/**
 * Step 2, for typed input only: a question that contains a phrasing ("I was wondering, what did
 * he do at ETS?"), always confirmed. Voice gets the phonetic step instead, which does the same by
 * sound and also tolerates misheard words.
 */
export function routeContain(input: RouteInput, ctx: ChatContext): RouteResult {
  if (input.source !== "typed" || !input.alternatives[0]) return { kind: "none" };
  const norm = normalizeText(stripSocialPrefix(input.alternatives[0], ctx.lang), ctx.lang);
  return containRoute(norm, ctx.entries.filter((e) => !SOCIAL_IDS.has(e.id)), ctx.lang, MATCH_CONFIG[ctx.lang]);
}

/**
 * Step 2, for voice input only. Typed text has no recognition errors, so running the
 * phonetic step on it would only add false positives.
 */
export function routePhoneme(input: RouteInput, ctx: ChatContext, phonemize: (t: string) => PhonemeResult): RouteResult {
  if (input.source !== "voice" || !input.alternatives[0]) return { kind: "none" };
  const { ph } = phonemize(input.alternatives[0]);
  return phonemeRoute(ph, ctx.entries, ctx.lang, MATCH_CONFIG[ctx.lang]);
}

export function routeAll(input: RouteInput, ctx: ChatContext, phonemize: (t: string) => PhonemeResult): RouteResult {
  const r = routeFuzzy(input, ctx);
  if (r.kind === "faq") return r;
  const c = routeContain(input, ctx);
  return c.kind === "faq" ? c : routePhoneme(input, ctx, phonemize);
}
