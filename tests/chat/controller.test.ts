import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { chatStrings } from "../../src/data/chat/strings.ts";
import { ChatController, type Chip } from "../../src/lib/chat/controller.ts";
import { normalizeText } from "../../src/lib/chat/normalize.ts";
import type { ChatContext } from "../../src/lib/chat/types.ts";

const storage = new Map<string, string>();
Object.assign(globalThis, {
  window: new EventTarget(),
  matchMedia: () => ({ matches: true }),
  Worker: class {
    constructor() { assert.fail("these turns should not use phonetic matching"); }
  },
});
Object.defineProperty(globalThis, "sessionStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  },
});

const scenarios = {
  en: { command: "Can we talk about something else?", question: "What is Yuya's research about?" },
  ja: { command: "話題を変えて。", question: "浅野さんの研究内容は何ですか？" },
} as const;

for (const lang of ["en", "ja"] as const) {
  test(`${lang}: a spoken topic change picks the same reply and starting chips as the chip`, async (t) => {
    const { command, question } = scenarios[lang];
    const strings = chatStrings[lang];
    const answer = {
      canonical: question, chip: "Research", parents: [], children: [],
      text: "Research FAQ answer", alternatives: [], links: [],
    };
    const ctx: ChatContext = {
      lang, version: "test", start: ["research"], pages: { work: ["experience"] },
      entries: [{ id: "research", text: question, norm: normalizeText(question, lang), ph: "" }],
      answers: { research: answer, experience: { ...answer, chip: "Experience" } },
      phrases: [], termReadings: {},
    };
    const fetch = t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
      assert.equal(input, `/chat/context.${lang}.json`, "only the initial context should be fetched");
      return Response.json(ctx);
    });
    t.mock.method(Math, "random", () => 0);
    async function openChat() {
      storage.clear();
      let chips: Chip[] = [];
      let asked = "";
      let reply = "";
      const controller = new ChatController(lang, {
        showQuestion(text) { asked = text; },
        startReply() {
          reply = "";
          return { append(text) { reply += text; }, finish() {}, fail: assert.fail };
        },
        setChips(list) { chips = list; },
        setBusy() {},
      }, strings, "work");
      await controller.load();
      return {
        controller,
        get chips() { return chips; },
        snapshot() {
          const { log } = JSON.parse(storage.get(`chat:${lang}`)!);
          return { asked, reply, chips: chips.map((chip) => chip.label), log };
        },
      };
    }

    const clicked = await openChat();
    const chip = clicked.chips.find((candidate) => candidate.label === strings.somethingElse);
    assert.ok(chip);
    chip.onPick();
    await setImmediate();
    const expected = clicked.snapshot();
    assert.equal(expected.reply, strings.somethingElseReply[0]);
    assert.deepEqual(expected.chips, [answer.chip]);
    assert.deepEqual(expected.log, [
      { role: "user", text: strings.somethingElse },
      { role: "assistant", text: strings.somethingElseReply[0] },
    ]);

    const spoken = await openChat();
    await spoken.controller.ask(command, { source: "voice", alternatives: [command], handsFree: true });
    assert.deepEqual(spoken.snapshot(), expected);

    await spoken.controller.ask(question, { source: "voice", alternatives: [question], handsFree: true });
    assert.equal(spoken.snapshot().reply, answer.text);
    assert.equal(fetch.mock.callCount(), 2);
  });
}
