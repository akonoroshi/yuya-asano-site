// The voice player against a simulated browser: window events, sessionStorage, fetch, and a
// fake Web Audio API that "plays" each buffer for a few milliseconds and records what it played.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { speechKey, speechUnits } from "../../src/lib/chat/speech.ts";

const FP = "0123456789abcdef";
let played: string[] = [];
let events: string[] = [];
let fetches: string[] = [];
let ttsBodies: { text: string; fp: string }[] = [];
let clipUnits: string[] = []; // units with a pre-recorded clip
let ttsStatus = 200;
let contextState: "running" | "suspended" = "running";

const g = globalThis as Record<string, unknown>;
const win = new EventTarget();
g.window = win;
g.document = Object.assign(new EventTarget(), { hidden: false });
const store = new Map<string, string>();
g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
for (const name of ["character:speech-start", "character:speech-end", "character:voice-state", "voice:backchannel-played"]) {
  win.addEventListener(name, () => events.push(name));
}

const label = (b: ArrayBuffer) => new TextDecoder().decode(b);
class FakeAudioContext {
  get state() {
    return contextState;
  }
  destination = {};
  async resume() {}
  createAnalyser() {
    return { fftSize: 0, connect() {} };
  }
  createGain() {
    const node = { gain: { value: 1 }, connect: () => node };
    return node;
  }
  async decodeAudioData(b: ArrayBuffer) {
    return { label: label(b) };
  }
  createBufferSource() {
    const src = {
      buffer: null as { label: string } | null,
      onended: null as null | (() => void),
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
      connect() {},
      start() {
        played.push(src.buffer!.label);
        src.timer = setTimeout(() => src.onended?.(), 5);
      },
      stop() {
        clearTimeout(src.timer);
        src.onended?.();
      },
    };
    return src;
  }
}
g.AudioContext = FakeAudioContext;

g.fetch = async (url: string, init?: RequestInit) => {
  fetches.push(url);
  if (url === "/voice/manifest.json") {
    const keys = await Promise.all(clipUnits.map((u) => speechKey(FP, "en", u)));
    return new Response(JSON.stringify({ version: 1, en: { fingerprint: FP, keys } }));
  }
  if (url.startsWith("/voice/en/")) {
    const key = url.slice("/voice/en/".length, -4);
    for (const u of clipUnits) if ((await speechKey(FP, "en", u)) === key) return new Response(`clip:${u}`);
    return new Response("", { status: 404 });
  }
  if (url === "/api/tts") {
    const body = JSON.parse(String(init!.body));
    ttsBodies.push(body);
    return new Response(`live:${body.text}`, { status: ttsStatus });
  }
  return new Response("", { status: 404 });
};

const { VoicePlayer } = await import("../../src/lib/chat/voice.ts");
const emit = (name: string, detail?: unknown) => win.dispatchEvent(new CustomEvent(name, { detail }));
const until = async (cond: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

let player: InstanceType<typeof VoicePlayer>;
beforeEach(() => {
  played = [];
  events = [];
  fetches = [];
  ttsBodies = [];
  ttsStatus = 200;
  contextState = "running";
  // A fresh player per test (each one listens on window, so earlier ones are turned off).
  player?.setEnabled(false);
  store.clear();
  events = [];
  player = new VoicePlayer("en");
});

const ANSWER = "Yuya Asano is a PhD candidate. He builds LLM systems.";

test("voice is off until turned on, and then a curated reply plays its clips in order", async () => {
  clipUnits = speechUnits("en", ANSWER);
  emit("chat:reply-start", { text: ANSWER });
  emit("chat:reply-end");
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(played, [], "off by default");

  player.setEnabled(true);
  emit("chat:reply-start", { text: ANSWER });
  emit("chat:reply-end");
  await until(() => events.includes("character:speech-end"));
  assert.deepEqual(played, clipUnits.map((u) => `clip:${u}`));
  assert.deepEqual(events, ["character:voice-state", "character:speech-start", "character:speech-end"]);
  assert.equal(ttsBodies.length, 0, "curated lines never call the TTS server");
});

test("an LLM reply: the filler first, then each signed sentence (a clip if there is one, else live)", async () => {
  clipUnits = ["Let me see…", "He builds LLM systems."];
  player.setEnabled(true);
  emit("chat:reply-start", {});
  emit("chat:filler", { text: "Let me see…" });
  emit("chat:say", { text: "Yuya Asano is a PhD candidate.", exp: 9e9, sig: "s1" });
  emit("chat:say", { text: "He builds LLM systems.", exp: 9e9, sig: "s2" });
  emit("chat:reply-end");
  await until(() => events.includes("character:speech-end"));
  assert.deepEqual(played, ["clip:Let me see…", "live:Yuya Asano is a PhD candidate.", "clip:He builds LLM systems."]);
  assert.deepEqual(ttsBodies.map((b) => [b.text, b.fp]), [["Yuya Asano is a PhD candidate.", FP]]);
});

test("talking over Shino stops her and drops the rest", async () => {
  clipUnits = speechUnits("en", ANSWER);
  player.setEnabled(true);
  emit("chat:reply-start", { text: ANSWER });
  emit("chat:reply-end");
  await until(() => played.length === 1);
  emit("voice:barge-in");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(played.length, 1);
  assert.equal(events.filter((e) => e === "character:speech-end").length, 1);
});

test("a new reply replaces the one still playing", async () => {
  clipUnits = [...speechUnits("en", ANSWER), "Hi!"];
  player.setEnabled(true);
  emit("chat:reply-start", { text: ANSWER });
  await until(() => played.length === 1);
  emit("chat:reply-start", { text: "Hi!" });
  emit("chat:reply-end");
  await until(() => played.includes("clip:Hi!"));
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(played, [`clip:${clipUnits[0]}`, "clip:Hi!"]);
});

test("if the server's voice changed (409), live sentences stay silent instead of mixing voices", async () => {
  clipUnits = [];
  ttsStatus = 409;
  player.setEnabled(true);
  emit("chat:reply-start", {});
  emit("chat:say", { text: "One.", exp: 9e9, sig: "a" });
  emit("chat:say", { text: "Two.", exp: 9e9, sig: "b" });
  emit("chat:reply-end");
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(played, []);
  assert.equal(ttsBodies.length, 1, "no more requests after the first 409");
});

test("without a gesture (audio still locked), nothing plays and nothing hangs", async () => {
  clipUnits = speechUnits("en", ANSWER);
  player.setEnabled(true);
  contextState = "suspended";
  emit("chat:reply-start", { text: ANSWER });
  emit("chat:reply-end");
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(played, []);
  contextState = "running";
  emit("chat:reply-start", { text: ANSWER });
  emit("chat:reply-end");
  await until(() => events.includes("character:speech-end"));
  assert.equal(played.length, clipUnits.length);
});

test("a voice conversation turns voice on, unless the visitor turned it off in this tab", () => {
  player.autoEnable();
  assert.equal(player.enabled, true);
  player.setEnabled(false);
  player.autoEnable();
  assert.equal(player.enabled, false);
  assert.equal(store.get("chat:voice"), "off");
});

const BACKCHANNELS = ["Mm-hmm.", "Uh-huh.", "I see.", "Right."];

test("backchannel: plays softly when idle, as its own event, never as a turn", async () => {
  clipUnits = BACKCHANNELS.flatMap((l) => speechUnits("en", l));
  player.setEnabled(true);
  events = [];
  let units = 0;
  win.addEventListener("voice:unit", () => units++);
  emit("voice:backchannel");
  await until(() => events.includes("voice:backchannel-played"));
  assert.equal(played.length, 1);
  assert.equal(units, 0, "no voice:unit");
  assert.ok(clipUnits.map((u) => `clip:${u}`).includes(played[0]));
  assert.ok(!events.includes("character:speech-start"), "no lip sync, not a turn");
});

test("backchannel: skipped while a reply plays, and when Voice is off", async () => {
  clipUnits = [...BACKCHANNELS.flatMap((l) => speechUnits("en", l)), ...speechUnits("en", ANSWER)];
  emit("voice:backchannel");
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(played, [], "Voice is off");
  player.setEnabled(true);
  emit("chat:reply-start", { text: ANSWER });
  emit("voice:backchannel"); // while the reply is open
  emit("chat:reply-end");
  await until(() => events.includes("character:speech-end"));
  assert.deepEqual(played, speechUnits("en", ANSWER).map((u) => `clip:${u}`), "only the reply played");
});

test("backchannel: never the same line twice in a row, and none without a clip", async () => {
  clipUnits = BACKCHANNELS.flatMap((l) => speechUnits("en", l));
  player.setEnabled(true);
  for (let k = 0; k < 8; k++) {
    emit("voice:backchannel");
    await until(() => played.length === k + 1);
    await new Promise((r) => setTimeout(r, 10)); // let it end
  }
  for (let k = 1; k < played.length; k++) assert.notEqual(played[k], played[k - 1]);
  clipUnits = [];
  const before = played.length;
  const fresh = new VoicePlayer("en"); // a new manifest with no clips
  player.setEnabled(false);
  player = fresh;
  player.setEnabled(true);
  emit("voice:backchannel");
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(played.length, before, "no clip: silent");
});
