import assert from "node:assert/strict";
import { test } from "node:test";
import { BackchannelEcho, stripBackchannelEcho } from "../../src/lib/chat/backchannel.ts";

test("English: Shino's own backchannel is removed anywhere in the visitor's sentence", () => {
  assert.equal(stripBackchannelEcho("tell me about mm hmm his research", ["Mm-hmm."], "en"), "tell me about his research");
  assert.equal(stripBackchannelEcho("mhm what did he do at ETS", ["Mm-hmm."], "en"), "what did he do at ETS");
  assert.equal(stripBackchannelEcho("So I was reading about Emma", ["Mm-hmm."], "en"), "So I was reading about Emma", "untouched");
  assert.equal(stripBackchannelEcho("uh huh", ["Uh-huh."], "en"), "");
  assert.equal(stripBackchannelEcho("I see that he worked at ETS", ["I see."], "en"), "that he worked at ETS");
  // Only the lines she actually said
  assert.equal(stripBackchannelEcho("tell me about mm hmm his research", ["Right."], "en"), "tell me about mm hmm his research");
});

test("Japanese: removed only at the start, the end, or as the whole text", () => {
  assert.equal(stripBackchannelEcho("うん", ["うん。"], "ja"), "");
  assert.equal(stripBackchannelEcho("うん、ETSでは何をしましたか", ["うん。"], "ja"), "ETSでは何をしましたか");
  assert.equal(stripBackchannelEcho("ETSでは何をしましたかなるほど", ["なるほど。"], "ja"), "ETSでは何をしましたか");
  assert.equal(stripBackchannelEcho("運動うんどうの研究", ["うん。"], "ja"), "運動うんどうの研究", "never from the middle");
});

test("only within the window after she said it", () => {
  const echo = new BackchannelEcho();
  echo.played("Mm-hmm.", 400, 1000);
  assert.equal(echo.strip("and mm hmm then", "en", 1500), "and then");
  assert.equal(echo.strip("and mm hmm then", "en", 1000 + 400 + 1300), "and mm hmm then", "window over");
});
