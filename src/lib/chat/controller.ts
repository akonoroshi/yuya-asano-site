// Orchestrates one chat session. The order of the routing steps is the whole cost strategy:
//   1. chip -> pre-written answer (no network)
//   2. fuzzy match against the FAQ phrasings (main thread, instant)
//   3. voice input only: phonetic match in the worker, confirmed with "Did you mean …?"
//   4. otherwise POST /api/chat (retrieval + LLM on the Worker)
// The DOM lives in Chat.astro, which implements ChatView.
// The conversation is saved in sessionStorage after every turn, so it carries over between the
// home page and the chat opened from the corner character on any other page (same tab only).
import { ChatApiError, streamChat } from "./api.ts";
import { parseTags, stripTags, TagStream, type Tag } from "./tags.ts";
import { routeFuzzy, type RouteInput } from "./route.ts";
import type { WorkerRequest, WorkerResponse } from "./phoneme.worker.ts";
import type { ApiErrorCode, ChatContext, ChatMessage, Lang, Link, RouteResult } from "./types.ts";

/** The character's current reply (shown as a caption, and kept in the transcript). */
export interface ReplyView {
  append(text: string): void;
  finish(extra?: { links?: Link[]; sources?: Link[] }): void;
  fail(message: string): void;
}

export interface Chip {
  label: string;
  onPick: () => void;
  /** "confirm" chips answer a "Did you mean …?" question. */
  kind: "suggest" | "confirm";
}

export interface ChatView {
  showQuestion(text: string): void;
  startReply(): ReplyView;
  setChips(chips: Chip[]): void;
  setBusy(busy: boolean): void;
}

/** Lists are alternative phrasings; one is picked each time, never the same twice in a row. */
export interface ChatStrings {
  /** Each contains {q}, replaced by the matched question. */
  didYouMean: string[];
  somethingElse: string; // chip label
  somethingElseReply: string[]; // what the character says before showing the start chips
  repeatLeadIn: string[]; // before a curated answer already given in this conversation
  yes: string;
  askAsSaid: string;
  errors: Record<ApiErrorCode | "interrupted", string>;
}

export type AskOptions =
  | { source: "typed" }
  | { source: "voice"; alternatives: string[] }
  | { source: "chip"; faqId: string };

const MAX_CHIPS = 4;
const MAX_PAGE_CHIPS = 4;
const SAVED_ENTRIES = 40; // transcript entries kept in sessionStorage

/** What the transcript shows, saved so the conversation can be restored on the next page. */
type LogEntry =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; links?: Link[]; sources?: Link[]; error?: string };

/** Which chips are showing, saved so they come back the same on the next page. */
type ChipState =
  | { kind: "start" } // the site-wide starting chips
  | { kind: "page" } // this page's starting chips (faq.ts pageChips), plus "Something else"
  | { kind: "topic"; id: string; includeTopic: boolean }
  | { kind: "only-else" };

interface Saved {
  version: string; // context version: a new build with different FAQ data starts a fresh conversation
  page: string; // the page the chips were saved on
  history: ChatMessage[];
  answered: string[];
  via: Record<string, string>;
  log: LogEntry[];
  chips: ChipState;
}
// Curated answers are typed out like streamed LLM answers, so every reply arrives the same way
// (and the talking animation has time to play). About 75 characters per second.
const REVEAL_CHARS = 3;
const REVEAL_MS = 40;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const HISTORY_SENT = 8; // messages sent to the Worker (it enforces its own cap too)
const PHONEME_TIMEOUT_MS = 2500;

const emit = (name: string, detail?: unknown) => window.dispatchEvent(new CustomEvent(name, { detail }));

/*
 * Events for the character (window CustomEvents). Each reply is bracketed by start and end, and
 * every [act:…]/[emo:…] tag is sent when the text reaches it, with its position in the plain text:
 *   chat:reply-start  { text?, tagged? }  both known up front for curated replies; absent for LLM replies
 *   chat:tag          { kind: "act", name, at } | { kind: "emo", name, strength, at }
 *   chat:reply-end    { text, tagged }    the whole reply, plain and with its tags
 * So the character can either react to chat:tag as it arrives, or align the full tagged text itself.
 */
const emitTag = (tag: Tag) => emit("chat:tag", tag);

export class ChatController {
  ctx: ChatContext | null = null;
  private lang: Lang;
  private view: ChatView;
  private strings: ChatStrings;
  private page: string;
  private history: ChatMessage[] = [];
  private answered = new Set<string>(); // FAQ topics already answered, not offered again as chips
  /** For topics with two parents: which parent the visitor came through, to go back up that way. */
  private via = new Map<string, string>();
  private lastPicked = new Map<string, string>(); // per list: the phrasing used last time
  private log: LogEntry[] = [];
  private chipState: ChipState = { kind: "start" };
  private busy = false;
  private worker: Worker | null = null;
  private workerReady: Promise<boolean> | null = null;
  private pending = new Map<number, (r: RouteResult) => void>();
  private nextId = 1;

  /** page: "home", "work", "publications", or "project:<id>"; picks the starting chips. */
  constructor(lang: Lang, view: ChatView, strings: ChatStrings, page = "home") {
    this.lang = lang;
    this.view = view;
    this.strings = strings;
    this.page = page;
  }

  private get pageStart(): string[] {
    return this.ctx?.pages?.[this.page] ?? [];
  }

  /** The state a visitor starts in on this page. */
  private get startState(): ChipState {
    return this.pageStart.length ? { kind: "page" } : { kind: "start" };
  }

  async load(): Promise<ChatContext> {
    const res = await fetch(`/chat/context.${this.lang}.json`);
    if (!res.ok) throw new Error(`context ${res.status}`);
    this.ctx = (await res.json()) as ChatContext;
    if (!this.restore()) {
      this.showChips(this.startState);
      // The opening line is already on screen (it's in the page's HTML): greet with a smile.
      emitTag({ kind: "emo", name: "happy", strength: 0.8, at: 0 });
      emitTag({ kind: "act", name: "greet", at: 0 });
    }
    return this.ctx;
  }

  /* ---------- Saving and restoring the conversation ---------- */

  private get storageKey() {
    return `chat:${this.lang}`;
  }

  private save() {
    if (!this.ctx) return;
    const saved: Saved = {
      version: this.ctx.version,
      page: this.page,
      history: this.history,
      answered: [...this.answered],
      via: Object.fromEntries(this.via),
      log: this.log.slice(-SAVED_ENTRIES),
      chips: this.chipState,
    };
    try {
      sessionStorage.setItem(this.storageKey, JSON.stringify(saved));
    } catch {
      /* storage full or disabled: the conversation just won't carry over */
    }
  }

  /** Replays a saved conversation into the view. Returns false if there is nothing to restore. */
  private restore(): boolean {
    let saved: Saved | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(this.storageKey) ?? "null") as Saved | null;
    } catch {
      return false;
    }
    if (!saved || saved.version !== this.ctx?.version || !saved.log?.length) return false;
    this.history = saved.history;
    this.answered = new Set(saved.answered);
    this.via = new Map(Object.entries(saved.via ?? {}));
    this.log = saved.log;
    for (const entry of saved.log) {
      if (entry.role === "user") this.view.showQuestion(entry.text);
      else {
        const r = this.view.startReply();
        if (entry.text) r.append(entry.text);
        if (entry.error) r.fail(entry.error);
        else r.finish({ links: entry.links, sources: entry.sources });
      }
    }
    // A conversation continued on a different page starts from that page's chips, if it has
    // its own; otherwise (or after a reload of the same page) the chips come back as they were.
    this.showChips(saved.page !== this.page && this.pageStart.length ? { kind: "page" } : saved.chips);
    return true;
  }

  private logQuestion(text: string) {
    this.view.showQuestion(text);
    this.log.push({ role: "user", text });
  }

  private showChips(state: ChipState) {
    this.chipState = state;
    this.view.setChips(
      state.kind === "start"
        ? this.chipsFor(null)
        : state.kind === "page"
          ? this.pageChipsNow()
          : state.kind === "topic"
            ? this.chipsFor(state.id, state.includeTopic)
            : [this.somethingElseChip()],
    );
    this.save();
  }

  /** Starts loading the pronunciation dictionary in the worker. Safe to call repeatedly. */
  warmPhonemes(): Promise<boolean> {
    if (this.workerReady) return this.workerReady;
    if (!this.ctx || typeof Worker === "undefined") return Promise.resolve(false);
    const ctx = this.ctx;
    this.workerReady = new Promise<boolean>((resolve) => {
      const worker = new Worker(new URL("./phoneme.worker.ts", import.meta.url));
      this.worker = worker;
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        if (m.type === "ready") resolve(true);
        else if (m.type === "failed") {
          console.warn("[chat] phonetic matching unavailable:", m.message);
          resolve(false);
        } else if (m.type === "result") {
          if (m.oov.length) console.debug("[chat] no pronunciation for:", m.oov.join(", "));
          this.pending.get(m.id)?.(m.result);
          this.pending.delete(m.id);
        }
      };
      worker.onerror = () => resolve(false);
      const init: WorkerRequest = { type: "init", lang: ctx.lang, entries: ctx.entries, termReadings: ctx.termReadings };
      worker.postMessage(init);
    });
    return this.workerReady;
  }

  isBusy() {
    return this.busy;
  }

  async ask(text: string, opts: AskOptions): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || this.busy || !text.trim()) return;
    this.logQuestion(text);

    if (opts.source === "chip") return this.answerFaq(opts.faqId, text);

    const input: RouteInput =
      opts.source === "voice" ? { alternatives: opts.alternatives, source: "voice" } : { alternatives: [text], source: "typed" };

    const fuzzy = routeFuzzy(input, ctx);
    if (fuzzy.kind === "faq") return fuzzy.confirm ? this.confirmFaq(fuzzy.id, text) : this.answerFaq(fuzzy.id, text);

    if (input.source === "voice") {
      this.setBusy(true);
      const phonetic = await this.phonemeRoute(input.alternatives[0]);
      this.setBusy(false);
      if (phonetic.kind === "faq") return this.confirmFaq(phonetic.id, text);
    }
    return this.askLlm(text);
  }

  private async phonemeRoute(text: string): Promise<RouteResult> {
    const ready = await Promise.race([this.warmPhonemes(), timeout(PHONEME_TIMEOUT_MS, false)]);
    if (!ready || !this.worker) return { kind: "none" };
    const id = this.nextId++;
    const result = new Promise<RouteResult>((resolve) => this.pending.set(id, resolve));
    const req: WorkerRequest = { type: "route", id, text };
    this.worker.postMessage(req);
    return Promise.race([result, timeout<RouteResult>(PHONEME_TIMEOUT_MS, { kind: "none" })]);
  }

  /**
   * Chips follow the topic tree. After answering `topic`: its unanswered children (one level
   * deeper); if none are left, its unanswered siblings; if none, its parent's siblings; and so on
   * up the tree. Only the nearest level with anything left is offered.
   * For a topic with two parents, "up" is the parent the visitor came through.
   * `includeTopic` also offers the topic itself, for LLM answers that only touched on it.
   * Every state except the start gets "Something else". `topic` null means the start state.
   */
  private chipsFor(topic: string | null, includeTopic = false): Chip[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    const answers = ctx.answers;
    if (!topic || !answers[topic]) return ctx.start.filter((id) => answers[id]?.chip).map((id) => this.topicChip(id));

    // Each candidate remembers the parent it is offered under, so picking it records the way in.
    const picks: { id: string; parent?: string }[] = [];
    const add = (id: string, parent?: string) => {
      if (answers[id]?.chip && !this.answered.has(id) && !picks.some((p) => p.id === id)) picks.push({ id, parent });
    };
    if (includeTopic) add(topic, this.parentOf(topic));
    answers[topic].children.forEach((c) => add(c, topic));
    // Stop at the nearest level with anything left, so every chip stays on the current topic:
    // subtopics first; if none, siblings; if none, the parent's siblings; and so on up.
    for (let node: string | undefined = topic; node && !picks.length; node = this.parentOf(node)) {
      const parent = this.parentOf(node);
      const siblings = parent ? answers[parent].children : ctx.start.includes(node) ? ctx.start : [];
      siblings.forEach((sib) => add(sib, parent));
    }
    return [...picks.slice(0, MAX_CHIPS).map((p) => this.topicChip(p.id, p.parent)), this.somethingElseChip()];
  }

  /** The parent to go back up to: the one the visitor came through, else the primary one. */
  private parentOf(id: string): string | undefined {
    const parents = this.ctx?.answers[id]?.parents ?? [];
    const came = this.via.get(id);
    return came && parents.includes(came) ? came : parents[0];
  }

  /**
   * This page's starting chips that haven't been answered yet, plus "Something else". If they
   * have all been answered, continue from the first one's place in the topic tree instead.
   */
  private pageChipsNow(): Chip[] {
    const answers = this.ctx?.answers ?? {};
    const ids = this.pageStart.filter((id) => answers[id]?.chip && !this.answered.has(id));
    if (!ids.length) return this.chipsFor(this.pageStart[0]);
    return [...ids.slice(0, MAX_PAGE_CHIPS).map((id) => this.topicChip(id)), this.somethingElseChip()];
  }

  private topicChip(id: string, parent?: string): Chip {
    const answers = this.ctx!.answers;
    return {
      label: answers[id].chip!,
      kind: "suggest",
      onPick: () => {
        if (parent) this.via.set(id, parent);
        this.ask(answers[id].canonical, { source: "chip", faqId: id });
      },
    };
  }

  private somethingElseChip(): Chip {
    return { label: this.strings.somethingElse, kind: "suggest", onPick: () => this.backToStart() };
  }

  /** "Something else": a canned reply, then the start chips again. No network. */
  private async backToStart() {
    if (this.busy) return;
    this.setBusy(true);
    this.logQuestion(this.strings.somethingElse);
    this.view.setChips([]);
    const r = this.view.startReply();
    const reply = await this.reveal(r, this.vary("somethingElse", this.strings.somethingElseReply));
    r.finish();
    this.log.push({ role: "assistant", text: reply });
    this.setBusy(false);
    this.showChips({ kind: "start" });
  }

  /** Picks one phrasing, avoiding the one used last time for the same list. */
  private vary(key: string, options: string[]): string {
    if (options.length <= 1) return options[0] ?? "";
    const last = this.lastPicked.get(key);
    const choices = options.filter((o) => o !== last);
    const pick = choices[Math.floor(Math.random() * choices.length)];
    this.lastPicked.set(key, pick);
    return pick;
  }

  /**
   * Types a local (curated) reply out in small chunks, sending each tag to the character when the
   * text reaches it. Instant when the visitor prefers reduced motion. Returns the plain text.
   */
  private async reveal(r: ReplyView, tagged: string): Promise<string> {
    const { text, tags } = parseTags(tagged);
    emit("chat:reply-start", { text, tagged });
    let next = 0; // index of the next tag to send
    const sendUpTo = (pos: number) => {
      while (next < tags.length && tags[next].at <= pos) emitTag(tags[next++]);
    };
    if (reducedMotion()) {
      sendUpTo(text.length);
      r.append(text);
    } else {
      // Positions count UTF-16 units, like the tag positions; chunks never split a character.
      let pos = 0;
      const chars = Array.from(text);
      for (let i = 0; i < chars.length; i += REVEAL_CHARS) {
        const chunk = chars.slice(i, i + REVEAL_CHARS).join("");
        sendUpTo(pos + chunk.length - 1); // tags inside this chunk fire just before it appears
        r.append(chunk);
        pos += chunk.length;
        await sleep(REVEAL_MS);
      }
      sendUpTo(text.length); // tags at the very end, like [act:wait_user]
    }
    emit("chat:reply-end", { text, tagged });
    return text;
  }

  private async answerFaq(id: string, userText: string) {
    const ans = this.ctx?.answers[id];
    if (!ans) return this.askLlm(userText);
    if (this.busy) return;
    this.setBusy(true);
    // Conversational answers (greetings, thanks) rotate phrasings. A factual answer heard before
    // in this conversation keeps its exact wording, with a short lead-in so the repeat feels intended.
    const repeated = this.answered.has(id);
    const tagged = ans.alternatives.length
      ? this.vary(`answer:${id}`, [ans.text, ...ans.alternatives])
      : repeated
        ? `${this.vary("repeat", this.strings.repeatLeadIn)}${this.lang === "ja" ? "" : " "}${ans.text}`
        : ans.text;
    this.answered.add(id);
    this.view.setChips([]);
    const r = this.view.startReply();
    const text = await this.reveal(r, tagged);
    r.finish({ links: ans.links });
    this.history.push({ role: "user", content: userText }, { role: "assistant", content: stripTags(ans.text) });
    this.log.push({ role: "assistant", text, links: ans.links });
    this.setBusy(false);
    // Answers outside the tree (greetings, thanks) return to the start chips.
    this.showChips(ans.chip ? { kind: "topic", id, includeTopic: false } : { kind: "start" });
  }

  /** "Did you mean …?" asked in the caption, answered with chips. Both choices are free until "Ask what I said". */
  private async confirmFaq(id: string, userText: string) {
    const ans = this.ctx?.answers[id];
    if (!ans) return this.askLlm(userText);
    this.setBusy(true);
    this.view.setChips([]);
    const r = this.view.startReply();
    const prompt = await this.reveal(r, this.vary("didYouMean", this.strings.didYouMean).replace("{q}", ans.canonical.replace(/[?？]$/, "")));
    r.finish();
    this.log.push({ role: "assistant", text: prompt });
    this.setBusy(false);
    // If the visitor leaves before answering, the next page offers only "Something else".
    this.chipState = { kind: "only-else" };
    this.save();
    this.view.setChips([
      { label: this.strings.yes, kind: "confirm", onPick: () => this.answerFaq(id, ans.canonical) },
      { label: this.strings.askAsSaid, kind: "confirm", onPick: () => this.askLlm(userText) },
      this.somethingElseChip(),
    ]);
  }

  private async askLlm(text: string) {
    if (this.busy) return;
    this.setBusy(true);
    this.view.setChips([]);
    this.history.push({ role: "user", content: text });
    const a = this.view.startReply();
    const tags = new TagStream();
    let reply = "";
    let sources: Link[] = [];
    let related: string[] = [];
    let failed = false;
    let errorText: string | undefined;
    let tagged = ""; // the raw reply with its tags, for chat:reply-end
    emit("chat:reply-start", {});
    const write = (chunk: { text: string; tags: Tag[] }) => {
      // A tag is sent before the text it precedes, so the character reacts as the text appears.
      chunk.tags.forEach(emitTag);
      if (chunk.text) {
        reply += chunk.text;
        a.append(chunk.text);
      }
    };
    try {
      for await (const ev of streamChat({ lang: this.lang, messages: this.history.slice(-HISTORY_SENT) })) {
        if (ev.type === "meta") {
          sources = ev.sources ?? [];
          related = ev.related ?? [];
        }
        else if (ev.type === "delta") {
          tagged += ev.text;
          write(tags.push(ev.text));
        }
        else if (ev.type === "error") {
          failed = true;
          errorText = this.strings.errors[ev.code === "interrupted" ? "interrupted" : "unavailable"];
          a.fail(errorText);
        }
      }
      write(tags.flush());
      if (!failed) a.finish({ sources });
    } catch (e) {
      failed = true;
      errorText = this.strings.errors[e instanceof ChatApiError ? e.code : "unavailable"];
      a.fail(errorText);
    } finally {
      emit("chat:reply-end", { text: reply, tagged });
      if (reply.trim()) this.history.push({ role: "assistant", content: reply.trim() });
      else this.history.pop(); // drop the unanswered question so a retry doesn't send it twice
      this.log.push({ role: "assistant", text: reply.trim(), sources: failed ? undefined : sources, error: errorText });
      this.setBusy(false);
      // The topic of an LLM answer is the most related curated answer that is a chip topic.
      const topic = related.find((id) => this.ctx?.answers[id]?.chip) ?? null;
      // With no related topic (off-topic, or nothing curated is close), only "Something else".
      this.showChips(topic ? { kind: "topic", id: topic, includeTopic: true } : { kind: "only-else" });
    }
  }

  private setBusy(b: boolean) {
    this.busy = b;
    this.view.setBusy(b);
  }
}

function timeout<T>(ms: number, value: T): Promise<T> {
  return new Promise((r) => setTimeout(() => r(value), ms));
}
