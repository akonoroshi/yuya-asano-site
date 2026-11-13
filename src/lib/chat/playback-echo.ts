import { repairTranscript } from "./asr-repair.ts";
import { toKatakana } from "./normalize.ts";
import type { Lang } from "./types.ts";

// Recognition can report a sentence after its audio has ended.
const ECHO_TAIL_MS = 1200;

export function echoText(text: string, lang: Lang): string {
  const normalized = repairTranscript(text, lang).normalize("NFKC").toLowerCase();
  if (lang === "ja") return toKatakana(normalized).replace(/[^\p{L}\p{N}ー]/gu, "");
  return normalized.replace(/[’'`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function hasInterruptionPhrase(text: string, lang: Lang): boolean {
  return lang === "ja" ? text.length >= 4 : text.includes(" ");
}

export class PlaybackEcho {
  private readonly lang: Lang;
  private units: { text: string; end: number }[] = [];

  constructor(lang: Lang) {
    this.lang = lang;
  }

  start(text: string, duration: number, now: number) {
    this.end(now);
    this.units = this.units.filter((unit) => now <= unit.end + ECHO_TAIL_MS);
    this.units.push({ text: echoText(text, this.lang), end: now + duration });
  }

  end(now: number) {
    const current = this.units.at(-1);
    if (current) current.end = Math.min(current.end, now);
  }

  isRecent(now: number): boolean {
    return this.units.some((unit) => now <= unit.end + ECHO_TAIL_MS);
  }

  matches(text: string, now: number): boolean {
    if (!text) return false;
    const recent = this.units.filter((unit) => now <= unit.end + ECHO_TAIL_MS);
    if (recent.some((unit) => unit.text === text)) return true;
    // Japanese has no word boundaries. Keep short fragments unless they match an entire clip.
    if (this.lang === "ja" && !hasInterruptionPhrase(text, this.lang)) return false;
    const playback = recent.map((unit) => unit.text).join(this.lang === "ja" ? "" : " ");
    return this.lang === "ja" ? playback.includes(text) : ` ${playback} `.includes(` ${text} `);
  }
}
