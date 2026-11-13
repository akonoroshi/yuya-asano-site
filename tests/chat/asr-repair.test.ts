import assert from "node:assert/strict";
import { test } from "node:test";
import { repairAlternatives, repairTranscript } from "../../src/lib/chat/asr-repair.ts";

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
