import assert from "node:assert/strict";
import { test } from "node:test";
import { estimatePitch, LowPitchRule, PITCH_RULE } from "../../src/lib/chat/pitch.ts";

const RATE = 48_000;
const N = 2048;
/** A voice-like frame: a fundamental plus decaying harmonics, at a random phase. */
function voiced(hz: number, harmonics = 5, rate = RATE): Float32Array {
  const x = new Float32Array(N);
  const phase = Math.random() * 2 * Math.PI;
  for (let h = 1; h <= harmonics; h++) for (let i = 0; i < N; i++) x[i] += Math.sin(phase * h + (2 * Math.PI * hz * h * i) / rate) / h;
  return x;
}
const noise = () => Float32Array.from({ length: N }, () => Math.random() * 2 - 1);

test("pitch: tones and voice-like signals across the speaking range, at 48 and 44.1 kHz", () => {
  for (const rate of [48_000, 44_100]) {
    for (const hz of [80, 110, 150, 220, 300, 420]) {
      const got = estimatePitch(voiced(hz, 1, rate), rate);
      assert.ok(got !== null && Math.abs(got - hz) / hz < 0.02, `sine ${hz} Hz at ${rate}: ${got}`);
      const v = estimatePitch(voiced(hz, 6, rate), rate);
      assert.ok(v !== null && Math.abs(v - hz) / hz < 0.02, `harmonics ${hz} Hz at ${rate}: ${v}`);
    }
  }
});

test("pitch: silence and noise are unvoiced", () => {
  assert.equal(estimatePitch(new Float32Array(N), RATE), null);
  let voicedNoise = 0;
  for (let k = 0; k < 20; k++) if (estimatePitch(noise(), RATE) !== null) voicedNoise++;
  assert.ok(voicedNoise <= 2, `${voicedNoise}/20 noise frames looked voiced`);
});

/** Drives the rule with 20 ms frames; returns the times it said to nod. */
function drive(lang: "en" | "ja", frames: (number | null)[]) {
  const rule = new LowPitchRule(lang);
  const nods: number[] = [];
  let spoken = 0;
  frames.forEach((hz, i) => {
    const now = i * 20;
    if (hz !== null) spoken += 20;
    rule.push(now, hz, spoken);
    if (rule.due(now)) {
      nods.push(now);
      rule.nodded(now);
    }
  });
  return { nods, rule };
}
const range = (n: number, lo = 180, hi = 260) => Array.from({ length: n }, (_, i) => lo + ((i * 37) % (hi - lo)));
const low = (ms: number, hz = 140) => Array.from({ length: ms / 20 }, () => hz);

test("rule: a low-pitch region after calibration and 700 ms of speech nods 700 ms later (English)", () => {
  const calib = range(80); // 1.6 s of normal pitch: calibrated, and past 700 ms of speech
  const { nods } = drive("en", [...calib, ...low(160), ...range(60)]);
  assert.equal(nods.length, 1);
  const qualifiedAt = (calib.length + PITCH_RULE.minLowMs / 20) * 20;
  assert.ok(Math.abs(nods[0] - (qualifiedAt + 700)) <= 20, `nod at ${nods[0]}, region qualified at ${qualifiedAt}`);
});

test("rule: Japanese nods twice as soon, 350 ms after", () => {
  const calib = range(80);
  const { nods } = drive("ja", [...calib, ...low(160), ...range(40)]);
  const qualifiedAt = (calib.length + PITCH_RULE.minLowMs / 20) * 20;
  assert.ok(nods.length === 1 && Math.abs(nods[0] - (qualifiedAt + 350)) <= 20, `nod at ${nods[0]}`);
});

test("rule: nothing before calibration, for short dips, or within the refractory period", () => {
  assert.equal(drive("en", [...low(200), ...range(30)]).nods.length, 0, "uncalibrated");
  assert.equal(drive("en", [...range(80), ...low(80), ...range(40)]).nods.length, 0, "80 ms is too short");
  // Two regions 400 ms apart: the second falls within 800 ms of the first nod's region
  const two = drive("en", [...range(80), ...low(140), ...range(10), ...low(140), ...range(80)]);
  assert.equal(two.nods.length, 1);
});

test("rule: a short unvoiced gap (a consonant) doesn't break a region; cancel drops a pending nod", () => {
  const gap = drive("en", [...range(80), ...low(60), null, ...low(60), ...range(60)]);
  assert.equal(gap.nods.length, 1, "20 ms gap bridged");
  const rule = new LowPitchRule("en");
  let spoken = 0;
  [...range(80), ...low(160)].forEach((hz, i) => rule.push(i * 20, hz, (spoken += 20)));
  rule.cancel(); // the turn ended
  assert.equal(rule.due(1e6), false);
});
