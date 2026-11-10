// Bindings and variables, as configured in wrangler.jsonc. Runtime types (Ai, VectorizeIndex,
// RateLimit, ...) come from worker-configuration.d.ts: generate it with `npx wrangler types`.
import type { Budget } from "./budget.ts";

export interface ChatEnv {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  CHAT_BURST: RateLimit;
  CHAT_SUSTAINED: RateLimit;
  TELEMETRY_LIMIT: RateLimit;
  TTS_LIMIT: RateLimit;
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

  // Shino's live voice (see README-voice.md). With TTS_URL empty, replies aren't voiced live.
  TTS_URL: string; // the TTS server behind Cloudflare Tunnel, e.g. https://tts.yuyaasano.dev
  TTS_SERVER_TOKEN: string; // secret, the same value as on the server
  TTS_SIGNING_KEY: string; // secret, any long random string: signs the sentences /api/tts may voice
  // Secrets: the Cloudflare Access service token that guards the tunnel hostname. Optional in
  // code, but set them: without Access, the server token alone opens the TTS server.
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}
