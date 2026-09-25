import { normalizeText } from "./adult-learning";

export const SOURCE_MAX_WORDS = 15000;
export const SOURCE_MAX_CHARS = 150000;
export function wordCount(text: string) { return (text.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*|\d+(?:[.,]\d+)*/g) ?? []).length; }
export function validateSource(text: string) {
  if (text.trim().length < 20 || text.length > SOURCE_MAX_CHARS || wordCount(text) > SOURCE_MAX_WORDS) throw new Error("正文需至少 20 字符，最多 15,000 英文词且不超过 150,000 字符。");
  return text.trim();
}
/** Lossless paragraph/sentence boundaries; never ask an LLM to reproduce a long source. */
export function splitMeeting(text: string): string[] {
  validateSource(text);
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const units = text.trim().split(/\n\s*\n/).flatMap(paragraph => {
    if (wordCount(paragraph) <= 350 && paragraph.length <= 6000) return [paragraph.trim()];
    return [...segmenter.segment(paragraph)].map(s => s.segment.trim()).filter(Boolean);
  });
  const chunks: string[] = []; let current = "";
  for (const unit of units) {
    if (unit.length > 12000 || wordCount(unit) > 1000) throw new Error("发现一段没有句号的超长文本，请先补上段落或句号再分节；不会截断或丢弃原文。");
    const combined = current ? `${current}\n\n${unit}` : unit;
    if (current && (wordCount(combined) > 350 || combined.length > 6000)) { chunks.push(current); current = unit; }
    else current = combined;
  }
  if (current) chunks.push(current);
  // Avoid an orphan ending when the previous unit can still stay reasonably short.
  if (chunks.length > 1 && wordCount(chunks.at(-1)!) < 80 && wordCount(chunks.at(-2)! + " " + chunks.at(-1)!) <= 400) {
    const last = chunks.pop()!; chunks[chunks.length - 1] += `\n\n${last}`;
  }
  if (chunks.length > 150) throw new Error("分节过多，请按会议主题拆为两份资料后导入。");
  return chunks;
}
export type ChoiceQuestion = { prompt: string; translation: string; options: string[]; correct: number; explanation: string; evidence: string };
export type ListeningTerm = { phrase: string; meaning: string; example: string; source_quote: string; category: "word" | "phrase" | "sentence"; options: string[]; correct: number; concept_id?: string };
export type ListeningContent = { title: string; summary: string; translation: string; questions: ChoiceQuestion[]; expressions: ListeningTerm[] };
export type Section = { id: string; source_id: string; ordinal: number; excerpt?: string; word_count: number; title: string };
export type ListeningLesson = { id: string; source_id: string; section_id: string; status: string; error: string | null; created_at: string; content?: ListeningContent; format_version: number };
export type ReviewWord = ListeningTerm & { concept_id: string; lesson_id: string };
export type ListeningSession = { id: string; profile_id: string; local_date: string; lesson_id: string | null; snapshot: ListeningContent | null; review_words: ReviewWord[]; assisted: boolean; completed_at: string | null };
export type ListeningAttempt = { id: string; session_id: string; task_id: string; kind: "listening" | "vocabulary"; correct: boolean; assisted: boolean; selected: number | null; rating: string | null; local_date: string; created_at: string; concept_id: string | null };
export type WordState = { concept_id: string; stage: number; attempts: number; independent_days: number; spaced_success: boolean; last_success_date: string | null; due_date: string; priority: boolean };

export function validateListening(value: unknown, excerpt: string): ListeningContent {
  if (!value || typeof value !== "object") throw new Error("课程格式不正确");
  const x = value as Record<string, unknown>;
  const str = (v: unknown, max: number) => { if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error("课程文字为空或过长"); return v.trim(); };
  const obj = (v: unknown) => { if (!v || typeof v !== "object") throw new Error("课程条目格式错误"); return v as Record<string, unknown>; };
  const options = (v: unknown) => {
    if (!Array.isArray(v) || v.length !== 4) throw new Error("每题需要四个选项");
    const opts = v.map(t => str(t, 500)); if (new Set(opts.map(normalizeText)).size !== 4) throw new Error("选项不能重复"); return opts;
  };
  const correct = (v: unknown) => { if (!Number.isInteger(v) || Number(v) < 0 || Number(v) > 3) throw new Error("正确答案编号必须为 0～3"); return Number(v); };
  const summary = str(x.summary, 7000); const words = wordCount(summary);
  if (words < 80 || words > 400) throw new Error("听力稿应为 80～400 词，正常小节目标约 300 词；过短材料请合并后重试。");
  if (!Array.isArray(x.questions) || x.questions.length !== 3) throw new Error("每节需三道理解题");
  const questions = x.questions.map(q => { const p = obj(q); const evidence = str(p.evidence, 1800); if (!normalizeText(summary).includes(normalizeText(evidence))) throw new Error("答案依据必须逐字来自听力稿"); return { prompt: str(p.prompt, 600), translation: str(p.translation, 600), options: options(p.options), correct: correct(p.correct), explanation: str(p.explanation, 1500), evidence }; });
  if (!Array.isArray(x.expressions) || x.expressions.length < 4 || x.expressions.length > 6) throw new Error("每节需精选 4～6 个词句");
  const expressions = x.expressions.map(e => { const p = obj(e); const quote = str(p.source_quote, 1800); if (!normalizeText(excerpt).includes(normalizeText(quote))) throw new Error("词句引文必须逐字来自所选原文"); const meaning = str(p.meaning, 300), opts = options(p.options), c = correct(p.correct); if (normalizeText(opts[c]) !== normalizeText(meaning)) throw new Error("词句正确选项必须与中文意思一致"); if (!["word", "phrase", "sentence"].includes(String(p.category))) throw new Error("词句类别错误"); return { phrase: str(p.phrase, 300), meaning, example: str(p.example, 600), source_quote: quote, category: p.category as ListeningTerm["category"], options: opts, correct: c }; });
  if (new Set(expressions.map(e => normalizeText(e.phrase))).size !== expressions.length) throw new Error("本节词句重复，请修正");
  return { title: str(x.title, 120), summary, translation: str(x.translation, 7000), questions, expressions };
}
/** Rotate answers per session without mutating the saved course. Grading uses the snapshot. */
export function rotateOptions<T extends { options: string[]; correct: number }>(item: T, offset: number): T {
  const n = ((offset % 4) + 4) % 4;
  return { ...item, options: [...item.options.slice(n), ...item.options.slice(0, n)], correct: (item.correct - n + 4) % 4 };
}
export function wordLabel(state?: WordState) {
  if (!state || state.attempts === 0) return "未练习";
  return state.stage >= 3 && state.independent_days >= 3 && state.spaced_success ? "跨天巩固" : state.independent_days ? "巩固中" : "需要复习";
}
