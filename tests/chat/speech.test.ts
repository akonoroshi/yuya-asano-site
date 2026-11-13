import assert from "node:assert/strict";
import { test } from "node:test";
import { SpeechSegmenter, speechKey, speechText, speechUnits } from "../../src/lib/chat/speech.ts";
import { faq } from "../../src/data/chat/faq.ts";
import { parseTags } from "../../src/lib/chat/tags.ts";
import { SayStream, tts } from "../../worker/tts.ts";

test("English sentences, with abbreviations, initials, and decimals kept together", () => {
  assert.deepEqual(speechUnits("en", "Hi! I'm Shino. Diane J. Litman advised him, e.g. on Emma. It scored 0.85. No. 7 is next."), [
    "Hi!",
    "I'm Shino.",
    "Diane J. Litman advised him, e.g. on Emma.",
    "It scored 0.85.",
    "No. 7 is next.",
  ]);
});

test("a lead-in ending in a colon is its own unit, so the answer after it matches its clip", () => {
  const answer = "Yuya Asano is a PhD candidate. He builds LLM systems.";
  assert.deepEqual(speechUnits("en", `Like I said earlier: ${answer}`), ["Like I said earlier:", ...speechUnits("en", answer)]);
});

test("links are read by their label, email addresses and bare URLs are never read out", () => {
  assert.equal(speechText("en", "See [his CV](/CV_YuyaAsano.pdf) or https://example.com now."), "See his CV or now.");
  // After a colon the sentence just ends; elsewhere the address becomes "the address on screen".
  assert.equal(speechText("en", "Email is the best way to reach him: yuya.asano47@gmail.com."), "Email is the best way to reach him.");
  assert.equal(speechText("en", "You can email him at yuya.asano47@gmail.com."), "You can email him at the address on screen.");
  assert.equal(speechText("ja", "連絡はメールが確実です：yuya.asano47@gmail.com。"), "連絡はメールが確実です。");
  assert.equal(speechText("ja", "yuya.asano47@gmail.com までどうぞ"), "画面のアドレス までどうぞ");
});

test("no curated line reads out an email address", () => {
  for (const lang of ["en", "ja"] as const) {
    for (const e of faq) {
      for (const t of [e.answer[lang], ...(e.alternatives?.[lang] ?? [])]) {
        const spoken = speechUnits(lang, parseTags(t).text).join(" ");
        assert.ok(!/@|gmail|アット|on screen|画面のアドレス/.test(spoken), `${lang} "${e.id}": ${spoken}`);
      }
    }
  }
});

test("Japanese splits after 。！？ and keeps closing brackets with their sentence", () => {
  assert.deepEqual(speechUnits("ja", "「はい。」です！浅野の研究ですか？ええ…そうです。"), ["「はい。」", "です！", "浅野の研究ですか？", "ええ…そうです。"]);
});

test("very long sentences are cut at a comma, and no unit is too long", () => {
  for (const lang of ["en", "ja"] as const) {
    for (const e of faq) {
      for (const u of speechUnits(lang, parseTags(e.answer[lang]).text)) {
        assert.ok(u.length <= (lang === "en" ? 280 : 110), `${lang} "${e.id}": ${u.length} characters`);
      }
    }
  }
  const long = Array.from({ length: 60 }, (_, i) => `part ${i}`).join(", ") + ".";
  const units = speechUnits("en", long);
  assert.ok(units.length > 1);
  assert.equal(units.join(" "), long);
});

test("streamed text gives exactly the units of the whole text, however it's chunked", () => {
  const texts = [
    ...faq.slice(0, 12).flatMap((e) => [parseTags(e.answer.en).text, parseTags(e.answer.ja).text]),
    "No. 7 is fine. See [the paper](https://aclanthology.org/2025.coling-industry.32/). Email yuya.asano47@gmail.com!",
  ];
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (const text of texts) {
    const lang = /[ぁ-んァ-ン一-龯]/.test(text) ? "ja" : "en";
    for (let trial = 0; trial < 5; trial++) {
      const seg = new SpeechSegmenter(lang);
      const got: string[] = [];
      for (let i = 0; i < text.length; ) {
        const n = 1 + Math.floor(rand() * 12);
        got.push(...seg.push(text.slice(i, i + n)));
        i += n;
      }
      got.push(...seg.flush());
      assert.deepEqual(got, speechUnits(lang, text));
    }
  }
});

test("clip keys depend on the voice fingerprint, the language, and the exact unit", async () => {
  const k = await speechKey("0123456789abcdef", "en", "Hi!");
  assert.match(k, /^[0-9a-f]{20}$/);
  assert.equal(k, await speechKey("0123456789abcdef", "en", "Hi!"));
  assert.notEqual(k, await speechKey("fedcba9876543210", "en", "Hi!"));
  assert.notEqual(k, await speechKey("0123456789abcdef", "ja", "Hi!"));
  assert.notEqual(k, await speechKey("0123456789abcdef", "en", "Hi."));
});

/* ---------- Worker: signed sentences and /api/tts ---------- */

function mockEnv(upstream: (body: { lang: string; text: string }, fp: string | null) => Response) {
  const calls: unknown[] = [];
  const store = new Map<string, Response>();
  (globalThis as unknown as { caches: unknown }).caches = {
    default: {
      match: async (r: Request) => store.get(r.url)?.clone(),
      put: async (r: Request, res: Response) => void store.set(r.url, res),
    },
  };
  const headers: Headers[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    headers.push(new Headers(init.headers));
    return upstream(body, new Headers(init.headers).get("X-Expect-Fingerprint"));
  }) as typeof fetch;
  const env = {
    TTS_URL: "https://tts.example",
    TTS_SERVER_TOKEN: "server-token",
    TTS_SIGNING_KEY: "signing-key",
    CF_ACCESS_CLIENT_ID: "access-id",
    CF_ACCESS_CLIENT_SECRET: "access-secret",
    TTS_LIMIT: { limit: async () => ({ success: true }) },
  } as never;
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => waits.push(p) } as never;
  return { env, ctx, calls, waits, headers };
}

const ttsRequest = (body: unknown) =>
  new Request("https://site.example/api/tts", { method: "POST", headers: { Origin: "https://site.example" }, body: JSON.stringify(body) });

test("the Worker signs each sentence of a streamed reply, without its tags", async () => {
  const { env } = mockEnv(() => new Response("x"));
  const say = new SayStream(env, "en");
  const events = [...(await say.push("[emo:happy:0.6]Hello there. Yuya builds")), ...(await say.push(" LLM systems.")), ...(await say.flush())];
  assert.deepEqual(events.map((e) => (e as { text: string }).text), ["Hello there.", "Yuya builds LLM systems."]);
  assert.ok(events.every((e) => e.type === "say" && e.sig.length > 20 && e.exp > Date.now() / 1000));
});

test("/api/tts voices a signed sentence once, then serves it from the edge cache", async () => {
  const { env, ctx, calls, waits, headers } = mockEnv(
    (_b, fp) => new Response(new Uint8Array([1, 2, 3]), { status: fp === "0123456789abcdef" ? 200 : 409, headers: { "Content-Type": "audio/mpeg" } }),
  );
  const s = new SayStream(env, "en");
  const [ev] = [...(await s.push("Hello there. ")), ...(await s.flush())];
  assert.equal(ev.type, "say");
  if (ev.type !== "say") return;
  const body = { lang: "en", text: ev.text, exp: ev.exp, sig: ev.sig, fp: "0123456789abcdef" };
  const url = new URL("https://site.example/api/tts");

  const first = await tts(ttsRequest(body), env, ctx, url, true);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("Content-Type"), "audio/mpeg");
  await Promise.all(waits);
  const second = await tts(ttsRequest(body), env, ctx, url, true);
  assert.equal(second.status, 200);
  assert.equal(calls.length, 1, "the second request came from the cache");
  // Both locks on the TTS server: the Access service token and the bearer token.
  assert.equal(headers[0].get("CF-Access-Client-Id"), "access-id");
  assert.equal(headers[0].get("CF-Access-Client-Secret"), "access-secret");
  assert.equal(headers[0].get("Authorization"), "Bearer server-token");

  // Text that the chat didn't say, a tampered signature, or an expired one: refused.
  assert.equal((await tts(ttsRequest({ ...body, text: "Something else entirely." }), env, ctx, url, true)).status, 403);
  assert.equal((await tts(ttsRequest({ ...body, sig: ev.sig.slice(0, -2) + "AA" }), env, ctx, url, true)).status, 403);
  assert.equal((await tts(ttsRequest({ ...body, exp: ev.exp - 181 }), env, ctx, url, true)).status, 403, "expired after 3 minutes");
  assert.equal((await tts(ttsRequest({ ...body, lang: "ja" }), env, ctx, url, true)).status, 403);
  // Wrong origin.
  assert.equal((await tts(ttsRequest(body), env, ctx, url, false)).status, 403);
  // The clips were recorded with a different voice than the server has now: no mixing.
  assert.equal((await tts(ttsRequest({ ...body, fp: "ffffffffffffffff" }), env, ctx, url, true)).status, 409);
});

test("/api/tts treats a Cloudflare Access refusal (a redirect to its login page) as unavailable, never as audio", async () => {
  const { env, ctx } = mockEnv(() => new Response(null, { status: 302, headers: { Location: "https://example.cloudflareaccess.com/login" } }));
  const s = new SayStream(env, "en");
  const [ev] = [...(await s.push("Hello there. ")), ...(await s.flush())];
  if (ev.type !== "say") return assert.fail("expected a say event");
  const body = { lang: "en", text: ev.text, exp: ev.exp, sig: ev.sig, fp: "0123456789abcdef" };
  const res = await tts(ttsRequest(body), env, ctx, new URL("https://site.example/api/tts"), true);
  assert.equal(res.status, 503);
});
