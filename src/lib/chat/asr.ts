// Speech input through the browser's Web Speech API. Two modes share the setup here:
//   Listener (this file)                    tap to ask: start() listens for one question, stop()
//                                           ends it early; it also ends when the visitor stops
//   ConversationListener (conversation.ts)  always on, with its own end-of-turn detection
//
// maxAlternatives is only a maximum. The spec lets a browser return fewer, so callers read
// however many alternatives come back. Counts are reported to /api/telemetry so you can see
// what each browser actually returns.
import { repairAlternatives, repairTranscript } from "./asr-repair.ts";
import type { Lang } from "./types.ts";

/* Minimal typings: the Web Speech API is not in TypeScript's DOM library yet. */
interface Alternative { transcript: string; confidence: number }
interface Result { readonly length: number; readonly isFinal: boolean; [i: number]: Alternative }
interface RecognitionEvent extends Event { readonly resultIndex: number; readonly results: { readonly length: number; [i: number]: Result } }
interface RecognitionErrorEvent extends Event { readonly error: string }
export interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  phrases?: unknown;
  /** Newer browsers accept the microphone track to recognize, so the page and the recognizer share one capture. */
  start(track?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
export type { RecognitionEvent, RecognitionErrorEvent };
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
export const markPhrasesUnsupported = () => {
  phrasesUnsupported = true;
};

/**
 * A recognizer set up the same way for both modes: up to 5 alternatives, on-device when the
 * browser can, and biased toward the site's terms when the browser supports phrase lists.
 */
export function createRecognition(lang: Lang, opts: { local: boolean; phrases: string[]; continuous: boolean }): Recognition {
  const rec = new Ctor!();
  rec.lang = langTag(lang);
  rec.continuous = opts.continuous;
  rec.interimResults = true;
  rec.maxAlternatives = 5; // Alexa gave up to 5 in the TaskBot data
  if (opts.local && "processLocally" in rec) rec.processLocally = true;
  if (!phrasesUnsupported && opts.phrases.length && Phrase && "phrases" in rec) {
    try {
      rec.phrases = opts.phrases.map((p) => new Phrase(p, 3));
    } catch {
      phrasesUnsupported = true;
    }
  }
  return rec;
}

/** Whether phrase biasing will be attempted (false after the browser rejected it once). */
export const phrasesEnabled = () => !phrasesUnsupported;
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
      const rec = createRecognition(this.lang, { local, phrases: usePhrases ? this.phrases : [], continuous: false });
      this.rec = rec;
      let final: string[] = [];
      let failed: string | null = null;
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            final = [];
            for (let k = 0; k < r.length; k++) final.push(r[k].transcript.trim());
          } else this.onInterim(repairTranscript(r[0].transcript, this.lang));
        }
      };
      rec.onerror = (e) => {
        failed = e.error;
      };
      rec.onend = () => {
        this.rec = null;
        if (failed === "phrases-not-supported") return reject("phrases-not-supported");
        if (failed === "not-allowed" || failed === "service-not-allowed") return reject("not-allowed" satisfies ListenError);
        // Known mishearings ("you yeah" for Yuya) are fixed before anything else sees them.
        const alternatives = repairAlternatives(final.filter(Boolean), this.lang);
        if (!alternatives.length) return reject((failed && failed !== "no-speech" && failed !== "aborted" ? "unavailable" : "no-speech") satisfies ListenError);
        report(this.lang, final.length, local, "tap");
        resolve({ alternatives, local });
      };
      rec.start();
    });
  }
}

/** How many alternatives the browser returned, per mode, so you can see what each browser does. */
export function report(lang: Lang, n: number, local: boolean, mode: "tap" | "conversation") {
  try {
    navigator.sendBeacon("/api/telemetry", JSON.stringify({ kind: "nbest", lang, n, local, mode }));
  } catch {
    /* telemetry is best effort */
  }
}
