// Bindings and variables, as configured in wrangler.jsonc. Runtime types (Ai, VectorizeIndex,
// RateLimit, ...) come from worker-configuration.d.ts: generate it with `npx wrangler types`.
import type { Budget } from "./budget.ts";

export interface ChatEnv {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CHAT_BURST: RateLimit;
  CHAT_SUSTAINED: RateLimit;
  TELEMETRY_LIMIT: RateLimit;
  BUDGET: DurableObjectNamespace<Budget>;

  GEMINI_API_KEY: string; // secret: npx wrangler secret put GEMINI_API_KEY
  GEMINI_MODEL: string;
  GEMINI_THINKING_LEVEL: string; // "" to leave the model default
  FALLBACK_MODEL: string;
  EMBED_MODEL: string;
  DAILY_LLM_LIMIT: string;
  DAILY_FALLBACK_LIMIT: string;
  OFFTOPIC_THRESHOLD: string;
  AI_GATEWAY_ID: string; // "" to call providers directly
  CF_ACCOUNT_ID: string; // needed only with AI_GATEWAY_ID
  ALLOWED_ORIGINS: string; // extra comma-separated origins, e.g. a preview URL
}
