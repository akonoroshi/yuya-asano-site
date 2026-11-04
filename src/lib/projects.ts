// Returns the projects for a language. Japanese entries are merged over the English ones,
// so anything not translated (order, demos, replays) comes from the English file.
import { getCollection, type CollectionEntry } from "astro:content";
import type { Lang } from "../i18n/ui";

export type ProjectData = CollectionEntry<"projects">["data"];
export type LocalizedProject = {
  id: string;
  data: ProjectData;
  entry: CollectionEntry<"projects"> | CollectionEntry<"projectsJa">; // the Markdown body to render
  isFallback: boolean; // true when a Japanese page falls back to the English text
};

const defined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

export async function getProjects(lang: Lang): Promise<LocalizedProject[]> {
  const en = (await getCollection("projects", ({ data }) => !data.draft)).sort((a, b) => a.data.order - b.data.order);
  if (lang === "en") return en.map((e) => ({ id: e.id, data: e.data, entry: e, isFallback: false }));

  const ja = new Map((await getCollection("projectsJa")).map((e) => [e.id, e]));
  return en.map((e) => {
    const t = ja.get(e.id);
    return t
      ? { id: e.id, data: { ...e.data, ...defined(t.data) }, entry: t, isFallback: false }
      : { id: e.id, data: e.data, entry: e, isFallback: true };
  });
}
