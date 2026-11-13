import assert from "node:assert/strict";
import { test } from "node:test";
import { containRoute, MATCH_CONFIG } from "../../src/lib/chat/match.ts";
import { normalizeText } from "../../src/lib/chat/normalize.ts";
import type { ContextEntry } from "../../src/lib/chat/types.ts";

const entry = (id: string, text: string, lang: "en" | "ja" = "en"): ContextEntry => ({ id, text, norm: normalizeText(text, lang), ph: "" });
const en = [entry("ets", "What did he do at ETS?"), entry("about", "Tell me about Yuya"), entry("privacy", "Privacy"), entry("ets", "ETS internship")];
const route = (q: string, lang: "en" | "ja" = "en", entries = en) => containRoute(normalizeText(q, lang), entries, lang, MATCH_CONFIG[lang]);

test("a phrasing inside a longer question is suggested, always with confirmation", () => {
  const r = route("I was wondering, what did he do at ETS?");
  assert.equal(r.kind, "faq");
  assert.ok(r.kind === "faq" && r.id === "ets" && r.confirm && r.via === "contain");
  assert.equal(route("What did he do at ETS before SigIQ?").kind, "faq");
  assert.equal(route("I was wondering what did he do at ETZ").kind, "faq", "a one-letter typo is fine");
});

test("one-word phrasings (chip labels) and partial words are never looked for inside a question", () => {
  assert.equal(route("What privacy laws apply to student data?").kind, "none"); // "Privacy" is one word
  // "ETS internship" is two words: suggested (confirmed), the trade-off for catching framed questions
  assert.equal(route("Was his ETS internship paid?").kind, "faq");
  assert.equal(route("what did he do").kind, "none");
});

test("the longest phrasing found wins", () => {
  const entries = [...en, entry("about", "Tell me about Yuya"), entry("ets", "Tell me about Yuya's ETS internship")];
  const r = route("so tell me about Yuya's ETS internship please", "en", entries);
  assert.ok(r.kind === "faq" && r.id === "ets");
});

test("Japanese, by characters", () => {
  const ja = [entry("ets", "ETSでは何をしましたか", "ja")];
  const r = route("ちょっと聞きたいんですが、ETSでは何をしましたか", "ja", ja);
  assert.ok(r.kind === "faq" && r.id === "ets" && r.confirm);
  assert.equal(route("ETSの給料はいくらでしたか", "ja", ja).kind, "none");
  assert.equal(route("研究テーマ", "ja", [entry("research", "テーマ", "ja")]).kind, "none", "under 4 characters");
});
