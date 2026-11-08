// The two routing steps, kept separate so the browser can run the fuzzy step instantly on the
// main thread and the phonetic step in a Web Worker. The eval script runs both in sequence.
import { fuzzyRoute, MATCH_CONFIG, phonemeRoute } from "./match.ts";
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
  const alts = input.alternatives.map((a) => normalizeText(a, ctx.lang));
  return fuzzyRoute(alts, ctx.entries, MATCH_CONFIG[ctx.lang]);
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
  return r.kind === "faq" ? r : routePhoneme(input, ctx, phonemize);
}
