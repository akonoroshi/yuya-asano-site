import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTags, stripTags, TagStream } from "../../src/lib/chat/tags.ts";

test("tags are removed and positioned in the plain text", () => {
  const { text, tags, errors } = parseTags("[emo:happy:0.8][act:greet]Hi! I'm Shino.[act:wait_user]");
  assert.equal(text, "Hi! I'm Shino.");
  assert.deepEqual(errors, []);
  assert.deepEqual(tags, [
    { kind: "emo", name: "happy", strength: 0.8, at: 0 },
    { kind: "act", name: "greet", at: 0 },
    { kind: "act", name: "wait_user", at: 14 },
  ]);
});

test("emotion strength defaults to 0.5", () => {
  assert.deepEqual(parseTags("[emo:focused]x").tags, [{ kind: "emo", name: "focused", strength: 0.5, at: 0 }]);
});

test("invalid tags are dropped and reported; other brackets stay text", () => {
  const { text, tags, errors } = parseTags("a [act:dance] b [emo:happy:2] c [1] d");
  assert.equal(text, "a  b  c [1] d");
  assert.equal(tags.length, 0);
  assert.equal(errors.length, 2);
});

test("Japanese positions count characters of the plain text", () => {
  const { tags } = parseTags("こんにちは！[act:beat]しのです。");
  assert.equal(tags[0].at, "こんにちは！".length);
  assert.equal(stripTags("こんにちは！[act:beat]しのです。"), "こんにちは！しのです。");
});

test("streamed tags split across chunks are held back and positioned across chunks", () => {
  const t = new TagStream();
  assert.deepEqual(t.push("[emo:hap"), { text: "", tags: [] });
  assert.deepEqual(t.push("py:0.7]Hello "), { text: "Hello ", tags: [{ kind: "emo", name: "happy", strength: 0.7, at: 0 }] });
  assert.deepEqual(t.push("there. [act:be"), { text: "there. ", tags: [] });
  assert.deepEqual(t.push("at]More"), { text: "More", tags: [{ kind: "act", name: "beat", at: 13 }] });
});

test("an unfinished bracket at the end is released as text on flush", () => {
  const t = new TagStream();
  assert.equal(t.push("see [1").text, "see ");
  assert.equal(t.flush().text, "[1");
});
