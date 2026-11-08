// A stand-in for /api/chat, for testing the chat UI with `npm run dev` before setting up
// Vectorize, Workers AI, or Gemini. Development only: api.ts loads this file only when Vite's
// import.meta.env.DEV is true, so it is never part of a production build.
//
// Turn it on by opening any page with ?mock in the URL; it stays on for the browser tab.
// ?mock=<mode> picks what the "server" does:
//   ?mock          answer: streams the closest curated answer, with sources and related chips
//   ?mock=slow     the same, streamed slowly (to watch the caption follow the text)
//   ?mock=cut      the answer stops halfway with an "interrupted" error
//   ?mock=offtopic the canned reply for questions unrelated to Yuya
//   ?mock=error    the server is unavailable before answering
//   ?mock=limit    the daily LLM limit is reached
//   ?mock=rate     the visitor is rate limited
//   ?mock=off      back to the real /api/chat
import { ChatApiError } from "./api.ts";
import { normalizeText } from "./normalize.ts";
import type { ChatContext, ChatMessage, Lang, ServerEvent } from "./types.ts";

const MODES = ["answer", "slow", "cut", "offtopic", "error", "limit", "rate"] as const;
type Mode = (typeof MODES)[number];
const KEY = "chat:mock";

/** The mock mode for this tab, or null to use the real API. Reads ?mock from the URL. */
export function mockMode(): Mode | null {
  if (typeof location === "undefined") return null;
  const param = new URLSearchParams(location.search).get("mock");
  try {
    if (param === "off") sessionStorage.removeItem(KEY);
    else if (param !== null) sessionStorage.setItem(KEY, (MODES as readonly string[]).includes(param) ? param : "answer");
    const mode = sessionStorage.getItem(KEY) as Mode | null;
    if (mode) console.info(`[chat] mock API: ${mode} (open the page with ?mock=off to use the real one)`);
    return mode;
  } catch {
    return null;
  }
}

const contexts = new Map<Lang, Promise<ChatContext>>();
function context(lang: Lang): Promise<ChatContext> {
  if (!contexts.has(lang)) contexts.set(lang, fetch(`/chat/context.${lang}.json`).then((r) => r.json() as Promise<ChatContext>));
  return contexts.get(lang)!;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const STOP = new Set(
  "a an the i you your yuya yuya's he his him me my we our it its is are was were be been do does did what which who how why when where can could would should will about tell for of to in on at with and or from this that these those there any some more".split(" "),
);
/** Content words (English) or pairs of non-hiragana characters (Japanese), for a rough overlap. */
function words(t: string, lang: Lang): string[] {
  const n = normalizeText(t, lang);
  if (lang === "en") return n.split(" ").filter((w) => w && !STOP.has(w));
  const pairs: string[] = [];
  for (let i = 0; i + 1 < n.length; i++) {
    const pair = n.slice(i, i + 2);
    if (!/[\u3041-\u3096]/.test(pair)) pairs.push(pair);
  }
  return pairs;
}

/** Ranks curated topics by word overlap with the question, standing in for retrieval. */
function related(question: string, ctx: ChatContext): string[] {
  const q = new Set(words(question, ctx.lang));
  const score = new Map<string, number>();
  for (const e of ctx.entries) {
    const overlap = words(e.text, ctx.lang).filter((w) => q.has(w)).length;
    if (overlap > (score.get(e.id) ?? 0)) score.set(e.id, overlap);
  }
  return [...score].filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

const prefix: Record<Lang, string> = { en: "(Mock answer) ", ja: "（テスト用の回答）" };
const offtopic: Record<Lang, string> = {
  en: "[emo:concerned:0.3][act:normalize_error]Sorry, I can only talk about Yuya's research, projects, and experience! Try one of the suggested questions, or email him for anything else.",
  ja: "[emo:concerned:0.3][act:normalize_error]ごめんなさい、私がお答えできるのは、浅野の研究やプロジェクト、経歴のことだけなんです。おすすめの質問を試すか、そのほかのことはメールでお問い合わせくださいね。",
};

export async function* mockChat(body: { lang: Lang; messages: ChatMessage[] }, mode: Mode): AsyncGenerator<ServerEvent> {
  await sleep(500); // network and retrieval time
  if (mode === "error") throw new ChatApiError("unavailable");
  if (mode === "limit") throw new ChatApiError("daily_limit");
  if (mode === "rate") throw new ChatApiError("rate_limited");

  const ctx = await context(body.lang);
  const question = body.messages[body.messages.length - 1]?.content ?? "";
  const ids = mode === "offtopic" ? [] : related(question, ctx);
  if (!ids.length) {
    yield { type: "meta", mode: "canned", reason: "offtopic" };
    yield { type: "delta", text: offtopic[body.lang] };
    yield { type: "done" };
    return;
  }

  const top = ctx.answers[ids[0]];
  // Site pages linked from the top related answers stand in for retrieved sources.
  const seen = new Set<string>();
  const sources = ids
    .slice(0, 3)
    .flatMap((id) => ctx.answers[id].links)
    .filter((l) => /^\/(ja\/)?projects\//.test(l.href) && !seen.has(l.href) && !!seen.add(l.href))
    .slice(0, 2);
  yield { type: "meta", mode: "llm", sources, related: ids.slice(0, 3) };
  // Keep the curated answer's tags, so the mock exercises the same events as a real reply.
  const text = top.text.replace(/^((?:\[(?:act|emo):[^\]]+\])*)/, (tags) => `${tags}${prefix[body.lang]}`);
  const chars = Array.from(text);
  const step = mode === "slow" ? 2 : 6;
  for (let i = 0; i < chars.length; i += step) {
    if (mode === "cut" && i > chars.length / 2) {
      yield { type: "error", code: "interrupted" };
      break;
    }
    yield { type: "delta", text: chars.slice(i, i + step).join("") };
    await sleep(mode === "slow" ? 90 : 25);
  }
  yield { type: "done" };
}
