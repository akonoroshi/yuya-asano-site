// Syncs the retrieval index used by the LLM answers. Run it locally after changing project
// pages, paper texts, or FAQ answers, then commit src/data/chat/generated/vector-ids.json.
//
//   npm run chat:index -- --dry-run   show the chunks without calling any API
//   CF_ACCOUNT_ID=... CF_API_TOKEN=... npm run chat:index
//
// The token needs "Workers AI: Read" and "Vectorize: Edit". Chunk ids are content hashes,
// so only new or changed chunks are embedded, and removed ones are deleted.
//
// Sources and their scope (the Worker retrieves scope = page language, plus "all"):
//   src/content/projects/en/*.md   scope "en", url /projects/<id>/
//   src/content/projects/ja/*.md   scope "ja", url /ja/projects/<id>/
//   src/data/chat/papers/*.md      scope "all", frontmatter: title, url
//   faq.ts answers                 scope "en" / "ja"
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fail, root } from "./lib.mjs";

const { faq } = await import("../../src/data/chat/faq.ts");
const { stripTags } = await import("../../src/lib/chat/tags.ts");

const dryRun = process.argv.includes("--dry-run");
const INDEX = process.env.VECTORIZE_INDEX ?? "site-chat";
const EMBED_MODEL = "@cf/baai/bge-m3"; // must match EMBED_MODEL in wrangler.jsonc
const manifestFile = path.join(root, "src/data/chat/generated/vector-ids.json");
const MAX_CHARS = { en: 1200, ja: 500, all: 1200 }; // Japanese packs more meaning per character

/* ---------- Reading sources ---------- */

function frontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src };
  const data = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return { data, body: src.slice(m[0].length) };
}

/** Markdown to plain text with headings kept (as "## Heading" lines), components and code dropped. */
function plain(md) {
  return md
    .replace(/^import .*$/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<[A-Z][\s\S]*?\/>/g, "") // self-closing components like <Replay ... />
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Paragraph chunks of up to max characters, each prefixed with the document title and current heading. */
function chunk(title, text, max) {
  const out = [];
  let heading = "";
  let buf = [];
  let len = 0;
  const flush = () => {
    if (buf.length) out.push([title, heading, ...buf].filter(Boolean).join("\n"));
    buf = [];
    len = 0;
  };
  for (const para of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
    const h = para.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      flush();
      heading = h[1];
      continue;
    }
    if (len + para.length > max && buf.length) {
      const carry = buf[buf.length - 1]; // overlap one paragraph between chunks
      flush();
      if (carry.length < max / 3) {
        buf = [carry];
        len = carry.length;
      }
    }
    for (const piece of para.length > max ? splitLong(para, max) : [para]) {
      if (len + piece.length > max && buf.length) flush();
      buf.push(piece);
      len += piece.length;
    }
  }
  flush();
  return out;
}

/** Splits a long paragraph at sentence ends into pieces of at most max characters (hard cut if a sentence is longer). */
function splitLong(para, max) {
  const pieces = [];
  let cur = "";
  for (const sentence of para.match(/[^.!?。！？]+[.!?。！？]*\s*/g) ?? [para]) {
    if (cur && cur.length + sentence.length > max) {
      pieces.push(cur.trim());
      cur = "";
    }
    cur += sentence;
    while (cur.length > max) {
      pieces.push(cur.slice(0, max).trim());
      cur = cur.slice(max);
    }
  }
  if (cur.trim()) pieces.push(cur.trim());
  return pieces;
}

async function mdFiles(dir) {
  try {
    return (await fs.readdir(dir)).filter((f) => /\.mdx?$/.test(f)).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

const docs = [];
for (const lang of ["en", "ja"]) {
  for (const file of await mdFiles(path.join(root, "src/content/projects", lang))) {
    const { data, body } = frontmatter(await fs.readFile(file, "utf8"));
    if (data.draft === "true") continue;
    const id = path.basename(file).replace(/\.mdx?$/, "");
    docs.push({ scope: lang, kind: "project", title: data.title || id, url: `${lang === "ja" ? "/ja" : ""}/projects/${id}/`, text: plain(body) });
  }
}
for (const file of await mdFiles(path.join(root, "src/data/chat/papers"))) {
  const { data, body } = frontmatter(await fs.readFile(file, "utf8"));
  if (!data.title || !data.url) fail(`${path.relative(root, file)}: add "title" and "url" to the frontmatter`);
  docs.push({ scope: "all", kind: "paper", title: data.title, url: data.url, text: plain(body) });
}
for (const e of faq) {
  for (const lang of ["en", "ja"]) {
    docs.push({ scope: lang, kind: "faq", faqId: e.id, title: e.questions[lang][0], url: "", text: stripTags(e.answer[lang]) });
  }
}

/* ---------- Chunks and ids ---------- */

const chunks = [];
for (const d of docs) {
  for (const text of chunk(d.title, d.text, MAX_CHARS[d.scope])) {
    const id = createHash("sha256").update(`${d.scope}|${d.url}|${text}`).digest("hex").slice(0, 40);
    // faqId lets the Worker suggest follow-up chips related to an LLM answer.
    chunks.push({ id, text, metadata: { scope: d.scope, kind: d.kind, title: d.title, url: d.url, text, ...(d.faqId ? { faqId: d.faqId } : {}) } });
  }
}
const previous = new Set(JSON.parse(await fs.readFile(manifestFile, "utf8").catch(() => "[]")));
const current = new Set(chunks.map((c) => c.id));
const toEmbed = chunks.filter((c) => !previous.has(c.id));
const toDelete = [...previous].filter((id) => !current.has(id));

const byKind = chunks.reduce((m, c) => ((m[`${c.metadata.kind}/${c.metadata.scope}`] = (m[`${c.metadata.kind}/${c.metadata.scope}`] ?? 0) + 1), m), {});
console.log(`${docs.length} documents -> ${chunks.length} chunks`, byKind);
console.log(`${toEmbed.length} to embed, ${toDelete.length} to delete`);
if (dryRun) {
  for (const c of toEmbed.slice(0, 5)) console.log(`\n--- ${c.metadata.kind}/${c.metadata.scope} ${c.metadata.url}\n${c.text}`);
  process.exit(0);
}

/* ---------- Cloudflare API ---------- */

const account = process.env.CF_ACCOUNT_ID ?? fail("set CF_ACCOUNT_ID");
const token = process.env.CF_API_TOKEN ?? fail("set CF_API_TOKEN");
const api = `https://api.cloudflare.com/client/v4/accounts/${account}`;

async function call(url, init) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) fail(`${res.status} ${url}\n${JSON.stringify(json.errors ?? json)}`);
  return json.result;
}

for (let i = 0; i < toEmbed.length; i += 50) {
  const batch = toEmbed.slice(i, i + 50);
  const result = await call(`${api}/ai/run/${EMBED_MODEL}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: batch.map((c) => c.text) }),
  });
  const ndjson = batch
    .map((c, k) => {
      const metadata = { ...c.metadata };
      while (Buffer.byteLength(JSON.stringify(metadata)) > 9000) metadata.text = metadata.text.slice(0, -100); // 10 KiB limit
      return JSON.stringify({ id: c.id, values: result.data[k], metadata });
    })
    .join("\n");
  await call(`${api}/vectorize/v2/indexes/${INDEX}/upsert`, { method: "POST", headers: { "Content-Type": "application/x-ndjson" }, body: ndjson });
  console.log(`✓ embedded and upserted ${Math.min(i + 50, toEmbed.length)}/${toEmbed.length}`);
}
for (let i = 0; i < toDelete.length; i += 100) {
  await call(`${api}/vectorize/v2/indexes/${INDEX}/delete_by_ids`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: toDelete.slice(i, i + 100) }),
  });
}
if (toDelete.length) console.log(`✓ deleted ${toDelete.length}`);

await fs.mkdir(path.dirname(manifestFile), { recursive: true });
await fs.writeFile(manifestFile, JSON.stringify([...current].sort(), null, 1) + "\n");
console.log(`✓ wrote ${path.relative(root, manifestFile)}; commit it`);
