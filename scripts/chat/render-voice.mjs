// Pre-records everything Shino can say without the LLM, through the same TTS server that voices
// live replies, so both sound the same. Writes:
//   tts-server/lexicon.json     pronunciation fixes, from terms.ts and pronunciations.ts
//   public/voice/<lang>/*.mp3   one clip per speech unit (src/lib/chat/speech.ts)
//   public/voice/manifest.json  each language's voice fingerprint and its clips
//
// Usage (see README-voice.md):
//   npm run chat:voice                 record new and changed lines, delete unused clips
//   npm run chat:voice -- --lexicon    only rewrite tts-server/lexicon.json
//   npm run chat:voice -- --check      no server: report lines without a clip (runs before every build)
// Needs TTS_URL (e.g. https://tts.yuyaasano.dev, or http://localhost:8080 on the VM) and
// TTS_SERVER_TOKEN, except with --lexicon and --check. Through the tunnel, also the Cloudflare
// Access service token: CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { root } from "./lib.mjs";

const { faq } = await import("../../src/data/chat/faq.ts");
const { terms } = await import("../../src/data/chat/terms.ts");
const pron = await import("../../src/data/chat/pronunciations.ts");
const { chatStrings } = await import("../../src/data/chat/strings.ts");
const { canned } = await import("../../worker/prompt.ts");
const { parseTags } = await import("../../src/lib/chat/tags.ts");
const { speechKey, speechUnits } = await import("../../src/lib/chat/speech.ts");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const LEXICON_ONLY = args.includes("--lexicon");
const LANGS = ["en", "ja"];
const voiceDir = path.join(root, "public/voice");
const manifestPath = path.join(voiceDir, "manifest.json");
const lexiconPath = path.join(root, "tts-server/lexicon.json");
const CONCURRENCY = 2; // the server synthesizes one request at a time per language anyway

/* ---------- Lexicon ---------- */
const lexicon = {
  en: { ...pron.en },
  ja: { ...Object.fromEntries(terms.filter((t) => t.ja).map((t) => [t.text, t.ja])), ...pron.ja },
};
const lexiconText = JSON.stringify(lexicon, null, 2) + "\n";
const lexiconHash = createHash("sha256").update(lexiconText).digest("hex");
const current = await fs.readFile(lexiconPath, "utf8").catch(() => null);

if (CHECK) {
  if (current !== lexiconText) {
    console.warn("! voice: tts-server/lexicon.json is out of date with terms.ts / pronunciations.ts. Run npm run chat:voice.");
  }
} else if (current !== lexiconText) {
  await fs.writeFile(lexiconPath, lexiconText);
  console.log("✓ tts-server/lexicon.json updated");
}
if (LEXICON_ONLY) process.exit(0);

/* ---------- Everything Shino says without the LLM ---------- */
function lines(lang) {
  const s = chatStrings[lang];
  const out = [s.intro, s.introProject, ...s.fillers, ...s.somethingElseReply, ...s.repeatLeadIn, ...Object.values(s.errors), ...canned.offtopic[lang]];
  const sep = lang === "ja" ? "" : " ";
  for (const e of faq) {
    const answers = [e.answer[lang], ...(e.alternatives?.[lang] ?? [])];
    out.push(...answers);
    // A repeated factual answer gets a lead-in (controller.ts answerFaq).
    if (!e.alternatives?.[lang]?.length) for (const lead of s.repeatLeadIn) out.push(`${lead}${sep}${e.answer[lang]}`);
    // "Did you mean …?" with this question (controller.ts confirmFaq).
    const q = e.questions[lang][0].replace(/[?？]$/, "");
    for (const d of s.didYouMean) out.push(d.replace("{q}", q));
  }
  return out.map((t) => parseTags(t).text);
}

const unitsByLang = Object.fromEntries(LANGS.map((lang) => [lang, [...new Set(lines(lang).flatMap((t) => speechUnits(lang, t)))]]));

async function keysFor(lang, fp) {
  const map = new Map(); // key -> unit
  for (const u of unitsByLang[lang]) map.set(await speechKey(fp, lang, u), u);
  return map;
}

const readManifest = async () => JSON.parse(await fs.readFile(manifestPath, "utf8").catch(() => "{}"));

/* ---------- --check: no server, just report ---------- */
if (CHECK) {
  const manifest = await readManifest();
  for (const lang of LANGS) {
    const m = manifest[lang];
    if (!m?.fingerprint) {
      console.warn(`! voice: no ${lang} clips recorded yet (npm run chat:voice). Shino stays silent for curated ${lang} lines.`);
      continue;
    }
    const have = new Set(m.keys);
    const missing = [...(await keysFor(lang, m.fingerprint))].filter(([k]) => !have.has(k)).map(([, u]) => u);
    if (missing.length) {
      console.warn(`! voice: ${missing.length} ${lang} line(s) changed or new since the clips were recorded; they play silently until npm run chat:voice:`);
      for (const u of missing.slice(0, 5)) console.warn(`    ${u.length > 70 ? u.slice(0, 70) + "…" : u}`);
      if (missing.length > 5) console.warn(`    … and ${missing.length - 5} more`);
    } else console.log(`✓ voice: all ${have.size} ${lang} clips present`);
  }
  process.exit(0);
}

/* ---------- Record ---------- */
const base = (process.env.TTS_URL ?? "").replace(/\/$/, "");
const token = process.env.TTS_SERVER_TOKEN ?? "";
if (!base || !token) {
  console.error("Set TTS_URL and TTS_SERVER_TOKEN (the same token as on the server). See README-voice.md.");
  process.exit(1);
}
const access =
  process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
    ? { "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID, "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET }
    : {};
if (!Object.keys(access).length && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(base)) {
  console.warn("! No CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET: Cloudflare Access will refuse the requests if it guards TTS_URL.");
}

// redirect: "manual", because Cloudflare Access answers a bad service token with a redirect to its login page.
const health = await fetch(`${base}/healthz`, { headers: access, redirect: "manual" }).then((r) =>
  r.ok
    ? r.json()
    : Promise.reject(new Error(`healthz ${r.status}${r.status === 403 || (r.status >= 300 && r.status < 400) ? ": Cloudflare Access refused the service token (check CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET)" : ""}`)),
);
if (health.lexicon !== lexiconHash) {
  console.error(
    "The TTS server has a different tts-server/lexicon.json than this checkout.\n" +
      "Commit and push it, then on the VM: git pull && docker compose restart gateway. Then run this again.",
  );
  process.exit(1);
}
for (const lang of LANGS) {
  if (!health[lang]?.fingerprint) {
    console.error(`The server's ${lang} voice isn't running: ${health[lang]?.error ?? "unknown error"}`);
    process.exit(1);
  }
}
if (health.ja.credit !== JSON.parse(await fs.readFile(path.join(root, "tts-server/voices.json"), "utf8")).ja.credit) {
  console.error("The server's Japanese credit differs from tts-server/voices.json here: deploy voices.json first.");
  process.exit(1);
}

const manifest = { version: 1 };
for (const lang of LANGS) {
  const fp = health[lang].fingerprint;
  const dir = path.join(voiceDir, lang);
  await fs.mkdir(dir, { recursive: true });
  const wanted = await keysFor(lang, fp);
  const existing = new Set((await fs.readdir(dir)).filter((f) => f.endsWith(".mp3")).map((f) => f.slice(0, -4)));
  const todo = [...wanted].filter(([k]) => !existing.has(k));
  console.log(`${lang}: ${wanted.size} units, ${todo.length} to record (voice ${fp})`);

  let done = 0;
  const started = Date.now();
  const worker = async () => {
    for (let job = todo.shift(); job; job = todo.shift()) {
      const [key, unit] = job;
      const res = await fetch(`${base}/v1/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Expect-Fingerprint": fp, ...access },
        body: JSON.stringify({ lang, text: unit }),
        redirect: "manual",
      });
      if (res.status === 409) throw new Error("The server's voice changed while recording. Run this again.");
      if (!res.ok) throw new Error(`${res.status} for "${unit}": ${await res.text()}`);
      await fs.writeFile(path.join(dir, `${key}.mp3`), Buffer.from(await res.arrayBuffer()));
      done++;
      if (done % 10 === 0 || !todo.length) {
        const rate = (Date.now() - started) / 1000 / done;
        process.stdout.write(`  ${done} recorded, about ${Math.round(rate * todo.length)} s left\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Clips no line uses any more (old wording, or an old voice) are deleted.
  const stale = [...existing].filter((k) => !wanted.has(k));
  for (const k of stale) await fs.rm(path.join(dir, `${k}.mp3`));
  if (stale.length) console.log(`  deleted ${stale.length} unused clip(s)`);

  manifest[lang] = { fingerprint: fp, ...(health[lang].credit ? { credit: health[lang].credit } : {}), keys: [...wanted.keys()].sort() };
}
await fs.writeFile(manifestPath, JSON.stringify(manifest) + "\n");
console.log("✓ public/voice/manifest.json written. Commit public/voice/ and deploy.");
