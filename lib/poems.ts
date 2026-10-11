import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPracticeSummaries, loadResourceBatches, loadResourceRows } from "@/lib/resource-queries";

export type PoemProgress = {
  id: string;
  poem_key: string;
  title: string;
  author: string;
  dynasty: string | null;
  content: string;
  sequence: number;
  sourceCollectionIds: string[];
  sourceTitles: string[];
  attemptCount: number;
  practiceDays: number;
  lastRecitedAt: string | null;
  lastRecitedDate: string | null;
  lastScore: number | null;
  averageScore: number | null;
  scoreCount: number;
};

type CollectionRow = { collection_id: string; linked_at: string };
type Collection = { id: string; title: string; created_at: string };
type CollectionItem = { collection_id: string; poem_id: string; sequence: number };
type Poem = { id: string; poem_key: string; title: string; author: string; dynasty: string | null; content: string };

/** Loads every poem linked to one child. Filtering and pagination happen in the page, so imported collections remain visible together. */
export async function loadPoemProgress(supabase: SupabaseClient, learnerId: string): Promise<{ collections: Collection[]; poems: PoemProgress[] }> {
  const links = await loadResourceRows<CollectionRow>((from, to) => supabase
    .from("learner_poem_collections")
    .select("collection_id,linked_at")
    .eq("learner_id", learnerId)
    .eq("assignment_status", "active")
    .order("linked_at").order("collection_id").range(from, to));
  const collectionIds = links.map((row) => row.collection_id);
  if (collectionIds.length === 0) return { collections: [], poems: [] };

  const [collections, items] = await Promise.all([
    loadResourceBatches<Collection>(collectionIds, (ids, from, to) => supabase.from("poem_collections").select("id,title,created_at").in("id", ids).order("created_at").order("id").range(from, to)),
    loadResourceBatches<CollectionItem>(collectionIds, (ids, from, to) => supabase.from("poem_collection_items").select("collection_id,poem_id,sequence").in("collection_id", ids).order("collection_id").order("sequence").order("poem_id").range(from, to)),
  ]);
  collections.sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const poemIds = [...new Set(items.map((row) => row.poem_id))];
  if (poemIds.length === 0) return { collections, poems: [] };

  const [poemRows, summaries] = await Promise.all([
    loadResourceBatches<Poem>(poemIds, (ids, from, to) => supabase.from("poems").select("id,poem_key,title,author,dynasty,content").in("id", ids).order("id").range(from, to)),
    loadPracticeSummaries<Pick<PoemProgress, "id" | "attemptCount" | "practiceDays" | "lastRecitedAt" | "lastRecitedDate" | "lastScore" | "averageScore" | "scoreCount">>(supabase, "poem", learnerId),
  ]);

  const titleByCollection = new Map(collections.map((collection) => [collection.id, collection.title]));
  const sourcesByPoem = new Map<string, Array<{ collectionId: string; sequence: number; title: string }>>();
  for (const item of items) {
    const source = sourcesByPoem.get(item.poem_id) ?? [];
    source.push({ collectionId: item.collection_id, sequence: item.sequence, title: titleByCollection.get(item.collection_id) ?? "未命名诗词册" });
    sourcesByPoem.set(item.poem_id, source);
  }
  const poems = poemRows.map((poem) => {
    const summary = summaries.get(poem.id);
    const sourceRows = sourcesByPoem.get(poem.id) ?? [];
    return {
      ...poem,
      sequence: Math.min(...sourceRows.map((row) => row.sequence)),
      sourceCollectionIds: [...new Set(sourceRows.map((item) => item.collectionId))],
      sourceTitles: [...new Set(sourceRows.sort((a, b) => a.sequence - b.sequence).map((row) => row.title))],
      attemptCount: Number(summary?.attemptCount ?? 0),
      practiceDays: Number(summary?.practiceDays ?? 0),
      lastRecitedAt: summary?.lastRecitedAt ?? null,
      lastRecitedDate: summary?.lastRecitedDate ?? null,
      lastScore: summary?.lastScore ?? null,
      averageScore: summary?.averageScore ?? null,
      scoreCount: Number(summary?.scoreCount ?? 0),
    };
  }).sort((left, right) => left.sequence - right.sequence || left.title.localeCompare(right.title, "zh-CN"));

  return { collections, poems };
}

export function formatPoemDate(value: string | null) {
  if (!value) return "尚未打卡";
  const [, month, day] = value.slice(0, 10).split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
}

export function recommendationForPoem(poem: PoemProgress, now = new Date()) {
  if (poem.attemptCount === 0) return "还没打卡";
  if (poem.scoreCount === 0) return "练过了，待评分";
  if ((poem.lastScore ?? 10) <= 6) return "最近评分偏低";
  if (poem.lastRecitedAt && now.getTime() - new Date(poem.lastRecitedAt).getTime() > 14 * 24 * 60 * 60 * 1000) return "超过 14 天没背";
  if (poem.attemptCount < 2) return "只背过 1 次";
  return "记录很均衡";
}
