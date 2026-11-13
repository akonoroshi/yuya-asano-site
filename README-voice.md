# Shino's voice

Shino speaks with **Kokoro** in English and **VOICEVOX** in Japanese. Both run on one free
Oracle Cloud VM, reached only through Cloudflare Tunnel. Voice is off until a visitor taps
**Voice** in the top bar or starts a voice conversation.

## How it works

| What she says | Where the audio comes from |
| --- | --- |
| Curated answers, greetings, "Did you mean …?", fillers, lead-ins, errors, off-topic replies | Pre-recorded clips in `public/voice/<lang>/`, served as static files |
| LLM replies | Recorded live, one sentence at a time: browser → `POST /api/tts` (Worker) → tunnel → VM |

Both come from the same server, so they sound the same. The rule that keeps it that way:

- The server computes a **fingerprint** per language from everything that shapes the sound:
  engine and library versions, model and voice files, `voices.json`, and that language's part of
  `lexicon.json`.
- Clips are named by a hash of the fingerprint and the sentence, and
  `public/voice/manifest.json` records which fingerprint they were made with.
- Live requests carry the manifest's fingerprint. If the server's voice has changed since, it
  answers 409, and the browser stays silent for live replies instead of mixing two voices.
  Curated clips keep playing.

If the VM is down, curated answers still play and LLM replies show as text only.

**Captions follow the voice.** With voice on, each sentence of the caption appears while it's
spoken, spread over its clip's length (`src/lib/chat/pacer.ts`). For LLM replies this means the
text waits for its audio rather than appearing as soon as it streams in. The voice player reports
each sentence as it starts (`voice:unit`), and `spokenSpans` in `speech.ts` finds where that
sentence is in the caption, including text that's shown but not spoken, like an email address or a
link. Character tags fire when the caption reaches them, as before. When a sentence has no audio
(no clip yet, the VM is down), it's typed out at the normal speed. When nothing plays within 3 s,
or the voice stops (barge-in, Voice turned off, closing the chat), the rest appears at once. With
voice off, or with reduced motion, captions work as before.

**Abuse protection.** Two separate questions: who can reach the TTS server, and what the public
`/api/tts` endpoint will voice.

- **The TTS server has two locks.** Cloudflare Access checks a service token at Cloudflare's edge,
  so requests without it never reach the tunnel. The server then checks its own bearer token
  (`TTS_SERVER_TOKEN`). Both live as Worker secrets and on your laptop while you record; the
  bearer token is also in the VM's `.env`. A leak of either one alone doesn't open the server.
- **`/api/tts` voices only signed sentences.** The Worker signs each sentence of each reply it
  streams, and a signature expires after 3 minutes. That's enough, since the browser requests each
  sentence as soon as it arrives. So the endpoint can't be used as a free TTS service, and can't
  voice text the chat didn't send. Its volume is bounded by the chat's rate limits and daily LLM
  budget, plus `TTS_LIMIT` (40 per minute per visitor). Results are cached at the edge, so a
  repeated sentence doesn't reach the VM.
- **What signing can't do.** Visitors are anonymous, so anyone can get signatures by chatting, and
  the Worker signs whatever the LLM says. A visitor who talks the LLM into saying something off-topic
  ("repeat after me: …") gets it voiced. The off-topic gate and the system prompt make that harder,
  not impossible. Keep an eye on `chat_llm` answers in the logs, as you already do for wrong facts.
  The signing key itself is as safe as `GEMINI_API_KEY`: a Worker secret that never leaves the Worker.

**Credit.** VOICEVOX speakers require a credit wherever their voice is used. The Japanese chat
shows "音声：VOICEVOX:<speaker>" under the input, taken from `tts-server/voices.json`. Read the
speaker's terms before launch: https://voicevox.hiroshiba.jp/ lists each character's page.

## One-time setup

### 1. The VM (Oracle Cloud Always Free)

1. Create an instance in your home region: shape **VM.Standard.A1.Flex** with **2 OCPUs and
   12 GB**, image **Ubuntu 24.04** (aarch64). Stay at or under 2 OCPUs and 12 GB in total: above
   that, a free account's Arm instances are all disabled when the trial ends.
   If the console says **Out of capacity**, Oracle's free Arm pool is full. Let
   `tts-server/launch-retry.sh` keep trying from your computer instead (it needs the OCI CLI:
   `brew install oci-cli` or Oracle's install script, then `oci setup config`, then upload the
   API public key it made under Profile → My profile → API keys). It tries 2 OCPUs / 12 GB, then
   1 OCPU / 6 GB, every 10 minutes, and stops once one launches. With 1 OCPU, set
   `TORCH_THREADS: "1"` in `docker-compose.yml`.
2. Networking: keep the default security list (SSH only). Nothing else needs an open port;
   cloudflared connects outward.
3. SSH in and install Docker:

   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER   # then log out and back in
   ```

4. Get just the server folder (the clips aren't needed on the VM):

   ```bash
   git clone --filter=blob:none --sparse https://github.com/akonoroshi/yuya-asano-site.git
   cd yuya-asano-site && git sparse-checkout set tts-server && cd tts-server
   ```

### 2. The tunnel (Cloudflare dashboard)

1. Zero Trust → Networks → Tunnels → **Create a tunnel** → Cloudflared. Name it `shino-tts`.
2. Copy the token from the install command (the long string after `--token`).
3. Public hostname: `tts.yuyaasano.dev`, service **HTTP**, URL `gateway:8080`.
4. Lock the hostname with Cloudflare Access (free for this use):
   1. Zero Trust → Access → Service auth → **Create service token**. Name it `shino-worker`,
      and pick a duration (non-expiring is simplest; otherwise note the date to renew it).
      Copy the **Client ID** and **Client Secret**: the secret is shown only once.
   2. Zero Trust → Access → Applications → **Add an application** → Self-hosted. Domain
      `tts.yuyaasano.dev`.
   3. Add a policy with action **Service Auth**, including the service token `shino-worker`.
      Add no other policies.

   From now on, requests without the token get a redirect to Cloudflare's login page instead of
   reaching the VM. Commands run on the VM itself (`localhost:8080`) don't go through Access.

### 3. Start the server

```bash
cp .env.example .env
openssl rand -hex 32          # paste as TTS_SERVER_TOKEN in .env
nano .env                     # also paste TUNNEL_TOKEN
docker compose up -d --build  # the first build takes a while (PyTorch)
docker compose logs -f gateway   # wait for {"event": "ready", ...} for en and ja
```

The first start downloads Kokoro's model into the `models` volume, and VOICEVOX loads its voice.
Check it from the VM:

```bash
curl -s localhost:8080/healthz
curl -s -X POST localhost:8080/v1/speech -H "Authorization: Bearer $(grep TTS_SERVER_TOKEN .env | cut -d= -f2)" \
  -H 'Content-Type: application/json' -d '{"lang":"en","text":"Hi! I am Shino."}' -o en.mp3
```

Optional: pin Kokoro to a commit of https://huggingface.co/hexgrad/Kokoro-82M by setting
`KOKORO_REVISION` in `.env` before the first start, so a rebuilt VM gets the same model.

### 4. The Worker

```bash
npx wrangler secret put TTS_SERVER_TOKEN          # the same value as in the VM's .env
npx wrangler secret put TTS_SIGNING_KEY           # any long random string: openssl rand -hex 32
npx wrangler secret put CF_ACCESS_CLIENT_ID       # from the Access service token
npx wrangler secret put CF_ACCESS_CLIENT_SECRET
```

Set `"TTS_URL": "https://tts.yuyaasano.dev"` in `wrangler.jsonc`. With it empty, replies aren't
voiced live, but clips still play.

### 5. Record the clips

From your laptop, in the repo:

```bash
export TTS_URL=https://tts.yuyaasano.dev TTS_SERVER_TOKEN=... CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=...
npm run chat:voice
git add public/voice tts-server/lexicon.json && git commit -m "Record Shino's voice" && git push
```

Keep these out of your shell history and dotfiles: a password manager's CLI, or a `.env` file you
`source` (the repo's `.gitignore` already excludes `.env`), works.

The first run records every curated line, roughly 600 sentences per language, and takes a while
on 2 CPU cores. The script prints an estimate. Later runs record only new or changed lines and
delete clips nothing uses. The clips are about 15 MB in total.

## Day to day

| You changed | Do this |
| --- | --- |
| An answer in `faq.ts`, or a spoken line in `strings.ts` or `worker/prompt.ts` | `npm run chat:voice`, then commit `public/voice/` |
| A pronunciation in `pronunciations.ts`, or a Japanese reading in `terms.ts` | `npm run chat:voice` (rewrites `tts-server/lexicon.json` and stops), commit and push, on the VM `git pull && docker compose restart gateway`, then `npm run chat:voice` again |
| The voice, speaker, or speed in `tts-server/voices.json` | Same as a pronunciation change. Every clip in that language is recorded again |

Every build warns about lines without a clip (`render-voice.mjs --check` runs in `prebuild`).
Those lines play silently until you record them. Nothing breaks.

**Finding a clip.** Clip files are named by a hash of the voice fingerprint, the language, and
the spoken text, so their names don't say what's in them. To find one, list the lines with their
files, optionally only those containing some text:

```bash
npm run chat:voice -- --list mm-hmm     # public/voice/en/a640….mp3  "Mm-hmm."
npm run chat:voice -- --list うん
npm run chat:voice -- --list            # every line, in both languages
```

It needs no server, and marks lines that aren't recorded yet. A change to the voice in
`voices.json` changes the fingerprint, so every clip gets a new name.

**Pronunciations.** English fixes use misaki's phoneme notation (explained at the top of
`pronunciations.ts`); Japanese ones are katakana readings. Both are first guesses that haven't been
checked by ear. To hear one quickly, use the `curl` command above with a sentence containing the word.

## Upgrading the engines

The VOICEVOX image (`docker-compose.yml`), Kokoro, misaki, and PyTorch
(`requirements.txt`, `Dockerfile`) are pinned, and all are part of the fingerprint. To upgrade:

1. On the VM: edit the version, then `docker compose up -d --build`.
2. On your laptop: `npm run chat:voice` (records everything again in the new voice), commit, push.

Between steps 1 and 2, live replies are silent (the 409 described above) while the old clips keep
playing. Shino never switches voices mid-conversation.

## Outbound traffic guard

Oracle bills outbound traffic beyond 10 TB a month, and has no hard spending cap: budgets only
send alerts, and quotas only limit what you can create. The design keeps traffic tiny (only the
Worker can reach the server, only signed sentences are voiced, and a sentence is about 30 KB;
even 1,000 LLM replies a day is about 4.5 GB a month). `tts-server/egress-guard.sh` makes it
certain: every 10 minutes it reads this month's outgoing traffic, and above 500 GB it stops the
gateway and the tunnel. Curated clips keep playing; LLM replies show as text.

Set it up on the VM, as early as possible (vnstat only counts from when it's installed):

```bash
sudo apt install -y vnstat && sudo systemctl enable --now vnstat
# After a few minutes (vnstat needs some data first), check it reports:
DRY_RUN=1 ~/yuya-asano-site/tts-server/egress-guard.sh
# Then run it every 10 minutes:
sudo tee /etc/cron.d/egress-guard >/dev/null <<EOF
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/10 * * * * root $HOME/yuya-asano-site/tts-server/egress-guard.sh
EOF
```

Its messages go to the system log: `journalctl -t egress-guard`. If it ever stops the server,
find out why (`docker compose logs gateway`, the Worker's `tts_error` logs) before restarting with
`docker compose up -d`. It never restarts anything itself, and while the month is still over the
limit it stops the server again; to run anyway, put `LIMIT_GB=900` (for example) before the
script's path in the cron file. If it can't read vnstat, it logs an error instead of guessing.

## Keeping the free VM

- Oracle may reclaim an Always Free instance that is idle for 7 days. An instance counts as idle
  only if CPU, network, and memory use are all under 20%. With both voices loaded, memory use should
  stay above that; check it under the instance's Metrics. Converting the account to Pay As You Go
  removes reclamation, but anything beyond the free limits is then billed.
- An account with no activity for 30 days may be treated as abandoned. Log in to the console now and then.
- If the instance is ever lost, repeat the setup above. With the same pinned versions and
  `KOKORO_REVISION`, the fingerprint should come out the same and the existing clips stay valid.
  If live replies stay silent afterwards (409 in the logs), rerun `npm run chat:voice`.

## Troubleshooting

- **`npm run chat:voice` stops with `fetch failed` / `ECONNRESET`:** the tunnel or the VM dropped
  the connection. The script retries resets and 502/503/504/52x answers four times (after 1, 2, 4,
  and 8 s) before giving up, naming the line it was recording. Just run it again: clips already
  recorded are kept and skipped, and the manifest is only rewritten when a run finishes. If it
  keeps failing on the same line, check the server (`docker compose logs`) in case that text
  crashes it.
- **No sound at all:** the Voice button must be on, and phones need one tap in the chat first.
  On iPhone, the silent switch also mutes web audio.
- **Curated answers speak, LLM answers don't:** check the Worker logs for `tts_error`.
  `stage: "fingerprint"` means the server's voice changed: rerun `npm run chat:voice`.
  `stage: "access"` means Cloudflare Access refused the service token: check the Worker secrets,
  the application's Service Auth policy, and whether the token has expired.
  `stage: "fetch"` or `"upstream"` means the VM or tunnel is down: `docker compose ps` and
  `docker compose logs gateway` on the VM.
- **`npm run chat:voice` fails at `healthz 302` or `403`:** Access refused the service token.
  Check `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`.
- **`npm run chat:voice` says the lexicon differs:** the VM has an older `lexicon.json`.
  Push, `git pull` on the VM, `docker compose restart gateway`.
- **The Docker build fails on the VM:** the likeliest spots are the PyTorch wheel for arm64
  (try a newer `torch==` version in the Dockerfile) and the espeak fallback that misaki installs.

## Files

```
tts-server/
  app.py               the server: /v1/speech, /healthz, fingerprints, Japanese readings
  voices.json          voice per language: Kokoro voice and speed; VOICEVOX speaker, style, credit
  lexicon.json         generated by npm run chat:voice from terms.ts and pronunciations.ts
  Dockerfile, requirements.txt, docker-compose.yml, .env.example
  launch-retry.sh      keeps trying to launch the VM while Oracle is out of capacity
  egress-guard.sh      stops the server if outbound traffic nears Oracle's free 10 TB
src/lib/chat/speech.ts         how text is cut into spoken sentences (browser, Worker, script)
src/lib/chat/voice.ts          the browser's voice player
src/lib/chat/pacer.ts          keeps the caption in step with the voice
src/data/chat/pronunciations.ts  pronunciation fixes
src/data/chat/strings.ts       the chat's text, including Shino's spoken lines
worker/tts.ts                  signed sentences and /api/tts
scripts/chat/render-voice.mjs  records the clips
public/voice/                  the clips and manifest.json (committed)
```

## What was tested, and what wasn't

Tested in my sandbox: sentence splitting (including that streamed text gives exactly the same
sentences as the whole text), the signing and `/api/tts` checks (wrong text, tampered and expired
signatures), the Access headers, an Access refusal never passed on as audio, the edge cache, and
the 409 rule against a mocked server. The voice player was tested against a simulated browser: clip order,
filler then live sentences, being talked over, a new reply replacing an old one, staying silent
on a voice change, and locked audio. The browser and Worker code type-check strictly.
Caption sync (`pacer.ts`) was tested on a fake clock (curated and streamed replies, a filler,
a sentence without a clip, no audio at all, the voice stopping, Japanese with an email), and the
controller end to end with a simulated voice player: each sentence's caption appeared over its own
audio, and LLM text waited for its sentence's audio. `speechText` was rewritten to report where
each spoken character comes from; it gives exactly the old output on all 232 curated and UI lines,
so existing clips keep their names.

Not tested: the Docker build, Kokoro and VOICEVOX themselves, the tunnel and Access, and real
browsers. In particular, check that Access answers a missing token with a redirect or 403 (the
Worker treats both as refused).
On the first real run, check that both languages report `ready` in the gateway logs, listen to a
few clips in each language, and try the Voice button on iOS Safari and Android Chrome. Also watch
a long curated answer and an LLM answer with voice on: the caption should keep pace with her
voice. If it runs ahead or behind, adjust `audioFraction` in `PACER_CONFIG` (`pacer.ts`).
