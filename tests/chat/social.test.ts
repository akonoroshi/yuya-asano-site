import assert from "node:assert/strict";
import { test } from "node:test";
import { classifySocial, stripSocialPrefix } from "../../src/lib/chat/social.ts";

test("English: any combination of social phrases, strongest kind wins", () => {
  const cases: [string, string | null][] = [
    ["thanks", "thanks"], ["Thank you so much!", "thanks"], ["thanks, that was really helpful", "thanks"],
    ["great, thank you!", "thanks"], ["ok thanks", "thanks"], ["thanks for the info, Shino", "thanks"],
    ["that's really helpful", "thanks"], ["cool", "ack"], ["Got it.", "ack"], ["oh interesting", "ack"],
    ["that makes sense", "ack"], ["hi there", "greeting"], ["Good morning!", "greeting"],
    ["ok thanks, bye", "farewell"], ["that's all, thank you", "farewell"],
  ];
  for (const [t, kind] of cases) assert.equal(classifySocial(t, "en"), kind, t);
});

test("English: questions, yes/no, and filler-only text are not social remarks", () => {
  for (const t of ["thanks, what did he do at ETS?", "Hi, what does Yuya research?", "is that all", "yes", "no", "yeah", "so", "", "what is cool about Emma"]) {
    assert.equal(classifySocial(t, "en"), null, t);
  }
});

test("Japanese", () => {
  const cases: [string, string | null][] = [
    ["ありがとうございました！", "thanks"], ["なるほど、ありがとうございます", "thanks"], ["助かりました", "thanks"],
    ["なるほど", "ack"], ["すごいですね", "ack"], ["こんにちは", "greeting"], ["ありがとう、さようなら", "farewell"],
    ["しのさん、本当にありがとう", "thanks"],
    ["なるほど、ETSでは何をしましたか", null], ["はい", null], ["いいえ", null],
  ];
  for (const [t, kind] of cases) assert.equal(classifySocial(t, "ja"), kind, t);
});

test("a pleasantry in front of a question is stripped for matching, and only that", () => {
  assert.equal(stripSocialPrefix("thanks, what did he do at ETS?", "en"), "what did he do at ETS?");
  assert.equal(stripSocialPrefix("ok so is he open to roles", "en"), "is he open to roles");
  assert.equal(stripSocialPrefix("Hi Shino, what does Yuya research?", "en"), "what does Yuya research?");
  assert.equal(stripSocialPrefix("what did he do at ETS?", "en"), "what did he do at ETS?");
  assert.equal(stripSocialPrefix("thanks", "en"), "thanks"); // nothing left: unchanged
  assert.equal(stripSocialPrefix("なるほど。では、ETSでは何をしましたか", "ja"), "ETSでは何をしましたか");
  // Width-normalized (？ -> ?): the result is only used for matching, which drops punctuation.
  assert.equal(stripSocialPrefix("ありがとうございます！浅野さんの研究テーマは？", "ja"), "浅野さんの研究テーマは?");
  assert.equal(stripSocialPrefix("ETSでは何をしましたか", "ja"), "ETSでは何をしましたか");
});
