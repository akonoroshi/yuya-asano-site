// Offline paraphrase augmentation (the paper's Sec. 3.4, without the clustering step, which a
// list this small doesn't need). Asks Gemini for different ways a visitor might ask each FAQ
// question and writes them to src/data/chat/paraphrases.json for you to review and edit.
//
//   GEMINI_API_KEY=... npm run chat:paraphrase            only FAQ ids/languages not in the file yet
//   GEMINI_API_KEY=... npm run chat:paraphrase -- --force regenerate everything
import fs from "node:fs/promises";
import path from "node:path";
import { fail, root } from "./lib.mjs";

const { faq } = await import("../../src/data/chat/faq.ts");
const key = process.env.GEMINI_API_KEY ?? fail("set GEMINI_API_KEY");
const model = process.env.PARAPHRASE_MODEL ?? "gemini-3.8-flash";
const force = process.argv.includes("--force");
const file = path.join(root, "src/data/chat/paraphrases.json");
const data = JSON.parse(await fs.readFile(file, "utf8"));

const instructions = {
  en: (qs) => `Visitors to a PhD student's portfolio website (mostly recruiters, hiring managers, and researchers) ask an AI character questions about him. Write 8 different ways a visitor might ask the same thing as these questions:\n${qs.map((q) => `- ${q}`).join("\n")}\nVary vocabulary and sentence structure, include short and casual forms, and address the student as "you" or "Yuya". Do not change the meaning. Return a JSON array of strings.`,
  ja: (qs) => `博士課程の学生のポートフォリオサイトで、訪問者（主に採用担当者や研究者）がAIキャラクターに本人について質問します。次の質問と同じ内容を尋ねる、異なる言い方を8通り書いてください：\n${qs.map((q) => `- ${q}`).join("\n")}\n語彙や文の構造を変え、短い言い方やくだけた言い方も含めてください。本人は「あなた」または「浅野さん」と呼んでください。意味は変えないでください。文字列のJSON配列で返してください。`,
};

for (const e of faq) {
  for (const lang of ["en", "ja"]) {
    if (!force && data[e.id]?.[lang]?.length) continue;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: instructions[lang](e.questions[lang]) }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
      }),
    });
    if (!res.ok) fail(`Gemini ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "[]";
    const list = JSON.parse(text).filter((s) => typeof s === "string" && s.trim());
    data[e.id] = { ...data[e.id], [lang]: list };
    console.log(`✓ ${e.id} (${lang}): ${list.length}`);
  }
}
await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n");
console.log(`\nWrote ${path.relative(root, file)}. Review it: delete any phrasing that changes the meaning.`);
