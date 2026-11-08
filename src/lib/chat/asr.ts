// Speech input through the browser's Web Speech API. Push to talk: start() begins listening,
// stop() ends it early; recognition also ends by itself when the visitor stops speaking.
//
// maxAlternatives is only a maximum. The spec lets a browser return fewer, so callers read
// however many alternatives come back. Counts are reported to /api/telemetry so you can see
// what each browser actually returns.
import type { Lang } from "./types.ts";

/* Minimal typings: the Web Speech API is not in TypeScript's DOM library yet. */
interface Alternative { transcript: string; confidence: number }
interface Result { readonly length: number; readonly isFinal: boolean; [i: number]: Alternative }
interface RecognitionEvent extends Event { readonly resultIndex: number; readonly results: { readonly length: number; [i: number]: Result } }
interface RecognitionErrorEvent extends Event { readonly error: string }
interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  phrases?: unknown;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
interface RecognitionCtor {
  new (): Recognition;
  available?: (o: { langs: string[]; processLocally?: boolean }) => Promise<string>;
}
type PhraseCtor = new (phrase: string, boost?: number) => unknown;

const w = typeof window === "undefined" ? undefined : (window as unknown as Record<string, unknown>);
const Ctor = (w?.SpeechRecognition ?? w?.webkitSpeechRecognition) as RecognitionCtor | undefined;
const Phrase = w?.SpeechRecognitionPhrase as PhraseCtor | undefined;

export const speechSupported = (): boolean => !!Ctor;
export const langTag = (lang: Lang) => (lang === "ja" ? "ja-JP" : "en-US");

export interface ListenResult {
  alternatives: string[]; // best first, deduplicated
  local: boolean; // recognized on the device
}

export type ListenError = "no-speech" | "not-allowed" | "unavailable";

let phrasesUnsupported = false;
const localCache = new Map<Lang, Promise<boolean>>();

/** Whether this browser can recognize the language on the device, without a download. */
export function canRecognizeLocally(lang: Lang): Promise<boolean> {
  if (!localCache.has(lang)) {
    const p = Ctor?.available
      ? Ctor.available({ langs: [langTag(lang)], processLocally: true }).then((s) => s === "available", () => false)
      : Promise.resolve(false);
    localCache.set(lang, p);
  }
  return localCache.get(lang)!;
}

export class Listener {
  private rec: Recognition | null = null;
  private lang: Lang;
  private phrases: string[];
  private onInterim: (text: string) => void;

  constructor(lang: Lang, phrases: string[], onInterim: (text: string) => void) {
    this.lang = lang;
    this.phrases = phrases;
    this.onInterim = onInterim;
  }

  async start(): Promise<ListenResult> {
    if (!Ctor) throw "unavailable" satisfies ListenError;
    const local = await canRecognizeLocally(this.lang);
    try {
      return await this.run(local, !phrasesUnsupported && this.phrases.length > 0);
    } catch (e) {
      if (e === "phrases-not-supported") {
        phrasesUnsupported = true;
        return this.run(local, false);
      }
      throw e;
    }
  }

  stop() {
    this.rec?.stop();
  }

  abort() {
    this.rec?.abort();
  }

  private run(local: boolean, usePhrases: boolean): Promise<ListenResult> {
    return new Promise((resolve, reject) => {
      const rec = new Ctor!();
      this.rec = rec;
      rec.lang = langTag(this.lang);
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 5; // Alexa gave up to 5 in the TaskBot data
      if (local && "processLocally" in rec) rec.processLocally = true;
      if (usePhrases && Phrase && "phrases" in rec) {
        try {
          rec.phrases = this.phrases.map((p) => new Phrase(p, 3));
        } catch {
          phrasesUnsupported = true;
        }
      }
      let final: string[] = [];
      let failed: string | null = null;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            final = [];
            for (let k = 0; k < r.length; k++) final.push(r[k].transcript.trim());
          } else this.onInterim(r[0].transcript);
        }
      };
      rec.onerror = (e) => {
        failed = e.error;
      };
      rec.onend = () => {
        this.rec = null;
        if (failed === "phrases-not-supported") return reject("phrases-not-supported");
        if (failed === "not-allowed" || failed === "service-not-allowed") return reject("not-allowed" satisfies ListenError);
        const alternatives = [...new Set(final.filter(Boolean))];
        if (!alternatives.length) return reject((failed && failed !== "no-speech" && failed !== "aborted" ? "unavailable" : "no-speech") satisfies ListenError);
        report(this.lang, final.length, local);
        resolve({ alternatives, local });
      };
      rec.start();
    });
  }
}

function report(lang: Lang, n: number, local: boolean) {
  try {
    navigator.sendBeacon("/api/telemetry", JSON.stringify({ kind: "nbest", lang, n, local }));
  } catch {
    /* telemetry is best effort */
  }
}
