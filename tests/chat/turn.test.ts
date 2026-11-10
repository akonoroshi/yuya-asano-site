import assert from "node:assert/strict";
import { test } from "node:test";
import {
  combineSegments,
  completeness,
  endOfTurnDelay,
  isBackchannel,
  isBargeIn,
  isHesitation,
  levelDb,
  NodScheduler,
  parseConfirm,
  prependToAlternatives,
  TURN_CONFIG,
  VadTracker,
} from "../../src/lib/chat/turn.ts";

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

test("completeness: English goes by the last word and question shape", () => {
  assert.equal(completeness("tell me about his research and", "en"), "continuing");
  assert.equal(completeness("um", "en"), "continuing");
  assert.equal(completeness("what is his dissertation about", "en"), "continuing"); // ends in "about"
  assert.equal(completeness("what is his dissertation", "en"), "complete");
  assert.equal(completeness("is he open to roles?", "en"), "complete");
  assert.equal(completeness("Emma", "en"), "unknown");
});

test("completeness: Japanese goes by the ending", () => {
  assert.equal(completeness("浅野の研究について教えてください", "ja"), "complete");
  assert.equal(completeness("エマはどう答えるんですか", "ja"), "complete");
  assert.equal(completeness("インターンのことなんですけど", "ja"), "continuing");
  assert.equal(completeness("えーと", "ja"), "continuing");
  assert.equal(completeness("ETSでのインターンで", "ja"), "continuing");
});

test("end-of-turn delay: short when finished, long mid-phrase, longest with no words", () => {
  const c = TURN_CONFIG.endOfTurn;
  assert.equal(endOfTurnDelay("what is his dissertation", "en"), c.completeMs);
  assert.equal(endOfTurnDelay("tell me about the", "en"), c.continuingMs);
  assert.equal(endOfTurnDelay("Emma", "en"), c.defaultMs);
  assert.equal(endOfTurnDelay("", "en"), c.noTextMs);
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

test("nods: once per pause, after some speech, with a cooldown", () => {
  const nods = new NodScheduler("en", TURN_CONFIG.nod, () => 0); // nod at the earliest point in the range
  const end = 1400;
  assert.ok(!nods.shouldNod(1000, 300, 200, end), "not after only 200 ms of speech");
  assert.ok(!nods.shouldNod(1000, 100, 1000, end), "not right at the start of a pause");
  assert.ok(nods.shouldNod(1000, 260, 1000, end));
  assert.ok(!nods.shouldNod(1020, 280, 1000, end), "only once per pause");
  nods.speechResumed();
  assert.ok(!nods.shouldNod(2000, 300, 2000, end), "cooldown");
  nods.speechResumed();
  assert.ok(nods.shouldNod(4000, 300, 3000, end));
  nods.speechResumed();
  assert.ok(!nods.shouldNod(8000, 1500, 3000, end), "never once the turn is over");
});

test("spoken answers to Did you mean", () => {
  assert.equal(parseConfirm("Yes", "en"), "yes");
  assert.equal(parseConfirm("yeah that's right", "en"), "yes");
  assert.equal(parseConfirm("yes please do", "en"), "yes");
  assert.equal(parseConfirm("nope", "en"), "as-said");
  assert.equal(parseConfirm("something else", "en"), "else");
  assert.equal(parseConfirm("no I meant his ETS internship", "en"), null); // a new question
  assert.equal(parseConfirm("はい", "ja"), "yes");
  assert.equal(parseConfirm("はい、それです", "ja"), "yes");
  assert.equal(parseConfirm("違います", "ja"), "as-said");
  assert.equal(parseConfirm("ほかのこと", "ja"), "else");
  assert.equal(parseConfirm("いいえ、ETSのインターンについて知りたいです", "ja"), null);
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
