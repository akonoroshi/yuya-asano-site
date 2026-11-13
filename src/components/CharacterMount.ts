import { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AvatarStage, createStudyRoom } from "@tonari/characters/react";
import { CompanionMotion, armFoldTags, internalIntents, publicIntents } from "@tonari/characters/gestures";
import { createBundledModels } from "@tonari/characters/models";
import type { AvatarMood, Intent, Mood } from "@tonari/characters/gestures";
import { characterEvents } from "../lib/chat/character-events";

const assetBase = "/characters/avatars";
const seatedAnimationUrl = "/characters/animations/study-seated.vrma";
const model = createBundledModels(assetBase).find((item) => item.id === "shino")!;
const knownIntents = new Set<Intent>([...publicIntents, ...internalIntents]);
const moods = new Set<Mood>(["neutral", "focused", "happy", "concerned", "relaxed"]);
const avatarMood = (value: Mood): AvatarMood =>
  value === "happy" ? "happy" : value === "focused" || value === "concerned" ? "thinking"
    : value === "relaxed" ? "encourage" : "neutral";

type TagDetail = { kind?: string; name?: string; strength?: number };
type SpeechDetail = { analyser?: AnalyserNode };

function CharacterView({ slot, pending }: { slot: HTMLElement; pending: Event[] }) {
  const motion = useMemo(() => new CompanionMotion(), []);
  const audioLevel = useRef(0);
  const analyser = useRef<AnalyserNode | undefined>(undefined);
  const loadedOnce = useRef(false);
  const [active, setActive] = useState(
    slot.dataset.mode === "page" || slot.closest("dialog")?.open === true,
  );
  const [speaking, setSpeaking] = useState(false);
  const [mood, setMood] = useState<Mood>("neutral");
  const initialEvents = useRef(pending);

  useLayoutEffect(() => {
    const onOpen = (event: Event) => {
      if ((event as CustomEvent<{ slot?: HTMLElement }>).detail?.slot !== slot) return;
      setActive(true);
    };
    const onClose = () => {
      if (slot.dataset.mode !== "page") {
        setActive(false);
        setSpeaking(false);
        delete slot.dataset.characterLoaded;
        loadedOnce.current = false;
        analyser.current = undefined;
        audioLevel.current = 0;
        const now = performance.now() / 1000;
        motion.applyArmFoldTag("cross_arms_release", now);
        motion.interrupt(now);
      }
    };
    const onTag = (event: Event) => {
      const detail = (event as CustomEvent<TagDetail>).detail;
      if (detail?.kind === "emo" && moods.has(detail.name as Mood)) {
        setMood(detail.name as Mood);
      } else if (detail?.kind === "act" && armFoldTags.includes(detail.name as (typeof armFoldTags)[number])) {
        motion.applyArmFoldTag(detail.name as (typeof armFoldTags)[number], performance.now() / 1000);
      } else if (detail?.kind === "act" && knownIntents.has(detail.name as Intent)) {
        motion.event(detail.name as Intent, 0.7, 60, "speech", "conversation", performance.now() / 1000);
      }
    };
    const onReplyStart = () => {
      motion.releaseReplyWait(performance.now() / 1000);
      setSpeaking(true);
    };
    const onReplyEnd = () => setSpeaking(Boolean(analyser.current));
    const onSpeechStart = (event: Event) => {
      analyser.current = (event as CustomEvent<SpeechDetail>).detail?.analyser;
      setSpeaking(true);
    };
    const onSpeechEnd = () => {
      analyser.current = undefined;
      audioLevel.current = 0;
      setSpeaking(false);
    };
    // An open microphone keeps the desk-rest pose. Listening nods (voice:nod) and spoken
    // backchannels (voice:backchannel) both cue the library's listening nod: listen_learn has a
    // dedicated head nod of listeningNodDeg (5°), where ack is a 2° tilt that's barely visible.
    // Priority 40 is the library's default for backchannels, below her own speech gestures.
    const onBackchannel = () => motion.event("listen_learn", 0.6, 40, "backchannel", "conversation", performance.now() / 1000);
    const handlers: Record<(typeof characterEvents)[number], (event: Event) => void> = {
      "chat:open": onOpen,
      "chat:close": onClose,
      "chat:tag": onTag,
      "chat:reply-start": onReplyStart,
      "chat:reply-end": onReplyEnd,
      "character:speech-start": onSpeechStart,
      "character:speech-end": onSpeechEnd,
      "voice:backchannel": onBackchannel,
      "voice:nod": onBackchannel,
      "voice:barge-in": () => motion.interrupt(performance.now() / 1000),
    };
    for (const name of characterEvents) window.addEventListener(name, handlers[name]);
    for (const event of initialEvents.current.splice(0)) handlers[event.type as keyof typeof handlers](event);
    return () => {
      for (const name of characterEvents) window.removeEventListener(name, handlers[name]);
    };
  }, [motion, slot]);

  useEffect(() => {
    if (!active || !speaking) return;
    let frame = 0;
    let samples = new Uint8Array(0);
    const update = () => {
      const node = analyser.current;
      if (node && samples.length !== node.fftSize) samples = new Uint8Array(node.fftSize);
      if (node && samples.length > 0) {
        node.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const value = (sample - 128) / 128;
          sum += value * value;
        }
        audioLevel.current = Math.min(1, Math.sqrt(sum / samples.length) * 4);
      } else audioLevel.current = 0;
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [active, speaking]);

  if (!active) return null;
  return createElement("div", { className: "chat-character-renderer" }, createElement(AvatarStage, {
    model,
    seatedAnimationUrl,
    createRoom: createStudyRoom,
    motion,
    speaking,
    audioLevel,
    mood: avatarMood(mood),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    phase: "conversation",
    idleMotion: false,
    onDiagnostics: () => {
      if (loadedOnce.current) return;
      loadedOnce.current = true;
      slot.dataset.characterLoaded = "";
      window.dispatchEvent(new CustomEvent("character:loaded"));
    },
  }));
}

export function mountCharacter(slot: HTMLElement, pending: Event[]) {
  const host = slot.querySelector<HTMLElement>("[data-character-mount]");
  if (!host) return;
  const root = createRoot(host);
  flushSync(() => root.render(createElement(CharacterView, { slot, pending })));
}
