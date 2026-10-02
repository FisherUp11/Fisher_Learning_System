import { normalizeText } from "./adult-learning";
import { prepareEnglishSource } from "./english-source";
import { splitMeeting, validateSource } from "./english-listening";

export type AcademicCandidate = {
  phrase: string; meaning: string; source_quote: string; translation: string;
  category: "word" | "phrase" | "sentence";
};
export type AcademicCourse = { id: string; title: string; created_at: string };
export type AcademicSource = { id: string; course_id: string; title: string; archived: boolean; published_at: string | null; created_at: string };
export type AcademicChunk = { id: string; source_id: string; ordinal: number; status: string; candidates: AcademicCandidate[]; error: string | null };
export type AcademicLink = { source_id: string; concept_id: string; chunk_ordinal: number; source_quote: string; translation: string };
export type AcademicItem = { profile_id: string; local_date: string; concept_id: string; queue_kind: "new" | "review"; confirmations: number; had_failure: boolean; attempt_count: number; last_answered_at: string | null; completed_at: string | null };
export type AcademicSettings = { profile_id: string; daily_new: number; daily_review: number; focus_course_id: string | null };

export function academicChunks(raw: string): string[] {
  const source = validateSource(raw);
  const prepared = prepareEnglishSource(source);
  if (prepared.englishWords < 80) throw new Error("请粘贴至少 80 个英文词；中文译文不计入英文学习内容。");
  const parts = splitMeeting(source);
  // An isolated heading or short final paragraph should travel with a neighbouring passage.
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts.length === 1 || prepareEnglishSource(parts[i]).englishWords >= 40) continue;
    const neighbour = i > 0 ? i - 1 : 1;
    const merged = i > 0 ? `${parts[neighbour]}\n\n${parts[i]}` : `${parts[i]}\n\n${parts[neighbour]}`;
    if (merged.length > 10000) continue;
    parts[neighbour] = merged; parts.splice(i, 1);
  }
  if (!parts.length || parts.length > 200) throw new Error("讲义过长，请按课拆开导入。");
  for (const part of parts) {
    if (prepareEnglishSource(part).englishWords < 1) throw new Error("有未识别英文的段落，请核对中英排版。");
  }
  return parts;
}

export function validateAcademicCandidates(value: unknown, excerpt: string): AcademicCandidate[] {
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) throw new Error("AI 候选格式不完整，请重试本段。");
  const raw = (value as { items: unknown[] }).items;
  if (raw.length < 1 || raw.length > 10) throw new Error("本段候选数量不合理，请重试。");
  const source = normalizeText(prepareEnglishSource(excerpt).english);
  const result: AcademicCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const phrase = typeof item.phrase === "string" ? item.phrase.trim() : "";
    const meaning = typeof item.meaning === "string" ? item.meaning.trim() : "";
    const source_quote = typeof item.source_quote === "string" ? item.source_quote.trim() : "";
    const translation = typeof item.translation === "string" ? item.translation.trim() : "";
    const category = item.category;
    if (!phrase || phrase.length > 200 || !meaning || meaning.length > 300 || source_quote.length < 10 || source_quote.length > 1000 || translation.length > 1000) continue;
    if (/\p{Script=Han}/u.test(phrase + source_quote) || !["word", "phrase", "sentence"].includes(String(category))) continue;
    if (!source.includes(normalizeText(source_quote)) || !normalizeText(source_quote).includes(normalizeText(phrase))) continue;
    const key = normalizeText(phrase);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ phrase, meaning, source_quote, translation, category: category as AcademicCandidate["category"] });
  }
  if (!result.length) throw new Error("AI 没有给出能在英文原文中核对的候选词，请重试本段。");
  return result;
}
