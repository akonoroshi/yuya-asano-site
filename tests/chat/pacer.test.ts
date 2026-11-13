import assert from "node:assert/strict";
import { test } from "node:test";
import { CaptionPacer, PACER_CONFIG, type PacerClock } from "../../src/lib/chat/pacer.ts";
import { spokenSpans } from "../../src/lib/chat/speech.ts";

/** A fake clock and a pacer whose caption is a string we can inspect. */
function setup(lang: "en" | "ja" = "en") {
  let now = 0;
  const ticks: (() => void)[] = [];
  const clock: PacerClock = { now: () => now, every: (_ms, fn) => (ticks.push(fn), () => ticks.splice(ticks.indexOf(fn), 1)) };
  let text = "";
  let caption = "";
  const pacer = new CaptionPacer(lang, (pos) => (caption = text.slice(0, pos)), clock);
  let done = false;
  void pacer.done.then(() => (done = true));
  return {
    pacer,
    set: (t: string, final: boolean) => {
      text = t;
      pacer.update(t, final);
    },
    advance: async (ms: number) => {
      for (let t = 0; t < ms; t += PACER_CONFIG.tickMs) {
        now += PACER_CONFIG.tickMs;
        [...ticks].forEach((f) => f());
      }
      await Promise.resolve();
    },
    caption: () => caption,
    done: () => done,
  };
}

const A = "Yuya builds LLM systems.";
const B = "He finishes in May 2027.";

test("spans: where each spoken unit ends in the caption, emails and links included", () => {
  const t = "Email is the best way to reach him: yuya.asano47@gmail.com. See [his CV](/cv.pdf).";
  const spans = spokenSpans("en", t);
  assert.deepEqual(spans.map((s) => s.unit), ["Email is the best way to reach him.", "See his CV."]);
  assert.equal(t.slice(0, spans[0].end), "Email is the best way to reach him: yuya.asano47@gmail.com.");
  assert.equal(spans[1].end, t.length);
});

test("curated: each sentence appears over its audio, not all at once", async () => {
  const p = setup();
  p.set(`${A} ${B}`, true);
  assert.equal(p.caption(), "", "nothing before the audio starts");
  p.pacer.unitStarted(A, 2000);
  await p.advance(1000);
  const half = p.caption().length;
  assert.ok(half > 5 && half < A.length, `about half of the first sentence: "${p.caption()}"`);
  await p.advance(1000);
  assert.equal(p.caption(), A, "the first sentence is complete by the end of its audio");
  p.pacer.unitStarted(B, 1500);
  await p.advance(1600);
  assert.equal(p.caption(), `${A} ${B}`);
  assert.ok(p.done());
});

test("a unit with no clip is typed out; the next one follows its audio again", async () => {
  const p = setup();
  p.set(`${A} ${B}`, true);
  p.pacer.unitSkipped(A);
  await p.advance((A.length / PACER_CONFIG.typingCps) * 1000 + 50);
  assert.equal(p.caption(), A);
  p.pacer.unitStarted(B, 1000);
  await p.advance(200);
  assert.ok(p.caption().length < `${A} ${B}`.length);
  await p.advance(1000);
  assert.ok(p.done());
});

test("no audio at all (voice unavailable): everything shows after a short wait, not per sentence", async () => {
  const p = setup();
  p.set(`${A} ${B}`, true);
  await p.advance(PACER_CONFIG.waitForAudioMs - 200);
  assert.equal(p.caption(), "");
  await p.advance(400);
  assert.equal(p.caption(), `${A} ${B}`);
  assert.ok(p.done());
});

test("LLM: text waits for its audio, a filler doesn't count, and the reply ends with the voice", async () => {
  const p = setup();
  p.pacer.unitStarted("Let me see…", 1200); // the filler: audio, but not part of the reply
  p.set("Yuya builds", false);
  await p.advance(300);
  p.set(`${A} He fin`, false); // first sentence complete, second still streaming
  await p.advance(1000);
  assert.equal(p.caption(), "", "the text waits while the filler plays and the sentence's audio loads");
  p.pacer.unitStarted(A, 1500);
  await p.advance(1600);
  assert.equal(p.caption(), A);
  p.set(`${A} ${B}`, true);
  assert.ok(!p.done(), "not done until the last sentence is spoken");
  p.pacer.unitStarted(B, 800);
  await p.advance(900);
  assert.equal(p.caption(), `${A} ${B}`);
  assert.ok(p.done());
});

test("the voice stops (barge-in, Voice off): the rest shows at once, and later text too", async () => {
  const p = setup();
  p.set(`${A} He`, false);
  p.pacer.unitStarted(A, 2000);
  await p.advance(500);
  p.pacer.stop();
  await p.advance(40);
  assert.equal(p.caption(), `${A} He`);
  p.set(`${A} ${B}`, true);
  await p.advance(40);
  assert.equal(p.caption(), `${A} ${B}`);
  assert.ok(p.done());
});

test("Japanese, with the email after a colon", async () => {
  const p = setup("ja");
  const t = "連絡はメールが確実です：yuya.asano47@gmail.com。CVもどうぞ。";
  p.set(t, true);
  p.pacer.unitStarted("連絡はメールが確実です。", 1000);
  await p.advance(1100);
  assert.equal(p.caption(), "連絡はメールが確実です：yuya.asano47@gmail.com。");
  p.pacer.unitStarted("CVもどうぞ。", 500);
  await p.advance(600);
  assert.equal(p.caption(), t);
  assert.ok(p.done());
});
