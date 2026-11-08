// Streaming text from Gemini (primary) and Workers AI (fallback). Both yield plain text chunks.
// With AI_GATEWAY_ID set, both go through Cloudflare AI Gateway, which adds logs and a global
// rate limit you can set in the dashboard.
import type { ChatMessage } from "../src/lib/chat/types.ts";
import type { ChatEnv } from "./env.ts";

const MAX_OUTPUT_TOKENS = 500;

/** Yields the data payload of each server-sent event. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = (body as ReadableStream).pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let cut: number;
    while ((cut = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut).replace(/^\r?\n\r?\n/, "");
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) yield data;
    }
  }
}

export async function* gemini(env: ChatEnv, system: string, messages: ChatMessage[]): AsyncGenerator<string> {
  const path = `v1beta/models/${env.GEMINI_MODEL}:streamGenerateContent?alt=sse`;
  const url = env.AI_GATEWAY_ID
    ? `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/google-ai-studio/${path}`
    : `https://generativelanguage.googleapis.com/${path}`;
  const generationConfig: Record<string, unknown> = { maxOutputTokens: MAX_OUTPUT_TOKENS, temperature: 0.4 };
  if (env.GEMINI_THINKING_LEVEL) generationConfig.thinkingConfig = { thinkingLevel: env.GEMINI_THINKING_LEVEL };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok || !res.body) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  for await (const data of sseData(res.body)) {
    const json = JSON.parse(data) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
    for (const part of json.candidates?.[0]?.content?.parts ?? []) {
      if (part.text && !part.thought) yield part.text;
    }
  }
}

export async function* workersAi(env: ChatEnv, system: string, messages: ChatMessage[]): AsyncGenerator<string> {
  const options = env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined;
  const stream = (await env.AI.run(
    env.FALLBACK_MODEL as Parameters<Ai["run"]>[0],
    { messages: [{ role: "system", content: system }, ...messages], stream: true, max_tokens: MAX_OUTPUT_TOKENS },
    options,
  )) as unknown as ReadableStream<Uint8Array>;
  for await (const data of sseData(stream)) {
    if (data === "[DONE]") break;
    const json = JSON.parse(data) as { response?: string };
    if (json.response) yield json.response;
  }
}
