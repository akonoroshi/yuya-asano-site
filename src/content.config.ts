// Schemas for project pages. Astro checks every file against these at build time,
// so a missing field or typo fails the build with a clear message.
import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const turn = z.object({
  role: z.enum(["learner", "learner2", "agent"]), // controls the speaker color
  who: z.string(),
  text: z.string(),
  mood: z.string().optional(), // expression chip, e.g. "thinking"
  note: z.string().optional(), // annotation explaining what the system did
  to: z.string().optional(), // addressee, shown under the speaker's name
  // phrases to highlight in this turn (lexical alignment examples)
  highlight: z.array(z.object({ text: z.string(), kind: z.enum(["initiated", "reused", "established"]) })).optional(),
});
const replay = z.object({ title: z.string(), foot: z.string(), turns: z.array(turn).min(1) });
const fact = z.object({ label: z.string(), value: z.string() });
const link = z.object({ label: z.string(), href: z.string() });

// English: the full definition of each project, including demos.
const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects/en" }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string(), // shown under the title on the project page
    summary: z.string(), // shown in the list on the main page
    order: z.number(), // position on the main page and in "Next project"
    period: z.string(),
    badge: z.string().optional(),
    facts: z.array(fact),
    links: z.array(link).default([]),
    notice: z.string().optional(),
    replay: replay.optional(), // one conversation shown above the write-up
    // Conversations placed inside the write-up. Put <div data-example="name"></div> on its own
    // line in the Markdown (English and Japanese) where each should appear.
    replays: z.record(z.string(), replay).optional(),
    demo: z.enum(["asr-correction"]).optional(),
    heroMedia: z.string().optional(), // placeholder text for a figure or video slot above the article
    draft: z.boolean().default(false), // true hides the project everywhere
  }),
});

// Japanese: same file name as the English version. Only text is translated here; order,
// demos, and conversation replays come from the English file and stay in English.
// If a Japanese file is missing, the Japanese site shows the English page with a note.
const projectsJa = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects/ja" }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string(),
    summary: z.string(),
    period: z.string().optional(),
    badge: z.string().optional(),
    facts: z.array(fact).optional(),
    links: z.array(link).optional(),
    notice: z.string().optional(),
    heroMedia: z.string().optional(),
  }),
});

export const collections = { projects, projectsJa };
