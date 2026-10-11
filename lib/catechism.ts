import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPracticeSummaries, loadResourceBatches, loadResourceRows } from "@/lib/resource-queries";

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
  practiceDays: number;
  practicedToday: boolean;
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
/**
 * 兼容早期已经导入数据库的旧标题，只调整展示文字，不修改主键或历史记录。
 */
export function displayCatechismTitle(title: string) {
  return title.replaceAll("儿童信仰问答", "要理问答").replaceAll("信仰问答", "要理问答");
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
  const links = await loadResourceRows<LinkRow>((from,to) => supabase
    .from("learner_catechism_collections")
    .select("collection_id,linked_at")
    .eq("learner_id", learnerId)
    .eq("assignment_status", "active")
    .order("linked_at").order("collection_id").range(from,to));
  const collectionIds = links.map((row) => row.collection_id);
  if (!collectionIds.length) return { collections: [] as CatechismCollection[], items: [] as CatechismProgress[] };

  const [publishedCollections, itemRows] = await Promise.all([
    loadResourceBatches<CollectionRow>(collectionIds,(ids,from,to)=>supabase.from("catechism_collections").select("id,title,english_title,status").in("id",ids).eq("status","published").order("id").range(from,to)),
    loadResourceBatches<ItemRow>(collectionIds,(ids,from,to)=>supabase.from("catechism_items").select("id,collection_id,item_key,sort_order,section_title,question_zh,question_en,answer_zh,answer_en,scripture_reference,parent_note").in("collection_id",ids).eq("status","active").order("collection_id").order("sort_order").order("id").range(from,to)),
  ]);
  const publishedIds = new Set(publishedCollections.map((row) => row.id));
  const rawItems = itemRows.filter((row) => publishedIds.has(row.collection_id));
  if (!rawItems.length) {
    return {
      collections: publishedCollections.map((row) => ({ ...row, title: displayCatechismTitle(row.title), englishTitle: row.english_title, linkedAt: links.find((link) => link.collection_id === row.id)?.linked_at ?? "" })),
      items: [] as CatechismProgress[],
    };
  }

  const itemIds = rawItems.map((row) => row.id);
  const [stateRows, summaries] = await Promise.all([
    loadResourceBatches<StateRow>(itemIds,(ids,from,to)=>supabase.from("catechism_learning_states").select("item_id,stage,next_review_date,last_result,total_attempts,success_count,again_count,first_practiced_local_date,last_practiced_at,last_practiced_local_date,mastered_at").eq("learner_id",learnerId).in("item_id",ids).order("item_id").range(from,to)),
    loadPracticeSummaries<{id:string;practiceDays:number;practicedToday:boolean}>(supabase,"catechism",learnerId),
  ]);

  const collections: CatechismCollection[] = publishedCollections.map((row) => ({
    id: row.id,
    title: displayCatechismTitle(row.title),
    englishTitle: row.english_title,
    status: row.status,
    linkedAt: links.find((link) => link.collection_id === row.id)?.linked_at ?? "",
  })).sort((left, right) => left.linkedAt.localeCompare(right.linkedAt));
  const collectionById = new Map(collections.map((row) => [row.id, row]));
  const stateByItem = new Map(stateRows.map((row) => [row.item_id, row]));
  const collectionOrder = new Map(collections.map((row,index)=>[row.id,index]));

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
      practiceDays: Number(summaries.get(row.id)?.practiceDays ?? 0),
      practicedToday: summaries.get(row.id)?.practicedToday ?? false,
    };
  }).sort((left, right) => {
    const order = (collectionOrder.get(left.collectionId)??0) - (collectionOrder.get(right.collectionId)??0);
    return order || left.sequence - right.sequence || left.id.localeCompare(right.id);
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
    return item.practicedToday ? [item.id] : [];
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
