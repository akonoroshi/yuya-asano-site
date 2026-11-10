// Pronunciation fixes for Shino's voice. `npm run chat:voice` merges these with the Japanese
// readings in terms.ts into tts-server/lexicon.json, which the TTS server applies before
// synthesis. Changing anything here changes that language's voice fingerprint, so all of its
// clips are recorded again: deploy the new lexicon to the server first (see README-voice.md).
//
// Listen to the result: these are first guesses, not checked by ear.

/**
 * English, for Kokoro: one word -> phonemes in misaki's notation (American English), with ˈ
 * before the stressed vowel and ˌ before a secondary stress. A = "ay" (eɪ), I = "eye" (aɪ),
 * O = "oh" (oʊ), W = "ow" (aʊ), Y = "oy" (ɔɪ). Kokoro already reads ordinary words and most
 * acronyms (LLM, ASR, ETS) correctly; list only words it gets wrong. Matching ignores case,
 * and possessives ("Yuya's") use the same entry.
 */
export const en: Record<string, string> = {
  Yuya: "jˈujɑ",
  Asano: "ɑsˈɑnO",
  Shino: "ʃˈinO",
  Litman: "lˈɪtmən",
  Alikhani: "ˌɑlɪkˈɑni",
  SigIQ: "sˈɪɡˌIkjˈu",
  EverTutor: "ˈɛvəɹtˌutəɹ",
  TaskBot: "tˈæskbˌɑt",
  ISABEL: "ˈɪzəbˌɛl",
  COLING: "kˈOlɪŋ",
  edtech: "ˈɛdtˌɛk",
};

/**
 * Japanese, for VOICEVOX: text -> katakana reading. Added to the readings in terms.ts (this
 * list wins where both have the same text). Mostly English names and phrases in the Japanese
 * answers, which VOICEVOX would otherwise guess. The longest match is replaced first, and Latin
 * text only matches whole words ("Emma" doesn't match inside "Emmanuel").
 */
export const ja: Record<string, string> = {
  "Intelligent Systems Program": "インテリジェントシステムズプログラム",
  Diane: "ダイアン",
  "Applied Scientist": "アプライドサイエンティスト",
  "Research Scientist": "リサーチサイエンティスト",
  "ML Engineer": "エムエルエンジニア",
  "Alexa Prize TaskBot Challenge": "アレクサプライズタスクボットチャレンジ",
  "Alexa Prize": "アレクサプライズ",
  "SigIQ.ai": "シグアイキュードットエーアイ",
  "Jackson State University": "ジャクソンステートユニバーシティ",
  "Educational Testing Service": "エデュケーショナルテスティングサービス",
  "Cloudflare Workers": "クラウドフレアワーカーズ",
  Cloudflare: "クラウドフレア",
  "Workers AI": "ワーカーズエーアイ",
  "LLM-as-judge": "エルエルエムアズジャッジ",
  "Industry Track": "インダストリートラック",
  "GPT-4o": "ジーピーティーフォーオー",
  LangChain: "ラングチェーン",
  Docker: "ドッカー",
  Astro: "アストロ",
  CMUdict: "シーエムユーディクト",
  kuromoji: "クロモジ",
  Vectorize: "ベクトライズ",
  Gemini: "ジェミニ",
  "K-12": "ケートゥエルブ",
  "Beta-Bernoulli": "ベータベルヌーイ",
  JSON: "ジェイソン",
  React: "リアクト",
  "Three.js": "スリージェイエス",
  "three-vrm": "スリーブイアールエム",
  "ASP.NET": "エーエスピードットネット",
  Python: "パイソン",
  python: "パイソン",
  "Azure SQL": "アジュールエスキューエル",
  Azure: "アジュール",
  NAO: "ナオ",
  AIED: "エーアイイーディー",
  dialign: "ダイアライン",
  Cohen: "コーエン",
  Gwet: "グウェット",
  AC1: "エーシーワン",
  "Tree of Thoughts": "ツリーオブソーツ",
  "in-context learning": "インコンテキストラーニング",
  LinkedIn: "リンクトイン",
  Web: "ウェブ",
  RAG: "ラグ",
  // The email address, which speech.ts reads out as "yuya ドット asano47 アット gmail ドット com".
  yuya: "ユウヤ",
  asano47: "アサノヨンジュウナナ",
  gmail: "ジーメール",
  com: "コム",
};
