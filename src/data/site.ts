// Everything on the main page that isn't a project or a publication lives here.
// Publications live in publications.json; projects in src/content/projects/{en,ja}/*.md.
import type { Lang } from "../i18n/ui";

export const profile = {
  name: "Yuya Asano", // used to bold your name in author lists
  email: "yuya.asano47@gmail.com",
  // From the CV. The first link is the dark primary button. Labels are translated below.
  links: [
    { key: "cv", href: "/CV_YuyaAsano.pdf" },
    { key: "github", href: "https://github.com/akonoroshi" },
    { key: "scholar", href: "https://scholar.google.com/citations?user=0k3K65YAAAAJ&hl=en" },
    { key: "linkedin", href: "https://www.linkedin.com/in/yuya-asano-441373124/" },
    { key: "chat", href: "/" }, // the home page is the chat; on the portfolio page this opens it in place
  ],
} as const;

type LinkKey = (typeof profile.links)[number]["key"];
type Row = { org: string; role: string; desc: string; date: string };
type SiteText = {
  displayName: string;
  role: string;
  photoAlt: string;
  statement: string;
  lede: string[];
  linkLabels: Record<LinkKey, string>;
  experience: Row[];
  education: Row[];
};

export const text: Record<Lang, SiteText> = {
  en: {
    displayName: "Yuya Asano",
    role: "PhD candidate in Intelligent Systems, University of Pittsburgh",
    photoAlt: "Portrait of Yuya Asano",
    statement: "I build conversational AI that people learn with.",
    lede: [
      "I design, build, and evaluate LLM systems, from agent harnesses for multi-turn dialogue to LLM-as-judge evaluation pipelines and LLM features shipped in industry. At Pitt I built the LLM agent behind Emma, a teachable robot that students teach math to. At SigIQ.ai I built an LLM and retrieval pipeline and shipped a mastery model for a K-12 math tutor. I’m now building an AI learning companion for adults preparing for professional exams.",
      "Finishing my PhD in May 2027 and open to applied scientist, research scientist, and ML engineer roles.",
    ],
    linkLabels: { cv: "CV (PDF)", github: "GitHub", scholar: "Google Scholar", linkedin: "LinkedIn", chat: "Talk to my AI companion" },
    experience: [
      { org: "SigIQ.ai", role: "Machine learning intern", date: "May – Aug 2026",
        desc: "Built a two-stage LLM and retrieval pipeline that labels math lessons with the Common Core standards they cover (+.19–.33 macro F1 over the existing baseline), and shipped a Beta-Bernoulli mastery model as a teacher-facing feature." },
      { org: "Jackson State University", role: "NLP research intern", date: "May – Aug 2025",
        desc: "Proposed retrieval-augmented generation that tailors grading rubrics to students’ oral and written answers, and prototyped grading APIs on AWS with LangChain and Docker." },
      { org: "Educational Testing Service (ETS)", role: "Ida Lawrence Research Intern", date: "Jun – Aug 2024",
        desc: "Automated scoring of how well teachers lead classroom discussions with GPT-4o. Better task formulation raised correlation with human raters by .12–.28." },
      { org: "Alexa Prize TaskBot Challenge 2", role: "Team ISABEL", date: "2023",
        desc: "Context-aware speech recognition correction that tripled correction recall. Third place." },
      { org: "University of Pittsburgh", role: "Graduate research assistant", date: "2022 – now",
        desc: "Built the LLM agent harness behind Emma and study infrastructure for lab and classroom studies. Advised by Diane Litman." },
      { org: "Carnegie Mellon University", role: "Research intern", date: "2020 – 2021",
        desc: "Clustered student code to deliver programming hints, and prototyped an instructor dashboard that summarizes student reflections." },
      { org: "University of Toronto", role: "Undergraduate research assistant", date: "2019 – 2021",
        desc: "Built a reinforcement learning system that personalized feedback on online learning platforms, and ran field experiments in a live course." },
    ],
    education: [
      { org: "University of Pittsburgh", role: "PhD, Intelligent Systems", desc: "Advised by Diane Litman. GPA 3.85.", date: "2021 – 2027" },
      { org: "University of Toronto", role: "Honours BSc, Computer Science", desc: "AI focus. GPA 3.97.", date: "2018 – 2021" },
    ],
  },

  ja: {
    displayName: "浅野 裕哉 (Yuya Asano)",
    role: "ピッツバーグ大学 Intelligent Systems Program 博士候補生",
    photoAlt: "浅野裕哉の写真",
    statement: "人がAIと共に学ぶ時代へ",
    lede: [
      "マルチターン対話のためのエージェントハーネスから、LLM-as-judgeによる評価パイプライン、企業で提供されるLLM機能まで、LLMシステムの設計・開発・評価に取り組んでいます。ピッツバーグ大学では、生徒が算数・数学を教えるティーチャブル・ロボット「Emma」のLLMエージェントを開発しました。SigIQ.aiでは、米国の小中高生（K-12）向け数学チューターのために、LLMと検索を組み合わせたパイプラインを構築し、習熟度推定モデルを製品機能として提供しました。現在は、資格試験の勉強をする社会人のためのAI学習コンパニオンを開発しています。",
      "2027年5月に博士号を取得予定です。Applied Scientist、Research Scientist、ML Engineerのポジションを探しています。",
    ],
    linkLabels: { cv: "CV（英語・PDF）", github: "GitHub", scholar: "Google Scholar", linkedin: "LinkedIn", chat: "AIコンパニオンと話す" },
    experience: [
      { org: "SigIQ.ai", role: "機械学習インターン", date: "2026年5月〜8月",
        desc: "数学の授業コンテンツに、対応する米国の共通学力基準（Common Core）を付与する、LLMと検索による2段階のパイプラインを構築し、既存手法と比べてマクロF1を.19〜.33改善しました。また、Beta-Bernoulliモデルによる習熟度推定を教師向けの機能として提供しました。" },
      { org: "Jackson State University", role: "NLPリサーチインターン", date: "2025年5月〜8月",
        desc: "生徒の口頭・記述の回答に合わせて採点ルーブリックを調整する、検索拡張生成（RAG）の手法を提案し、AWS、LangChain、Dockerで採点APIのプロトタイプを開発しました。" },
      { org: "Educational Testing Service（ETS）", role: "リサーチインターン", date: "2024年6月〜8月",
        desc: "教師が授業で一貫した議論を進められているかを、GPT-4oで自動採点しました。タスクの定式化を工夫することで、人間の評価者との相関を.12〜.28向上させました。" },
      { org: "Alexa Prize TaskBot Challenge 2", role: "チームISABEL", date: "2023年",
        desc: "文脈を活用した音声認識の誤り訂正手法を開発し、訂正の再現率を約3倍に向上させました。チームは3位に入賞しました。" },
      { org: "ピッツバーグ大学", role: "リサーチアシスタント", date: "2022年〜現在",
        desc: "EmmaのLLMエージェントハーネスと、実験室・教室での研究を支えるシステム基盤を開発しました。指導教員はDiane Litmanです。" },
      { org: "カーネギーメロン大学", role: "リサーチインターン", date: "2020年〜2021年",
        desc: "学生のプログラムをクラスタリングしてヒントを提供する手法と、学生の振り返りを要約する教員向けダッシュボードのプロトタイプを開発しました。" },
      { org: "トロント大学", role: "リサーチアシスタント", date: "2019年〜2021年",
        desc: "オンライン学習プラットフォームでフィードバックを個別化する強化学習システムを構築し、実際の授業でフィールド実験を行いました。" },
    ],
    education: [
      { org: "ピッツバーグ大学", role: "博士課程（Intelligent Systems）", desc: "指導教員：Diane Litman。GPA 3.85。", date: "2021年〜2027年（予定）" },
      { org: "トロント大学", role: "学士（コンピュータサイエンス）", desc: "AI専攻。GPA 3.97。", date: "2018年〜2021年" },
    ],
  },
};
