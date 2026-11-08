# Chat

The home page (`/`, `/ja/`) is a full-screen chat with your AI companion. Every other page has a
small character in the bottom-right corner that opens the same chat full-screen. This file covers
how it works, the one-time Cloudflare setup, and how to tune it.

## How a question is answered

Cheapest first. Most questions should stop at step 1 or 2.

| Step | Where | Cost | What happens |
|---|---|---|---|
| 1. Chip | Browser | Free | Pre-written answer from `faq.ts` |
| 2. Fuzzy match | Browser, main thread | Free | Typed text or ASR alternatives vs. FAQ phrasings. Top alternative answers directly; a lower one asks "Did you mean …?" |
| 3. Phonetic match | Browser, Web Worker | Free | Voice only. Algorithm 1 from the COLING 2025 paper, weighted LCS. Always asks "Did you mean …?" |
| 4. Off-topic gate | Worker | 1 embedding | Nothing on the site is similar enough: canned reply |
| 5. LLM | Worker | 1 LLM call | Retrieved passages + fact sheet, Gemini, Workers AI if Gemini fails |

## Shino

The character is **Shino** (しの in Japanese), your AI companion. She opens every new conversation
with "Welcome to Yuya's website! I'm Shino, Yuya's AI companion. Ask me about his research,
projects, or experience." (on project pages: "…Ask me about this project, or anything else about
Yuya."). The opening is in the page's HTML, so it shows before any script runs. Her name is also
in the dialog's top bar, the corner button's label, the disclosure line, the "Who are you?"
answer, and the LLM's system prompt (`worker/prompt.ts`), and it's an ASR term in `terms.ts`.

**Her voice**

Shino looks like a high school student, and her conversational lines sound friendly and upbeat:
the opening, greetings, thanks, "Something else", "Did you mean …?", repeat lead-ins, the
off-topic reply, and error messages. Japanese keeps soft, friendly です/ます (〜なんです,
〜ですね), never タメ口 or slang. Factual answers stay neutral and exactly as checked, since
recruiters read them. The LLM gets the same split in its system prompt (`worker/prompt.ts`):
warm openings and closings, facts stated plainly, no slang, at most one exclamation mark.

**Not repeating herself**

- Short conversational lines rotate between three phrasings, never the same one twice in a row:
  "Did you mean …?", the reply to "Something else", greetings, thanks, and the off-topic redirect.
  They carry no facts. Edit them in `Chat.astro` (`didYouMean`, `somethingElseReply`), in
  `faq.ts` (`alternatives` on the greeting and thanks entries), and in `worker/prompt.ts`
  (`canned.offtopic`).
- Factual answers have one checked wording each, so a recruiter who asks twice gets the same
  facts. When a visitor asks one again in the same conversation, Shino adds a short lead-in
  ("As I mentioned earlier:", `repeatLeadIn` in `Chat.astro`) and gives the same answer.

## Where the chat appears

- **Home page** (`ChatView.astro`): the chat is the page itself, not a pop-up over another page,
  so it isn't an intrusive interstitial for visitors arriving from search. Your name and role are
  the page's `<h1>`, so recruiters and search engines see them without any interaction.
- **Every other page** (`ChatLauncher.astro`, added by `Base.astro`): a 56px round button in the
  bottom-right corner, with a hint ("Ask me about Yuya") on wide screens. Clicking it opens the
  same full-screen layout in a modal `<dialog>`: focus moves in, Esc closes it (first closing the
  transcript if it's open), and the page behind doesn't scroll. Nothing chat-related downloads
  until the first click. The "Talk to my AI companion" link on the portfolio page opens it too.
- **Button image:** put a square still of the character at `src/assets/character-launcher.png`
  (or `.jpg`, `.webp`). Until then, a simple drawn face is shown.
- **One conversation per tab:** after every turn, the conversation (transcript, answered topics,
  current chips) is saved in `sessionStorage`, and restored on the next page. So a visitor can ask
  on the home page, follow a link to a project, and continue from the corner character. A reply
  still streaming when they navigate is cut off. A new build with different FAQ data starts a
  fresh conversation.
- **Both layouts share `ChatStage.astro`**, so they look and behave the same. The home page's top
  bar has your name, Portfolio, Transcript, and the language switch; the dialog's has your name,
  Transcript, and Close.

## The screen

The character fills the screen. The top bar is described above. Over the bottom of the character, from the bottom up: a slim input bar (text
and voice), a row of suggested-question chips, the character's current reply as a caption, and a
small "you asked" line. The caption is about four lines tall. Every reply streams in (LLM answers as
they arrive from the Worker, curated answers typed out locally at about 75 characters per second,
instantly with reduced motion), and the caption follows the newest text like subtitles. Scrolling
up stops the following, so visitors can reread; a fade at the bottom edge shows there is more. The Transcript button opens the full conversation, with links and sources,
in a panel under the top bar. "Did you mean …?" is asked in the caption and answered with chips.

## Chips

Chips follow a topic tree defined in `faq.ts`. On the home page:

- **About Yuya:** Research interests · Dissertation in 30 seconds · AI learning companion
  (Teaching the companion · Gestures without clipping) · Contact & CV
- **Research highlights:**
  - Emma, an LLM agent: How Emma responds · Why a second solution? · What made it hard ·
    The 72-person study
  - Pairs teaching Emma: Whose words they share · When they disagree · How the data is built
  - Speech recognition correction*: Re-ranking the guesses · Matching by sound ·
    Results with real users
  - LLMs vs. students: Why it matters · How it was measured
- **Internships:** SigIQ internship · ETS internship · Jackson State internship
- **How this chat works:** Speech recognition correction* · Keeping LLM calls low · Tech stack

\* Listed under both Research highlights and How this chat works (a topic can have up to two
parents). Going back up follows the way the visitor came: after the speech recognition branch,
someone who came from How this chat works is offered Keeping LLM calls low and Tech stack, and
someone who came from Research highlights is offered the other research projects. The first parent
in `faq.ts` order (Research highlights) is used when the visitor typed the question instead.

"Voice input", "Demos", and "Open to roles?" are no longer chips, but still answer typed questions.

**How chips are chosen**

- Up to four topic chips, plus "Something else".
- After an answer, the chips go one level deeper (the topic's subtopics). If none are left, they
  offer the topic's unanswered siblings; if none, the parent's siblings; and so on up. Only the
  nearest level with anything left is offered, so every chip stays on the previous turn's topic.
- After an LLM answer, the topic is the curated answer the retrieval step found most related (the
  Worker sends the ids with the reply, at no extra cost), and that topic itself is offered too if
  it hasn't been answered. If nothing curated is related, only "Something else" is shown.
- Every state except the site-wide start has "Something else": the companion says "OK. What else
  would you like to know about Yuya?" and the site-wide start chips come back. No network call.
  (At the site-wide start it would do nothing, so it isn't shown there.)
- Greetings and thanks aren't in the tree, so they return to the starting chips.

**Where the chat starts depends on the page** (`pageChips` in `faq.ts`). Project pages start one
level down, with the same subtopics as in the tree; the page itself already gives the overview.

| Page | Starting chips |
| --- | --- |
| Home, portfolio, 404 | About Yuya, Research highlights, Internships, How this chat works |
| Emma (LLM agent) | How Emma responds, Why a second solution?, What made it hard, The 72-person study |
| Pairs teaching Emma | Whose words they share, When they disagree, How the data is built |
| Speech recognition correction | Re-ranking the guesses, Matching by sound, Results with real users |
| AI learning companion | Teaching the companion, Gestures without clipping |
| LLMs vs. students | Why it matters, How it was measured |
| Publications | Research highlights, Speech recognition correction, LLMs vs. students, Whose words they share |

Page-specific starting chips always come with "Something else". Each page passes its key
(`project:<file name>` or `publications`) through `Base.astro`'s `chatPage` prop, so a new project
only needs an entry in `pageChips` (up to four ids); pages without one use the site-wide start. A
conversation continued on another page starts from that page's chips, skipping topics already
answered. Reloading the same page brings back the chips as they were.

Edit `startChips`, `pageChips`, and each topic's `children` in `faq.ts`. The build fails if an id
doesn't exist, a topic has more than two parents, the tree has a cycle, or a page lists more than
four chips.

## Files

```
src/lib/chat/            shared logic; Node runs these .ts files directly in scripts and tests
  types.ts               shared types
  normalize.ts           text normalization for fuzzy matching
  phonemes.ts            ARPAbet and Japanese phoneme encoding, numbers, term readings
  match.ts               fuzzy matching, weighted LCS, Algorithm 1, thresholds (MATCH_CONFIG)
  route.ts               the two free routing steps
  controller.ts          routing order, worker, streaming, history
  phoneme.worker.ts      loads CMUdict or kuromoji off the main thread
  asr.ts                 Web Speech API: push to talk, n-best, biasing, on-device check
  api.ts                 /api/chat client
  tags.ts                behavior tags ([act:…], [emo:…]): vocabulary, parser, streaming parser
  mock.ts                stand-in for /api/chat in `npm run dev` (?mock); never in production
src/components/Chat.astro          the chat panel (caption, chips, input, transcript)
src/components/ChatStage.astro     full-screen layout: character slot, top bar, chat
src/components/ChatLauncher.astro  corner character + full-screen dialog (every page but home)
src/views/ChatView.astro           the home page (/ and /ja/)
src/data/chat/
  faq.ts                 curated answers (EN/JA), based on site.ts and the project pages
  terms.ts               domain terms: ASR biasing, pronunciations, Japanese readings
  factsheet.ts           always in the LLM prompt; built from site.ts, so edit site.ts instead
  paraphrases.json       generated phrasings (npm run chat:paraphrase), reviewed by you
  papers/                paper texts for retrieval (see "Retrieval index")
  eval/en.tsv, ja.tsv    routing test sets
  generated/             vector-ids.json, written by chat:index (commit it)
scripts/chat/            build, paraphrase, index, eval, g2pE helper
worker/                  /api/chat and /api/telemetry
tests/chat/              unit tests
```

## Setup

The code, scripts, and config are already in place (`package.json`, `wrangler.jsonc`, `.gitignore`,
`tsconfig.json`, CI). What's left:

### 1. Install the new packages

```bash
npm install
```

This adds `kuromoji` and `cmu-pronouncing-dictionary` and updates `package-lock.json`. Commit the
lock file: CI runs `npm ci`, which fails if the lock file doesn't match `package.json`.

### 2. Cloudflare resources

```bash
npx wrangler vectorize create site-chat --dimensions=1024 --metric=cosine
npx wrangler vectorize create-metadata-index site-chat --property-name=scope --type=string
npx wrangler secret put GEMINI_API_KEY
```

Create the metadata index before indexing anything: vectors inserted earlier aren't filterable.
Create the Vectorize index before the first deploy that includes the Worker: a binding to an
index that doesn't exist makes the deploy fail.

### 3. Retrieval index

Put each paper's text in `src/data/chat/papers/<name>.md`:

```markdown
---
title: Contextual ASR Error Handling with LLMs Augmentation for Goal-Oriented Conversational AI
url: https://aclanthology.org/2025.coling-industry.32/
---
(paper text: e.g. `pdftotext paper.pdf -`, minus references and tables)
```

Then, with an API token that has Workers AI: Read and Vectorize: Edit:

```bash
npm run chat:index -- --dry-run      # check the chunks first
CF_ACCOUNT_ID=... CF_API_TOKEN=... npm run chat:index
git add src/data/chat/generated/vector-ids.json
```

Rerun after changing project pages, papers, or FAQ answers. Only changed chunks are embedded.

## Running locally

### Without any backend (no Vectorize, Workers AI, or Gemini)

```bash
npm install
npm run dev
```

Open `http://localhost:4321/?mock`. Everything runs in the browser except answers to new
questions, which come from a stand-in for `/api/chat` (`src/lib/chat/mock.ts`, development only):

- **Works as in production:** chips and the topic tree, page-specific chips (open a project page,
  then the corner character), fuzzy matching of typed questions, voice input with "Did you mean
  …?", the transcript, the conversation carrying over between pages, and the corner dialog.
- **Mocked:** a question with no curated match streams back the closest curated answer, prefixed
  "(Mock answer)", with a project page as its source and related follow-up chips, the way the real
  Worker's retrieval would choose them. A question unrelated to everything gets the off-topic reply.

`?mock` stays on for the browser tab, across pages. To try the other states, open any page with:

| URL | What the "server" does |
| --- | --- |
| `?mock` | streams an answer |
| `?mock=slow` | streams slowly, to watch the caption follow the text |
| `?mock=cut` | stops halfway with "The answer was cut off" |
| `?mock=offtopic` | the canned off-topic reply |
| `?mock=error` | unavailable before answering |
| `?mock=limit` | the daily limit is reached |
| `?mock=rate` | the visitor is rate limited |
| `?mock=off` | back to the real `/api/chat` (in `npm run dev`, that shows "couldn't answer") |

The mock is never part of a production build: `api.ts` loads it only when Vite's
`import.meta.env.DEV` is true.

**Voice input on a phone:** browsers allow the microphone only on `https` or `localhost`, so
`http://<your-laptop's-IP>:4321` won't work. A free Cloudflare quick tunnel gives the dev server
a temporary `https` URL:

```bash
npm run dev -- --host
npx cloudflared tunnel --url http://localhost:4321   # prints an https://….trycloudflare.com URL
```

Then open that URL with `?mock` on the phone. (Astro may ask you to allow the tunnel's host name
in `vite.server.allowedHosts`; it prints the exact setting to add.)

### With the real backend

- `npm run preview`: the full stack through Wrangler, including the Worker. Put
  `GEMINI_API_KEY=...` in `.dev.vars` first. Vectorize and Workers AI calls go to your real account.

Test voice on real phones: iOS Safari and Android Chrome behave differently from desktop.

## Connecting the character

**Behavior tags.** Shino's replies carry the same tags as your learning companion
(`src/lib/chat/tags.ts`): `[act:<name>]` for a gesture at that point, and
`[emo:<emotion>:<strength>]` for an emotion from that point on (strength 0 to 1, default 0.5; with
no emotion tag, neutral). Every curated answer in `faq.ts` starts with an emotion and an act, such
as `[emo:happy:0.8][act:co_celebrate]` for the Alexa Prize result or `[emo:focused:0.6][act:think]`
before "What made it hard", with one or two more where the tone changes. Tags are removed before
anything is shown, saved to the transcript, indexed for retrieval, or sent to the LLM as history.
The build fails on an unknown tag or a strength outside 0 to 1. LLM answers currently use emotion
tags only (the system prompt lists them); unknown tags from the model are dropped, never shown.

**Events** (window `CustomEvent`s, from `controller.ts`):

| Event | Detail | When |
| --- | --- | --- |
| `chat:reply-start` | `{ text, tagged }` for curated replies; `{}` for LLM replies (not known yet) | a reply begins |
| `chat:tag` | `{ kind: "act", name, at }` or `{ kind: "emo", name, strength, at }` | the text reaches the tag; `at` is the position in the plain text |
| `chat:reply-end` | `{ text, tagged }` | the reply is complete |
| `chat:open` | `{ slot }` | the corner dialog opened; load the model into `slot` |
| `chat:close` | | the dialog closed; pause rendering |
| `character:loaded` | (from the character) | start loading the voice dictionaries |

Your alignment code can use either form: react to `chat:tag` as the text streams in, or take the
full tagged text from `chat:reply-start` (curated replies) or `chat:reply-end` (any reply). When a
new conversation opens, `chat:tag` sends `emo:happy` (0.8) and `act:greet`, since the opening
line is already on screen.

Mount the character in `[data-character-slot]` in `ChatStage.astro`: on the home page right away,
in the dialog on `chat:open`. It fills the whole viewport; the top bar and the chat float over it.
The caption, chips, and input cover roughly the bottom 40% of the screen, so frame the camera with
the face in the upper half. Clicks on empty areas of the overlay pass through to the canvas, in
case you add interaction with the character.

## Tuning

**Routing thresholds** are in `MATCH_CONFIG` (`src/lib/chat/match.ts`). Add real misrecognitions
from phone testing to `src/data/chat/eval/*.tsv`, then:

```bash
npm run chat:context && npm run chat:eval -- --verbose
```

The starter English set already shows the paper's "more specific query" false positive:
"how does Emma decide which solution to show" matches "How does Emma decide what to say?" at
0.85 coverage. The confirmation chip catches it, but it's the case to tune against. For Japanese,
`vowelWeight: 0.5` is a first guess; try consonant-only coverage if chance vowel matches dominate.

**Off-topic threshold** (`OFFTOPIC_THRESHOLD` in `wrangler.jsonc`): read `topScore` in the logs.
Too many good questions in `chat_offtopic` events: lower it. Junk reaching `chat_llm`: raise it.

**Missing pronunciations**: `npm run chat:context` lists English context words not in CMUdict.
Run `pip install g2p_en && python3 scripts/chat/g2p_oov.py WORD ...`, check the result by ear,
and add it to `terms.ts`. Use `--strict` to make the build fail on them.

## The review loop

In the Cloudflare dashboard, open the Worker's logs and filter by `event`:

- `chat_llm`: questions that reached the LLM, with the answer. Move frequent ones into `faq.ts`,
  then `npm run chat:paraphrase` and review the new phrasings in `paraphrases.json`.
  Check answers for anything wrong about you.
- `chat_offtopic`: questions the gate rejected, for tuning the threshold.
- `asr_nbest`: how many alternatives each browser returns (`n`), and whether it was on-device.
- `chat_budget`, `chat_error`: daily limits hit, retrieval failures.

## Limits (all in wrangler.jsonc)

- Per visitor: 3 chat requests per 10 s and 12 per minute.
- Per day: 300 LLM calls (`DAILY_LLM_LIMIT`), of which at most 30 can use the Workers AI fallback
  (`DAILY_FALLBACK_LIMIT`, kept small because the fallback shares the free daily neurons with
  embeddings).
- Per request: a 500-character question; the last 8 messages are sent.

## What was tested, and what wasn't

Tested in my sandbox: the 17 unit tests (`npm run test:chat`), strict type-checking of the browser
and Worker code, and the bundled Worker run against mocked bindings (origin check, size and shape
checks, Gemini streaming, fallback after a Gemini error, daily limit, off-topic reply).

Not tested: I couldn't install npm packages, so the build and eval scripts ran against stand-ins
for CMUdict and kuromoji, and nothing ran against real Cloudflare or Gemini APIs. Things to check
on the first real run:

- `npm run build` succeeds, and `public/chat/cmudict.json` has around 130,000 words.
- On `/ja/chat/`, the browser console shows no kuromoji dictionary errors after the first voice
  question. If it fails while decompressing, the dictionary is being served with
  `Content-Encoding: gzip`, so the browser decompresses it before kuromoji does.
- The Gemini model id and `thinkingLevel` are accepted (Gemini 400 errors appear as `failure` in
  `chat_llm` logs; set `GEMINI_THINKING_LEVEL` to `""` if the parameter is rejected).
- `npm run chat:index` works against the Vectorize REST API.
