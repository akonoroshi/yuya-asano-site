// Adds new papers from Google Scholar to src/data/publications.json.
//
// Google Scholar has no official API and blocks automated requests, so this uses SerpApi's
// Google Scholar Author API. Papers already in the JSON are never overwritten, so your edits
// (venue names, links, awards, hidden) are kept. New papers are added with Scholar's data,
// which you can then polish by hand.
//
// Usage:
//   SERPAPI_KEY=... node scripts/sync-publications.mjs
//   SERPAPI_FIXTURE=path/to/response.json node scripts/sync-publications.mjs   (offline test)

import { readFile, writeFile } from "node:fs/promises";

const AUTHOR_ID = process.env.SCHOLAR_AUTHOR_ID ?? "0k3K65YAAAAJ";
const FILE = new URL("../src/data/publications.json", import.meta.url);

const key = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "");

// "Y Asano" -> "Y. Asano", "JJ Williams" -> "J. J. Williams"
const formatAuthor = (name) =>
  name.trim().replace(/^([A-Z]{1,3})\s+(?=\S)/, (_, initials) => initials.split("").map((c) => `${c}. `).join(""));

// "Proceedings of the 2025 Conference on ..., 16336-16365, 2025" -> "Proceedings of the 2025 Conference on ..."
const cleanVenue = (publication = "") =>
  publication
    .replace(/,\s*\d{4}\s*$/, "")
    .replace(/,\s*\d+\s*[-–]\s*\d+\s*$/, "")
    .replace(/,\s*\d+\s*\(\d+\)\s*$/, "")
    .trim();

async function fetchArticles() {
  if (process.env.SERPAPI_FIXTURE) {
    return JSON.parse(await readFile(process.env.SERPAPI_FIXTURE, "utf8")).articles ?? [];
  }
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error("SERPAPI_KEY is not set.");
  const articles = [];
  for (let start = 0; start < 1000; start += 100) {
    const url = new URL("https://serpapi.com/search.json");
    url.search = new URLSearchParams({
      engine: "google_scholar_author",
      author_id: AUTHOR_ID,
      sort: "pubdate",
      num: "100",
      start: String(start),
      hl: "en",
      api_key: apiKey,
    }).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SerpApi returned HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`SerpApi error: ${body.error}`);
    const page = body.articles ?? [];
    articles.push(...page);
    if (page.length < 100) break;
  }
  return articles;
}

const existing = JSON.parse(await readFile(FILE, "utf8"));
const known = new Map(existing.map((p) => [key(p.title), p]));
const articles = await fetchArticles();

const added = [];
for (const a of articles) {
  if (!a.title) continue;
  const k = key(a.title);
  const year = Number.parseInt(a.year, 10) || null;
  const current = known.get(k);
  if (current) {
    if (current.year == null && year) current.year = year; // only fill gaps
    continue;
  }
  const venue = cleanVenue(a.publication);
  const entry = {
    title: a.title,
    authors: (a.authors ?? "").split(",").map(formatAuthor).filter((n) => n && n !== "..."),
    venue: venue || "Unpublished",
    year,
    href: a.link ?? "",
    ...(/arxiv/i.test(venue) ? { preprint: true } : {}),
  };
  known.set(k, entry);
  added.push(entry);
}

if (added.length === 0) {
  console.log(`No new papers (checked ${articles.length} on Google Scholar).`);
} else {
  // New papers go first; the site sorts by year and keeps file order within a year.
  await writeFile(FILE, JSON.stringify([...added, ...existing], null, 2) + "\n");
  console.log(`Added ${added.length} paper(s):`);
  for (const p of added) console.log(`  ${p.year ?? "????"}  ${p.title}  [${p.venue}]`);
}
