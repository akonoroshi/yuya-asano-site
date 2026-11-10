// Shino's live voice. Curated answers are pre-recorded static files (public/voice/); this is only
// for LLM replies, one sentence at a time.
//
// /api/chat cuts each reply into units (src/lib/chat/speech.ts) and signs each one with
// TTS_SIGNING_KEY. POST /api/tts voices a unit only with a valid, unexpired signature: only text
// this site's chat actually replied, within the chat's own rate limits and daily LLM budget.
// That limits *what* can be voiced, not *who* asks (visitors are anonymous), and it can't tell a
// good reply from one a visitor coaxed out of the LLM: whatever the LLM says gets signed.
//
// The TTS server itself sits behind two locks: Cloudflare Access (a service token, checked at
// Cloudflare's edge before anything reaches the tunnel) and its own bearer token.
//
// POST /api/tts  { lang, text, exp, sig, fp }  -> audio/mpeg
//   fp: the voice fingerprint of the pre-recorded clips (public/voice/manifest.json). The TTS
//   server refuses (409) if its voice has changed since, so live audio never mixes with clips
//   recorded by a different model or lexicon. Answers are cached at the edge by fp and text.
import type { ChatEnv } from "./env.ts";
import { SpeechSegmenter } from "../src/lib/chat/speech.ts";
import { TagStream } from "../src/lib/chat/tags.ts";
import type { Lang, ServerEvent } from "../src/lib/chat/types.ts";

// The browser requests each sentence as soon as its signature arrives, so a short life is
// enough; it limits how long a copied signature can be replayed.
const SIGNATURE_TTL_S = 3 * 60;
const MAX_TEXT = 400;
const UPSTREAM_TIMEOUT_MS = 20_000;
const CACHE_TTL_S = 7 * 24 * 3600;

export const ttsEnabled = (env: ChatEnv) => !!(env.TTS_URL && env.TTS_SERVER_TOKEN && env.TTS_SIGNING_KEY);

let keyCache: { secret: string; key: Promise<CryptoKey> } | null = null;
function hmacKey(secret: string): Promise<CryptoKey> {
  if (keyCache?.secret !== secret) {
    const key = crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    keyCache = { secret, key };
  }
  return keyCache.key;
}

const payload = (lang: Lang, exp: number, text: string) => new TextEncoder().encode(`${lang}\n${exp}\n${text}`);

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function fromB64url(s: string): Uint8Array<ArrayBuffer> | null {
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export async function signUnit(env: ChatEnv, lang: Lang, text: string): Promise<ServerEvent> {
  const exp = Math.floor(Date.now() / 1000) + SIGNATURE_TTL_S;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env.TTS_SIGNING_KEY), payload(lang, exp, text));
  return { type: "say", text, exp, sig: b64url(sig) };
}

async function verifyUnit(env: ChatEnv, lang: Lang, text: string, exp: number, sig: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(exp) || exp < now || exp > now + SIGNATURE_TTL_S + 60) return false;
  const bytes = fromB64url(sig);
  if (!bytes) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(env.TTS_SIGNING_KEY), bytes, payload(lang, exp, text));
}

/**
 * Turns a streamed, tagged reply into signed "say" events, one per speech unit. push() for each
 * chunk, then flush() once at the end. Without TTS configured, both return nothing.
 */
export class SayStream {
  private env: ChatEnv;
  private lang: Lang;
  private tags = new TagStream();
  private units: SpeechSegmenter;
  private on: boolean;

  constructor(env: ChatEnv, lang: Lang) {
    this.env = env;
    this.lang = lang;
    this.units = new SpeechSegmenter(lang);
    this.on = ttsEnabled(env);
  }

  push(tagged: string): Promise<ServerEvent[]> {
    if (!this.on) return Promise.resolve([]);
    return this.sign(this.units.push(this.tags.push(tagged).text));
  }

  flush(): Promise<ServerEvent[]> {
    if (!this.on) return Promise.resolve([]);
    const rest = this.units.push(this.tags.flush().text);
    return this.sign([...rest, ...this.units.flush()]);
  }

  private sign(units: string[]): Promise<ServerEvent[]> {
    return Promise.all(units.map((u) => signUnit(this.env, this.lang, u)));
  }
}

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function tts(req: Request, env: ChatEnv, ctx: ExecutionContext, url: URL, originAllowed: boolean): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!originAllowed) return new Response("Forbidden", { status: 403 });
  if (!ttsEnabled(env)) return json(503, "unavailable");
  const raw = await req.text();
  if (raw.length > 2_000) return json(413, "too_long");
  let body: { lang?: unknown; text?: unknown; exp?: unknown; sig?: unknown; fp?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, "bad_request");
  }
  const { lang, text, exp, sig, fp } = body;
  if ((lang !== "en" && lang !== "ja") || typeof text !== "string" || typeof sig !== "string" || typeof exp !== "number") return json(400, "bad_request");
  if (typeof fp !== "string" || !/^[0-9a-f]{16}$/.test(fp)) return json(400, "bad_request");
  if (!text.trim() || text.length > MAX_TEXT) return json(400, "bad_request");
  if (!(await verifyUnit(env, lang, text, exp, sig))) return json(403, "bad_signature");

  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await env.TTS_LIMIT.limit({ key: ip })).success) return json(429, "rate_limited");

  // Same fingerprint and text: same audio. The edge cache saves the VM for repeated replies
  // (the off-topic redirects, for example, if their clips are missing).
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const hash = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  const cacheKey = new Request(`${url.origin}/__tts-cache/${fp}/${lang}/${hash}.mp3`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let upstream: Response;
  try {
    upstream = await fetch(`${env.TTS_URL.replace(/\/$/, "")}/v1/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.TTS_SERVER_TOKEN}`,
        "X-Expect-Fingerprint": fp,
        ...accessHeaders(env),
      },
      body: JSON.stringify({ lang, text }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      // Cloudflare Access answers a missing or wrong service token with a redirect to its login
      // page; following it would return HTML as if it were audio.
      redirect: "manual",
    });
  } catch (e) {
    log({ event: "tts_error", lang, stage: "fetch", message: String(e) });
    return json(503, "unavailable");
  }
  if ((upstream.status >= 300 && upstream.status < 400) || upstream.status === 403) {
    // Cloudflare Access refused the service token (wrong, expired, or not in the policy).
    log({ event: "tts_error", lang, stage: "access", status: upstream.status });
    return json(503, "unavailable");
  }
  if (upstream.status === 409) {
    // The server's voice changed (an engine upgrade or a lexicon change) and the clips weren't
    // recorded again yet. Live replies stay silent until `npm run chat:voice` is rerun and deployed.
    log({ event: "tts_error", lang, stage: "fingerprint", expected: fp });
    return json(409, "voice_changed");
  }
  if (!upstream.ok || !upstream.body || !upstream.headers.get("Content-Type")?.startsWith("audio/mpeg")) {
    log({ event: "tts_error", lang, stage: "upstream", status: upstream.status });
    return json(503, "unavailable");
  }
  const res = new Response(upstream.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": `public, max-age=${CACHE_TTL_S}` },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/** Cloudflare Access service token headers, if configured. */
function accessHeaders(env: ChatEnv): Record<string, string> {
  return env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET
    ? { "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID, "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET }
    : {};
}

function log(entry: Record<string, unknown>) {
  console.log(JSON.stringify(entry));
}
