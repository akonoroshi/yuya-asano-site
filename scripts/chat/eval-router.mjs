// Measures the free routing steps (fuzzy + phonetic) against hand-labeled test sets, using the
// built context files and exactly the same code as the browser.
//
//   npm run chat:eval                 both languages
//   npm run chat:eval -- ja --verbose one language, listing every mistake
//
// Test sets: src/data/chat/eval/<lang>.tsv, one row per utterance:
//   expected_id <TAB> typed|voice <TAB> alternative 1 || alternative 2 || ...
// expected_id is an FAQ id, or "none" when the question should go to the LLM.
// Metrics follow the paper: precision/recall/F1 at rank 1, and the false positive rate
// (share of "none" rows that were wrongly answered from the FAQ).
import fs from "node:fs/promises";
import path from "node:path";
import { fail, loadTokenizer, outDir, root } from "./lib.mjs";

const { routeAll } = await import("../../src/lib/chat/route.ts");
const { repairAlternatives } = await import("../../src/lib/chat/asr-repair.ts");
const { makeEnglishPhonemizer, makeJapanesePhonemizer } = await import("../../src/lib/chat/phonemes.ts");

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const langs = args.filter((a) => a === "en" || a === "ja");

const readJson = async (f) => JSON.parse(await fs.readFile(path.join(outDir, f), "utf8").catch(() => fail(`missing public/chat/${f}: run npm run chat:context`)));

for (const lang of langs.length ? langs : ["en", "ja"]) {
  const ctx = await readJson(`context.${lang}.json`);
  const phonemize = lang === "en" ? makeEnglishPhonemizer(await readJson("cmudict.json")) : makeJapanesePhonemizer(await loadTokenizer(), ctx.termReadings);
  const file = path.join(root, `src/data/chat/eval/${lang}.tsv`);
  const rows = (await fs.readFile(file, "utf8"))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const [expected, source, alts] = l.split("\t");
      if (!alts || !["typed", "voice"].includes(source)) fail(`${file}: bad row "${l}"`);
      const alternatives = alts.split("||").map((s) => s.trim()).filter(Boolean);
      // Voice rows are raw recognizer output: repair them the way the listeners do.
      return { expected, source, alternatives: source === "voice" ? repairAlternatives(alternatives, lang) : alternatives };
    });

  let tp = 0, fp = 0, fn = 0, negatives = 0, falsePos = 0;
  const viaCount = { social: 0, fuzzy: 0, contain: 0, phoneme: 0 };
  let confirmed = 0; // correct matches that still ask "Did you mean …?"
  const mistakes = [];
  for (const row of rows) {
    const r = routeAll({ alternatives: row.alternatives, source: row.source }, ctx, phonemize);
    const got = r.kind === "faq" ? r.id : "none";
    if (r.kind === "faq") viaCount[r.via]++;
    if (row.expected === "none") {
      negatives++;
      if (got !== "none") { falsePos++; fp++; }
    } else if (got === row.expected) {
      tp++;
      if (r.confirm) confirmed++;
    }
    else {
      fn++;
      if (got !== "none") fp++;
    }
    if (got !== row.expected) mistakes.push({ ...row, got, r });
  }
  const p = tp + fp ? tp / (tp + fp) : 0;
  const rc = tp + fn ? tp / (tp + fn) : 0;
  const f1 = p + rc ? (2 * p * rc) / (p + rc) : 0;
  const fpr = negatives ? falsePos / negatives : 0;
  const f = (x) => x.toFixed(2);
  console.log(`\n${lang}: ${rows.length} rows   precision ${f(p)}   recall ${f(rc)}   F1 ${f(f1)}   FPR ${f(fpr)}   (matched by social ${viaCount.social}, fuzzy ${viaCount.fuzzy}, contain ${viaCount.contain}, phoneme ${viaCount.phoneme}; ${confirmed} correct but confirmed)`);
  if (verbose) {
    for (const m of mistakes) {
      const how = m.r.kind === "faq" ? ` via ${m.r.via} (${m.r.score.toFixed(2)})` : "";
      console.log(`  expected ${m.expected}, got ${m.got}${how}:  ${m.alternatives.join(" || ")}`);
    }
  } else if (mistakes.length) console.log(`  ${mistakes.length} mistake(s); add --verbose to list them`);
}
