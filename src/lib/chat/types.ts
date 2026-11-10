// Shared types for the chat. Used by the browser, the build scripts, and the eval script,
// so this file (like everything in src/lib/chat) uses only type syntax that Node can strip.
export type Lang = "en" | "ja";

// Behavior tags ([act:…], [emo:…]) are defined in tags.ts.

export interface Link {
  label: string;
  href: string;
}

/** One phrasing of an FAQ question, as stored in the built context file. */
export interface ContextEntry {
  id: string; // FAQ id this phrasing belongs to
  text: string; // phrasing as written
  norm: string; // normalized text, for fuzzy matching
  ph: string; // phoneme string, one character per phoneme (see phonemes.ts)
}

export interface Answer {
  canonical: string; // the question shown in "Did you mean …?" and "You asked"
  chip?: string; // short label when offered as a chip
  parents: string[]; // parent topics in the chip tree, primary first (empty for top-level topics)
  children: string[]; // subtopics, in chip order
  /** May contain [act:…]/[emo:…] tags (tags.ts), removed before display. */
  text: string;
  /** Other phrasings of a short conversational answer; empty for factual answers. */
  alternatives: string[];
  links: Link[];
}

/** public/chat/context.<lang>.json, written by scripts/chat/build-context.mjs */
export interface ChatContext {
  lang: Lang;
  version: string;
  /** FAQ ids of the top-level chips shown at the start. */
  start: string[];
  /** Starting chips for specific pages ("project:<id>", "publications"), from faq.ts. */
  pages: Record<string, string[]>;
  entries: ContextEntry[];
  answers: Record<string, Answer>;
  /** Phrases for ASR contextual biasing. */
  phrases: string[];
  /** Japanese only: surface form -> katakana reading, applied before tokenizing. */
  termReadings: Record<string, string>;
}

export type RouteResult =
  | { kind: "faq"; id: string; confirm: boolean; via: "fuzzy" | "phoneme"; score: number }
  | { kind: "none" };

/** Events the Worker streams back (server-sent events, one JSON object per event). */
export type ServerEvent =
  | { type: "meta"; mode: "llm" | "canned"; reason?: "offtopic"; sources?: Link[]; related?: string[] }
  | { type: "delta"; text: string }
  /** One unit of the reply to speak (speech.ts), signed so /api/tts only voices the site's own replies. */
  | { type: "say"; text: string; exp: number; sig: string }
  | { type: "error"; code: "interrupted" | "unavailable" }
  | { type: "done" };

/** Error codes the Worker returns as JSON with a non-200 status. */
export type ApiErrorCode = "rate_limited" | "turn_limit" | "daily_limit" | "too_long" | "unavailable" | "bad_request";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
