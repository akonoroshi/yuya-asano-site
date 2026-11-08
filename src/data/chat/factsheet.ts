// Always included in the LLM's system prompt, together with the passages retrieved for the
// question. Built from src/data/site.ts, so the chat and the portfolio page can't disagree:
// edit your profile, experience, and education there, not here.
import { profile, text } from "../site.ts";
import type { Lang } from "../../lib/chat/types.ts";

const labels: Record<Lang, Record<string, string>> = {
  en: { name: "Name", now: "Now", about: "About (in Yuya's own words)", experience: "Experience", education: "Education", contact: "Contact", links: "Links" },
  ja: { name: "氏名", now: "現在", about: "概要（本人の言葉）", experience: "職歴", education: "学歴", contact: "連絡先", links: "リンク" },
};

function build(lang: Lang): string {
  const s = text[lang];
  const l = labels[lang];
  const rows = (items: { org: string; role: string; desc: string; date: string }[]) =>
    items.map((x) => `- ${x.org}, ${x.role} (${x.date}): ${x.desc}`).join("\n");
  const links = profile.links
    .filter((x) => x.key !== "chat")
    .map((x) => `${s.linkLabels[x.key]}: ${x.href}`)
    .join("\n");
  return [
    `${l.name}: ${s.displayName}`,
    `${l.now}: ${s.role}`,
    `${l.about}: ${s.statement} ${s.lede.join(" ")}`,
    `${l.experience}:\n${rows(s.experience)}`,
    `${l.education}:\n${rows(s.education)}`,
    `${l.contact}: ${profile.email}`,
    `${l.links}:\n${links}`,
  ].join("\n");
}

export const factsheet: Record<Lang, string> = { en: build("en"), ja: build("ja") };
