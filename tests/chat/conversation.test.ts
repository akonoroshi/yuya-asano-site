import assert from "node:assert/strict";
import { test } from "node:test";
import { echoText, PlaybackEcho } from "../../src/lib/chat/playback-echo.ts";

const globals = globalThis as Record<string, unknown>;
const win = new EventTarget();
const track = { stop() {} };
let micLevel = 0;
let constraints: MediaStreamConstraints | undefined;
let bargeIns = 0;

class Recognizer {
  static current: Recognizer;
  onresult?: (event: { resultIndex: number; results: ReturnType<typeof result>[] }) => void;
  start(input: unknown) {
    assert.equal(input, track);
    Recognizer.current = this;
  }
  abort() {}
}

function result(text: string, isFinal: boolean, ...alternatives: string[]) {
  return Object.assign([text, ...alternatives].map((transcript) => ({ transcript })), { isFinal });
}

globals.window = Object.assign(win, { SpeechRecognition: Recognizer });
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { mediaDevices: {
    async getUserMedia(options: MediaStreamConstraints) {
      constraints = options;
      return { getAudioTracks: () => [track], getTracks: () => [track] };
    },
  } },
});
globals.AudioContext = class {
  sampleRate = 48000;
  async resume() {}
  async close() {}
  createMediaStreamSource() { return { connect() {} }; }
  createAnalyser() {
    return { fftSize: 2048, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(micLevel) };
  }
};
win.addEventListener("voice:barge-in", () => bargeIns++);

const { ConversationListener } = await import("../../src/lib/chat/conversation.ts");

function useClock(t: import("node:test").TestContext) {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setInterval"] });
  return (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 20) {
      now += 20;
      t.mock.timers.tick(20);
    }
    return now;
  };
}

test("conversation filters echo before display and submission, and yields to a stable visitor phrase", async (t) => {
  const advance = useClock(t);
  const interim: string[] = [];
  const submitted: string[][] = [];
  const playback = new PlaybackEcho("en");
  const listener = new ConversationListener("en", [], {
    onInterim: (text) => interim.push(text),
    onTurn: (alternatives) => submitted.push(alternatives),
    onUserTalking() {}, onStop() {}, onTurnDropped() {},
  }, playback);
  t.after(() => listener.stop());
  await listener.start();
  assert.deepEqual(constraints?.audio, {
    echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    advanced: [{ echoCancellation: "all" }],
  });

  const recognize = (...results: ReturnType<typeof result>[]) => {
    Recognizer.current.onresult?.({ resultIndex: results.length - 1, results });
  };
  listener.setSpeaking(true, true);
  playback.start("Yuya builds language models.", 4000, performance.now());
  micLevel = 0.1;
  advance(800);
  assert.equal(bargeIns, 0, "sustained speaker audio alone should not interrupt");

  const echo = result("You yeah builds language models", true, "Yuya builds language modules");
  recognize(result("You yeah builds language models", false));
  advance(40);
  assert.equal(interim.at(-1), "");
  listener.setSpeaking(false);
  playback.end(performance.now());
  micLevel = 0;
  advance(1400);
  recognize(echo);
  advance(1000);
  assert.deepEqual(submitted, [], "the same echo arriving late as a final result should stay filtered");

  listener.setSpeaking(true, true);
  playback.start("He evaluates models in classrooms.", 4000, performance.now());
  recognize(echo, result("What about", false));
  advance(40);
  assert.equal(bargeIns, 0, "one interim phrase should not cut off playback");
  recognize(echo, result("What about his teaching", false));
  advance(40);
  assert.equal(bargeIns, 1);
  listener.setSpeaking(false);
  playback.end(performance.now());
  recognize(echo, result("What about his teaching?", true));
  advance(1600);
  assert.deepEqual(submitted, [["What about his teaching?"]]);

  listener.setSpeaking(true, true);
  playback.start("Here is another example.", 3000, performance.now());
  recognize(echo, result("What about his teaching?", true), result("wait", false));
  advance(20);
  assert.equal(bargeIns, 2, "an explicit stop command can interrupt immediately");
});

test("an immediate follow-up uses mic timing while late playback text is still filtered", async (t) => {
  const advance = useClock(t);
  const interim: string[] = [];
  const submitted: string[][] = [];
  const playback = new PlaybackEcho("en");
  const listener = new ConversationListener("en", [], {
    onInterim: (text) => interim.push(text),
    onTurn: (alternatives) => submitted.push(alternatives),
    onUserTalking() {}, onStop() {}, onTurnDropped() {},
  }, playback);
  t.after(() => listener.stop());
  await listener.start();
  listener.setSpeaking(true, true);
  playback.start("Yuya builds language models.", 800, performance.now());
  micLevel = 0.1;
  advance(800);
  listener.setSpeaking(false);
  playback.end(performance.now());

  // The visitor starts right away, before the mic level has fallen between speakers.
  advance(600);
  micLevel = 0;
  advance(200);
  const echo = result("Yuya builds language models", true);
  Recognizer.current.onresult?.({ resultIndex: 0, results: [echo] });
  assert.equal(interim.at(-1), "");
  advance(200);
  Recognizer.current.onresult?.({ resultIndex: 1, results: [echo, result("What about his teaching?", true)] });
  assert.equal(interim.at(-1), "What about his teaching?");
  assert.deepEqual(submitted, []);
  advance(220);
  assert.deepEqual(submitted, [["What about his teaching?"]], "count silence from the mic, even when words arrived late");
});

for (const finalizeEarly of [false, true]) {
  test(`a late revision submits once when ${finalizeEarly ? "the result finalizes" : "the words stabilize"}`, async (t) => {
    const advance = useClock(t);
    const submitted: string[][] = [];
    const listener = new ConversationListener("en", [], {
      onInterim() {}, onUserTalking() {}, onStop() {}, onTurnDropped() {},
      onTurn: (alternatives) => submitted.push(alternatives),
    }, new PlaybackEcho("en"));
    t.after(() => listener.stop());
    await listener.start();
    const recognize = (text: string, final = false) => {
      Recognizer.current.onresult?.({ resultIndex: 0, results: [result(text, final)] });
    };

    micLevel = 0.1;
    advance(400);
    recognize("what about his");
    micLevel = 0;
    advance(500);
    recognize("what about his research");
    advance(100);
    assert.deepEqual(submitted, [], "600 ms quiet, but the latest text is only 100 ms old");
    if (finalizeEarly) {
      recognize("what about his research", true);
      advance(20);
    } else {
      advance(80);
      recognize("what about his research");
      advance(20);
    }
    assert.deepEqual(submitted, [["what about his research"]]);
    if (finalizeEarly) return;
    recognize("what about his research", true);
    advance(800);
    assert.equal(submitted.length, 1, "late finalization must not resubmit the turn");
  });
}

test("a continuing turn uses the longer pause until the visitor resumes and finishes", async (t) => {
  const advance = useClock(t);
  const submitted: string[][] = [];
  const listener = new ConversationListener("en", [], {
    onInterim() {}, onUserTalking() {}, onStop() {}, onTurnDropped() {},
    onTurn: (alternatives) => submitted.push(alternatives),
  }, new PlaybackEcho("en"));
  t.after(() => listener.stop());
  await listener.start();

  micLevel = 0.1;
  advance(400);
  const first = result("tell me about his work and", true);
  Recognizer.current.onresult?.({ resultIndex: 0, results: [first] });
  micLevel = 0;
  advance(1100);
  assert.deepEqual(submitted, []);
  micLevel = 0.1;
  advance(400);
  Recognizer.current.onresult?.({ resultIndex: 1, results: [first, result("his research", false)] });
  micLevel = 0;
  advance(580);
  assert.deepEqual(submitted, [], "the second burst restarted the silence timer");
  advance(20);
  assert.deepEqual(submitted, [["tell me about his work and his research"]]);
});

test("playback matching handles Japanese scripts, short repeats, and the tail after a stop", () => {
  const playback = new PlaybackEcho("ja");
  playback.start("浅野はことばのモデルを研究しています。", 5000, 0);
  const matches = (text: string, now: number) => playback.matches(echoText(text, "ja"), now);
  assert.ok(matches("コトバのモデルを研究", 1000));
  assert.ok(!matches("モデル", 1000));
  assert.ok(!matches("モデルって何？", 1000));
  playback.end(1000);
  assert.ok(matches("コトバのモデルを研究", 1500));
  assert.ok(!matches("コトバのモデルを研究", 2300));
});
