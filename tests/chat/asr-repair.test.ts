import assert from "node:assert/strict";
import { test } from "node:test";
import { repairAlternatives, repairTranscript } from "../../src/lib/chat/asr-repair.ts";

test("repairs the site's name in Japanese speech and deduplicates alternatives", () => {
  assert.equal(repairTranscript("佐野さんの研究について教えて", "ja"), "浅野さんの研究について教えて");
  assert.equal(repairTranscript("浅尾さんの研究について教えて", "ja"), "浅野さんの研究について教えて");
  for (const heard of ["朝野", "麻野", "浅埜", "朝尾", "朝の"]) {
    assert.equal(repairTranscript(`${heard}さんについて教えて`, "ja"), "浅野さんについて教えて", heard);
  }
  assert.equal(repairTranscript("朝の研究について教えて", "ja"), "朝の研究について教えて");
  assert.deepEqual(repairAlternatives(["佐野の経歴は？", "浅野の経歴は？"], "ja"), ["浅野の経歴は？"]);
  assert.equal(repairTranscript("佐野さん", "en"), "佐野さん");
});

test("English mishearings of Yuya become Yuya", () => {
  for (const heard of ["you yeah", "You yeah", "you ya", "yu yah", "yoo-ya", "youya", "yoya", "you yuh"]) {
    assert.equal(repairTranscript(`what did ${heard} do at ets`, "en"), "what did Yuya do at ets", heard);
  }
  assert.equal(repairTranscript("what are you yeah's research interests", "en"), "what are Yuya's research interests");
});

test("left alone: thanks, ordinary words, typed-looking text, Japanese", () => {
  assert.equal(repairTranscript("thank you yeah", "en"), "thank you yeah");
  assert.equal(repairTranscript("thanks you ya", "en"), "thanks you ya");
  assert.equal(repairTranscript("do you yearn for yachts", "en"), "do you yearn for yachts");
  assert.equal(repairTranscript("what did you do at ets", "en"), "what did you do at ets");
  assert.equal(repairTranscript("ユウヤはETSで何をしましたか", "ja"), "ユウヤはETSで何をしましたか");
});

test("alternatives are repaired and deduplicated, best first", () => {
  assert.deepEqual(repairAlternatives(["what did you yeah do", "what did you ya do", "what did you do"], "en"), [
    "what did Yuya do",
    "what did you do",
  ]);
});
