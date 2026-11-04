// Reads src/data/publications.json (kept up to date by scripts/sync-publications.mjs)
// and decides what the main page shows.
import data from "./publications.json";

export type Publication = {
  title: string;
  authors: string[];
  venue: string;
  year: number | null;
  href: string;
  code?: string;
  arxiv?: string;
  award?: string;
  preprint?: boolean; // set by the sync script for arXiv-only papers
  hidden?: boolean; // set to true in the JSON to hide a paper everywhere
};

/** How many papers the main page shows. */
export const SELECTED_COUNT = 5;
/** Whether arXiv-only preprints can appear on the main page. */
export const SELECTED_INCLUDES_PREPRINTS = false;

/** "Yuya Asano", "Y. Asano", and "Y Asano" all become "yasano". */
export const nameKey = (name: string) => {
  const parts = name.replace(/\./g, " ").trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ""}${parts.at(-1) ?? ""}`.toLowerCase();
};
const ME = nameKey("Yuya Asano");
export const isMe = (author: string) => nameKey(author) === ME;

const visible = (data as Publication[]).filter((p) => !p.hidden);

// Newest year first; within a year, keep the order in the JSON file (the sync script puts new papers first).
const byNewest = visible
  .map((p, i) => ({ p, i }))
  .sort((a, b) => (b.p.year ?? 0) - (a.p.year ?? 0) || a.i - b.i)
  .map(({ p }) => p);

export const allPublications = byNewest;

/** The latest first-authored papers. */
export const selectedPublications = byNewest
  .filter((p) => p.authors.length > 0 && isMe(p.authors[0]))
  .filter((p) => SELECTED_INCLUDES_PREPRINTS || !p.preprint)
  .slice(0, SELECTED_COUNT);

export const publicationsByYear = byNewest.reduce<Map<number | null, Publication[]>>((acc, p) => {
  acc.set(p.year, [...(acc.get(p.year) ?? []), p]);
  return acc;
}, new Map());

export const firstAuthorCount = visible.filter((p) => p.authors.length > 0 && isMe(p.authors[0])).length;
