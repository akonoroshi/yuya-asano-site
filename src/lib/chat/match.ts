// Matching a visitor's question against the narrow context (FAQ phrasings).
// Follows Asano et al. (COLING 2025 Industry): fuzzy matching over n-best hypotheses (Sec. 3.2),
// then ranking the context by phonetic LCS against the best hypothesis (Sec. 3.3, Algorithm 1).
// The LCS is weighted so Japanese vowels can count for less than consonants.
import { EN_VOWEL_CHARS, JA_VOWEL_CHARS } from "./phonemes.ts";
import type { ContextEntry, Lang, RouteResult } from "./types.ts";

export interface MatchConfig {
  /** Fuzzy similarity needed to accept a match (paper: 0.96 with a different fuzzy metric). */
  fuzzyThreshold: number;
  /** s in Algorithm 1: share of the context phrasing (by weight) the LCS must cover. */
  coverage: number;
  /** r in Algorithm 1: LCS span in the hypothesis / context length must not exceed this. */
  range: number;
  /** Weight of a matched vowel; consonants weigh 1. */
  vowelWeight: number;
  /** Context phrasings shorter than this (in phonemes) are skipped by the phonetic step. */
  minContextPh: number;
  /** Hypotheses are truncated to this many phonemes. */
  maxHypPh: number;
}

// Starting points. Tune them with `npm run chat:eval` on your own test sets.
export const MATCH_CONFIG: Record<Lang, MatchConfig> = {
  en: { fuzzyThreshold: 0.92, coverage: 0.8, range: 1.5, vowelWeight: 1, minContextPh: 6, maxHypPh: 160 },
  ja: { fuzzyThreshold: 0.9, coverage: 0.8, range: 1.5, vowelWeight: 0.5, minContextPh: 8, maxHypPh: 200 },
};

/* ---------------- Fuzzy matching ---------------- */

let row0 = new Uint16Array(256);
let row1 = new Uint16Array(256);

/** Levenshtein similarity: 1 - distance / max(length). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  if (Math.abs(a.length - b.length) / Math.max(a.length, b.length) > 0.2) return 0; // cannot reach any useful threshold
  if (b.length + 1 > row0.length) {
    row0 = new Uint16Array(b.length * 2);
    row1 = new Uint16Array(b.length * 2);
  }
  let prev = row0;
  let cur = row1;
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/**
 * Scores hypotheses from best to worst and stops at the first one that matches a phrasing.
 * A match on the top hypothesis needs no confirmation; a match on a lower one is a correction,
 * so the visitor is asked "Did you mean …?" (as in the paper's Alexa deployment).
 */
export function fuzzyRoute(normalizedAlternatives: string[], entries: ContextEntry[], cfg: MatchConfig): RouteResult {
  for (let k = 0; k < normalizedAlternatives.length; k++) {
    const alt = normalizedAlternatives[k];
    if (!alt) continue;
    let best: ContextEntry | null = null;
    let bestScore = 0;
    for (const e of entries) {
      const s = similarity(alt, e.norm);
      if (s > bestScore) [best, bestScore] = [e, s];
    }
    if (best && bestScore >= cfg.fuzzyThreshold) {
      return { kind: "faq", id: best.id, confirm: k > 0, via: "fuzzy", score: bestScore };
    }
  }
  return { kind: "none" };
}

/* ---------------- Weighted LCS ---------------- */

export interface LcsResult {
  weight: number; // total weight of matched phonemes
  first: number; // index in the hypothesis of the first matched phoneme (-1 if none)
  last: number; // index of the last matched phoneme
}

let table = new Float32Array(0);

/** Heaviest common subsequence of h (hypothesis) and c (context), with match positions in h. */
export function weightedLcs(h: string, c: string, weight: (ch: string) => number): LcsResult {
  const n = h.length;
  const m = c.length;
  const w = m + 1;
  if (table.length < (n + 1) * w) table = new Float32Array((n + 1) * w * 2);
  const t = table;
  for (let j = 0; j <= m; j++) t[j] = 0;
  for (let i = 1; i <= n; i++) {
    t[i * w] = 0;
    const hc = h[i - 1];
    const hw = weight(hc);
    for (let j = 1; j <= m; j++) {
      const up = t[(i - 1) * w + j];
      const left = t[i * w + j - 1];
      const diag = hc === c[j - 1] ? t[(i - 1) * w + j - 1] + hw : -1;
      t[i * w + j] = diag > up && diag > left ? diag : up > left ? up : left;
    }
  }
  // Backtrack to find where the matched phonemes sit in the hypothesis.
  let i = n;
  let j = m;
  let first = -1;
  let last = -1;
  while (i > 0 && j > 0) {
    const v = t[i * w + j];
    if (h[i - 1] === c[j - 1] && Math.abs(t[(i - 1) * w + j - 1] + weight(h[i - 1]) - v) < 1e-6) {
      if (last < 0) last = i - 1;
      first = i - 1;
      i--;
      j--;
    } else if (t[(i - 1) * w + j] >= t[i * w + j - 1]) i--;
    else j--;
  }
  return { weight: t[n * w + m], first, last };
}

export function weightFor(lang: Lang, cfg: MatchConfig): (ch: string) => number {
  const vowels = lang === "ja" ? JA_VOWEL_CHARS : EN_VOWEL_CHARS;
  return (ch) => (vowels.has(ch) ? cfg.vowelWeight : 1);
}

/* ---------------- Ranking context (Algorithm 1) ---------------- */

export interface ContextScore {
  entry: ContextEntry;
  lcs: number; // L_i (weighted)
  coverage: number; // S_i = L_i / weight(C_i)
  rangeRatio: number; // R_i / len(C_i)
}

export function scoreContext(hph: string, entries: ContextEntry[], lang: Lang, cfg: MatchConfig): ContextScore[] {
  const h = hph.slice(0, cfg.maxHypPh);
  const weight = weightFor(lang, cfg);
  const out: ContextScore[] = [];
  for (const e of entries) {
    if (e.ph.length < cfg.minContextPh) continue;
    let total = 0;
    for (const ch of e.ph) total += weight(ch);
    const r = weightedLcs(h, e.ph, weight);
    if (r.first < 0) continue;
    out.push({ entry: e, lcs: r.weight, coverage: r.weight / total, rangeRatio: (r.last - r.first + 1) / e.ph.length });
  }
  return out;
}

/**
 * Algorithm 1: take the phrasing with the longest LCS; if it fails the coverage or range check,
 * try the phrasing with the highest coverage. A phonetic match is always confirmed with the visitor.
 */
export function phonemeRoute(hph: string, entries: ContextEntry[], lang: Lang, cfg: MatchConfig): RouteResult {
  if (!hph) return { kind: "none" };
  const scores = scoreContext(hph, entries, lang, cfg);
  if (!scores.length) return { kind: "none" };
  const passes = (s: ContextScore) => s.coverage >= cfg.coverage && s.rangeRatio <= cfg.range;
  const byLcs = scores.reduce((a, b) => (b.lcs > a.lcs ? b : a));
  const byCoverage = scores.reduce((a, b) => (b.coverage > a.coverage ? b : a));
  const pick = passes(byLcs) ? byLcs : passes(byCoverage) ? byCoverage : null;
  return pick ? { kind: "faq", id: pick.entry.id, confirm: true, via: "phoneme", score: pick.coverage } : { kind: "none" };
}
