import assert from "node:assert/strict";
import { test } from "node:test";
import { fuzzyRoute, MATCH_CONFIG, phonemeRoute, similarity, weightedLcs } from "../../src/lib/chat/match.ts";
import { normalizeText } from "../../src/lib/chat/normalize.ts";
import { encodeArpabet, makeEnglishPhonemizer } from "../../src/lib/chat/phonemes.ts";
import type { ContextEntry } from "../../src/lib/chat/types.ts";

// CMUdict pronunciations for the paper's example (Sec. 3.3).
const dict: Record<string, string> = Object.fromEntries(
  Object.entries({
    how: "HH AW1", to: "T UW1", can: "K AE1 N", i: "AY1", fix: "F IH1 K S", a: "AH0", leaky: "L IY1 K IY0",
    bathroom: "B AE1 TH R UW2 M", faucet: "F AO1 S AH0 T", for: "F AO1 R", sit: "S IH1 T",
    paint: "P EY1 N T", wood: "W UH1 D", fence: "F EH1 N S", clean: "K L IY1 N", carpet: "K AA1 R P AH0 T",
  }).map(([w, p]) => [w, encodeArpabet(p)]),
);
const phonemize = makeEnglishPhonemizer(dict);
const entry = (id: string, text: string): ContextEntry => ({ id, text, norm: normalizeText(text, "en"), ph: phonemize(text).ph });
const ctx = [entry("faucet", "how to fix a bathroom faucet"), entry("fence", "how to paint a wood fence"), entry("carpet", "how to clean a carpet")];

test("similarity", () => {
  assert.equal(similarity("abc", "abc"), 1);
  assert.equal(similarity("kitten", "sitting"), 1 - 3 / 7);
});

test("weighted LCS reports where the match sits in the hypothesis", () => {
  const r = weightedLcs("xxabcxx", "abc", () => 1);
  assert.deepEqual(r, { weight: 3, first: 2, last: 4 });
  assert.equal(weightedLcs("ab", "ab", (c) => (c === "a" ? 0.5 : 1)).weight, 1.5);
});

test("fuzzy: top hypothesis answers directly, a lower one asks for confirmation", () => {
  const cfg = MATCH_CONFIG.en;
  const top = fuzzyRoute([normalizeText("How to fix the bathroom faucets?", "en")], ctx, cfg);
  assert.deepEqual(top, { kind: "faq", id: "faucet", confirm: false, via: "fuzzy", score: 1 });
  const lower = fuzzyRoute(["something else entirely", normalizeText("how to clean a carpet", "en")], ctx, cfg);
  assert.equal(lower.kind === "faq" && lower.confirm, true);
});

test('phonetic: "for sit" is matched to "faucet", skipping the inserted "leaky"', () => {
  const r = phonemeRoute(phonemize("how can i fix a leaky bathroom for sit").ph, ctx, "en", MATCH_CONFIG.en);
  assert.equal(r.kind, "faq");
  assert.equal(r.kind === "faq" && r.id, "faucet");
  assert.equal(r.kind === "faq" && r.confirm, true);
});

test("phonetic: unrelated speech matches nothing", () => {
  const r = phonemeRoute(phonemize("paint").ph, ctx, "en", MATCH_CONFIG.en);
  assert.equal(r.kind, "none");
});
