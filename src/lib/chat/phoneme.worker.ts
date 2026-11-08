// Runs the phonetic matching step off the main thread, so loading a multi-megabyte dictionary
// and building the kuromoji tokenizer never stalls the character's render loop.
//
// This is a classic (non-module) worker: kuromoji ships a self-contained browser bundle that
// is loaded with importScripts from this site's own /chat/kuromoji/ folder.
import { MATCH_CONFIG, phonemeRoute } from "./match.ts";
import { makeEnglishPhonemizer, makeJapanesePhonemizer, type PhonemeResult, type Tokenizer } from "./phonemes.ts";
import type { ContextEntry, Lang } from "./types.ts";

export type WorkerRequest =
  | { type: "init"; lang: Lang; entries: ContextEntry[]; termReadings: Record<string, string> }
  | { type: "route"; id: number; text: string };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "failed"; message: string }
  | { type: "result"; id: number; result: import("./types.ts").RouteResult; oov: string[] };

interface Kuromoji {
  builder(o: { dicPath: string }): { build(cb: (err: unknown, t: Tokenizer) => void): void };
}
const scope = self as unknown as {
  importScripts(url: string): void;
  postMessage(m: WorkerResponse): void;
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  kuromoji?: Kuromoji;
};

let lang: Lang = "en";
let entries: ContextEntry[] = [];
let phonemize: ((t: string) => PhonemeResult) | null = null;

async function init(m: Extract<WorkerRequest, { type: "init" }>) {
  lang = m.lang;
  entries = m.entries;
  if (lang === "en") {
    const res = await fetch("/chat/cmudict.json");
    if (!res.ok) throw new Error(`cmudict ${res.status}`);
    phonemize = makeEnglishPhonemizer(await res.json());
  } else {
    scope.importScripts("/chat/kuromoji/kuromoji.js");
    const tokenizer = await new Promise<Tokenizer>((resolve, reject) =>
      scope.kuromoji!.builder({ dicPath: "/chat/kuromoji/dict/" }).build((err, t) => (err ? reject(err) : resolve(t))),
    );
    phonemize = makeJapanesePhonemizer(tokenizer, m.termReadings);
  }
}

scope.onmessage = (e) => {
  const m = e.data;
  if (m.type === "init") {
    init(m).then(
      () => scope.postMessage({ type: "ready" }),
      (err) => scope.postMessage({ type: "failed", message: String(err) }),
    );
  } else if (m.type === "route") {
    if (!phonemize) return scope.postMessage({ type: "result", id: m.id, result: { kind: "none" }, oov: [] });
    const { ph, oov } = phonemize(m.text);
    const result = phonemeRoute(ph, entries, lang, MATCH_CONFIG[lang]);
    scope.postMessage({ type: "result", id: m.id, result, oov });
  }
};
