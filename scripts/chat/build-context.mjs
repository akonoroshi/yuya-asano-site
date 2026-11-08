// Builds everything the browser needs for free (no-LLM) answers, into public/chat/:
//   context.en.json / context.ja.json  FAQ phrasings with normalized text and phonemes, answers, chips
//   cmudict.json                       word -> phoneme string, for English voice input
//   kuromoji/                          kuromoji's browser bundle and dictionary, for Japanese voice input
// Runs automatically before `npm run build` and `npm run dev`. Pass --strict to fail on
// English context words that have no pronunciation (see terms.ts).
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fail, kuromojiDir, loadTokenizer, outDir, root } from "./lib.mjs";

const { faq, startChips, pageChips } = await import("../../src/data/chat/faq.ts");
const { terms } = await import("../../src/data/chat/terms.ts");
const { normalizeText } = await import("../../src/lib/chat/normalize.ts");
const { parseTags } = await import("../../src/lib/chat/tags.ts");
const { encodeArpabet, englishWords, makeEnglishPhonemizer, makeJapanesePhonemizer } = await import(
  "../../src/lib/chat/phonemes.ts"
);
const { dictionary } = await import("cmu-pronouncing-dictionary");

const strict = process.argv.includes("--strict");
const paraphrases = JSON.parse(await fs.readFile(path.join(root, "src/data/chat/paraphrases.json"), "utf8"));
await fs.mkdir(path.join(outDir, "kuromoji/dict"), { recursive: true });

/* ---------- Validate the FAQ ---------- */
const ids = new Set();
for (const e of faq) {
  if (ids.has(e.id)) fail(`faq.ts: duplicate id "${e.id}"`);
  ids.add(e.id);
  for (const lang of ["en", "ja"]) {
    if (!e.questions[lang]?.length) fail(`faq.ts: "${e.id}" has no ${lang} questions`);
    if (!e.answer[lang]?.trim()) fail(`faq.ts: "${e.id}" has no ${lang} answer`);
  }
}
for (const id of Object.keys(paraphrases)) if (!ids.has(id)) console.warn(`! paraphrases.json: "${id}" is not in faq.ts`);
// Behavior tags: a typo would silently drop a gesture, so unknown tags fail the build.
for (const e of faq) {
  for (const lang of ["en", "ja"]) {
    for (const t of [e.answer[lang], ...(e.alternatives?.[lang] ?? [])]) {
      const { errors, tags } = parseTags(t);
      if (errors.length) fail(`faq.ts: "${e.id}" (${lang}) has invalid tags: ${errors.join("; ")}`);
      if (!tags.some((x) => x.kind === "emo" && x.at === 0)) console.warn(`! faq.ts: "${e.id}" (${lang}) doesn't start with an [emo:…] tag (the character stays neutral)`);
    }
  }
}
const hasChip = new Set(faq.filter((e) => e.chip).map((e) => e.id));
// Chip tree: child id -> parent ids, in faq.ts order. The first parent is the primary one, used
// when the visitor didn't arrive through a parent (for example, after typing the question).
const parentsOf = new Map();
for (const e of faq) {
  for (const lang of ["en", "ja"]) if (e.chip && !e.chip[lang]?.trim()) fail(`faq.ts: "${e.id}" has no ${lang} chip label`);
  if (e.children?.length && !e.chip) fail(`faq.ts: "${e.id}" has children but no chip label`);
  for (const c of e.children ?? []) {
    if (!hasChip.has(c)) fail(`faq.ts: "${e.id}" lists child "${c}", which doesn't exist or has no chip label`);
    const ps = parentsOf.get(c) ?? [];
    if (ps.includes(e.id)) fail(`faq.ts: "${e.id}" lists "${c}" twice`);
    if (ps.length >= 2) fail(`faq.ts: "${c}" has more than two parents (${[...ps, e.id].join(", ")})`);
    parentsOf.set(c, [...ps, e.id]);
  }
}
// No cycles through any parent.
const visiting = new Set();
const checked = new Set();
const visit = (id) => {
  if (checked.has(id)) return;
  if (visiting.has(id)) fail(`faq.ts: the chip tree has a cycle through "${id}"`);
  visiting.add(id);
  for (const p of parentsOf.get(id) ?? []) visit(p);
  visiting.delete(id);
  checked.add(id);
};
for (const id of parentsOf.keys()) visit(id);
for (const id of startChips) {
  if (!hasChip.has(id)) fail(`faq.ts: start chip "${id}" doesn't exist or has no chip label`);
  if (parentsOf.has(id)) fail(`faq.ts: start chip "${id}" must be top-level, but it is a child of "${parentsOf.get(id).join(", ")}"`);
}
for (const [page, ids] of Object.entries(pageChips)) {
  if (ids.length > 4) fail(`faq.ts: pageChips["${page}"] has ${ids.length} chips; use at most four`);
  for (const id of ids) if (!hasChip.has(id)) fail(`faq.ts: pageChips["${page}"] lists "${id}", which doesn't exist or has no chip label`);
}
const orphans = [...hasChip].filter((id) => !parentsOf.has(id) && !startChips.includes(id));
if (orphans.length) console.warn(`! faq.ts: chip topics outside the tree (shown only after an LLM answer finds them): ${orphans.join(", ")}`);

/* ---------- English pronunciations ---------- */
const dict = {};
for (const [word, pron] of Object.entries(dictionary)) {
  if (/^[a-z']+$/.test(word)) dict[word] = encodeArpabet(pron); // skips variants like "read(1)"
}
for (const t of terms) {
  if (!t.en) continue;
  const words = englishWords(t.text);
  if (words.length !== 1) fail(`terms.ts: "${t.text}" has an English pronunciation but is not one word`);
  dict[words[0]] = encodeArpabet(t.en);
}
const dictJson = JSON.stringify(dict);
await fs.writeFile(path.join(outDir, "cmudict.json"), dictJson);
const phEn = makeEnglishPhonemizer(dict);

/* ---------- Japanese readings ---------- */
const termReadings = Object.fromEntries(terms.filter((t) => t.ja).map((t) => [t.text, t.ja]));
const phJa = makeJapanesePhonemizer(await loadTokenizer(), termReadings);
const kdir = kuromojiDir();
await fs.copyFile(path.join(kdir, "build/kuromoji.js"), path.join(outDir, "kuromoji/kuromoji.js"));
for (const f of await fs.readdir(path.join(kdir, "dict"))) {
  if (f.endsWith(".dat.gz")) await fs.copyFile(path.join(kdir, "dict", f), path.join(outDir, "kuromoji/dict", f));
}

/* ---------- Context files ---------- */
const localize = (href, lang) => (lang === "ja" && href.startsWith("/") && !href.startsWith("/ja/") ? `/ja${href}` : href);
const enOov = new Map(); // word -> example phrasing

for (const lang of ["en", "ja"]) {
  const phonemize = lang === "en" ? phEn : phJa;
  const entries = [];
  const answers = {};
  const owner = new Map(); // normalized text -> id, to catch the same phrasing under two answers
  for (const e of faq) {
    const seen = new Set();
    for (const text of [...e.questions[lang], ...(paraphrases[e.id]?.[lang] ?? [])]) {
      const norm = normalizeText(text, lang);
      if (!norm || seen.has(norm)) continue;
      seen.add(norm);
      if (owner.has(norm) && owner.get(norm) !== e.id) console.warn(`! ${lang}: "${text}" is a phrasing of both "${owner.get(norm)}" and "${e.id}"`);
      owner.set(norm, e.id);
      const { ph, oov } = phonemize(text);
      if (lang === "en") for (const w of oov) if (!enOov.has(w)) enOov.set(w, text);
      if (lang === "ja" && !ph) console.warn(`! ja: no phonemes for "${text}"`);
      entries.push({ id: e.id, text, norm, ph });
    }
    answers[e.id] = {
      canonical: e.questions[lang][0],
      chip: e.chip?.[lang],
      parents: parentsOf.get(e.id) ?? [],
      children: e.children ?? [],
      text: e.answer[lang],
      alternatives: e.alternatives?.[lang] ?? [],
      links: (e.links ?? []).map((l) => ({ label: l.label[lang], href: localize(l.href, lang) })),
    };
  }
  const biased = terms.filter((t) => t.bias !== false);
  const phrases = lang === "en" ? biased.map((t) => t.text) : [...new Set(biased.flatMap((t) => [t.text, t.ja].filter(Boolean)))];
  const body = { lang, start: startChips, pages: pageChips, entries, answers, phrases, termReadings: lang === "ja" ? termReadings : {} };
  const version = createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12);
  await fs.writeFile(path.join(outDir, `context.${lang}.json`), JSON.stringify({ version, ...body }));
  console.log(`✓ context.${lang}.json: ${entries.length} phrasings, ${hasChip.size} chip topics (version ${version})`);
}
console.log(`✓ cmudict.json: ${Object.keys(dict).length} words, ${(dictJson.length / 1e6).toFixed(1)} MB before compression`);
console.log("✓ kuromoji/: browser bundle and dictionary copied");

if (enOov.size) {
  console.warn(`\n! ${enOov.size} English context word(s) have no pronunciation and are skipped by phonetic matching:`);
  for (const [w, ex] of enOov) console.warn(`    ${w}   (in "${ex}")`);
  console.warn(`  Get pronunciations with: python3 scripts/chat/g2p_oov.py ${[...enOov.keys()].join(" ")}`);
  console.warn("  then add them to src/data/chat/terms.ts.");
  if (strict) fail("unresolved pronunciations (--strict)");
}
