// The only dynamic part of the site. wrangler.jsonc routes just /api/* here
// (run_worker_first), so static pages never count toward the Workers request quota.
//
// POST /api/chat, in order of cost:
//   1. free checks: origin, size, shape, turn count
//   2. per-visitor rate limits (Workers Rate Limiting)
//   3. one embedding + one Vectorize query
//   4. off-topic gate: nothing on the site is similar -> canned reply, no LLM
//   5. global daily LLM budget (Durable Object)
//   6. Gemini, then Workers AI if Gemini fails before its first token (own, smaller budget)
// Each reply is also cut into signed sentences ("say" events) for Shino's live voice.
//
// POST /api/tts: voices one signed sentence through the TTS server (see tts.ts).
import { canned, pick, systemPrompt, type Passage } from "./prompt.ts";
import { gemini, workersAi } from "./llm.ts";
import { SayStream, tts } from "./tts.ts";
import type { ChatEnv } from "./env.ts";
import type { ApiErrorCode, ChatMessage, Lang, Link, ServerEvent } from "../src/lib/chat/types.ts";

export { Budget } from "./budget.ts";

const MAX_BODY = 16_000; // bytes
const MAX_QUESTION = 500; // characters, latest message
const MAX_MESSAGE = 1_500; // characters, earlier messages
const MAX_MESSAGES = 8;
const TOP_K = 6;
const PASSAGES = 4;

export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/chat") return chat(req, env, ctx, url);
    if (url.pathname === "/api/telemetry") return telemetry(req, env, url);
    if (url.pathname === "/api/tts") return tts(req, env, ctx, url, originAllowed(req, env, url));
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<ChatEnv>;

const json = (status: number, error: ApiErrorCode) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json" } });

function originAllowed(req: Request, env: ChatEnv, url: URL): boolean {
  const origin = req.headers.get("Origin");
  if (!origin) return false;
  const extra = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  return origin === url.origin || extra.includes(origin);
}

async function rateLimited(req: Request, env: ChatEnv): Promise<boolean> {
  const key = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const [burst, sustained] = await Promise.all([env.CHAT_BURST.limit({ key }), env.CHAT_SUSTAINED.limit({ key })]);
  return !burst.success || !sustained.success;
}

function parseBody(raw: string): { lang: Lang; messages: ChatMessage[] } | ApiErrorCode {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return "bad_request";
  }
  const b = body as { lang?: unknown; messages?: unknown };
  if ((b.lang !== "en" && b.lang !== "ja") || !Array.isArray(b.messages) || !b.messages.length) return "bad_request";
  const messages: ChatMessage[] = [];
  for (const m of b.messages.slice(-MAX_MESSAGES) as { role?: unknown; content?: unknown }[]) {
    if ((m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return "bad_request";
    messages.push({ role: m.role, content: m.content.trim().slice(0, MAX_MESSAGE) });
  }
  while (messages.length && messages[0].role !== "user") messages.shift(); // Gemini wants a user turn first
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || !last.content) return "bad_request";
  if (last.content.length > MAX_QUESTION) return "too_long";
  return { lang: b.lang, messages };
}

async function chat(req: Request, env: ChatEnv, ctx: ExecutionContext, url: URL): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!originAllowed(req, env, url)) return new Response("Forbidden", { status: 403 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json(413, "too_long");
  const parsed = parseBody(raw);
  if (typeof parsed === "string") return json(parsed === "too_long" ? 413 : 400, parsed);
  const { lang, messages } = parsed;
  if (await rateLimited(req, env)) return json(429, "rate_limited");

  // Retrieval query: the question plus the previous one, so follow-ups like
  // "how did you evaluate it?" keep their subject without an LLM rewrite.
  const users = messages.filter((m) => m.role === "user");
  const question = users[users.length - 1].content;
  const query = users.slice(-2).map((m) => m.content).join("\n");

  let matches: VectorizeMatch[];
  try {
    const emb = (await env.AI.run(env.EMBED_MODEL as Parameters<Ai["run"]>[0], { text: [query] })) as { data?: number[][] };
    const vector = emb.data?.[0];
    if (!vector) throw new Error("no embedding returned");
    const res = await env.VECTORIZE.query(vector, { topK: TOP_K, returnMetadata: "all", filter: { scope: { $in: [lang, "all"] } } });
    matches = res.matches;
  } catch (e) {
    log({ event: "chat_error", stage: "retrieval", message: String(e) });
    return json(503, "unavailable");
  }

  const topScore = matches[0]?.score ?? 0;
  const threshold = Number(env.OFFTOPIC_THRESHOLD);
  if (topScore < threshold) {
    log({ event: "chat_offtopic", lang, question, topScore });
    const reply = pick(canned.offtopic[lang]);
    // Pre-recorded, so the browser normally plays the clip; the signed units are a fallback.
    const say = new SayStream(env, lang);
    const units = [...(await say.push(reply)), ...(await say.flush())];
    return sse([{ type: "meta", mode: "canned", reason: "offtopic" }, { type: "delta", text: reply }, ...units, { type: "done" }]);
  }

  const budget = env.BUDGET.get(env.BUDGET.idFromName("global"));
  if (!(await budget.take("llm", Number(env.DAILY_LLM_LIMIT)))) {
    log({ event: "chat_budget", kind: "llm" });
    return json(429, "daily_limit");
  }

  const passages: Passage[] = matches
    .filter((m) => m.score >= threshold)
    .slice(0, PASSAGES)
    .map((m) => {
      const md = m.metadata as Record<string, string>;
      return { title: md.title, url: md.url, text: md.text };
    });
  const seen = new Set<string>();
  const sources: Link[] = passages
    .filter((p) => p.url && !seen.has(p.url) && seen.add(p.url))
    .map((p) => ({ label: p.title, href: p.url }));
  const system = systemPrompt(lang, passages);
  // FAQ answers among the matches become the follow-up chips after this answer (free for the browser).
  const related = [...new Set(matches.map((m) => (m.metadata as Record<string, string> | undefined)?.faqId).filter((x): x is string => !!x))];

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (ev: ServerEvent) => writer.write(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));

  ctx.waitUntil(
    (async () => {
      let provider = "gemini";
      let answer = "";
      let failure: string | undefined;
      const say = new SayStream(env, lang);
      // Each chunk goes out as text first; a sentence's "say" event follows once it's complete.
      const write = async (t: string) => {
        answer += t;
        await send({ type: "delta", text: t });
        for (const ev of await say.push(t)) await send(ev);
      };
      try {
        await send({ type: "meta", mode: "llm", sources, related });
        try {
          for await (const t of gemini(env, system, messages)) await write(t);
        } catch (e) {
          if (answer) throw e; // partway through: don't restart in a different voice
          failure = String(e);
          provider = "workers-ai";
          if (!(await budget.take("fallback", Number(env.DAILY_FALLBACK_LIMIT)))) throw new Error("fallback budget spent");
          for await (const t of workersAi(env, system, messages)) await write(t);
        }
        if (!answer) throw new Error("empty answer");
      } catch (e) {
        failure = String(e);
        await send({ type: "error", code: answer ? "interrupted" : "unavailable" }).catch(() => {});
      } finally {
        for (const ev of await say.flush().catch(() => [])) await send(ev).catch(() => {});
        await send({ type: "done" }).catch(() => {});
        await writer.close().catch(() => {});
        // Questions that reached the LLM: review these and move frequent ones into faq.ts.
        log({ event: "chat_llm", lang, question, topScore, provider, sources: sources.map((s) => s.href), answer, failure });
      }
    })(),
  );
  return new Response(readable, { headers: sseHeaders });
}

const sseHeaders = { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" };

function sse(events: ServerEvent[]): Response {
  return new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: sseHeaders });
}

/** How many ASR alternatives each browser really returns (see asr.ts). Logged, not stored. */
async function telemetry(req: Request, env: ChatEnv, url: URL): Promise<Response> {
  if (req.method !== "POST" || !originAllowed(req, env, url)) return new Response(null, { status: 204 });
  const key = req.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await env.TELEMETRY_LIMIT.limit({ key })).success) return new Response(null, { status: 204 });
  const raw = (await req.text()).slice(0, 500);
  try {
    const d = JSON.parse(raw) as { kind?: unknown; lang?: unknown; n?: unknown; local?: unknown; mode?: unknown };
    if (d.kind === "nbest") {
      const ua = req.headers.get("User-Agent") ?? "";
      // mode: "tap" (one question per tap) or "conversation" (continuous recognition), which
      // can return fewer alternatives in some browsers. Older clients sent no mode: tap.
      const mode = d.mode === "conversation" ? "conversation" : "tap";
      log({ event: "asr_nbest", lang: d.lang, n: Number(d.n), local: !!d.local, mode, browser: browserName(ua) });
    }
  } catch {
    /* ignore malformed telemetry */
  }
  return new Response(null, { status: 204 });
}

function browserName(ua: string): string {
  if (/Edg/i.test(ua)) return "edge";
  if (/Chrome|Chromium/i.test(ua)) return /Android|Mobile/i.test(ua) ? "chrome-android" : "chrome";
  if (/Safari/i.test(ua)) return /iPhone|iPad/i.test(ua) ? "safari-ios" : "safari";
  if (/Firefox/i.test(ua)) return "firefox";
  return "other";
}

/** Structured logs, searchable in Workers Logs (observability is enabled in wrangler.jsonc). */
function log(entry: Record<string, unknown>) {
  console.log(JSON.stringify(entry));
}
