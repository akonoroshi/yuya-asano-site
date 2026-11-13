// Conversation mode: the microphone stays on, and the page (not the browser) decides when the
// visitor has finished a turn. Two inputs, combined every frame:
//   - loudness from the microphone (Web Audio), for when speech starts and stops (VadTracker)
//   - the recognizer's words (Web Speech API, continuous), for what was said and whether it
//     sounds finished (endOfTurnDelay)
// The timing rules live in turn.ts, so they can be unit-tested; this file is the browser glue.
//
// Window events, for the character and the voice player (see README-chat.md):
//   voice:listening   { on, reason? }  the microphone turned on or off
//   voice:speech-start                 the visitor started speaking
//   voice:nod                          a silent listening nod while the visitor talks
//   voice:backchannel                  a spoken "mm-hmm" (with a nod), at a low-pitch cue (pitch.ts)
//   voice:barge-in                     the visitor is talking over Shino: stop her voice
//   voice:turn-end    { alternatives } the visitor finished a turn
import { createRecognition, canRecognizeLocally, markPhrasesUnsupported, report, speechSupported, type Recognition } from "./asr.ts";
import {
  combineSegments,
  endOfTurnDelay,
  isBackchannel,
  isBargeIn,
  isHesitation,
  levelDb,
  ListeningNods,
  TURN_CONFIG,
  VadTracker,
} from "./turn.ts";
import { repairAlternatives, repairTranscript } from "./asr-repair.ts";
import { estimatePitch, LowPitchRule } from "./pitch.ts";
import { echoText, hasInterruptionPhrase, PlaybackEcho } from "./playback-echo.ts";
import { BackchannelEcho, stripBackchannelEcho } from "./backchannel.ts";
import type { Lang } from "./types.ts";

export type StopReason = "user" | "idle" | "hidden" | "not-allowed" | "unsupported" | "failed";

export interface ConversationHandlers {
  /** The words heard so far in this turn ("" when the turn ends). */
  onInterim(text: string): void;
  /** The visitor has clearly started a real turn (not "mm-hmm", not a cough). Once per turn. */
  onUserTalking(): void;
  /** A finished turn: alternatives best first. */
  onTurn(alternatives: string[]): void;
  /** A turn that turned out to be nothing (noise, "um", "mm-hmm" over Shino). */
  onTurnDropped(): void;
  onStop(reason: StopReason): void;
}

const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

// If the recognizer keeps ending right after it starts, continuous mode doesn't work here.
const RESTART_DELAY_MS = 250;
const MAX_QUICK_RESTARTS = 4;
const QUICK_RESTART_WINDOW_MS = 10_000;

interface Segment {
  final: boolean;
  alts: string[];
  recognized: string;
  echo: boolean;
  stable: boolean;
  /** Backchannels Shino said while this result was open: removed from every later revision. */
  backchannels: string[];
}

const STOP_PHRASES = {
  en: new Set(["stop", "wait", "hold on", "wait a second"]),
  ja: new Set(["待ッテ", "チョット待ッテ", "止メテ", "ストップ"]),
};

export class ConversationListener {
  private lang: Lang;
  private phrases: string[];
  private h: ConversationHandlers;
  private active = false;
  private local = false;

  // Microphone level
  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private vad = new VadTracker();
  private timer: ReturnType<typeof setInterval> | null = null;

  // Recognition
  private rec: Recognition | null = null;
  private shareTrack = true; // pass our microphone track to recognizers that accept one
  private consumed = 0; // results before this index belong to earlier turns
  private resultCount = 0; // results in this recognition session so far
  private segments: Segment[] = []; // this turn, in this recognition session
  private carry: Segment[] = []; // this turn, from a session that ended mid-turn
  private lastResultAt = -Infinity;
  private restarts: number[] = [];

  // Turn state
  private inTurn = false;
  private spokenMs = 0; // speech in this turn, from the microphone level
  private talkingSignalled = false;
  private startedOverShino = false;
  private finalWaitSince: number | null = null;
  private lastActivityAt = 0;
  private nods: ListeningNods; // silent nods: pauses, low-pitch cues, long stretches
  private lowPitch: LowPitchRule; // Ward & Tsukahara's low-pitch cue: a spoken backchannel or a nod
  private turnStartedAt = 0;
  private lastVocalAt = -Infinity;
  private backchannelEcho = new BackchannelEcho(); // Shino's own "mm-hmm", kept out of transcripts
  private sampleRate = 48_000;

  // Shino
  private readonly playback: PlaybackEcho;
  private shinoSpeaking = false;
  private audible = false;
  private bargedThisSpeech = false;

  constructor(lang: Lang, phrases: string[], handlers: ConversationHandlers, playback: PlaybackEcho) {
    this.lang = lang;
    this.phrases = phrases;
    this.h = handlers;
    this.playback = playback;
    this.nods = new ListeningNods(lang);
    this.lowPitch = new LowPitchRule(lang);
  }

  get isActive() {
    return this.active;
  }

  /**
   * Turns the microphone on. Call from a click or tap: browsers only allow audio to start from
   * one. Rejects with "not-allowed" or "unsupported".
   */
  async start(): Promise<void> {
    if (this.active) return;
    if (!speechSupported()) throw "unsupported" satisfies StopReason;
    // The level meter is optional: without it, turns end on pauses in the recognizer's results.
    try {
      // Browsers apply an advanced constraint only if they can satisfy it. Keep the
      // boolean request as a fallback on devices without system-wide cancellation.
      const cancelPlayback = { echoCancellation: "all" } as unknown as MediaTrackConstraintSet;
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, advanced: [cancelPlayback] },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") throw "not-allowed" satisfies StopReason;
      console.warn("[chat] microphone track unavailable:", e);
    }
    try {
      if (this.stream) {
        this.audio = new AudioContext();
        await this.audio.resume();
        const source = this.audio.createMediaStreamSource(this.stream);
        this.analyser = this.audio.createAnalyser();
        this.analyser.fftSize = 2048; // ~43 ms at 48 kHz: two periods of a 60 Hz voice, for pitch
        this.sampleRate = this.audio.sampleRate;
        this.samples = new Float32Array(this.analyser.fftSize);
        source.connect(this.analyser);
      }
    } catch (e) {
      // Recognition can still use the processed track if the level meter fails.
      this.audio?.close().catch(() => {});
      this.audio = this.analyser = this.samples = null;
      console.warn("[chat] microphone level unavailable; ending turns on recognizer pauses:", e);
    }
    this.local = await canRecognizeLocally(this.lang);
    this.active = true;
    this.lastActivityAt = performance.now();
    this.startRecognition();
    if (!this.active) return; // the recognizer refused to start; onStop has been called
    this.timer = setInterval(() => this.tick(), TURN_CONFIG.vad.frameMs);
    emit("voice:listening", { on: true });
  }

  stop(reason: StopReason = "user") {
    if (!this.active) return;
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const rec = this.rec;
    this.rec = null;
    rec?.abort();
    this.releaseAudio();
    this.resetTurn();
    this.h.onInterim("");
    emit("voice:listening", { on: false, reason });
    this.h.onStop(reason);
  }

  /**
   * Whether Shino is talking. While she is, speech that's more than a backchannel is an
   * interruption (voice:barge-in), and "mm-hmm" isn't taken as a question.
   */
  setSpeaking(on: boolean, audible = false) {
    this.audible = on && audible;
    if (on === this.shinoSpeaking) return;
    this.shinoSpeaking = on;
    this.bargedThisSpeech = false;
    if (on) {
      this.lastActivityAt = performance.now();
      this.lowPitch.cancel(); // no nod due while she talks
    }
  }

  /** The voice player said a backchannel: keep its words out of the visitor's transcript. */
  noteBackchannel(line: string, ms: number) {
    this.backchannelEcho.played(line, ms, performance.now());
  }

  private releaseAudio() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.audio?.close().catch(() => {});
    this.audio = null;
    this.analyser = null;
    this.samples = null;
  }

  /* ---------- Recognition ---------- */

  private startRecognition() {
    if (!this.active) return;
    const rec = createRecognition(this.lang, { local: this.local, phrases: this.phrases, continuous: true });
    this.rec = rec;
    this.consumed = 0;
    this.resultCount = 0;
    let fatal: string | null = null;
    rec.onresult = (e) => {
      if (this.rec !== rec) return;
      const now = performance.now();
      this.resultCount = e.results.length;
      const start = Math.max(this.consumed, e.resultIndex);
      const segs = this.segments.slice(0, start - this.consumed);
      for (let i = start; i < e.results.length; i++) {
        const r = e.results[i];
        const previous = this.segments[i - this.consumed];
        // Shino's own backchannels, if the microphone picked them up, are not the visitor's words.
        // A result can keep being revised (and finalize) long after the backchannel, so the lines
        // seen while it was open stay with it.
        const backchannels = [...new Set([...(previous?.backchannels ?? []), ...this.backchannelEcho.active(now)])];
        const alts: string[] = [];
        for (let k = 0; k < r.length; k++) {
          const transcript = stripBackchannelEcho(r[k].transcript.trim(), backchannels, this.lang);
          if (transcript) alts.push(transcript);
        }
        const recognized = echoText(alts[0] ?? "", this.lang);
        // Once classified as echo, an identical interim result can finalize late without resurfacing.
        const echo = (previous?.echo && recognized === previous.recognized) || this.playback.matches(recognized, now);
        const prefix = previous?.recognized ?? "";
        const stable = !!previous && !previous.echo && hasInterruptionPhrase(prefix, this.lang) &&
          (recognized === prefix || recognized.startsWith(this.lang === "ja" ? prefix : `${prefix} `));
        const filtered = echo ? [] : alts.filter((text, k) => k === 0 || !this.playback.matches(echoText(text, this.lang), now));
        segs.push({ final: r.isFinal, alts: filtered, recognized, echo, stable, backchannels });
      }
      this.segments = segs;
      if (segs.some((s) => s.alts.length)) {
        this.lastResultAt = now;
        this.lastActivityAt = now;
        if (!this.inTurn) this.beginTurn(now);
      }
      this.h.onInterim(this.currentText());
    };
    rec.onerror = (e) => {
      if (this.rec !== rec) return;
      if (e.error === "no-speech" || e.error === "aborted") return;
      fatal = e.error;
    };
    rec.onend = () => {
      if (this.rec !== rec) return; // stopped on purpose, or replaced
      this.rec = null;
      // Keep what this session heard of the current turn; the next session starts its own results.
      if (this.inTurn) this.carry.push(...this.segments.filter((s) => s.alts.length));
      this.segments = [];
      if (!this.active) return;
      if (fatal === "not-allowed" || fatal === "service-not-allowed") return this.stop("not-allowed");
      if (fatal === "phrases-not-supported") markPhrasesUnsupported();
      else if (fatal === "audio-capture" && this.shareTrack) this.shareTrack = false; // try the recognizer's own capture
      else if (fatal === "language-not-supported") return this.stop("unsupported");
      // Sessions end on their own now and then (long silence, network). Restart, unless it
      // keeps ending right away: then continuous mode doesn't work in this browser.
      const now = performance.now();
      this.restarts = this.restarts.filter((t) => now - t < QUICK_RESTART_WINDOW_MS);
      this.restarts.push(now);
      if (this.restarts.length > MAX_QUICK_RESTARTS && now - this.lastResultAt > QUICK_RESTART_WINDOW_MS) return this.stop("failed");
      setTimeout(() => this.startRecognition(), RESTART_DELAY_MS);
    };
    const track = this.shareTrack ? this.stream?.getAudioTracks()[0] : undefined;
    try {
      // Browsers that don't take a track ignore the argument and use the default microphone.
      rec.start(track);
    } catch (e) {
      if (track) {
        this.shareTrack = false;
        try {
          rec.start();
          return;
        } catch {
          /* fall through */
        }
      }
      console.warn("[chat] continuous recognition failed to start:", e);
      this.rec = null;
      this.stop("failed");
    }
  }

  private currentText(): string {
    return repairTranscript(combineSegments([...this.carry, ...this.segments].map((s) => s.alts), this.lang)[0] ?? "", this.lang);
  }

  /* ---------- The frame loop ---------- */

  private tick() {
    if (!this.active) return;
    const now = performance.now();
    const duringPlayback = this.audible || this.playback.isRecent(now);
    const hasLevel = !!(this.analyser && this.samples);
    if (hasLevel) {
      this.analyser!.getFloatTimeDomainData(this.samples!);
      for (const ev of this.vad.push(levelDb(this.samples!), now)) {
        if (ev.type === "speech-start") {
          this.lastActivityAt = now;
          this.nods.speechResumed();
          this.finalWaitSince = null;
          if (!duringPlayback) {
            if (!this.inTurn) this.beginTurn(ev.at);
            emit("voice:speech-start");
          }
        } else if (this.inTurn) this.spokenMs += Math.max(0, ev.at - this.vad.speechStartedAt);
      }
      // Pitch, only while the visitor is speaking and Shino isn't (her voice would skew their range).
      if (!this.shinoSpeaking && !duringPlayback) {
        const hz = this.vad.speaking ? estimatePitch(this.samples!, this.sampleRate) : null;
        this.lowPitch.push(now, this.inTurn ? hz : null, this.spokenMs + this.vad.speechMs(now));
      }
      if (this.lowPitch.due(now) && this.inTurn && !this.shinoSpeaking && !duringPlayback) {
        this.lowPitch.nodded(now);
        // The cue Ward & Tsukahara fitted to spoken backchannels: an "mm-hmm" when one is due
        // (the voice player says it only if Voice is on), otherwise a silent nod.
        const v = TURN_CONFIG.vocal;
        if (now - this.lastVocalAt >= v.minGapMs[this.lang] && now - this.turnStartedAt >= v.notBeforeMs) {
          this.lastVocalAt = now;
          this.nods.nodded(now);
          emit("voice:backchannel");
        } else if (this.nods.cue(now)) emit("voice:nod");
      }
      // Now and then during a long stretch of speech, so she never looks frozen.
      if (this.inTurn && this.vad.speaking && !this.shinoSpeaking && !duringPlayback &&
        this.nods.speaking(now, this.spokenMs + this.vad.speechMs(now))) emit("voice:nod");
    }
    const text = this.currentText();

    // Is this turn real? While Shino talks, that's also when to stop her voice.
    const speakingNow = this.vad.speechMs(now);
    const talking = duringPlayback
      ? isBargeIn(0, text, this.lang) && [...this.carry, ...this.segments].some((s) => s.alts.length &&
        (s.final || s.stable || STOP_PHRASES[this.lang].has(s.recognized)) && isBargeIn(0, s.alts[0], this.lang))
      : isBargeIn(this.spokenMs + speakingNow, text, this.lang);
    if (this.inTurn && !this.talkingSignalled && talking) {
      this.talkingSignalled = true;
      this.h.onUserTalking();
    }
    if (this.shinoSpeaking && !this.bargedThisSpeech &&
      (duringPlayback ? talking : isBargeIn(speakingNow, text, this.lang))) {
      this.bargedThisSpeech = true;
      emit("voice:barge-in");
    }

    if (this.inTurn && !this.vad.speaking) {
      // Silence so far: from the level meter if it heard this turn, else from the recognizer.
      const heard = hasLevel && this.spokenMs > 0;
      const pauseMs = now - (heard ? this.vad.lastLoudAt : this.lastResultAt);
      const endMs = endOfTurnDelay(text, this.lang);
      // A short way into a pause.
      if (heard && !this.shinoSpeaking && !duringPlayback && this.nods.pause(now, pauseMs, this.spokenMs, endMs)) emit("voice:nod");
      if (pauseMs >= endMs) this.finishTurn(now);
    }

    // Don't leave the microphone on in an empty room.
    if (!this.inTurn && !this.shinoSpeaking && now - this.lastActivityAt > TURN_CONFIG.idleStopMs) this.stop("idle");
  }

  private beginTurn(at: number) {
    this.inTurn = true;
    this.turnStartedAt = at;
    this.nods.startTurn(at);
    this.spokenMs = 0;
    this.talkingSignalled = false;
    this.startedOverShino = this.shinoSpeaking;
    this.finalWaitSince = null;
    this.lastActivityAt = at;
  }

  private finishTurn(now: number) {
    // The recognizer's final result (with its alternatives) usually lands just after the
    // silence. Wait briefly for it; if it doesn't come, use the interim words.
    const last = this.segments.findLast((s) => s.alts.length);
    if (last && !last.final) {
      this.finalWaitSince ??= now;
      if (now - this.finalWaitSince < TURN_CONFIG.endOfTurn.finalGraceMs) return;
    }
    // Known mishearings ("you yeah" for Yuya) are fixed before anything else sees them.
    const alternatives = repairAlternatives(combineSegments([...this.carry, ...this.segments].map((s) => s.alts), this.lang), this.lang);
    const lastFinal = this.segments.findLast((s) => s.final && s.alts.length);
    const overShino = this.startedOverShino;
    // Results up to here belong to this turn, including an interim that may still finalize.
    if (this.rec) this.consumed = this.resultCount;
    this.resetTurn();
    this.h.onInterim("");
    const top = alternatives[0] ?? "";
    if (!top || isHesitation(top, this.lang) || (overShino && isBackchannel(top, this.lang))) {
      this.h.onTurnDropped();
      return;
    }
    if (lastFinal) report(this.lang, lastFinal.alts.length, this.local, "conversation");
    emit("voice:turn-end", { alternatives });
    this.h.onTurn(alternatives);
  }

  private resetTurn() {
    this.lowPitch.cancel(); // a nod still due would land on Shino's answer
    this.inTurn = false;
    this.spokenMs = 0;
    this.talkingSignalled = false;
    this.startedOverShino = false;
    this.finalWaitSince = null;
    this.segments = [];
    this.carry = [];
  }
}
