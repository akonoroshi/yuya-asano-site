// Behavior tags for the companion, the same set as in Yuya's learning companion:
//   [act:<name>]               a gesture or behavior, at that point in the text
//   [emo:<name>] / [emo:<name>:<strength>]   an emotion from that point on; strength 0-1,
//                                            default 0.5 (with no emotion tag: neutral, 0.5)
// Tags never reach the screen, the transcript, the retrieval index, or the LLM's history: they
// are parsed out here and sent to the character as events with their position in the plain text.

export const ACTS = [
  "greet", "farewell", "think", "prompt_user_first", "confident_claim", "request_explain",
  "check_understanding", "listen_learn", "realize", "self_correct", "co_celebrate",
  "admire_explanation", "normalize_error", "take_break", "resume_study", "commit_answer",
  "wait_user", "ack", "beat", "material_reference", "cross_arms_start", "cross_arms_release",
] as const;
export const EMOTIONS = ["neutral", "focused", "happy", "concerned", "relaxed"] as const;
export type Act = (typeof ACTS)[number];
export type Emotion = (typeof EMOTIONS)[number];

export const DEFAULT_STRENGTH = 0.5;

type TagBody = { kind: "act"; name: Act } | { kind: "emo"; name: Emotion; strength: number };
export type Tag = TagBody & { at: number };

const ACT_SET = new Set<string>(ACTS);
const EMO_SET = new Set<string>(EMOTIONS);

/** Matches anything shaped like a behavior tag, valid or not. */
const TAG_RE = /\[(act|emo):([a-z_]+)(?::([0-9.]+))?\]/g;

/** A tag's meaning, or a reason it's invalid. `at` is filled in by the caller. */
export function readTag(kind: string, name: string, strength?: string): TagBody | string {
  if (kind === "act") {
    if (!ACT_SET.has(name)) return `unknown act "${name}"`;
    if (strength !== undefined) return `act "${name}" takes no strength`;
    return { kind: "act", name: name as Act };
  }
  if (!EMO_SET.has(name)) return `unknown emotion "${name}"`;
  const s = strength === undefined ? DEFAULT_STRENGTH : Number(strength);
  if (!Number.isFinite(s) || s < 0 || s > 1) return `emotion "${name}" has strength ${strength}; use 0 to 1`;
  return { kind: "emo", name: name as Emotion, strength: s };
}

/**
 * Splits tagged text into plain text and tags with their positions (in characters of the plain
 * text). Invalid tags are dropped and reported in `errors`, so a typo never shows up on screen.
 */
export function parseTags(tagged: string): { text: string; tags: Tag[]; errors: string[] } {
  const tags: Tag[] = [];
  const errors: string[] = [];
  let text = "";
  let last = 0;
  for (const m of tagged.matchAll(TAG_RE)) {
    text += tagged.slice(last, m.index);
    last = m.index! + m[0].length;
    const tag = readTag(m[1], m[2], m[3]);
    if (typeof tag === "string") errors.push(`${m[0]}: ${tag}`);
    else tags.push({ ...tag, at: text.length });
  }
  text += tagged.slice(last);
  return { text, tags, errors };
}

export const stripTags = (tagged: string) => parseTags(tagged).text;

/**
 * The same parsing for text that arrives in chunks (LLM replies). A tag can be split across
 * chunks ("[emo:hap" + "py]"), so an unfinished tag is held back until the next chunk.
 * Positions are in characters of all the plain text pushed so far.
 */
export class TagStream {
  private held = "";
  private offset = 0;

  push(chunk: string): { text: string; tags: Tag[] } {
    let s = this.held + chunk;
    this.held = "";
    const open = s.lastIndexOf("[");
    if (open >= 0 && s.indexOf("]", open) < 0 && s.length - open <= 32) {
      this.held = s.slice(open);
      s = s.slice(0, open);
    }
    return this.emit(s);
  }

  flush(): { text: string; tags: Tag[] } {
    const s = this.held;
    this.held = "";
    return this.emit(s);
  }

  private emit(s: string) {
    const { text, tags } = parseTags(s);
    const shifted = tags.map((t) => ({ ...t, at: t.at + this.offset }));
    this.offset += text.length;
    return { text, tags: shifted };
  }
}
