// Curated questions and answers. These are answered in the browser with no LLM call, so this
// file is where most visitor questions should end up. The loop:
//   1. Read the Worker logs for questions that went to the LLM ("chat_llm" events).
//   2. Add frequent ones here, with a few hand-written phrasings per language.
//   3. Run `npm run chat:paraphrase` to generate more phrasings, then review them in paraphrases.json.
//
// The first question in each language is the one shown in "Did you mean …?" and in the
// "You asked" line when a chip is picked.
// Chips are a topic tree. `startChips` are the top-level topics shown before the first question.
// After an answer, the chips go one level deeper (the topic's `children`); when a topic has no
// unanswered children, they offer its unanswered siblings, then its parent's siblings, and so on.
// A topic may be listed under two parents (speech recognition correction is under both Research
// highlights and How this chat works); going back up then follows the way the visitor came.
// After an LLM answer, the "topic" is the curated answer the retrieval step found most related.
// Every state except the start also gets a "Something else" chip that returns to the start chips.
// Keep chip labels short (about 2–4 words) so several fit on one row over the character.
// Links starting with "/" get "/ja" prepended on the Japanese page.
// Answers are based on src/data/site.ts and the project pages. When those change, update the
// matching answers here too (and rerun `npm run chat:index` so the LLM sees the new text).
// Answers carry behavior tags for the character (see src/lib/chat/tags.ts): [emo:<emotion>:<0-1>]
// from that point on, and [act:<gesture>] at that point. Each answer starts with an emotion and
// an act. The build fails on an unknown tag; tags never appear on screen or in the index.

type L10n = { en: string; ja: string };

export interface FaqEntry {
  id: string;
  /** Short label when this entry is offered as a chip. Entries without one are never chips. */
  chip?: L10n;
  /** Subtopics, in chip order. A topic can be listed under at most two parents. */
  children?: string[];
  questions: { en: string[]; ja: string[] };
  /** Questions asked of Shino herself, where "you" means her ("How do you work?"). Matched like
   *  the questions, but never turned into "he"/"Yuya" versions (see variants.ts). */
  toShino?: { en: string[]; ja: string[] };
  answer: L10n;
  /** Other phrasings of a short conversational answer (greetings, thanks), picked so the same
   *  line isn't said twice in a row. Not for factual answers: those stay a single, checked text. */
  alternatives?: { en: string[]; ja: string[] };
  links?: { label: L10n; href: string }[];
}

// Ordered for what visitors check first: who Yuya is and his level and availability, then
// evidence of impact, then work history, then the chat itself as a live demo.
export const startChips = ["about", "highlights", "experience", "chat-how"];

// Topics where "you" means Shino, not Yuya ("Who are you?", "Nice to meet you"). Every other
// English phrasing gets "he" and "Yuya" versions at build time (src/lib/chat/variants.ts),
// so add a topic here if you write one that's addressed to Shino.
export const shinoTopics = ["who", "greeting", "thanks", "ack", "farewell", "capabilities", "privacy", "accuracy", "language"];

// Starting chips for the chat opened from the corner character on specific pages (up to four),
// so visitors start with questions about what they're reading. Keys are "project:<file name>"
// and "publications". Pages not listed here (the portfolio, the 404 page) use startChips.
// These starting chips always come with "Something else", which leads to startChips.
export const pageChips: Record<string, string[]> = {
  // Project pages start one level down: the project's subtopics, the same chips as in the tree.
  "project:emma-agent": ["emma-llm", "emma-why", "emma-hard", "emma-study"],
  "project:emma-pairs": ["pairs-lexical", "pairs-conflict", "pairs-data"],
  "project:asr-correction": ["asr-rerank", "asr-sound", "asr-users"],
  "project:learning-companion": ["companion-teach", "companion-ik"],
  "project:student-solutions": ["emnlp-why", "emnlp-method"],
  publications: ["highlights", "asr", "emnlp", "pairs-lexical"],
};

export const faq: FaqEntry[] = [
  {
    id: "about",
    chip: { en: "About Yuya", ja: "浅野について" },
    children: ["research", "dissertation", "companion", "roles"],
    questions: {
      en: ["Tell me about Yuya", "Who is Yuya Asano?", "Introduce Yuya", "Give me a quick intro"],
      ja: ["浅野さんについて教えて", "浅野さんはどんな人ですか", "自己紹介してください", "簡単に紹介してください"],
    },
    answer: {
      en: "[emo:happy:0.6][act:confident_claim]Yuya Asano is a PhD candidate in Intelligent Systems at the University of Pittsburgh, advised by Diane Litman, finishing in May 2027. He designs, builds, and evaluates LLM systems, from agent harnesses for multi-turn dialogue to LLM-as-judge evaluation pipelines and LLM features shipped in industry. [emo:happy:0.7][act:beat]He's open to applied scientist, research scientist, and ML engineer roles.",
      ja: "[emo:happy:0.6][act:confident_claim]浅野はピッツバーグ大学 Intelligent Systems Program の博士候補生で、Diane Litman の指導のもと、2027年5月に博士号を取得予定です。マルチターン対話のためのエージェントハーネスから、LLM-as-judgeによる評価パイプライン、企業で提供されるLLM機能まで、LLMシステムの設計・開発・評価に取り組んでいます。[emo:happy:0.7][act:beat]Applied Scientist、Research Scientist、ML Engineerのポジションを探しています。",
    },
    links: [{ label: { en: "CV", ja: "CV（英語）" }, href: "/CV_YuyaAsano.pdf" }],
  },
  {
    id: "highlights",
    chip: { en: "Research highlights", ja: "研究の成果" },
    children: ["emma", "pairs", "asr", "emnlp"],
    questions: {
      en: ["What are your research highlights?", "What are your main achievements?", "What have you accomplished?", "What are your publications?"],
      ja: ["研究の成果を教えて", "主な実績は何ですか", "これまでに何を達成しましたか", "どんな論文がありますか"],
    },
    answer: {
      en: "[emo:happy:0.8][act:co_celebrate]On team ISABEL, third place in the Alexa Prize TaskBot Challenge 2, Yuya's context-aware speech recognition correction raised correction recall from .18 to .54 over a named-entity baseline in offline evaluation (COLING 2025, Industry Track). [act:confident_claim]His EMNLP 2025 paper shows that LLMs don't solve math the way real students do. [emo:happy:0.6]His LLM agent for the teachable robot Emma is in an IRB-approved controlled study with 72 participants.",
      ja: "[emo:happy:0.8][act:co_celebrate]Alexa Prize TaskBot Challenge 2で3位となったチームISABELで、文脈を活用した音声認識の誤り訂正手法を開発し、オフライン評価で、固有表現ベースの手法と比べて訂正の再現率を.18から.54に向上させました（COLING 2025 Industry Track）。[act:confident_claim]EMNLP 2025の論文では、LLMの解き方が実際の生徒とは異なることを示しました。[emo:happy:0.6]ティーチャブル・ロボット「Emma」のLLMエージェントは、IRB承認済みの72名の統制実験で使われています。",
    },
    links: [{ label: { en: "Speech recognition correction", ja: "音声認識の誤り訂正" }, href: "/projects/asr-correction/" }, { label: { en: "LLMs vs. students", ja: "LLMと生徒の解き方" }, href: "/projects/student-solutions/" }, { label: { en: "Emma (LLM agent)", ja: "Emma（LLMエージェント）" }, href: "/projects/emma-agent/" }],
  },
  {
    id: "experience",
    chip: { en: "Experience & skills", ja: "経験とスキル" },
    // Up to four chips show at a time; the rest appear as these are answered, in this order.
    children: ["sigiq", "ets", "llm-experience", "skills", "production", "jsu"],
    questions: {
      en: ["What experience do you have?", "Tell me about your experience", "What are your experience and skills?", "What is your work experience?", "Where have you interned?", "Do you have industry experience?", "Where have you worked?", "Internships"],
      ja: ["経験を教えてください", "どんな経験がありますか", "職歴を教えて", "経験とスキルを教えてください", "どこでインターンをしましたか", "職務経験を教えて", "企業での経験はありますか", "どこで働いたことがありますか", "インターン経験"],
    },
    answer: {
      en: "[emo:happy:0.7][act:confident_claim]Yuya was a machine learning intern at SigIQ.ai in 2026, an NLP research intern at Jackson State University in 2025, and an Ida Lawrence Research Intern at Educational Testing Service (ETS) in 2024. [act:beat]Before his PhD, he did research at Carnegie Mellon University and the University of Toronto. Most of his recent work is building and evaluating LLM systems, in research and in industry.",
      ja: "[emo:happy:0.7][act:confident_claim]浅野は2026年にSigIQ.aiで機械学習インターン、2025年にジャクソン州立大学でNLPリサーチインターン、2024年にEducational Testing Service（ETS）でリサーチインターンを経験しました。[act:beat]博士課程の前には、カーネギーメロン大学とトロント大学で研究に携わりました。最近は、研究と企業の両方でLLMシステムの開発と評価に取り組んでいます。",
    },
  },
  {
    id: "ets",
    chip: { en: "ETS internship", ja: "ETSでのインターン" },
    questions: {
      en: ["What did you do at ETS?", "Tell me about your ETS internship", "What did you work on at Educational Testing Service?"],
      ja: ["ETSでは何をしましたか", "ETSでのインターンについて教えて", "Educational Testing Serviceでは何に取り組みましたか"],
    },
    answer: {
      en: "[emo:focused:0.5][act:confident_claim]At ETS (June to August 2024), as an Ida Lawrence Research Intern, Yuya automated scoring of how well teachers lead classroom discussions with GPT-4o. [emo:happy:0.6]Better task formulation raised correlation with human raters by .12 to .28.",
      ja: "[emo:focused:0.5][act:confident_claim]ETS（2024年6月〜8月）では、教師が授業で一貫した議論を進められているかを、GPT-4oで自動採点しました。[emo:happy:0.6]タスクの定式化を工夫することで、人間の評価者との相関を.12〜.28向上させました。",
    },
  },
  {
    id: "jsu",
    chip: { en: "Jackson State internship", ja: "ジャクソン州立大学" },
    questions: {
      en: ["What did you do at Jackson State?", "Tell me about your Jackson State University internship"],
      ja: ["ジャクソン州立大学では何をしましたか", "ジャクソン州立大学でのインターンについて教えて"],
    },
    answer: {
      en: "[emo:focused:0.5][act:confident_claim]At Jackson State University (May to August 2025), Yuya proposed retrieval-augmented generation that tailors grading rubrics to students' oral and written answers, and prototyped grading APIs on AWS with LangChain and Docker.",
      ja: "[emo:focused:0.5][act:confident_claim]ジャクソン州立大学（2025年5月〜8月）では、生徒の口頭・記述の回答に合わせて採点ルーブリックを調整する、検索拡張生成（RAG）の手法を提案し、AWS、LangChain、Dockerで採点APIのプロトタイプを開発しました。",
    },
  },
  {
    id: "research",
    chip: { en: "Research interests", ja: "研究テーマ" },
    questions: {
      en: ["What are your research interests?", "What do you research?", "What is your research about?", "What do you work on?"],
      ja: ["研究テーマは何ですか", "どんな研究をしていますか", "研究内容を教えてください", "何を研究していますか"],
    },
    answer: {
      en: "[emo:happy:0.6][act:confident_claim]Yuya works on conversational AI for education. His main topic is teachable agents: AI that students learn from by teaching it, like his agent Emma. [act:beat]He also studies how students talk with these agents, whether LLMs can stand in for real students, and how to make spoken dialogue systems robust to speech recognition errors.",
      ja: "[emo:happy:0.6][act:confident_claim]浅野は教育のための対話AIを研究しています。中心となるテーマは、学習者がAIに教えることで学ぶティーチャブルエージェントで、Emmaというエージェントを開発しています。[act:beat]ほかにも、学習者がこうしたエージェントとどのように話すか、LLMが実際の学習者の代わりになるか、音声認識の誤りに強い音声対話システムをどう作るか、といったテーマに取り組んでいます。",
    },
  },
  {
    id: "chat-how",
    chip: { en: "How this chat works", ja: "このチャットの仕組み" },
    children: ["asr", "chat-cost", "chat-stack", "privacy"],
    questions: {
      en: ["How does this chat work?", "How is this AI implemented?", "How did you build this chatbot?", "Is this ChatGPT?"],
      ja: ["このチャットはどういう仕組みですか", "このAIはどう実装されていますか", "このチャットボットはどう作りましたか", "これはChatGPTですか"],
    },
    toShino: {
      en: ["How do you work?", "How were you built?", "How do you answer questions?", "Where do your answers come from?", "How do you know about Yuya?", "Are you ChatGPT?", "Do you use an LLM?"],
      ja: ["しのはどういう仕組みですか", "どういう仕組みで答えていますか", "あなたはどうやって作られたのですか", "答えはどこから来ていますか", "浅野のことをどうやって知っているのですか", "あなたはChatGPTですか"],
    },
    answer: {
      en: "[emo:happy:0.7][act:confident_claim]Most questions here never reach a language model. Suggested questions and close matches to curated ones are answered right in your browser. [emo:focused:0.5][act:beat]New questions go to a server that retrieves passages from Yuya's pages and papers, and a language model answers only from those passages.",
      ja: "[emo:happy:0.7][act:confident_claim]ここでの質問の多くは、言語モデルを使わずに答えています。おすすめの質問や、用意された質問に近いものは、ブラウザの中でそのまま回答します。[emo:focused:0.5][act:beat]新しい質問だけがサーバーに送られ、浅野のページや論文から関連する箇所を検索したうえで、言語モデルがその内容だけをもとに答えます。",
    },
  },
  {
    // Not a chip: How this chat works -> Speech recognition correction covers it. Still answers typed questions.
    id: "chat-voice",
    questions: {
      en: ["How does voice input work?", "How do you handle speech recognition errors?", "Can I talk to you?"],
      ja: ["音声入力はどういう仕組みですか", "音声認識の誤りにはどう対応していますか", "話しかけてもいいですか"],
    },
    toShino: {
      en: ["Can you hear me?", "Do you understand speech?", "How do you understand what I say?", "Can I talk to you out loud?"],
      ja: ["声は聞こえますか", "話した言葉をどうやって理解しているのですか", "声で話しかけてもいいですか"],
    },
    answer: {
      en: "[emo:relaxed:0.6][act:confident_claim]Your browser transcribes what you say. [emo:concerned:0.3][act:beat]Recognizers often mishear names like SigIQ, so the site also compares what it heard with likely questions by sound, using the method from Yuya's Alexa Prize work, and asks you to confirm before answering.",
      ja: "[emo:relaxed:0.6][act:confident_claim]話した内容はブラウザが文字に変換します。[emo:concerned:0.3][act:beat]音声認識はSigIQのような名前をよく聞き間違えるので、このサイトでは聞き取った内容を音の近さで想定される質問と照合し、回答する前に確認します。浅野がAlexa Prizeで開発した手法を使っています。",
    },
  },
  {
    id: "chat-cost",
    chip: { en: "Keeping LLM calls low", ja: "LLMの呼び出しを減らす工夫" },
    questions: {
      en: ["How do you keep the cost down?", "How do you limit LLM calls?", "Does every question call an LLM?"],
      ja: ["コストはどう抑えていますか", "LLMの呼び出しをどう減らしていますか", "すべての質問でLLMを使っていますか"],
    },
    toShino: {
      en: ["How much do you cost to run?", "Do you call an LLM for every question?"],
      ja: ["あなたを動かすのにいくらかかりますか", "毎回LLMを呼び出していますか"],
    },
    answer: {
      en: "[emo:focused:0.6][act:confident_claim]Because the site is public, it's built to call the language model as rarely as possible. Free matching in the browser comes first, then a cheap similarity check turns away off-topic questions, and rate limits plus a daily cap stop runaway use. [emo:happy:0.6][act:beat]Yuya reviews new questions and adds frequent ones as curated answers.",
      ja: "[emo:focused:0.6][act:confident_claim]公開サイトなので、言語モデルの呼び出しをできるだけ減らす設計にしています。まずブラウザ内の無料の照合で答え、次に軽い類似度チェックで関係のない質問を断り、さらに利用回数の制限と1日の上限で使いすぎを防いでいます。[emo:happy:0.6][act:beat]よく来る新しい質問は浅野が確認し、用意された回答に加えています。",
    },
  },
  {
    id: "chat-stack",
    chip: { en: "Tech stack", ja: "技術スタック" },
    questions: {
      en: ["What is the tech stack?", "What did you use to build this site?", "Which model do you use?"],
      ja: ["技術スタックは何ですか", "このサイトは何で作られていますか", "どのモデルを使っていますか"],
    },
    toShino: {
      en: ["What model are you?", "Which model are you?", "What are you built with?", "What do you run on?"],
      ja: ["あなたは何のモデルですか", "どのAIを使っていますか", "何で作られていますか"],
    },
    answer: {
      en: "[emo:focused:0.5][act:confident_claim]The site is built with Astro and runs on Cloudflare Workers. Voice input uses the browser's built-in speech recognition, on the device when the browser supports it, and matching by sound uses CMUdict for English and kuromoji for Japanese. Retrieval uses Workers AI embeddings and Vectorize, with Gemini as the main model and a Workers AI model as a backup. [emo:happy:0.7][act:beat]The character is a VRM model.",
      ja: "[emo:focused:0.5][act:confident_claim]サイトはAstroで作られ、Cloudflare Workersで動いています。音声入力にはブラウザ内蔵の音声認識を使い（対応するブラウザでは端末内で処理します）、音による照合には英語でCMUdict、日本語でkuromojiを使っています。検索にはWorkers AIの埋め込みとVectorizeを使い、回答には主にGemini、予備としてWorkers AIのモデルを使っています。[emo:happy:0.7][act:beat]キャラクターはVRMモデルです。",
    },
  },
  {
    id: "dissertation",
    chip: { en: "Dissertation in 30 seconds", ja: "博士研究を30秒で" },
    questions: {
      en: ["Explain your dissertation in 30 seconds", "What is your dissertation about?", "What is your PhD about?"],
      ja: ["博士研究を30秒で説明して", "博士論文のテーマは何ですか", "博士課程では何をしていますか"],
    },
    answer: {
      en: "[emo:happy:0.6][act:confident_claim]Yuya studies teachable agents: AI that students learn from by teaching it. His main system is Emma, a robot that students teach math to. [act:beat]He has studied Emma in two settings: pairs of students teaching her together, and one student teaching an LLM-based Emma, which is now in a controlled study with 72 participants.",
      ja: "[emo:happy:0.6][act:confident_claim]浅野は、生徒がAIに教えることで学ぶ「ティーチャブル・エージェント」を研究しています。中心となるのは、生徒が算数・数学を教えるロボット「Emma」です。[act:beat]2人の生徒が一緒にEmmaに教える場面と、1人の生徒がLLMベースのEmmaに教える場面の2つで研究しており、後者は現在72名が参加する統制実験で使われています。",
    },
    links: [{ label: { en: "Emma (LLM agent)", ja: "Emma（LLMエージェント）" }, href: "/projects/emma-agent/" }, { label: { en: "Pairs teaching Emma", ja: "2人で教える研究" }, href: "/projects/emma-pairs/" }],
  },
  {
    id: "sigiq",
    chip: { en: "SigIQ internship", ja: "SigIQでのインターン" },
    questions: {
      en: ["What did you build at SigIQ?", "What did you do at SigIQ?", "Tell me about your SigIQ internship"],
      ja: ["SigIQでは何を作りましたか？", "SigIQでは何をしていましたか", "SigIQでのインターンについて教えて"],
    },
    answer: {
      en: "[emo:focused:0.5][act:confident_claim]At SigIQ.ai (May to August 2026), Yuya built a two-stage LLM and retrieval pipeline that labels math lessons with the Common Core standards they cover, improving macro F1 by .19 to .33 over the existing baseline. [emo:happy:0.6][act:beat]He also shipped a Beta-Bernoulli mastery model as a teacher-facing feature of a K-12 math tutor.",
      ja: "[emo:focused:0.5][act:confident_claim]SigIQ.ai（2026年5月〜8月）では、数学の授業コンテンツに、対応する米国の共通学力基準（Common Core）を付与する、LLMと検索による2段階のパイプラインを構築し、既存手法と比べてマクロF1を.19〜.33改善しました。[emo:happy:0.6][act:beat]また、K-12向け数学チューターで、Beta-Bernoulliモデルによる習熟度推定を教師向けの機能として提供しました。",
    },
  },
  {
    // Not a chip: each project branch leads to the page with its demo. Still answers typed questions.
    id: "demo",
    questions: {
      en: ["Show me a demo", "Do you have any demos?", "Can I try something?"],
      ja: ["デモを見せて", "デモはありますか", "何か試せるものはありますか"],
    },
    answer: {
      en: "[emo:happy:0.7][act:material_reference]Two project pages have interactive demos: replays of students teaching Emma, and a walkthrough of how Yuya's method corrects speech recognition errors.",
      ja: "[emo:happy:0.7][act:material_reference]2つのプロジェクトページにインタラクティブなデモがあります。学習者がEmmaに教える会話のリプレイと、音声認識の誤りを訂正する手法のデモです。",
    },
    links: [{ label: { en: "Emma conversation", ja: "Emmaとの会話" }, href: "/projects/emma-agent/" }, { label: { en: "Pairs teaching Emma", ja: "2人で教える会話" }, href: "/projects/emma-pairs/" }, { label: { en: "Speech recognition demo", ja: "音声認識デモ" }, href: "/projects/asr-correction/" }],
  },
  {
    id: "roles",
    chip: { en: "Job search", ja: "仕事探し" },
    children: ["visa", "contact"],
    questions: {
      en: ["Are you open to roles?", "Are you looking for a job?", "When do you graduate?", "What kind of roles are you looking for?"],
      ja: ["求職中ですか？", "仕事を探していますか", "いつ卒業しますか", "どんな職種を希望していますか"],
    },
    answer: {
      en: "[emo:happy:0.8][act:ack]Yes. [act:confident_claim]Yuya finishes his PhD in May 2027 and is open to applied scientist, research scientist, and ML engineer roles, in the Bay Area or remote. [emo:happy:0.6][act:beat]Email is the best way to reach him: yuya.asano47@gmail.com.",
      ja: "[emo:happy:0.8][act:ack]はい。[act:confident_claim]浅野は2027年5月に博士号を取得予定で、ベイエリアまたはリモートで、Applied Scientist、Research Scientist、ML Engineerのポジションを探しています。[emo:happy:0.6][act:beat]連絡はメールが確実です：yuya.asano47@gmail.com。",
    },
    links: [{ label: { en: "CV", ja: "CV（英語）" }, href: "/CV_YuyaAsano.pdf" }],
  },
  {
    id: "emma-llm",
    chip: { en: "How Emma responds", ja: "Emmaの応答の仕組み" },
    questions: {
      en: ["How does Emma decide what to say?", "How does the LLM version of Emma work?", "How does Emma talk with students?"],
      ja: ["Emmaは何を話すかをどう決めていますか", "LLM版のEmmaはどう動いていますか", "Emmaは学習者とどう会話しますか"],
    },
    answer: {
      en: "[emo:focused:0.6][act:confident_claim]As a student explains a solution, Emma matches it to a verified solution or asks a clarifying question. She then introduces a verified alternative and asks which approach to follow, goes through the steps tracking what, how, and why for each, and finally reflects back both solutions and asks which works better on a slightly different problem. [act:beat]Each LLM call returns one JSON object with both her judgment and what she says next.",
      ja: "[emo:focused:0.6][act:confident_claim]生徒が解き方を説明すると、Emmaはそれを検証済みの解法と照合するか、確認の質問をします。次に検証済みの別解を示してどちらで進めるかを尋ね、各ステップの「何を・どうやって・なぜ」を追いながら解き進め、最後に両方の解き方を振り返って、少し違う問題ではどちらが有効かを尋ねます。[act:beat]LLMの各呼び出しは、Emmaの判断と次の発話の両方を含む1つのJSONを返します。",
    },
    links: [{ label: { en: "Project page", ja: "プロジェクトページ" }, href: "/projects/emma-agent/" }],
  },
  {
    id: "asr",
    chip: { en: "Speech recognition correction", ja: "音声認識の誤り訂正" },
    children: ["asr-rerank", "asr-sound", "asr-users"],
    questions: {
      en: ["What was your Alexa Prize project?", "Tell me about your speech recognition work", "What is your ASR correction paper about?"],
      ja: ["Alexa Prizeでは何をしましたか", "音声認識の研究について教えて", "ASR訂正の論文は何についてですか"],
    },
    answer: {
      en: "[emo:happy:0.7][act:co_celebrate]On team ISABEL in the Alexa Prize TaskBot Challenge 2, which placed third, Yuya was first author on context-aware speech recognition correction. [emo:focused:0.6][act:confident_claim]It re-ranks the recognizer's guesses against what the assistant expects the user to say, and matches by sound when no guess is right. In offline evaluation against a named-entity baseline, correction recall rose from .18 to .54 and F1 from .27 to .44, with no prior user data and no LLM latency at run time. [emo:happy:0.7][act:beat]This chat uses the same approach for voice input.",
      ja: "[emo:happy:0.7][act:co_celebrate]Alexa Prize TaskBot Challenge 2で3位となったチームISABELで、文脈を活用した音声認識の誤り訂正手法を筆頭著者として開発しました。[emo:focused:0.6][act:confident_claim]認識候補をアシスタントが想定する発話と照らし合わせて並べ替え、どの候補も正しくないときは音の近さで照合します。オフライン評価では、固有表現ベースの手法と比べて、訂正の再現率は.18から.54、F1は.27から.44に向上しました。事前のユーザーデータは不要で、実行時にLLMの遅延も生じません。[emo:happy:0.7][act:beat]このチャットの音声入力でも同じ方法を使っています。",
    },
    links: [{ label: { en: "Project page", ja: "プロジェクトページ" }, href: "/projects/asr-correction/" }, { label: { en: "Paper", ja: "論文" }, href: "https://aclanthology.org/2025.coling-industry.32/" }],
  },
  {
    id: "emnlp",
    chip: { en: "LLMs vs. students", ja: "LLMと生徒の解き方" },
    children: ["emnlp-why", "emnlp-method"],
    questions: {
      en: ["What is your EMNLP 2025 paper about?", "Can LLMs simulate student solutions?", "Tell me about your EMNLP paper"],
      ja: ["EMNLP 2025の論文は何についてですか", "LLMは学習者の解答を再現できますか", "EMNLPの論文について教えて"],
    },
    answer: {
      en: "[emo:focused:0.6][act:confident_claim]Yuya compared 404 correct solutions from students teaching a robot with 5,838 solutions from four LLMs and 13 prompting and sampling methods. [emo:concerned:0.4][act:beat]No model and method pair covered all of the strategies students used, and every pair over- or under-produced some strategy by at least 20 percentage points, which matters whenever LLMs stand in for students in system design and testing.",
      ja: "[emo:focused:0.6][act:confident_claim]ロボットに数学を教える生徒の正答404件と、4つのLLMと13の生成手法による5,838件の解答を比較しました。[emo:concerned:0.4][act:beat]生徒が使った解き方をすべて再現できたモデルと手法の組み合わせはなく、どの組み合わせも、ある解き方を20ポイント以上多く、または少なく生成していました。LLMを生徒の代わりにシステムの設計やテストに使う際に重要な知見です。",
    },
    links: [{ label: { en: "Project page", ja: "プロジェクトページ" }, href: "/projects/student-solutions/" }, { label: { en: "Paper", ja: "論文" }, href: "https://aclanthology.org/2025.emnlp-main.827/" }],
  },
  {
    id: "companion",
    chip: { en: "AI learning companion", ja: "AI学習コンパニオン" },
    children: ["companion-teach", "companion-ik"],
    questions: {
      en: ["What is the AI learning companion?", "Tell me about your learning companion project", "What are you building now?"],
      ja: ["AI学習コンパニオンとは何ですか", "3Dキャラクターのプロジェクトについて教えて", "今は何を作っていますか"],
    },
    answer: {
      en: "[emo:happy:0.8][act:confident_claim]It's a 3D study partner designed to keep adults studying for licensing and certification exams through to test day. Yuya is its sole designer and engineer, building it with React, Three.js, and three-vrm. [emo:relaxed:0.6][act:beat]Teaching the companion what you've learned is a secondary feature, not the core idea.",
      ja: "[emo:happy:0.8][act:confident_claim]資格試験の勉強をする社会人が、試験日まで勉強を続けられるように設計した3Dの学習パートナーです。浅野が一人で設計・開発しており、React、Three.js、three-vrmを使っています。[emo:relaxed:0.6][act:beat]学んだことをコンパニオンに教える機能もありますが、中心ではありません。",
    },
    links: [{ label: { en: "Project page", ja: "プロジェクトページ" }, href: "/projects/learning-companion/" }],
  },
  {
    id: "emma",
    chip: { en: "Emma, an LLM agent", ja: "Emma：LLMエージェント" },
    children: ["emma-llm", "emma-why", "emma-hard", "emma-study"],
    questions: {
      en: ["Tell me about Emma", "What is Emma?", "What is the LLM version of Emma?"],
      ja: ["Emmaについて教えて", "Emmaとは何ですか", "LLM版のEmmaとは何ですか"],
    },
    answer: {
      en: "[emo:happy:0.7][act:confident_claim]Emma is an LLM agent that a student teaches math to. Once she understands the student's solution, she offers a second, verified solution and asks the student to compare the two. [act:beat]Yuya designed and built the agent harness, and Emma is now in an IRB-approved controlled study with 72 participants.",
      ja: "[emo:happy:0.7][act:confident_claim]Emmaは、生徒が数学を教えるLLMエージェントです。生徒の解き方を理解したうえで、検証済みの別解を示し、2つの解き方を比べるよう促します。[act:beat]浅野がエージェントハーネスを設計・開発し、現在はIRB承認済みの72名の統制実験で使われています。",
    },
    links: [{ label: { en: "Project page", ja: "プロジェクトページ" }, href: "/projects/emma-agent/" }],
  },
  {
    id: "emma-why",
    chip: { en: "Why a second solution?", ja: "なぜ別解を示すのか" },
    questions: {
      en: ["Why does Emma offer a second solution?", "Why plan a disagreement?", "Why does Emma introduce an alternative solution?"],
      ja: ["なぜEmmaは別解を示すのですか", "なぜ意見の相違を計画するのですか", "別解を示す理由は何ですか"],
    },
    answer: {
      en: "[emo:focused:0.5][act:think]Comparing different solutions to the same problem can deepen learning, but disagreement can also backfire: in Yuya's studies of student pairs, disagreements left unresolved predicted lower rapport. [emo:relaxed:0.6][act:confident_claim]So this Emma doesn't leave disagreement to chance. Once she understands the student's solution, she offers a verified alternative, and after the problem is solved, she asks the student to compare the two.",
      ja: "[emo:focused:0.5][act:think]同じ問題の異なる解き方を比べることは学びを深めますが、意見の相違は逆効果にもなりえます。浅野のペアの生徒を対象にした研究では、解消されないまま終わった相違が、ラポール（信頼関係）の低さを予測していました。[emo:relaxed:0.6][act:confident_claim]そこでこのEmmaは相違を偶然に任せず、生徒の解き方を理解したうえで検証済みの別解を示し、解き終えた後に2つの解き方を比べてもらいます。",
    },
    links: [{ label: { en: "Pairs teaching Emma", ja: "2人で教える研究" }, href: "/projects/emma-pairs/" }],
  },
  {
    id: "emma-hard",
    chip: { en: "What made it hard", ja: "難しかった点" },
    questions: {
      en: ["What was hard about building Emma?", "What were the engineering challenges?", "What problems did you have to solve?"],
      ja: ["Emmaの開発で難しかった点は何ですか", "技術的な課題は何でしたか", "どんな問題を解決しましたか"],
    },
    answer: {
      en: "[emo:focused:0.6][act:think]Two things. [act:confident_claim]Students' first explanations are often incomplete, so an early match to a verified solution can be wrong: Yuya keeps an LLM classifier running asynchronously during the first step, with no added latency, and Emma switches the match if later explanations fit another solution better. And students often explain several steps at once, so the LLM records what, how, and why for future steps too. When a step is already covered, Emma just asks a yes/no question, [emo:happy:0.6]which significantly reduced unnecessary back-and-forth.",
      ja: "[emo:focused:0.6][act:think]主に2つです。[act:confident_claim]生徒の最初の説明は不完全なことが多く、早い段階での解き方の対応づけは間違っている可能性があります。そこで、対応づけた後も最初のステップのあいだはLLMによる分類を非同期で続け（遅延は増えません）、その後の説明が別の解き方により合っていればEmmaは切り替えます。また、生徒は複数のステップを一度に説明することが多いため、LLMは先のステップの「何を・どうやって・なぜ」も記録し、すでにそろっているステップでは、はい・いいえで答えられる質問だけにしました。[emo:happy:0.6]これで不要なやり取りが大幅に減りました。",
    },
  },
  {
    id: "emma-study",
    chip: { en: "The 72-person study", ja: "72名の実験" },
    questions: {
      en: ["Tell me about the Emma study", "How is Emma being evaluated?", "Who built the study infrastructure?"],
      ja: ["Emmaの実験について教えて", "Emmaはどう評価されていますか", "実験の基盤は誰が作りましたか"],
    },
    answer: {
      en: "[emo:focused:0.5][act:confident_claim]The agent is deployed in an IRB-approved controlled study with 72 participants. Yuya owns the study infrastructure end to end: an ASP.NET web application, the Python dialogue service (migrated from rule-based AIML to LLM-based), Azure SQL, and the data pipelines, with participant data kept in an IRB-compliant institutional Azure environment.",
      ja: "[emo:focused:0.5][act:confident_claim]このエージェントは、IRB承認済みの参加者72名による統制実験で使われています。浅野は研究基盤も一貫して担当しており、ASP.NETのWebアプリケーション、Pythonの対話サービス（ルールベースのAIMLからLLMベースに移行）、Azure SQL、データパイプラインを構築しました。参加者のデータは、IRBの要件を満たす大学のAzure環境で管理しています。",
    },
  },
  {
    id: "pairs",
    chip: { en: "Pairs teaching Emma", ja: "2人で教える研究" },
    children: ["pairs-lexical", "pairs-conflict", "pairs-data"],
    questions: {
      en: ["How do pairs of students teach a robot?", "Tell me about the pairs study", "What did you find when two students taught Emma together?"],
      ja: ["ペアの生徒はロボットにどう教えるのですか", "ペアの研究について教えて", "2人でEmmaに教える研究では何がわかりましたか"],
    },
    answer: {
      en: "[emo:happy:0.6][act:confident_claim]These studies analyzed conversations in which two U.S. undergraduates taught Emma, a NAO robot, middle-school ratio problems by voice. Yuya looks at them through two lenses: lexical alignment (whose words the group ends up sharing) and semantic (mis)alignment (whether the students and Emma agree on how to solve the problem). [emo:happy:0.7][act:beat]The findings shaped the LLM version of Emma.",
      ja: "[emo:happy:0.6][act:confident_claim]米国の大学生2人が、NAOロボットのEmmaに中学校レベルの比の問題の解き方を音声で教える対話を分析した研究です。語彙的同調（グループが誰の言葉を共有するようになるか）と、意味的な（不）一致（生徒とEmmaが解き方について合意しているか）の2つの観点から分析しており、[emo:happy:0.7][act:beat]その知見はLLM版のEmmaの設計につながっています。",
    },
    links: [{ label: { en: "Project page", ja: "プロジェクトページ" }, href: "/projects/emma-pairs/" }],
  },
  {
    id: "pairs-lexical",
    chip: { en: "Whose words they share", ja: "語彙的同調" },
    questions: {
      en: ["What is lexical alignment?", "What did you find about lexical alignment?", "Tell me about your AIED 2025 paper"],
      ja: ["語彙的同調とは何ですか", "語彙的同調について何がわかりましたか", "AIED 2025の論文について教えて"],
    },
    answer: {
      en: "[emo:focused:0.6][act:confident_claim]Yuya extended a measure of shared expressions to multi-party conversation: an expression is initiated when anyone first says it and established once every speaker has used it. The measure predicts rapport better than existing ones and separates Emma's alignment from the students'. More expressions established by Emma went with higher rapport, and more initiated by Emma with lower (AIED 2025). [emo:happy:0.6][act:material_reference]It's released as the open-source package dialign_python.",
      ja: "[emo:focused:0.6][act:confident_claim]共有表現に基づく指標を多人数の会話に拡張しました。ある表現は、誰かが初めて使ったときに導入され、全員が使った時点で確立されます。この指標は既存の指標よりもラポールをよく予測し、Emmaの同調と生徒の同調を区別できます。Emmaが確立した表現が多いほどラポールは高く、導入した表現が多いほど低くなっていました（AIED 2025）。[emo:happy:0.6][act:material_reference]オープンソースのパッケージdialign_pythonとして公開しています。",
    },
    links: [{ label: { en: "dialign_python", ja: "dialign_python" }, href: "https://github.com/akonoroshi/dialign_python" }],
  },
  {
    id: "pairs-conflict",
    chip: { en: "When they disagree", ja: "解法の食い違い" },
    questions: {
      en: ["What is a solution-path conflict?", "What happens when students and Emma disagree?", "Does disagreement hurt rapport?"],
      ja: ["解法の食い違いとは何ですか", "生徒とEmmaの意見が食い違うとどうなりますか", "食い違いはラポールを下げますか"],
    },
    answer: {
      en: "[emo:focused:0.5][act:think]Many math problems have more than one correct solution, so students and Emma can disagree even when both are right; Yuya calls this a solution-path conflict. [emo:concerned:0.4][act:confident_claim]Unresolved conflicts, not conflict in general, were associated with lower rapport with both Emma and the human partner. Resolving a conflict didn't by itself mean students learned more; what likely matters is whether they actually worked through the competing ideas.",
      ja: "[emo:focused:0.5][act:think]数学の問題には正しい解き方が複数あることが多く、生徒とEmmaはどちらも正しくても食い違うことがあります。これを解法の食い違いと呼んでいます。[emo:concerned:0.4][act:confident_claim]食い違い全般ではなく、解消されなかった食い違いが、Emmaとパートナーの双方とのラポールの低さと関連していました。また、食い違いが解消されただけで学習効果が高いわけではなく、対立する考えを実際に検討したかどうかが重要だと考えられます。",
    },
  },
  {
    id: "pairs-data",
    chip: { en: "How the data is built", ja: "データのつくり方" },
    questions: {
      en: ["How did you run the studies?", "How was the data annotated?", "What was the inter-rater reliability?"],
      ja: ["研究はどのように実施しましたか", "データはどうアノテーションしましたか", "評価者間の一致度はどれくらいですか"],
    },
    answer: {
      en: "[emo:focused:0.6][act:confident_claim]Yuya designs and runs lab and classroom studies end to end: experimental design and power analysis, IRB protocols, participant sessions, dialogue and audio collection, annotation, and statistical analysis. For solution-path conflicts, he developed the coding scheme, trained a second annotator, and refined the scheme through disagreement review, [emo:happy:0.6]reaching Cohen's κ = .72 and Gwet's AC1 = .83.",
      ja: "[emo:focused:0.6][act:confident_claim]実験室・教室での研究を一貫して設計・実施しています。実験計画と検出力分析、IRBのプロトコル作成、実験セッションの運営、対話・音声データの収集、アノテーション、統計分析まで担当しています。解法の食い違いについてはコーディングスキームを作成し、2人目のアノテーターを育成したうえで、不一致を検討しながらスキームを改善し、[emo:happy:0.6]Cohen’s κ = .72、Gwet’s AC1 = .83に達しました。",
    },
  },
  {
    id: "asr-rerank",
    chip: { en: "Re-ranking the guesses", ja: "候補の並べ替え" },
    questions: {
      en: ["How does the re-ranking work?", "How do you use the n-best list?", "How are the recognizer's guesses ranked?"],
      ja: ["候補の並べ替えはどう動きますか", "n-bestはどう使っていますか", "認識候補はどう順位づけしますか"],
    },
    answer: {
      en: "[emo:focused:0.6][act:confident_claim]The recognizer returns up to five guesses. Each one is checked by lexical and semantic similarity against the context: the options the assistant just offered, the commands available at this step, and the full task list. A lower-ranked guess wins if it is the only one that matches a real task, which handles extra words people insert in the middle of a request.",
      ja: "[emo:focused:0.6][act:confident_claim]音声認識は最大5つの候補を返します。各候補を、直前に提示した選択肢、そのステップで使えるコマンド、対応しているタスクの一覧といった文脈と、語彙的・意味的な類似度で照合します。実在するタスクに一致するのが下位の候補だけであれば、その候補を採用します。これにより、ユーザーが依頼の途中に言葉を挟んだ場合にも対応できます。",
    },
  },
  {
    id: "asr-sound",
    chip: { en: "Matching by sound", ja: "音による照合" },
    questions: {
      en: ["How does matching by sound work?", "What happens when none of the guesses is right?", "How do you use phonemes?"],
      ja: ["音による照合はどう動きますか", "どの候補も正しくない場合はどうしますか", "音素はどう使っていますか"],
    },
    answer: {
      en: "[emo:focused:0.6][act:confident_claim]When none of the guesses is right, the method compares the phoneme sequences of the best guess and each option in the context, using their longest common subsequence. This handles words the recognizer garbled and words the user added or left out: \"how can I fix a leaky bathroom for sit\" still matches \"how to fix a bathroom faucet.\" [emo:happy:0.7][act:beat]This chat uses the same idea for voice input.",
      ja: "[emo:focused:0.6][act:confident_claim]どの候補も正しくない場合は、最良の候補と文脈の各選択肢の音素列を、最長共通部分列で比較します。これにより、認識が崩れた単語や、ユーザーが付け加えたり省いたりした単語にも対応できます。たとえば「how can I fix a leaky bathroom for sit」も「how to fix a bathroom faucet」に照合できます。[emo:happy:0.7][act:beat]このチャットの音声入力でも同じ考え方を使っています。",
    },
  },
  {
    id: "asr-users",
    chip: { en: "Results with real users", ja: "実ユーザーでの結果" },
    questions: {
      en: ["How did real users respond?", "Did the correction improve user ratings?", "What happened in deployment?"],
      ja: ["実際のユーザーの反応はどうでしたか", "訂正でユーザー評価は上がりましたか", "実運用ではどうでしたか"],
    },
    answer: {
      en: "[emo:happy:0.6][act:confident_claim]In deployment, the assistant confirmed each correction by asking \"Did you mean …?\" [emo:happy:0.8][act:co_celebrate]Users rated conversations .8 to 1 point higher (out of 5) when the correction worked, and false positives did not significantly lower ratings.",
      ja: "[emo:happy:0.6][act:confident_claim]実運用では、アシスタントが「もしかして……ですか？」と確認してから訂正を反映しました。[emo:happy:0.8][act:co_celebrate]訂正がうまくいったとき、ユーザーによる評価（5点満点）は.8〜1点高く、誤った訂正があっても評価は有意に下がりませんでした。",
    },
  },
  {
    id: "companion-teach",
    chip: { en: "Teaching the companion", ja: "コンパニオンに教える" },
    questions: {
      en: ["Why does the learner teach the companion?", "What is the protégé effect?", "How does teaching the companion work?"],
      ja: ["なぜ学習者がコンパニオンに教えるのですか", "プロテジェ効果とは何ですか", "コンパニオンに教える機能はどう動きますか"],
    },
    answer: {
      en: "[emo:relaxed:0.6][act:confident_claim]Inside each session, the learner teaches the companion. It's a feature for learning, not the reason the companion exists: people tend to learn material more deeply when they explain it to someone else, the protégé effect. [act:beat]Drawing on Yuya's teachable-agent research, the companion says what confuses it, restates ideas in new examples, and occasionally makes a believable mistake for the learner to catch.",
      ja: "[emo:relaxed:0.6][act:confident_claim]各セッションの中では、学習者がコンパニオンに教えます。これはコンパニオンの目的ではなく、学習効果を高めるための機能です。人は誰かに説明するとき、内容をより深く学ぶ傾向があり、これはプロテジェ効果と呼ばれています。[act:beat]ティーチャブル・エージェントの研究を生かし、コンパニオンは自分がわからない点を伝え、新しい例で考えを言い直し、ときには学習者が気づけるような、もっともらしい間違いをします。",
    },
  },
  {
    id: "companion-ik",
    chip: { en: "Gestures without clipping", ja: "すり抜けないジェスチャー" },
    questions: {
      en: ["How do the gestures work?", "How do you avoid self-collision?", "What is the inverse kinematics layer?"],
      ja: ["ジェスチャーはどう動いていますか", "自己衝突はどう防いでいますか", "逆運動学のレイヤーとは何ですか"],
    },
    answer: {
      en: "[emo:concerned:0.4][act:beat]A hand raised to the chin or crossed over the chest can clip through the character's own body, which instantly breaks the illusion. [emo:focused:0.6][act:confident_claim]Yuya built an inverse-kinematics layer that adjusts each gesture in real time to avoid self-collision, with strict guarantees rather than best-effort fixes, while keeping the animation smooth in a browser on an ordinary laptop.",
      ja: "[emo:concerned:0.4][act:beat]あごに手を当てたり、胸の前で腕を交差させたりすると、手がキャラクター自身の体をすり抜けてしまい、一気に没入感が失われます。[emo:focused:0.6][act:confident_claim]そこで、ジェスチャーごとにリアルタイムで自己衝突を回避する、逆運動学（IK）のレイヤーを開発しました。その場しのぎの補正ではなく厳密な保証を持たせつつ、一般的なノートPCのブラウザでも滑らかに動くようにしています。",
    },
  },
  {
    id: "emnlp-why",
    chip: { en: "Why it matters", ja: "なぜ重要か" },
    questions: {
      en: ["Why does it matter whether LLMs solve math like students?", "Why use LLMs as simulated students?", "Why is this research important?"],
      ja: ["LLMが生徒と同じように解くかがなぜ重要なのですか", "なぜLLMを生徒の代わりに使うのですか", "この研究はなぜ重要ですか"],
    },
    answer: {
      en: "[emo:focused:0.5][act:confident_claim]Teams building tutoring products increasingly use LLMs as stand-ins for students: to generate practice data, to test a tutor before real users see it, or to simulate a class. [act:beat]Most prior work checks whether LLMs can imitate student mistakes, but students also differ in how they reach a correct answer, and a tutor that only expects one path will misjudge the rest.",
      ja: "[emo:focused:0.5][act:confident_claim]教育サービスを開発するチームでは、LLMを生徒の代わりに使う場面が増えています。練習用データの生成、実際のユーザーに使ってもらう前のチューターのテスト、クラス全体のシミュレーションなどです。[act:beat]先行研究の多くは、LLMが生徒の間違いを再現できるかを検証してきましたが、生徒は正解にたどり着く道筋もそれぞれ異なります。1つの解き方しか想定していないチューターは、それ以外の解き方を正しく評価できません。",
    },
  },
  {
    id: "emnlp-method",
    chip: { en: "How it was measured", ja: "分析の方法" },
    questions: {
      en: ["How did you compare LLM and student solutions?", "Which models and methods did you use?", "What data did you use?"],
      ja: ["LLMと生徒の解答をどう比較しましたか", "どのモデルと手法を使いましたか", "どんなデータを使いましたか"],
    },
    answer: {
      en: "[emo:focused:0.5][act:confident_claim]Yuya annotated 404 correct student solutions from 39 conversations in which students taught math problems to a robot, and 5,838 solutions from four LLMs (one proprietary, two open general-purpose, and one open math-specialized), generated with 13 prompting and sampling methods such as tree of thoughts, multi-agent debate, and in-context learning. He compared the distributions of solution strategies using coverage and total variation distance.",
      ja: "[emo:focused:0.5][act:confident_claim]生徒が会話型ロボットに数学の問題を教えた39の対話から、生徒による正しい解答404件をアノテーションしました。さらに、4つのLLM（プロプライエタリなモデル1つ、オープンな汎用モデル2つ、オープンな数学特化モデル1つ）が、Tree of Thoughts、マルチエージェント討論、in-context learningなど13のプロンプト・サンプリング手法で生成した5,838件の解答を分析し、解き方の分布をカバー率と全変動距離で比較しました。",
    },
  },
  {
    id: "contact",
    chip: { en: "Contact & CV", ja: "連絡先とCV" },
    questions: {
      en: ["How can I contact Yuya?", "What is your email?", "How do I get in touch?"],
      ja: ["連絡先を教えてください", "メールアドレスは何ですか", "どうやって連絡すればいいですか"],
    },
    answer: {
      en: "[emo:happy:0.7][act:confident_claim]Email is the best way to reach Yuya: yuya.asano47@gmail.com. [act:material_reference]His CV and LinkedIn are linked below.",
      ja: "[emo:happy:0.7][act:confident_claim]連絡はメールが確実です：yuya.asano47@gmail.com。[act:material_reference]CVとLinkedInは下のリンクからご覧いただけます。",
    },
    links: [{ label: { en: "CV", ja: "CV（英語）" }, href: "/CV_YuyaAsano.pdf" }, { label: { en: "LinkedIn", ja: "LinkedIn" }, href: "https://www.linkedin.com/in/yuya-asano-441373124/" }],
  },
  {
    id: "visa",
    chip: { en: "Visa sponsorship", ja: "ビザのスポンサー" },
    questions: {
      en: ["Do you need visa sponsorship?", "Will you need sponsorship?", "Are you authorized to work in the US?", "What is your visa status?", "Do you require sponsorship?"],
      ja: ["ビザのスポンサーは必要ですか", "就労ビザのサポートは必要ですか", "アメリカで働く資格はありますか", "ビザのステータスは何ですか"],
    },
    answer: {
      en: "[emo:relaxed:0.6][act:confident_claim]Yes, Yuya will need visa sponsorship. [emo:happy:0.6][act:beat]For details, email him: yuya.asano47@gmail.com.",
      ja: "[emo:relaxed:0.6][act:confident_claim]はい、浅野はビザのスポンサーが必要です。[emo:happy:0.6][act:beat]詳しくはメールでお問い合わせください：yuya.asano47@gmail.com。",
    },
  },
  {
    id: "location",
    questions: {
      en: ["Where are you located?", "Where do you want to work?", "Are you open to relocation?", "Are you willing to relocate?", "Do you want to work remotely?", "Are you open to remote work?"],
      ja: ["どこに住んでいますか", "どこで働きたいですか", "引っ越しは可能ですか", "リモートで働けますか", "勤務地の希望はありますか"],
    },
    answer: {
      en: "[emo:happy:0.6][act:confident_claim]Yuya is based in Pittsburgh now, and he's looking for roles in the Bay Area or remote.",
      ja: "[emo:happy:0.6][act:confident_claim]浅野は現在ピッツバーグに住んでいて、ベイエリアまたはリモートのポジションを探しています。",
    },
  },
  {
    id: "salary",
    // Shino never discusses compensation; this keeps the LLM from improvising an answer.
    questions: {
      en: ["What are your salary expectations?", "How much do you want to be paid?", "What is your expected compensation?", "What salary are you looking for?"],
      ja: ["希望年収はいくらですか", "給与の希望はありますか", "希望の報酬はどれくらいですか"],
    },
    answer: {
      en: "[emo:relaxed:0.6][act:beat]That's something Yuya would rather talk about with you directly. You can reach him by email: yuya.asano47@gmail.com.",
      ja: "[emo:relaxed:0.6][act:beat]その件は、浅野が直接お話ししたいそうです。メールでお問い合わせください：yuya.asano47@gmail.com。",
    },
  },
  {
    id: "advisor",
    questions: {
      en: ["Who is your advisor?", "Who is your PhD advisor?", "Who do you work with at Pitt?", "Who supervises your research?"],
      ja: ["指導教員は誰ですか", "博士課程の指導教員は誰ですか", "誰の研究室にいますか"],
    },
    answer: {
      en: "[emo:happy:0.6][act:confident_claim]Yuya's PhD advisor is Diane Litman, in the Intelligent Systems Program at the University of Pittsburgh.",
      ja: "[emo:happy:0.6][act:confident_claim]浅野の指導教員は、ピッツバーグ大学 Intelligent Systems Program のDiane Litman先生です。",
    },
  },
  {
    id: "skills",
    chip: { en: "Technical skills", ja: "技術スキル" },
    questions: {
      en: ["What are your technical skills?", "What programming languages do you use?", "What tools and frameworks do you use?", "Do you know PyTorch?"],
      ja: ["技術スキルを教えて", "どのプログラミング言語を使いますか", "どんなツールやフレームワークを使いますか", "PyTorchは使えますか"],
    },
    answer: {
      en: "[emo:focused:0.5][act:confident_claim]Mostly Python, with PyTorch, Hugging Face Transformers, and scikit-learn for machine learning. [act:beat]For LLM work he uses the OpenAI and Azure OpenAI APIs, LangChain, and vLLM for open-weight models, plus SQL, Docker, and AWS. [emo:happy:0.6][act:material_reference]The full list is on his CV.",
      ja: "[emo:focused:0.5][act:confident_claim]主にPythonで、機械学習にはPyTorch、Hugging Face Transformers、scikit-learnを使っています。[act:beat]LLMの開発では、OpenAIとAzure OpenAIのAPI、LangChain、オープンウェイトのモデルを動かすためのvLLMを使い、ほかにSQL、Docker、AWSも使います。[emo:happy:0.6][act:material_reference]詳しくはCVをご覧ください。",
    },
    links: [{ label: { en: "CV", ja: "CV（英語）" }, href: "/CV_YuyaAsano.pdf" }],
  },
  {
    id: "llm-experience",
    chip: { en: "LLM experience", ja: "LLMの経験" },
    questions: {
      en: ["Have you worked with LLMs?", "What is your LLM experience?", "Have you built LLM agents?", "Do you have RAG experience?", "Have you worked with retrieval-augmented generation?"],
      ja: ["LLMの経験はありますか", "LLMエージェントを作ったことはありますか", "RAGの経験はありますか"],
    },
    answer: {
      en: "[emo:happy:0.7][act:confident_claim]Yes, it's most of his recent work. He built the LLM agent harness behind Emma on Azure OpenAI, used in a 72-participant study, and an LLM and retrieval pipeline at SigIQ.ai that improved macro F1 by .19 to .33. [act:beat]He also evaluates LLMs, for example comparing 13 prompting and sampling methods across 4 models against real student solutions for EMNLP 2025.",
      ja: "[emo:happy:0.7][act:confident_claim]はい、最近の仕事の中心です。Azure OpenAIでEmmaのLLMエージェントハーネスを開発して72名の実験で使い、SigIQ.aiではLLMと検索のパイプラインでマクロF1を.19〜.33改善しました。[act:beat]LLMの評価にも取り組んでいて、EMNLP 2025では13のプロンプト・サンプリング手法を4つのモデルで試し、生成した解答を実際の生徒の解答と比較しました。",
    },
  },
  {
    id: "production",
    chip: { en: "Shipped to users", ja: "実運用の経験" },
    questions: {
      en: ["Do you have production experience?", "Have you shipped anything?", "Has your work been deployed?", "Have you built anything real users use?"],
      ja: ["本番環境での経験はありますか", "製品として提供したものはありますか", "実際に使われたシステムはありますか"],
    },
    answer: {
      en: "[emo:happy:0.7][act:confident_claim]Yes. At SigIQ.ai he shipped a mastery model as a teacher-facing product feature, and his Alexa Prize speech-recognition correction ran with real users. [act:beat]This site is one too: it runs on Cloudflare Workers, with the matching, retrieval, and limits he built.",
      ja: "[emo:happy:0.7][act:confident_claim]はい。SigIQ.aiでは習熟度推定モデルを教師向けの製品機能として提供し、Alexa Prizeの音声認識の誤り訂正は実際のユーザーに使われました。[act:beat]このサイトもそのひとつで、浅野が作った照合や検索、利用制限の仕組みでCloudflare Workers上で動いています。",
    },
  },
  {
    id: "capabilities",
    // No chip: like greetings, it returns to the start chips, which show what to ask.
    questions: {
      en: ["What can you do?", "What can I ask you?", "What do you know?", "Help", "What should I ask?"],
      ja: ["何ができますか", "何を聞けばいいですか", "何を知っていますか", "ヘルプ", "何が聞けますか"],
    },
    answer: {
      en: "[emo:happy:0.8][act:confident_claim]I can tell you about Yuya's research, his experience and skills, his job search, and how this chat works. [act:beat]Pick a topic below, or just ask![act:wait_user]",
      ja: "[emo:happy:0.8][act:confident_claim]浅野の研究や経験・スキル、仕事探し、それにこのチャットの仕組みについてお話しできます。[act:beat]下から選ぶか、気軽に聞いてくださいね！[act:wait_user]",
    },
  },
  {
    id: "privacy",
    chip: { en: "Privacy", ja: "プライバシー" },
    questions: {
      en: ["Are you recording me?", "Is my voice saved?", "Do you store my questions?", "Is this conversation private?", "Are you listening to me?"],
      ja: ["録音していますか", "声は保存されますか", "質問は保存されますか", "この会話は記録されますか"],
    },
    answer: {
      en: "[emo:relaxed:0.6][act:confident_claim]The site never records audio: your browser turns speech into text, on your device when it can, otherwise through its own speech service. [act:beat]Questions I answer from my prepared list stay in your browser. New questions are sent to the site's server, and Yuya keeps logs of those questions and my answers to improve the chat.",
      ja: "[emo:relaxed:0.6][act:confident_claim]このサイトは音声を録音しません。話した内容はブラウザが文字に変換し、対応していれば端末内で、そうでなければブラウザの音声認識サービスで処理します。[act:beat]用意された回答で答える質問は、ブラウザの中だけで処理されます。新しい質問はサイトのサーバーに送られ、チャットの改善のために、質問と私の回答の記録を浅野が保存しています。",
    },
  },
  {
    id: "accuracy",
    questions: {
      en: ["Can you be wrong?", "How accurate are you?", "Can I trust your answers?", "Do you make mistakes?"],
      ja: ["間違えることはありますか", "答えは正確ですか", "答えを信用していいですか"],
    },
    answer: {
      en: "[emo:concerned:0.3][act:normalize_error]I can be. Answers to common questions were written and checked by Yuya, but answers to new questions are generated from his site and papers and can contain mistakes. [emo:relaxed:0.6][act:material_reference]For anything important, check his CV or papers, or email him.",
      ja: "[emo:concerned:0.3][act:normalize_error]はい、ありえます。よくある質問の答えは浅野が書いて確認したものですが、新しい質問への答えはサイトと論文から生成するので、誤りを含むことがあります。[emo:relaxed:0.6][act:material_reference]大事なことは、CVや論文で確認するか、浅野にメールで聞いてくださいね。",
    },
    links: [{ label: { en: "CV", ja: "CV（英語）" }, href: "/CV_YuyaAsano.pdf" }],
  },
  {
    id: "language",
    questions: {
      en: ["Can you speak Japanese?", "Do you speak Japanese?", "Can we talk in Japanese?"],
      ja: ["英語で話せますか", "英語は話せますか", "英語でもいいですか"],
    },
    answer: {
      en: "[emo:happy:0.7][act:confident_claim]Yes, I speak English and Japanese! [act:material_reference]Switch the site to Japanese with the language link on the page, and I'll talk with you in Japanese.",
      ja: "[emo:happy:0.7][act:confident_claim]はい、日本語と英語で話せます！[act:material_reference]「English」のリンクでサイトを英語に切り替えると、英語でお話しします。",
    },
  },
  {
    id: "ack",
    // "Cool", "got it", 「なるほど」: matched mostly by social.ts, which catches any combination.
    // Keeps the chips the visitor had, like thanks: "cool" usually means "keep going".
    questions: {
      en: ["Okay", "Cool", "Got it", "I see", "Interesting"],
      ja: ["なるほど", "わかりました", "すごいですね", "そうなんですね"],
    },
    answer: {
      en: "[emo:happy:0.6][act:ack]Sure! What would you like to hear about next?[act:wait_user]",
      ja: "[emo:happy:0.6][act:ack]はい！次は何について聞きたいですか？[act:wait_user]",
    },
    alternatives: {
      en: ["[emo:happy:0.6][act:ack]Pick a topic below, or just ask.[act:wait_user]", "[emo:happy:0.6][act:ack]Let me know what else you're curious about![act:wait_user]"],
      ja: ["[emo:happy:0.6][act:ack]下から話題を選ぶか、気軽に聞いてくださいね。[act:wait_user]", "[emo:happy:0.6][act:ack]ほかにも気になることがあれば、なんでもどうぞ！[act:wait_user]"],
    },
  },
  {
    id: "farewell",
    questions: {
      en: ["Bye", "Goodbye", "See you", "That's all", "I'm done"],
      ja: ["さようなら", "またね", "バイバイ", "以上です", "おわります"],
    },
    answer: {
      en: "[emo:happy:0.8][act:farewell]Thanks for stopping by! If you'd like to talk with Yuya, you can email him: yuya.asano47@gmail.com.",
      ja: "[emo:happy:0.8][act:farewell]来てくれてありがとうございました！浅野と話したいときは、メールでどうぞ：yuya.asano47@gmail.com。",
    },
    alternatives: {
      en: ["[emo:happy:0.8][act:farewell]Bye for now! Come back anytime you have more questions about Yuya.", "[emo:happy:0.8][act:farewell]It was nice talking with you! If you'd like to reach Yuya, here's his email: yuya.asano47@gmail.com."],
      ja: ["[emo:happy:0.8][act:farewell]またいつでも来てくださいね！浅野について聞きたいことがあれば、いつでもどうぞ。", "[emo:happy:0.8][act:farewell]お話しできてうれしかったです！浅野への連絡は、メールでどうぞ：yuya.asano47@gmail.com。"],
    },
  },
  {
    id: "who",
    questions: {
      en: ["Are you Yuya?", "Who are you?", "Who is Shino?", "Are you an AI?", "Is this a real person?"],
      ja: ["あなたは浅野さんですか", "あなたは誰ですか", "しのって誰ですか", "AIですか", "本人ですか"],
    },
    toShino: {
      en: ["Who made you?", "Who built you?", "What are you?", "What is your name?"],
      ja: ["誰が作ったのですか", "あなたは何者ですか", "名前は何ですか"],
    },
    answer: {
      en: "[emo:happy:0.7][act:greet]I'm Shino, Yuya's AI companion! I'm not Yuya himself. [emo:relaxed:0.6][act:beat]My answers come from his website and papers, and if I'm not sure about something, I'll point you to his email.",
      ja: "[emo:happy:0.7][act:greet]私はしの、浅野のAIコンパニオンです！浅野本人ではありません。[emo:relaxed:0.6][act:beat]答えは浅野のサイトと論文にもとづいていて、わからないことは、メールでの問い合わせをご案内しますね。",
    },
  },
  {
    id: "greeting",
    questions: {
      en: ["Hi", "Hello", "Hey there", "Good morning", "Nice to meet you"],
      ja: ["こんにちは", "はじめまして", "こんばんは", "おはようございます"],
    },
    answer: {
      en: "[emo:happy:0.8][act:greet]Hi! Welcome to Yuya's website. I'm Shino, his AI companion. Ask me anything about Yuya![act:wait_user]",
      ja: "[emo:happy:0.8][act:greet]こんにちは！浅野のサイトへようこそ。浅野のAIコンパニオン、しのです。なんでも聞いてくださいね！[act:wait_user]",
    },
    alternatives: {
      en: ["[emo:happy:0.8][act:greet]Hello, and welcome to Yuya's website! I'm Shino, Yuya's AI companion. What would you like to know about him?[act:wait_user]", "[emo:happy:0.8][act:greet]Hi there! Welcome to Yuya's site. I'm Shino, and I can tell you about his research, projects, and experience. Where should we start?[act:wait_user]"],
      ja: ["[emo:happy:0.8][act:greet]こんにちは、浅野のサイトへようこそ！AIコンパニオン、しのです。浅野について、何が知りたいですか？[act:wait_user]", "[emo:happy:0.8][act:greet]こんにちは！浅野のサイトへようこそ。しのといいます。浅野の研究やプロジェクト、経歴についてお話しできますよ。どこから始めましょうか？[act:wait_user]"],
    },
  },
  {
    id: "thanks",
    questions: {
      en: ["Thanks", "Thank you", "Thanks a lot", "That's helpful"],
      ja: ["ありがとう", "ありがとうございます", "参考になりました"],
    },
    answer: {
      en: "[emo:happy:0.7][act:ack]You're welcome! Anything else you'd like to know about Yuya?[act:wait_user]",
      ja: "[emo:happy:0.7][act:ack]どういたしまして！ほかにも知りたいことはありますか？[act:wait_user]",
    },
    alternatives: {
      en: ["[emo:happy:0.7][act:ack]Happy to help! What should we look at next?[act:wait_user]", "[emo:happy:0.7][act:ack]Glad that helped! Ask me anything else.[act:wait_user]"],
      ja: ["[emo:happy:0.7][act:ack]お役に立ててうれしいです！次は何を見てみましょうか？[act:wait_user]", "[emo:happy:0.7][act:ack]よかったです！ほかにもなんでも聞いてくださいね。[act:wait_user]"],
    },
  },
];
