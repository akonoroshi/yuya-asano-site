import assert from "node:assert/strict";
import { test } from "node:test";
import {
  combineSegments,
  endOfTurnDelay,
  isBackchannel,
  isBargeIn,
  isHesitation,
  isSomethingElse,
  levelDb,
  ListeningNods,
  parseConfirm,
  prependToAlternatives,
  TURN_CONFIG,
  VadTracker,
} from "../../src/lib/chat/turn.ts";

test("something-else commands recognize English and Japanese equivalents as whole utterances", () => {
  for (const text of ["Something else!", "something different", "another topic", "Let's talk about something else.", "Can we talk about something else?", "I'd like to discuss another topic.", "Let's change the subject.", "Something else, please.", "Never mind."]) {
    assert.equal(isSomethingElse(text, "en"), true, text);
    assert.equal(parseConfirm(text, "en"), "else", text);
  }
  for (const text of ["ほかのこと", "他のこと。", "別のこと", "べつのこと", "別の質問", "他の話題", "話題を変えて", "話題を変えてください", "別の話をしよう", "別の話がしたいです", "他の話にしてください", "ほかのことをお願いします。", "別のことを話したい", "別のことについて聞きたいです"]) {
    assert.equal(isSomethingElse(text, "ja"), true, text);
    assert.equal(parseConfirm(text, "ja"), "else", text);
  }
  for (const text of ["", "yes", "Tell me something else about his research", "What is his research on topic change?"]) {
    assert.equal(isSomethingElse(text, "en"), false, text);
  }
  for (const text of ["", "はい", "別の質問ですが研究について教えて", "他のことも研究していますか"]) {
    assert.equal(isSomethingElse(text, "ja"), false, text);
  }
});

/** Feeds a level for a duration, one frame at a time; returns the events and the end time. */
function feed(vad: VadTracker, db: number, fromMs: number, forMs: number) {
  const events: string[] = [];
  const step = TURN_CONFIG.vad.frameMs;
  let t = fromMs;
  for (; t < fromMs + forMs; t += step) for (const e of vad.push(db, t)) events.push(e.type);
  return { events, t };
}

test("VAD: speech starts after the onset time, survives short dips, and ends after the hangover", () => {
  const vad = new VadTracker();
  let r = feed(vad, -60, 0, 1000); // quiet room: the floor settles near -60
  assert.deepEqual(r.events, []);
  r = feed(vad, -25, r.t, 40); // a click: too short
  assert.deepEqual(r.events, []);
  r = feed(vad, -60, r.t, 200);
  r = feed(vad, -25, r.t, 400); // speech
  assert.deepEqual(r.events, ["speech-start"]);
  r = feed(vad, -60, r.t, 100); // a dip inside a word
  assert.deepEqual(r.events, []);
  r = feed(vad, -25, r.t, 200);
  r = feed(vad, -60, r.t, 400); // a real pause
  assert.deepEqual(r.events, ["speech-end"]);
});

test("VAD: the noise floor follows a louder room, so steady noise stops counting as speech", () => {
  const vad = new VadTracker();
  feed(vad, -60, 0, 500);
  const r = feed(vad, -40, 500, 8000); // a fan turns on
  // It may count briefly as speech at first, but not for long.
  assert.ok(!vad.speaking, `still "speaking" in steady noise; floor ${vad.floor.toFixed(1)}`);
  assert.ok(vad.floor > -45, `floor ${vad.floor}`);
  assert.ok(r.events.length <= 2);
});

test("VAD: long speech with gaps between words keeps going", () => {
  const vad = new VadTracker();
  let r = feed(vad, -60, 0, 1000);
  const events: string[] = [];
  for (let i = 0; i < 25; i++) {
    r = feed(vad, -25, r.t, 200);
    events.push(...r.events);
    r = feed(vad, -60, r.t, 60); // shorter than the hangover
    events.push(...r.events);
  }
  assert.deepEqual(events, ["speech-start"]);
  assert.ok(vad.floor < -50, `floor ${vad.floor}`);
});

test("levelDb", () => {
  assert.equal(levelDb(new Float32Array(128)), -100);
  const full = new Float32Array(128).fill(1);
  assert.equal(Math.round(levelDb(full)), 0);
});

test("end-of-turn delay is longer for continuation cues and when no words arrived", () => {
  assert.equal(endOfTurnDelay("what is his dissertation about", "en"), 600);
  assert.equal(endOfTurnDelay("Emma", "en"), 600);
  assert.equal(endOfTurnDelay("tell me about the", "en"), 1200);
  assert.equal(endOfTurnDelay("tell me about his research and", "en"), 1200);
  assert.equal(endOfTurnDelay("エマはどう答えるんですか", "ja"), 600);
  assert.equal(endOfTurnDelay("浅野の研究について教えて", "ja"), 600);
  assert.equal(endOfTurnDelay("インターンのことなんですけど", "ja"), 1200);
  assert.equal(endOfTurnDelay("えーと", "ja"), 1200);
  assert.equal(endOfTurnDelay("ETSでのインターンで", "ja"), 1200);
  assert.equal(endOfTurnDelay("", "en"), 2500);
});

test("backchannels and hesitations", () => {
  for (const t of ["mm-hmm", "uh huh", "Yeah.", "oh okay", "yeah yeah", "I see"]) assert.ok(isBackchannel(t, "en"), t);
  for (const t of ["yeah what about his ETS internship", "wait", "no"]) assert.ok(!isBackchannel(t, "en"), t);
  for (const t of ["うん", "うんうん", "へえ、なるほど", "そうなんですね"]) assert.ok(isBackchannel(t, "ja"), t);
  assert.ok(!isBackchannel("うん、でもそれって", "ja"));
  assert.ok(isHesitation("um uh", "en"));
  assert.ok(!isHesitation("um what about Emma", "en"));
  assert.ok(isHesitation("えーと", "ja"));
  assert.ok(isHesitation("えっと", "ja"));
  assert.ok(!isHesitation("えっと、エマについて", "ja"));
});

test("barge-in: words or long speech interrupt; backchannels don't", () => {
  assert.ok(isBargeIn(100, "wait", "en")); // one real word is enough
  assert.ok(!isBargeIn(900, "mm-hmm", "en")); // long, but just "keep going"
  assert.ok(!isBargeIn(200, "", "en")); // a short sound with no words yet
  assert.ok(isBargeIn(600, "", "en")); // long speech before the words arrive
  assert.ok(!isBargeIn(700, "うんうん", "ja"));
  assert.ok(isBargeIn(150, "ちょっと待って", "ja"));
});

test("nods: once per pause, after some speech, with a minimum gap", () => {
  const nods = new ListeningNods("en", TURN_CONFIG.nod, () => 0); // earliest point in each range
  nods.startTurn(0);
  const end = 1400;
  assert.ok(!nods.pause(1000, 300, 200, end), "not after only 200 ms of speech");
  assert.ok(!nods.pause(1000, 100, 1000, end), "not right at the start of a pause");
  assert.ok(nods.pause(1000, 260, 1000, end));
  assert.ok(!nods.pause(1020, 280, 1000, end), "only once per pause");
  nods.speechResumed();
  assert.ok(!nods.pause(2000, 300, 2000, end), "within the minimum gap");
  nods.speechResumed();
  assert.ok(nods.pause(3000, 300, 3000, end));
  nods.speechResumed();
  assert.ok(!nods.pause(8000, 1500, 3000, end), "never once the turn is over");
});

test("nods: a gentle nod during a long stretch without one, and cues respect the gap", () => {
  const nods = new ListeningNods("en", TURN_CONFIG.nod, () => 0); // stretch target: 3000 ms
  nods.startTurn(0);
  assert.ok(!nods.speaking(2000, 2000), "not before the stretch");
  assert.ok(nods.speaking(3000, 3000), "after 3 s of speech with no nod");
  assert.ok(!nods.speaking(4000, 4000), "the stretch clock restarted");
  assert.ok(!nods.cue(4000), "a cue within 1.5 s of a nod waits");
  assert.ok(nods.cue(4600));
  assert.ok(!nods.speaking(7000, 7000), "a cue restarts the stretch clock too");
  assert.ok(nods.speaking(7600, 7600));
});

test("spoken answers to Did you mean", () => {
  for (const text of ["Yes", "Oh, yeah!", "Oh yes", "Mhm", "Yeah, that’s right", "Yes, I did", "Yes, please do"]) {
    assert.equal(parseConfirm(text, "en"), "yes", text);
  }
  for (const text of ["Nope", "No, that's wrong", "No, I didn’t"]) {
    assert.equal(parseConfirm(text, "en"), "as-said", text);
  }
  for (const text of ["yeah, no", "yeah, but why?", "yeah, 2024?", "Oh yeah, what about his internship?", "no I meant his ETS internship"]) {
    assert.equal(parseConfirm(text, "en"), null, text);
  }
  assert.equal(parseConfirm("something else", "en"), "else");

  for (const text of ["はい", "はい、それです", "はい、それで", "はい、それでお願いします", "うん、そう", "あ、そうです", "その通りです"]) {
    assert.equal(parseConfirm(text, "ja"), "yes", text);
  }
  for (const text of ["違います", "ううん", "いや、違います", "そうじゃないです"]) {
    assert.equal(parseConfirm(text, "ja"), "as-said", text);
  }
  for (const text of ["はい、でも？", "うん、なぜ？", "はい、次は？", "いいえ、ETSのインターンについて知りたいです"]) {
    assert.equal(parseConfirm(text, "ja"), null, text);
  }
  assert.equal(parseConfirm("ほかのこと", "ja"), "else");
});

test("segments: earlier best guesses, then every alternative of the last segment", () => {
  assert.deepEqual(
    combineSegments([["tell me about"], ["Emma", "emma's", "Emma"]], "en"),
    ["tell me about Emma", "tell me about emma's"],
  );
  assert.deepEqual(combineSegments([["浅野の"], ["研究", "健久"]], "ja"), ["浅野の研究", "浅野の健久"]);
  assert.deepEqual(combineSegments([[], [" "]], "en"), []);
});

test("a taken-back question joins what came next", () => {
  assert.deepEqual(prependToAlternatives("tell me about Emma", ["and the study", "in the study"], "en"), [
    "tell me about Emma and the study",
    "tell me about Emma in the study",
  ]);
  assert.deepEqual(prependToAlternatives("エマについて", [], "ja"), ["エマについて"]);
});
