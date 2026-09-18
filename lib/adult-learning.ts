/** Shared, side-effect-free contracts. Never import server credentials here. */
export type AdultProfile = { id: string; name: string; daily_new: number; daily_review: number; level: string; archived: boolean; created_at: string };
export type ExerciseGoal = { id: string; profile_id: string; name: string; unit: "sets" | "reps" | "minutes" | "km"; created_at: string };
export type GoalVersion = { goal_id: string; effective_date: string; target: number; weekdays: number[]; active: boolean };
export type ExerciseLog = { id: string; goal_id: string; profile_id: string; local_date: string; amount: number; reps: number | null; minutes: number | null; km: number | null; note: string; voided_at: string | null; created_at: string };
export type Expression = { phrase: string; meaning: string; example: string; source_quote: string };
export type LessonContent = {
  summary: string; translation: string;
  questions: { prompt: string; answer: string }[];
  expressions: Expression[];
  speaking: { prompt: string; answer: string }[];
  quiz: { prompt: string; answer: string }[];
};
export type MeetingSource = { id: string; title: string; body: string; meeting_date: string; priority: boolean; archived: boolean; created_at: string };
export type EnglishLesson = { id: string; source_id: string; status: "generating" | "draft" | "published" | "failed" | "archived"; content: LessonContent | null; level: string; error: string | null; created_at: string };
export type EnglishConcept = { id: string; phrase: string; meaning: string; example: string };
export type ConceptState = { profile_id: string; concept_id: string; skill: "listening" | "speaking"; stage: number; attempts: number; independent_days: number; spaced_success: boolean; last_success_date: string | null; due_date: string; last_date: string };
export type EnglishTask = { id: string; kind: "review" | "listen" | "expression" | "speak" | "quiz"; prompt: string; answer: string; lesson_id: string; concept_id?: string; skill: "listening" | "speaking"; audio: string; hint: string };
export type DailyPlan = { id: string; profile_id: string; local_date: string; mode: "standard" | "short" | "weekly"; tasks: EnglishTask[] };
export type EnglishAttempt = { id: string; plan_id: string; task_id: string; profile_id: string; response: string; result: "correct" | "partial" | "again"; evaluator: "ai" | "self"; hinted: boolean; mode: "text" | "speech" | "corrected" | "self"; feedback: string; local_date: string; created_at: string };
export const UNIT_LABELS = { sets: "组", reps: "次", minutes: "分钟", km: "公里" };
export function localDay(date = new Date()): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
export function addDays(day: string, days: number) { return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }
export function datesBack(today: string, count: number) { return Array.from({ length: count }, (_, i) => addDays(today, i - count + 1)); }
export function goalOnDay(goal: ExerciseGoal, versions: GoalVersion[], day: string) {
  if (day < localDay(new Date(goal.created_at))) return null;
  return versions.filter(v => v.goal_id === goal.id && v.effective_date <= day).sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0] ?? null;
}
export function dayProgress(goals: ExerciseGoal[], versions: GoalVersion[], logs: ExerciseLog[], day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const scheduled = goals.map(goal => ({ goal, version: goalOnDay(goal, versions, day) })).filter(x => x.version?.active && x.version.weekdays.includes(weekday));
  const actual = logs.filter(l => l.local_date === day && !l.voided_at);
  const completed = scheduled.filter(x => actual.filter(l => l.goal_id === x.goal.id).reduce((n, l) => n + Number(l.amount), 0) >= Number(x.version!.target));
  return { scheduled: scheduled.length, completed: completed.length, participated: actual.length > 0, achieved: scheduled.length > 0 && scheduled.length === completed.length };
}
export function normalizeText(value: string) { return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(); }
export function masteryLabel(state?: ConceptState) {
  if (!state) return "未练习";
  if (state.stage >= 3 && state.independent_days >= 3 && state.spaced_success) return "稳定掌握";
  if (state.independent_days > 0) return "巩固中";
  return "待独立确认";
}
export function validateLesson(value: unknown, source?: string): LessonContent {
  if (!value || typeof value !== "object") throw new Error("课程内容格式不正确");
  const obj = value as Record<string, unknown>;
  const str = (v: unknown, max: number) => { if (typeof v !== "string" || !v.trim() || v.length > max) throw new Error("课程字段为空或过长"); return v.trim(); };
  const pairs = (v: unknown, min: number, max: number) => {
    if (!Array.isArray(v) || v.length < min || v.length > max) throw new Error("课程题目数量不正确");
    return v.map(p => ({ prompt: str(p.prompt, 800), answer: str(p.answer, 1200) }));
  };
  if (!Array.isArray(obj.expressions) || obj.expressions.length < 1 || obj.expressions.length > 5) throw new Error("请保留 1～5 个重点表达");
  const expressions = obj.expressions.map(e => ({ phrase: str(e.phrase, 300), meaning: str(e.meaning, 300), example: str(e.example, 600), source_quote: str(e.source_quote, 1200) }));
  if (source && expressions.some(e => !normalizeText(source).includes(normalizeText(e.source_quote)))) throw new Error("重点表达的来源引文与原文不符，请重新生成或修正引文");
  return { summary: str(obj.summary, 3000), translation: str(obj.translation, 3000), questions: pairs(obj.questions, 1, 3), expressions, speaking: pairs(obj.speaking, 1, 3), quiz: pairs(obj.quiz, 1, 2) };
}
export function makeTasks(lesson: EnglishLesson | undefined, concepts: EnglishConcept[], links: { lesson_id: string; concept_id: string }[], states: ConceptState[], today: string, mode: DailyPlan["mode"], newLimit: number, reviewLimit: number): EnglishTask[] {
  const tasks: EnglishTask[] = [];
  const activeConceptIds = new Set(links.map(l => l.concept_id));
  const due = states.filter(s => activeConceptIds.has(s.concept_id) && s.due_date <= today).sort((a, b) => a.due_date.localeCompare(b.due_date) || a.stage - b.stage).slice(0, mode === "short" ? 5 : reviewLimit);
  for (const s of due) {
    const c = concepts.find(c => c.id === s.concept_id); const link = links.find(l => l.concept_id === s.concept_id);
    if (c && link) tasks.push({ id: `review-${c.id}-${s.skill}`, kind: "review", prompt: s.skill === "listening" ? "听这句英文，用中文说明意思。" : `用英文表达：${c.meaning}`, answer: s.skill === "listening" ? c.meaning : c.phrase, lesson_id: link.lesson_id, concept_id: c.id, skill: s.skill, audio: s.skill === "listening" ? c.phrase : "", hint: c.phrase });
  }
  if (mode === "short" && tasks.length) return tasks;
  if (!lesson?.content) return tasks;
  const l = lesson.content;
  const add = (kind: EnglishTask["kind"], index: number, prompt: string, answer: string, audio: string, hint: string, concept_id?: string) => tasks.push({ id: `${lesson.id}-${kind}-${index}`, kind, prompt, answer, audio, hint, lesson_id: lesson.id, concept_id, skill: kind === "listen" ? "listening" : "speaking" });
  if (mode !== "weekly") l.questions.slice(0, mode === "short" ? 1 : 3).forEach((q, i) => add("listen", i, q.prompt, q.answer, l.summary, `${l.summary}\n${l.translation}`));
  // A backlog deliberately reduces new expressions, without inflating the review budget.
  const expressionLimit = mode === "short" ? Math.min(1, newLimit) : due.length >= reviewLimit && reviewLimit > 0 ? Math.min(1, newLimit) : newLimit;
  const newExpressions = l.expressions.map((e, i) => ({ e, i, c: concepts.find(c => normalizeText(c.phrase) === normalizeText(e.phrase) && normalizeText(c.meaning) === normalizeText(e.meaning)) }))
    .filter(({ c }) => c && ["listening", "speaking"].some(skill => !states.some(st => st.concept_id === c.id && st.skill === skill)));
  if (mode !== "weekly") newExpressions.slice(0, expressionLimit).forEach(({ e, i, c }) => {
    if (!states.some(st => st.concept_id === c!.id && st.skill === "listening")) add("listen", i + 100, "听这句表达，用中文说明意思。", e.meaning, e.phrase, e.phrase, c!.id);
    if (!states.some(st => st.concept_id === c!.id && st.skill === "speaking")) add("expression", i, `尝试用英文表达：${e.meaning}`, e.phrase, "", `${e.phrase}\n${e.example}`, c!.id);
  });
  l.speaking.slice(0, mode === "short" ? 1 : 3).forEach((q, i) => add("speak", i, q.prompt, q.answer, "", q.answer));
  if (mode !== "short") l.quiz.forEach((q, i) => add("quiz", i, q.prompt, q.answer, "", q.answer));
  return tasks;
}
