// Domain terms. Each one is used three ways:
//   - sent to the browser's speech recognizer as a biasing phrase (where supported),
//   - its English pronunciation (ARPAbet, stress digits optional) overrides or extends CMUdict,
//   - its Japanese reading (katakana) replaces the term before Japanese text is tokenized.
// `npm run chat:context` lists context words that have no English pronunciation. To get one,
// run `python3 scripts/chat/g2p_oov.py WORD ...` (uses g2pE) and paste the result into `en`.
export interface Term {
  text: string;
  en?: string; // ARPAbet, e.g. "S IH G AY K Y UW"; only needed if CMUdict lacks the word
  ja?: string; // katakana reading
  bias?: boolean; // send as an ASR biasing phrase (default true)
}

export const terms: Term[] = [
  { text: "SigIQ", en: "S IH G AY K Y UW", ja: "シグアイキュー" },
  { text: "EverTutor", en: "EH V ER T UW T ER", ja: "エバーチューター" },
  { text: "Emma", ja: "エマ" },
  { text: "Shino", en: "SH IY N OW", ja: "しの" },
  { text: "Litman", en: "L IH T M AH N", ja: "リットマン" },
  { text: "Alikhani", en: "AA L IH K AA N IY", ja: "アリハーニ" },
  { text: "ISABEL", ja: "イザベル" },
  { text: "Alexa", ja: "アレクサ" },
  { text: "TaskBot", en: "T AE S K B AA T", ja: "タスクボット" },
  { text: "LLM", en: "EH L EH L EH M", ja: "エルエルエム" },
  { text: "LLMs", en: "EH L EH L EH M Z", ja: "エルエルエムズ", bias: false },
  { text: "ASR", en: "EY EH S AA R", ja: "エーエスアール" },
  { text: "EMNLP", en: "IY EH M EH N EH L P IY", ja: "イーエムエヌエルピー" },
  { text: "COLING", en: "K OW L IH NG", ja: "コーリング" },
  { text: "ETS", en: "IY T IY EH S", ja: "イーティーエス" },
  { text: "VRM", en: "V IY AA R EH M", ja: "ブイアールエム" },
  { text: "ChatGPT", en: "CH AE T JH IY P IY T IY", ja: "チャットジーピーティー" },
  { text: "chatbot", en: "CH AE T B AA T", ja: "チャットボット", bias: false },
  { text: "edtech", en: "EH D T EH K", ja: "エドテック" },
  { text: "Yuya", en: "Y UW Y AA", ja: "ユウヤ" },
  { text: "Asano", en: "AA S AA N OW", ja: "アサノ" },
  { text: "浅野", ja: "アサノ", bias: false },
  { text: "裕哉", ja: "ユウヤ", bias: false },
  { text: "Pitt", ja: "ピット" },
  { text: "Common Core", ja: "コモンコア", bias: true },
  { text: "Jackson State", ja: "ジャクソンステート" },
];
