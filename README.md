# yuya-asano-site

Personal site built with **Astro 7** (static output) and deployed to **Cloudflare Workers** static assets.
Runtime dependencies are kept small: Astro, a self-hosted font, and two dictionaries for the chat's
voice input (CMUdict for English, kuromoji for Japanese).

## Pages

| URL | Page |
| --- | --- |
| `/`, `/ja/` | Home: full-screen chat with your AI companion (`src/views/ChatView.astro`) |
| `/work/`, `/ja/work/` | Portfolio: intro, projects, experience, papers, education (`src/views/HomeView.astro`) |
| `/projects/<id>/` | One page per project |
| `/publications/` | All papers by year |

Every page except the home page has a small character in the bottom-right corner. Clicking it
opens the same full-screen chat, and the conversation continues where the visitor left it (per
browser tab). How the chat works, how to set it up, and how to tune it: **[README-chat.md](README-chat.md)**.

## First-time setup

### 1. Install Node.js 26

The project expects Node 26 (Active LTS), pinned in `.nvmrc`. First check what you have:

```bash
node -v
```

If it prints `v24` or higher, skip to step 2. Otherwise, install **fnm**, a Node version manager that reads `.nvmrc` and switches versions automatically when you `cd` into the project:

```bash
brew install fnm
echo 'eval "$(fnm env --use-on-cd --shell zsh)"' >> ~/.zshrc
source ~/.zshrc
```

Then, inside the project folder:

```bash
fnm install      # reads .nvmrc and installs Node 26
node -v          # should print v26.x
```

No Homebrew? Install Node 26 LTS with the macOS installer from nodejs.org instead.

### 2. Install and run

Your GitHub SSH key needs read access to `akonoroshi/vrm-characters` to install the pinned `@tonari/characters` dependency.

```bash
npm ci              # installs from package-lock.json
npm run dev         # http://localhost:4321
```

With a sibling `../vrm-characters` checkout, dev and build load its current TypeScript source and copy its Shino assets into `public/characters/`. Run `npm ci` in the shared checkout once to install its dependencies. Restart dev to copy any changed assets. Without that checkout, the site uses the installed package and its assets.

### Other commands

```bash
npm run clean       # deletes build output and Vite/Astro caches
npm run dev:fresh   # clean, then start the dev server
npm run build       # builds to dist/ and validates every project file against the schema
npm run preview     # serves the built site through Wrangler, like production
npm run deploy      # builds and deploys manually (normally Cloudflare deploys on push)
```

## Updating content (no code changes)

| To change | Edit |
| --- | --- |
| Links, email | `src/data/site.ts` → `profile` |
| Name, intro, experience, education | `src/data/site.ts` → `text.en` / `text.ja` |
| Your photo | Put a square-ish image at `src/assets/photo.jpg` (or `.png`, `.webp`). Astro resizes and compresses it. Until then, initials are shown. |
| CV | Replace `public/CV_YuyaAsano.pdf` (keep the file name, or update the link in `site.ts`) |
| A project page | `src/content/projects/en/<name>.md` (and `ja/<name>.md`) |
| Add a project | Copy any file in `src/content/projects/en/`, change the frontmatter. The page, the main-page row, and "Next project" links are generated. Add a Japanese version in `ja/` with the same file name. |
| Hide a project | Set `draft: true` in its frontmatter |
| A conversation example inside a write-up | Add it under `replays:` in the English frontmatter (see `emma-pairs.md`), then put `<div data-example="name"></div>` on its own line where it should appear, in both the English and Japanese Markdown. Turns can name an addressee (`to:`) and highlight phrases (`highlight:`). |
| Publications | `src/data/publications.json` (see below) |

Project frontmatter is validated by `src/content.config.ts`. If you mistype a field, `npm run build` fails and tells you which file and field.

## English and Japanese

English pages live at `/`, Japanese pages at `/ja/` (for example `/ja/projects/emma-agent/`, `/ja/work/`). Every page has a switch in the top right that opens the same page in the other language.

| To change | Edit |
| --- | --- |
| Interface text (section titles, buttons) | `src/i18n/ui.ts`. Every English key needs a Japanese one; the build stops if one is missing. |
| Profile, experience, education | `src/data/site.ts` → `text.en` and `text.ja` |
| A project page | `src/content/projects/en/<name>.md` and `src/content/projects/ja/<name>.md` (same file name) |

Japanese project files only contain text: title, subtitle, summary, facts, links, notice, and the write-up. Everything else (order, conversation replays, the speech-correction demo) comes from the English file, and demos stay in English. If a Japanese file is missing, the Japanese site shows the English page with a short note, so you can add a project in English first and translate later.

Links between pages inside Japanese Markdown should point to `/ja/...`.

Japanese text uses the visitor's built-in Japanese font (Hiragino on Mac and iPhone, Yu Gothic on Windows, Noto on Android), so nothing extra is downloaded. Spacing and line breaks for Japanese are set under "Japanese typography" in `global.css`.

## Publications (synced from Google Scholar)

`src/data/publications.json` holds every paper. The portfolio page automatically shows the **5 most recent papers where you are the first author**, and `/publications/` lists all of them by year. Change the count, or whether arXiv preprints can appear on the portfolio page, in `src/data/publications.ts`.

**New papers are added automatically** by a weekly GitHub Action (`.github/workflows/sync-publications.yml`). Google Scholar has no official API and blocks automated requests, so the sync goes through SerpApi's Google Scholar Author API. It only adds papers that aren't already in the JSON; it never overwrites your edits.

One-time setup:

1. Create a SerpApi account and copy your API key.
2. In GitHub: Settings → Secrets and variables → Actions → New repository secret. Name it `SERPAPI_KEY`.
3. Optionally run it now: Actions tab → Sync publications → Run workflow.

When a new paper arrives, Scholar's data can be rough (abbreviated venue, truncated author list). Edit its entry in the JSON once, and your version is kept from then on. Useful fields:

- `venue`: a short label such as `"EMNLP 2026"`
- `href`: link to the paper (DOI or ACL Anthology); `code` and `arxiv` add extra links
- `award`: e.g. `"Best paper"`
- `hidden: true`: hide a duplicate or a paper you don't want listed
- Delete `preprint: true` once an arXiv paper is published, so it can appear on the portfolio page

To run the sync locally: `SERPAPI_KEY=... npm run sync:publications`.

Note: GitHub pauses scheduled workflows in public repositories after 60 days without any commits. If the site goes quiet for that long, re-enable the workflow from the Actions tab (you'll see a banner), or just push any change.

## Keeping dependencies patched

- **Automatic:** Dependabot (`.github/dependabot.yml`) opens a weekly PR that groups all minor and patch updates. Run `npm ci && npm run build && npm run test:chat` on the proposed changes before merging. Cloudflare deploys automatically after merge.
- **Security fixes:** In GitHub repo settings, turn on *Dependabot alerts* and *Dependabot security updates* so urgent fixes arrive immediately instead of waiting for the weekly run.
- **Major Astro versions:** These arrive as separate PRs. Before merging, read the upgrade guide at docs.astro.build, or run `npm run upgrade:astro`, which upgrades Astro and official integrations together.
- **Node.js:** Change the number in `.nvmrc`, then run `fnm install` locally. CI reads the same file.
- **Cloudflare runtime:** Occasionally bump `compatibility_date` in `wrangler.jsonc` to today's date.
- **Check manually any time:** `npm run upgrade:check` lists outdated packages.

## Deploying (Cloudflare Workers Builds)

1. Push this repo to GitHub.
2. In the Cloudflare dashboard: Workers & Pages → Create application → Import a repository.
3. In Workers Builds, set `SKIP_DEPENDENCY_INSTALL` to `1` and add the encrypted build secret `VRM_CHARACTERS_DEPLOY_KEY` for production and previews. Its value is the base64-encoded private half of a read-only SSH deploy key for `akonoroshi/vrm-characters`.
4. Set the build command for production and previews to `sh scripts/install-ci-dependencies.sh && npm run build`. Keep `npx wrangler deploy` as the production deploy command. When configuring an existing Worker before merging this change, use `if [ -f scripts/install-ci-dependencies.sh ]; then sh scripts/install-ci-dependencies.sh; else npm ci; fi && npm run build` so builds of the current production branch can still install their dependencies.
5. Add your custom domain under the Worker's Settings → Domains & Routes.

Every push to `main` then deploys automatically, and branches get preview URLs.

GitHub CI uses an Actions secret with the same name and its own read-only deploy key. Fork and Dependabot PRs skip the build job because it requires access to that Actions secret.

CI and Cloudflare resolve the latest compatible shared commit before installing dependencies. They follow `codex/shared-prepared-gesture-playback` until `vrm-characters/main` includes the checked-in pin, then follow `main`. The install script logs the resolved commit and updates the lockfile in the build workspace.

To rebuild the live site when the shared package changes, create a Cloudflare Workers Builds Deploy Hook for the site's production branch. Save its URL as the `YUYA_ASANO_SITE_DEPLOY_HOOK` Actions secret in `akonoroshi/vrm-characters`. The shared package's CI calls the hook after its checks pass on the tracked branches.

## Structure

```
src/
  content.config.ts            schemas for project pages (English and Japanese)
  content/projects/en/*.md     one file per project: frontmatter, demos, write-up
  content/projects/ja/*.md     Japanese text for the same projects
  data/site.ts                 links, email, and English/Japanese profile text
  data/publications.json       every paper (synced from Google Scholar, hand-editable)
  data/publications.ts         picks the recent first-author papers for the portfolio page
  data/chat/                   chat answers (faq.ts), terms, fact sheet, test sets (see README-chat.md)
  lib/chat/                    chat logic shared by the browser, build scripts, and tests
  i18n/ui.ts                   interface text in both languages
  i18n/utils.ts                translation and URL helpers
  lib/projects.ts              merges Japanese project text over the English files
  views/                       the home (chat), portfolio, project, and publications pages (shared by both languages)
  pages/                       English routes; pages/ja/ holds the Japanese routes
  components/                  Replay, AsrDemo, PubList, LangSwitch, CopyEmail, Footer,
                               Chat, ChatStage (full-screen layout), ChatLauncher (corner character)
  layouts/Base.astro           <head>, hreflang tags, fonts, new-tab links, corner character
  styles/global.css            design tokens and all styles, including Japanese typography
  assets/photo.jpg             your photo (add it)
scripts/sync-publications.mjs  adds new papers from Google Scholar
scripts/chat/                  builds the chat's browser data, paraphrases, retrieval index, eval
worker/                        /api/chat (retrieval + LLM) on Cloudflare Workers
tests/chat/                    unit tests for the chat (npm run test:chat)
pitt-redirect/index.html       upload to Pitt AFS so the old URL forwards here
```

## Troubleshooting

**"No cached compile metadata found for …astro?astro&type=script…"**
The dev server's cache, or an open browser tab, still refers to a component that was renamed or deleted. Fix it with:

1. Stop the dev server (Ctrl+C).
2. Make sure the deleted files are really gone. If you updated the project by unzipping a new version over the old folder, old files stay behind. Replace the whole `src/` folder instead of merging into it.
3. Run `npm run dev:fresh`.
4. Hard-reload the browser tab (Cmd+Shift+R).

## Links

Links to other sites, and PDFs, open in a new tab automatically (a small script in `src/layouts/Base.astro`). Links within the site open in the same tab. This also covers links you write in project Markdown files.

## Chat

The home page is the chat; the API behind it is the Worker in `worker/`, which only runs for
`/api/*` (`run_worker_first` in `wrangler.jsonc`), so static pages never count toward the Workers
request quota. Setup steps (Vectorize index, Gemini key, retrieval index), tuning, and the review
loop are in [README-chat.md](README-chat.md).
