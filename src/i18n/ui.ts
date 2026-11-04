// Interface text in both languages. Every key in `en` must exist in `ja`
// (TypeScript flags a missing one, and the build throws if one slips through).

export const languages = { en: "English", ja: "日本語" } as const;
export type Lang = keyof typeof languages;
export const defaultLang: Lang = "en";

const en = {
  selectedWork: "Selected work",
  experience: "Experience",
  recentPapers: "Recent first-author papers",
  education: "Education",
  copyEmail: "Copy email",
  copied: "Copied",
  allPapers: "All {n} papers ({f} first-author)",
  publications: "Publications",
  pubsSummary: "{n} papers, {f} as first author.",
  pubsDescription: "All papers by {name}.",
  undated: "Undated",
  code: "Code",
  preprint: "Preprint",
  nextProject: "Next project",
  footerWork: "Home",
  footerEmail: "Email",
  fallbackNotice: "This page is only available in English.",
  switchLabel: "Read this page in Japanese",
  contactNav: "Contact and profiles",
};

const ja: Record<keyof typeof en, string> = {
  selectedWork: "主なプロジェクト",
  experience: "職歴",
  recentPapers: "最近の筆頭著者論文",
  education: "学歴",
  copyEmail: "メールアドレスをコピー",
  copied: "コピーしました",
  allPapers: "論文一覧（全{n}本、うち筆頭著者{f}本）",
  publications: "論文一覧",
  pubsSummary: "論文{n}本（うち筆頭著者{f}本）",
  pubsDescription: "{name}の論文一覧です。",
  undated: "年不明",
  code: "コード",
  preprint: "プレプリント",
  nextProject: "次のプロジェクト",
  footerWork: "ホーム",
  footerEmail: "メール",
  fallbackNotice: "このページは英語のみです。",
  switchLabel: "このページを英語で読む",
  contactNav: "連絡先とプロフィール",
};

export const ui = { en, ja };
export type UIKey = keyof typeof en;

/** Award labels in publications.json are in English; these are shown on Japanese pages. */
export const awardLabels: Record<Lang, Record<string, string>> = {
  en: {},
  ja: { "Best poster": "最優秀ポスター賞", "Best paper": "最優秀論文賞" },
};
