import type { SupabaseClient } from "@supabase/supabase-js";

export type CatechismAttemptResult = "recited" | "again";

export type CatechismCollection = {
  id: string;
  title: string;
  englishTitle: string | null;
  status: "draft" | "published" | "archived";
  linkedAt: string;
};

export type CatechismAttempt = {
  id: string;
  itemId: string;
  result: CatechismAttemptResult;
  practicedAt: string;
  practicedLocalDate: string;
  stageBefore: number;
  stageAfter: number;
  nextReviewDate: string;
  note: string | null;
};

export type CatechismProgress = {
  id: string;
  collectionId: string;
  collectionTitle: string;
  collectionEnglishTitle: string | null;
  itemKey: string;
  sequence: number;
  sectionTitle: string | null;
  questionZh: string;
  questionEn: string | null;
  answerZh: string;
  answerEn: string | null;
  scriptureReference: string | null;
  parentNote: string | null;
  stage: number;
  nextReviewDate: string | null;
  lastResult: CatechismAttemptResult | null;
  totalAttempts: number;
  successCount: number;
  againCount: number;
  firstPracticedLocalDate: string | null;
  lastPracticedAt: string | null;
  lastPracticedLocalDate: string | null;
  masteredAt: string | null;
  attempts: CatechismAttempt[];
};

export type CatechismQueueItem = CatechismProgress & { queueKind: "review" | "new" };

type LinkRow = { collection_id: string; linked_at: string };
type CollectionRow = { id: string; title: string; english_title: string | null; status: CatechismCollection["status"] };
type ItemRow = {
  id: string;
  collection_id: string;
  item_key: string;
  sort_order: number;
  section_title: string | null;
  question_zh: string;
  question_en: string | null;
  answer_zh: string;
  answer_en: string | null;
  scripture_reference: string | null;
  parent_note: string | null;
};
type StateRow = {
  item_id: string;
  stage: number;
  next_review_date: string | null;
  last_result: CatechismAttemptResult | null;
  total_attempts: number;
  success_count: number;
  again_count: number;
  first_practiced_local_date: string | null;
  last_practiced_at: string | null;
  last_practiced_local_date: string | null;
  mastered_at: string | null;
};
type AttemptRow = {
  id: string;
  item_id: string;
  result: CatechismAttemptResult;
  practiced_at: string;
  practiced_local_date: string;
  stage_before: number;
  stage_after: number;
  next_review_date: string;
  note: string | null;
};

function message(error: { message?: string } | null, fallback: string) {
  return error?.message || fallback;
}

export function localDateInTimezone(timezone = "Asia/Shanghai", date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function loadCatechismProgress(supabase: SupabaseClient, learnerId: string) {
  const { data: linkRows, error: linkError } = await supabase
    .from("learner_catechism_collections")
    .select("collection_id,linked_at")
    .eq("learner_id", learnerId)
    .order("linked_at") as { data: LinkRow[] | null; error: { message?: string } | null };
  if (linkError) throw new Error(message(linkError, "无法读取孩子的问答册"));
  const links = linkRows ?? [];
  const collectionIds = links.map((row) => row.collection_id);
  if (!collectionIds.length) return { collections: [] as CatechismCollection[], items: [] as CatechismProgress[] };

  const [{ data: collectionRows, error: collectionError }, { data: itemRows, error: itemError }] = await Promise.all([
    supabase.from("catechism_collections").select("id,title,english_title,status").in("id", collectionIds).eq("status", "published"),
    supabase.from("catechism_items").select("id,collection_id,item_key,sort_order,section_title,question_zh,question_en,answer_zh,answer_en,scripture_reference,parent_note").in("collection_id", collectionIds).eq("status", "active"),
  ]) as Array<{ data: CollectionRow[] | ItemRow[] | null; error: { message?: string } | null }>;
  if (collectionError) throw new Error(message(collectionError, "无法读取问答册"));
  if (itemError) throw new Error(message(itemError, "无法读取问答内容"));
  const publishedCollections = (collectionRows ?? []) as CollectionRow[];
  const publishedIds = new Set(publishedCollections.map((row) => row.id));
  const rawItems = ((itemRows ?? []) as ItemRow[]).filter((row) => publishedIds.has(row.collection_id));
  if (!rawItems.length) {
    return {
      collections: publishedCollections.map((row) => ({ ...row, englishTitle: row.english_title, linkedAt: links.find((link) => link.collection_id === row.id)?.linked_at ?? "" })),
      items: [] as CatechismProgress[],
    };
  }

  const itemIds = rawItems.map((row) => row.id);
  const [{ data: stateRows, error: stateError }, { data: attemptRows, error: attemptError }] = await Promise.all([
    supabase.from("catechism_learning_states").select("item_id,stage,next_review_date,last_result,total_attempts,success_count,again_count,first_practiced_local_date,last_practiced_at,last_practiced_local_date,mastered_at").eq("learner_id", learnerId).in("item_id", itemIds),
    supabase.from("catechism_attempts").select("id,item_id,result,practiced_at,practiced_local_date,stage_before,stage_after,next_review_date,note").eq("learner_id", learnerId).in("item_id", itemIds).order("practiced_at", { ascending: false }),
  ]) as Array<{ data: StateRow[] | AttemptRow[] | null; error: { message?: string } | null }>;
  if (stateError) throw new Error(message(stateError, "无法读取问答学习状态"));
  if (attemptError) throw new Error(message(attemptError, "无法读取问答练习历史"));

  const collections: CatechismCollection[] = publishedCollections.map((row) => ({
    id: row.id,
    title: row.title,
    englishTitle: row.english_title,
    status: row.status,
    linkedAt: links.find((link) => link.collection_id === row.id)?.linked_at ?? "",
  })).sort((left, right) => left.linkedAt.localeCompare(right.linkedAt));
  const collectionById = new Map(collections.map((row) => [row.id, row]));
  const stateByItem = new Map(((stateRows ?? []) as StateRow[]).map((row) => [row.item_id, row]));
  const attemptsByItem = new Map<string, CatechismAttempt[]>();
  for (const row of ((attemptRows ?? []) as AttemptRow[])) {
    const rows = attemptsByItem.get(row.item_id) ?? [];
    rows.push({
      id: row.id,
      itemId: row.item_id,
      result: row.result,
      practicedAt: row.practiced_at,
      practicedLocalDate: row.practiced_local_date,
      stageBefore: row.stage_before,
      stageAfter: row.stage_after,
      nextReviewDate: row.next_review_date,
      note: row.note,
    });
    attemptsByItem.set(row.item_id, rows);
  }

  const items = rawItems.map((row): CatechismProgress => {
    const state = stateByItem.get(row.id);
    const collection = collectionById.get(row.collection_id);
    return {
      id: row.id,
      collectionId: row.collection_id,
      collectionTitle: collection?.title ?? "未命名问答册",
      collectionEnglishTitle: collection?.englishTitle ?? null,
      itemKey: row.item_key,
      sequence: row.sort_order,
      sectionTitle: row.section_title,
      questionZh: row.question_zh,
      questionEn: row.question_en,
      answerZh: row.answer_zh,
      answerEn: row.answer_en,
      scriptureReference: row.scripture_reference,
      parentNote: row.parent_note,
      stage: state?.stage ?? 0,
      nextReviewDate: state?.next_review_date ?? null,
      lastResult: state?.last_result ?? null,
      totalAttempts: state?.total_attempts ?? 0,
      successCount: state?.success_count ?? 0,
      againCount: state?.again_count ?? 0,
      firstPracticedLocalDate: state?.first_practiced_local_date ?? null,
      lastPracticedAt: state?.last_practiced_at ?? null,
      lastPracticedLocalDate: state?.last_practiced_local_date ?? null,
      masteredAt: state?.mastered_at ?? null,
      attempts: attemptsByItem.get(row.id) ?? [],
    };
  }).sort((left, right) => {
    const collectionOrder = collections.findIndex((row) => row.id === left.collectionId) - collections.findIndex((row) => row.id === right.collectionId);
    return collectionOrder || left.sequence - right.sequence;
  });
  return { collections, items };
}

export function catechismStatus(item: CatechismProgress, today: string) {
  if (item.totalAttempts === 0) return { key: "new", label: "未开始" } as const;
  if (item.nextReviewDate && item.nextReviewDate <= today) return { key: "due", label: "到期复习" } as const;
  if (item.lastResult === "again") return { key: "again", label: "还要再背" } as const;
  if (item.stage >= 7) return { key: "stable", label: "稳定记住" } as const;
  if (item.stage >= 5) return { key: "familiar", label: "比较熟悉" } as const;
  return { key: "learning", label: item.stage <= 2 ? "正在记忆" : "正在巩固" } as const;
}

export function catechismStageLabel(stage: number) {
  if (stage >= 7) return "稳定记住";
  if (stage >= 5) return "比较熟悉";
  if (stage >= 3) return "正在巩固";
  if (stage >= 1) return "正在记忆";
  return "初学";
}

export function formatCatechismDate(value: string | null) {
  if (!value) return "尚未安排";
  const [, month, day] = value.slice(0, 10).split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
}

export function buildCatechismQueue(items: CatechismProgress[], today: string, dailyNewLimit: number, reviewLimit: number) {
  const newPracticedToday = items.filter((item) => item.firstPracticedLocalDate === today).length;
  const reviewedToday = new Set(items.flatMap((item) => {
    if (!item.firstPracticedLocalDate || item.firstPracticedLocalDate >= today) return [];
    return item.attempts.some((attempt) => attempt.practicedLocalDate === today) ? [item.id] : [];
  })).size;
  const remainingNew = Math.max(0, dailyNewLimit - newPracticedToday);
  const remainingReviews = Math.max(0, reviewLimit - reviewedToday);
  const reviews = items.filter((item) => item.totalAttempts > 0 && item.nextReviewDate && item.nextReviewDate <= today)
    .sort((left, right) => Number(right.lastResult === "again") - Number(left.lastResult === "again") || (left.nextReviewDate ?? "").localeCompare(right.nextReviewDate ?? "") || left.stage - right.stage)
    .slice(0, remainingReviews)
    .map((item) => ({ ...item, queueKind: "review" as const }));
  const newItems = items.filter((item) => item.totalAttempts === 0)
    .slice(0, remainingNew)
    .map((item) => ({ ...item, queueKind: "new" as const }));
  return { queue: [...reviews, ...newItems], newPracticedToday, reviewedToday, remainingNew, remainingReviews };
}
