import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeText } from "../../src/lib/chat/normalize.ts";
import { framedVariants, thirdPersonVariants } from "../../src/lib/chat/variants.ts";

test("variants: 'he' and 'Yuya' versions, with verb agreement", () => {
  assert.deepEqual(thirdPersonVariants("What did you do at ETS?"), ["What did he do at ETS?", "What did Yuya do at ETS?"]);
  assert.deepEqual(thirdPersonVariants("Are you open to roles?"), ["Is he open to roles?", "Is Yuya open to roles?"]);
  assert.deepEqual(thirdPersonVariants("Where have you interned?"), ["Where has he interned?", "Where has Yuya interned?"]);
  assert.deepEqual(thirdPersonVariants("Do you have industry experience?"), ["Does he have industry experience?", "Does Yuya have industry experience?"]);
  assert.deepEqual(thirdPersonVariants("What are your research interests?"), ["What are his research interests?", "What are Yuya's research interests?"]);
  assert.deepEqual(thirdPersonVariants("What are you building now?"), ["What is he building now?", "What is Yuya building now?"]);
});

test("variants: none without 'you', or when 'you' is an object (Shino)", () => {
  assert.deepEqual(thirdPersonVariants("Tell me about Emma"), []);
  assert.deepEqual(thirdPersonVariants("Can I talk to you?"), []);
  assert.deepEqual(thirdPersonVariants("Nice to meet you"), []);
});

test("normalize: 'Yuya Asano' and 'Asano' are 'Yuya'", () => {
  assert.equal(normalizeText("What did Yuya Asano build?", "en"), normalizeText("What did Yuya build?", "en"));
  assert.equal(normalizeText("Asano's email", "en"), normalizeText("Yuya's email", "en"));
});

test("normalize: Japanese drops honorifics and a leading subject", () => {
  assert.equal(normalizeText("浅野さんの研究テーマは何ですか", "ja"), normalizeText("研究テーマは何ですか", "ja"));
  assert.equal(normalizeText("彼は仕事を探していますか", "ja"), normalizeText("仕事を探していますか", "ja"));
  assert.equal(normalizeText("浅野さんについて教えて", "ja"), normalizeText("浅野について教えて", "ja"));
  // Not a leading subject: kept
  assert.equal(normalizeText("あなたは浅野さんですか", "ja"), normalizeText("あなたは浅野ですか", "ja"));
  assert.notEqual(normalizeText("あなたは浅野ですか", "ja"), normalizeText("ですか", "ja"));
  // Never stripped to nothing
  assert.ok(normalizeText("浅野は", "ja").length > 0);
});

test("frames: a topic label in common frames; names and acronyms keep their case", () => {
  const en = framedVariants("Research highlights", "en");
  assert.ok(en.includes("Tell me about research highlights") && en.includes("Can you tell me about research highlights?"));
  assert.ok(framedVariants("ETS internship", "en").includes("Tell me about ETS internship"));
  assert.ok(framedVariants("SigIQ internship", "en").includes("What about SigIQ internship?"));
  assert.ok(framedVariants("研究テーマ", "ja").includes("研究テーマについて教えてください"));
});

test("frames: labels that are already a frame get none", () => {
  assert.deepEqual(framedVariants("About Yuya", "en"), []);
  assert.deepEqual(framedVariants("How this chat works", "en"), []);
  assert.deepEqual(framedVariants("浅野について", "ja"), []);
});
