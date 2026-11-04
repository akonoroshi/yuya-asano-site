import { ui, defaultLang, awardLabels, type Lang, type UIKey } from "./ui";

/** t("allPapers", { n: 13, f: 10 }) -> "All 13 papers (10 first-author)" */
export function useTranslations(lang: Lang) {
  return (key: UIKey, vars: Record<string, string | number> = {}) => {
    const s = ui[lang][key];
    if (s === undefined) throw new Error(`Missing "${lang}" translation for "${key}" in src/i18n/ui.ts`);
    return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
  };
}

/** localePath("ja", "/projects/emma-agent/") -> "/ja/projects/emma-agent/" */
export const localePath = (lang: Lang, path: string) => (lang === defaultLang ? path : `/${lang}${path}`);

export const otherLang = (lang: Lang): Lang => (lang === "en" ? "ja" : "en");

export const awardLabel = (lang: Lang, award: string) => awardLabels[lang][award] ?? award;
