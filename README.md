# yuya-asano-site

Personal site built with **Astro 7** (static output) and deployed to **Cloudflare Workers** static assets.
Runtime dependencies are kept to two (Astro and a self-hosted font) so there is very little to patch.

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

```bash
npm install         # creates package-lock.json; commit it
npm run dev         # http://localhost:4321
```

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

English pages live at `/`, Japanese pages at `/ja/` (for example `/ja/projects/emma-agent/`). Every page has a switch in the top right that opens the same page in the other language.

| To change | Edit |
| --- | --- |
| Interface text (section titles, buttons) | `src/i18n/ui.ts`. Every English key needs a Japanese one; the build stops if one is missing. |
| Profile, experience, education | `src/data/site.ts` → `text.en` and `text.ja` |
| A project page | `src/content/projects/en/<name>.md` and `src/content/projects/ja/<name>.md` (same file name) |

Japanese project files only contain text: title, subtitle, summary, facts, links, notice, and the write-up. Everything else (order, conversation replays, the speech-correction demo) comes from the English file, and demos stay in English. If a Japanese file is missing, the Japanese site shows the English page with a short note, so you can add a project in English first and translate later.

Links between pages inside Japanese Markdown should point to `/ja/...`.

Japanese text uses the visitor's built-in Japanese font (Hiragino on Mac and iPhone, Yu Gothic on Windows, Noto on Android), so nothing extra is downloaded. Spacing and line breaks for Japanese are set under "Japanese typography" in `global.css`.

## Publications (synced from Google Scholar)

`src/data/publications.json` holds every paper. The main page automatically shows the **5 most recent papers where you are the first author**, and `/publications/` lists all of them by year. Change the count, or whether arXiv preprints can appear on the main page, in `src/data/publications.ts`.

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
- Delete `preprint: true` once an arXiv paper is published, so it can appear on the main page

To run the sync locally: `SERPAPI_KEY=... npm run sync:publications`.

Note: GitHub pauses scheduled workflows in public repositories after 60 days without any commits. If the site goes quiet for that long, re-enable the workflow from the Actions tab (you'll see a banner), or just push any change.

## Keeping dependencies patched

- **Automatic:** Dependabot (`.github/dependabot.yml`) opens a weekly PR that groups all minor and patch updates. CI (`.github/workflows/ci.yml`) builds every PR. If it's green, merge it, and Cloudflare deploys automatically.
- **Security fixes:** In GitHub repo settings, turn on *Dependabot alerts* and *Dependabot security updates* so urgent fixes arrive immediately instead of waiting for the weekly run.
- **Major Astro versions:** These arrive as separate PRs. Before merging, read the upgrade guide at docs.astro.build, or run `npm run upgrade:astro`, which upgrades Astro and official integrations together.
- **Node.js:** Change the number in `.nvmrc`, then run `fnm install` locally. CI reads the same file.
- **Cloudflare runtime:** Occasionally bump `compatibility_date` in `wrangler.jsonc` to today's date.
- **Check manually any time:** `npm run upgrade:check` lists outdated packages.

## Deploying (Cloudflare Workers Builds)

1. Push this repo to GitHub.
2. In the Cloudflare dashboard: Workers & Pages → Create application → Import a repository.
3. Build command: `npm run build`. Deploy command: `npx wrangler deploy`.
4. Add your custom domain under the Worker's Settings → Domains & Routes.

Every push to `main` then deploys automatically, and branches get preview URLs.

## Structure

```
src/
  content.config.ts            schemas for project pages (English and Japanese)
  content/projects/en/*.md     one file per project: frontmatter, demos, write-up
  content/projects/ja/*.md     Japanese text for the same projects
  data/site.ts                 links, email, and English/Japanese profile text
  data/publications.json       every paper (synced from Google Scholar, hand-editable)
  data/publications.ts         picks the recent first-author papers for the main page
  i18n/ui.ts                   interface text in both languages
  i18n/utils.ts                translation and URL helpers
  lib/projects.ts              merges Japanese project text over the English files
  views/                       the main, project, and publications pages (shared by both languages)
  pages/                       English routes; pages/ja/ holds the Japanese routes
  components/                  Replay, AsrDemo, PubList, LangSwitch, CopyEmail, Footer
  layouts/Base.astro           <head>, hreflang tags, fonts, new-tab links
  styles/global.css            design tokens and all styles, including Japanese typography
  assets/photo.jpg             your photo (add it)
scripts/sync-publications.mjs  adds new papers from Google Scholar
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

## Adding the chat backend later

Keep the portfolio static. Add a Worker at `worker/index.ts` for `/api/chat`, then in `wrangler.jsonc` set `"main": "./worker/index.ts"` and, inside `"assets"`, `"run_worker_first": ["/api/*"]`, so only API calls count toward the Workers request quota.
