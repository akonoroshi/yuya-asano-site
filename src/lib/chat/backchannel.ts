// Shino's spoken backchannels ("mm-hmm", 「うん」) play while the visitor is still talking, so the
// microphone can pick them up and the recognizer can write them into the visitor's sentence
// ("tell me about mm-hmm his research"). They're short and known in advance, so the words of a
// backchannel played in the last moment are simply removed from what the recognizer reports.
//
// This is separate from PlaybackEcho, which treats a whole reply as playback: a backchannel must
// not pause the visitor's turn. The lines themselves are `backchannels` in strings.ts.
import { normalizeText } from "./normalize.ts";
import type { Lang } from "./types.ts";

/** How long after a backchannel ends its words are still removed (recognition reports late). */
export const BACKCHANNEL_ECHO_TAIL_MS = 1200;

// How recognizers tend to write each English line. Japanese is matched by its normalized form.
const EN_FORMS: Record<string, string[]> = {
  "mm hmm": ["mm hmm", "mhm", "mm hm", "hmm hmm", "mmhmm", "hmm", "mm"],
  "uh huh": ["uh huh", "uhhuh", "aha", "uh"],
  "i see": ["i see"],
  right: ["right"],
};

const enWords = (text: string) => text.toLowerCase().replace(/[’`]/g, "'").replace(/[^\p{L}' ]+/gu, " ").replace(/\s+/g, " ").trim();

/** The forms to remove for a line Shino said (longest first). */
export function echoForms(line: string, lang: Lang): string[] {
  if (lang === "ja") {
    const n = normalizeText(line, "ja");
    return n ? [n] : [];
  }
  const key = enWords(line);
  return [...new Set([key, ...(EN_FORMS[key] ?? [])])].filter(Boolean).sort((a, b) => b.length - a.length);
}

/**
 * A transcript without the backchannels Shino just said. English removes them as whole words
 * anywhere; Japanese, which has no word boundaries, only at the start or the end (or the whole
 * text), so 「うん」 is never cut out of the middle of a word like 運動 (うんどう).
 */
export function stripBackchannelEcho(text: string, lines: string[], lang: Lang): string {
  if (!lines.length || !text) return text;
  const forms = lines.flatMap((l) => echoForms(l, lang));
  if (lang === "ja") {
    let s = text.trim();
    const n = () => normalizeText(s, "ja");
    for (let changed = true; changed && s; ) {
      changed = false;
      for (const f of forms) {
        const cur = n();
        if (cur === f) return "";
        // Compare on the normalized text, then cut the same number of raw characters, skipping
        // punctuation the normalization dropped.
        if (cur.startsWith(f)) {
          s = cutStart(s, f.length);
          changed = true;
        } else if (cur.endsWith(f)) {
          s = cutEnd(s, f.length);
          changed = true;
        }
      }
    }
    return s.trim();
  }
  // Compare word by word, but keep the recognizer's own words (case, punctuation) for the rest.
  const tokens = text.trim().split(/\s+/);
  const norm = tokens.map((t) => enWords(t));
  const keep = tokens.map(() => true);
  for (const f of forms.map((f) => f.split(" "))) {
    for (let i = 0; i + f.length <= tokens.length; i++) {
      if (f.every((w, k) => keep[i + k] && norm[i + k] === w)) for (let k = 0; k < f.length; k++) keep[i + k] = false;
    }
  }
  return tokens.filter((_, i) => keep[i]).join(" ").replace(/^[\s,.]+|[\s,]+$/g, "");
}

// Normalization keeps one character per kana and drops punctuation and spaces, so cutting N
// normalized characters means cutting N characters that survive normalization.
const kept = (ch: string) => !/[\s\p{P}\p{S}]/u.test(ch);
function cutStart(s: string, n: number): string {
  let i = 0;
  for (let k = 0; i < s.length && k < n; i++) if (kept(s[i])) k++;
  return s.slice(i).replace(/^[\s\p{P}\p{S}]+/u, "");
}
function cutEnd(s: string, n: number): string {
  let i = s.length;
  for (let k = 0; i > 0 && k < n; i--) if (kept(s[i - 1])) k++;
  return s.slice(0, i).replace(/[\s\p{P}\p{S}]+$/u, "");
}

/** Recent backchannels and the time their words stop being removed. */
export class BackchannelEcho {
  private recent: { line: string; until: number }[] = [];

  played(line: string, ms: number, now: number) {
    this.recent = this.recent.filter((r) => r.until > now);
    this.recent.push({ line, until: now + ms + BACKCHANNEL_ECHO_TAIL_MS });
  }

  /** Lines still within their window. */
  active(now: number): string[] {
    return this.recent.filter((r) => r.until > now).map((r) => r.line);
  }

  /** The transcript without any backchannel still within its window. */
  strip(text: string, lang: Lang, now: number): string {
    const lines = this.active(now);
    return lines.length ? stripBackchannelEcho(text, lines, lang) : text;
  }
}
