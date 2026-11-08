import assert from "node:assert/strict";
import { test } from "node:test";
import { kanjiNumeral, decodeEnglish, encodeArpabet, encodeJapanese, englishWords, kanaToTokens, makeEnglishPhonemizer, makeJapanesePhonemizer } from "../../src/lib/chat/phonemes.ts";

test("ARPAbet round trip strips stress", () => {
  assert.equal(decodeEnglish(encodeArpabet("F AO1 S AH0 T")), "F AO S AH T");
});

test("English words keep apostrophes", () => {
  assert.deepEqual(englishWords("What's Yuya’s  SigIQ work?"), ["what's", "yuya's", "sigiq", "work"]);
});

test("English phonemizer reports OOV words as gaps", () => {
  const ph = makeEnglishPhonemizer({ fix: encodeArpabet("F IH K S") });
  assert.deepEqual(ph("fix zorp"), { ph: encodeArpabet("F IH K S"), oov: ["zorp"] });
});

test("kana: plain, palatalized, small vowels", () => {
  assert.deepEqual(kanaToTokens("カタ"), ["k", "a", "t", "a"]);
  assert.deepEqual(kanaToTokens("キャ"), ["k", "y", "a"]);
  assert.deepEqual(kanaToTokens("シャ"), ["sh", "a"]);
  assert.deepEqual(kanaToTokens("ファ"), ["f", "a"]);
  assert.deepEqual(kanaToTokens("ティ"), ["t", "i"]);
  assert.deepEqual(kanaToTokens("ウィ"), ["w", "i"]);
  assert.deepEqual(kanaToTokens("ちゅう"), ["ch", "u", "u"]); // hiragana works too
});

test("kana: long vowel, sokuon, hatsuon", () => {
  assert.deepEqual(kanaToTokens("トーキョー"), ["t", "o", "o", "k", "y", "o", "o"]);
  assert.deepEqual(kanaToTokens("リットマン"), ["r", "i", "Q", "t", "o", "m", "a", "N"]);
  assert.equal(encodeJapanese(kanaToTokens("シチツ")), "SiCiTu");
});

test("か is closer to た than to と", () => {
  const ka = encodeJapanese(kanaToTokens("カ"));
  const ta = encodeJapanese(kanaToTokens("タ"));
  const to = encodeJapanese(kanaToTokens("ト"));
  const shared = (a: string, b: string) => [...a].filter((c) => b.includes(c)).length;
  assert.ok(shared(ka, ta) > shared(ka, to));
});

test("Japanese phonemizer applies term readings before tokenizing", () => {
  // A stand-in tokenizer: one token per run of non-space characters, pronunciation only for kana.
  const tokenizer = {
    tokenize: (t: string) => t.split(/\s+/).filter(Boolean).map((s) => ({ surface_form: s, pronunciation: /^[ァ-ヺー]+$/.test(s) ? s : undefined })),
  };
  const ph = makeJapanesePhonemizer(tokenizer, { SigIQ: "シグアイキュー" });
  assert.equal(ph("sigiq").ph, encodeJapanese(kanaToTokens("シグアイキュー")));
  assert.deepEqual(ph("ABC").oov, ["ABC"]);
});

test("numbers are spelled out the way people say them", () => {
  assert.deepEqual(englishWords("in 30 seconds"), ["in", "thirty", "seconds"]);
  assert.deepEqual(englishWords("EMNLP 2025"), ["emnlp", "twenty", "twenty", "five"]);
  assert.deepEqual(englishWords("2007 and 72"), ["twenty", "oh", "seven", "and", "seventy", "two"]);
  assert.deepEqual(englishWords("3D character"), ["three", "d", "character"]);
});

test("Japanese numerals", () => {
  assert.equal(kanjiNumeral("30"), "三十");
  assert.equal(kanjiNumeral("72"), "七十二");
  assert.equal(kanjiNumeral("2025"), "二千二十五");
  assert.equal(kanjiNumeral("110"), "百十");
  assert.equal(kanjiNumeral("0"), "〇");
});
