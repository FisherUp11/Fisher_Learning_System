import type { SupabaseClient } from "@supabase/supabase-js";

type RawAttempt = {
  id: string;
  poem_id: string;
  recited_at: string;
  recited_local_date: string;
  score: number | null;
  note: string | null;
};

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
  attempts: RawAttempt[];
};

type CollectionRow = { collection_id: string; linked_at: string };
type Collection = { id: string; title: string; created_at: string };
type CollectionItem = { collection_id: string; poem_id: string; sequence: number };
type Poem = { id: string; poem_key: string; title: string; author: string; dynasty: string | null; content: string };

function errorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message || fallback;
}

/** Loads every poem linked to one child. Filtering and pagination happen in the page, so imported collections remain visible together. */
export async function loadPoemProgress(supabase: SupabaseClient, learnerId: string): Promise<{ collections: Collection[]; poems: PoemProgress[] }> {
  const { data: links, error: linksError } = await supabase
    .from("learner_poem_collections")
    .select("collection_id,linked_at")
    .eq("learner_id", learnerId)
    .order("linked_at") as { data: CollectionRow[] | null; error: { message?: string } | null };
  if (linksError) throw new Error(errorMessage(linksError, "无法读取孩子的诗词册"));
  const collectionIds = (links ?? []).map((row) => row.collection_id);
  if (collectionIds.length === 0) return { collections: [], poems: [] };

  const [{ data: collectionRows, error: collectionsError }, { data: itemRows, error: itemsError }] = await Promise.all([
    supabase.from("poem_collections").select("id,title,created_at").in("id", collectionIds).order("created_at"),
    supabase.from("poem_collection_items").select("collection_id,poem_id,sequence").in("collection_id", collectionIds),
  ]) as Array<{ data: Collection[] | CollectionItem[] | null; error: { message?: string } | null }>;
  if (collectionsError) throw new Error(errorMessage(collectionsError, "无法读取诗词册"));
  if (itemsError) throw new Error(errorMessage(itemsError, "无法读取诗词目录"));
  const collections = (collectionRows ?? []) as Collection[];
  const items = (itemRows ?? []) as CollectionItem[];
  const poemIds = [...new Set(items.map((row) => row.poem_id))];
  if (poemIds.length === 0) return { collections, poems: [] };

  const [{ data: poemRows, error: poemsError }, { data: attemptRows, error: attemptsError }] = await Promise.all([
    supabase.from("poems").select("id,poem_key,title,author,dynasty,content").in("id", poemIds),
    supabase.from("poem_recitation_attempts").select("id,poem_id,recited_at,recited_local_date,score,note").eq("learner_id", learnerId).in("poem_id", poemIds).order("recited_at", { ascending: false }),
  ]) as Array<{ data: Poem[] | RawAttempt[] | null; error: { message?: string } | null }>;
  if (poemsError) throw new Error(errorMessage(poemsError, "无法读取诗词内容"));
  if (attemptsError) throw new Error(errorMessage(attemptsError, "无法读取背诵记录"));

  const titleByCollection = new Map(collections.map((collection) => [collection.id, collection.title]));
  const sourcesByPoem = new Map<string, Array<{ sequence: number; title: string }>>();
  for (const item of items) {
    const source = sourcesByPoem.get(item.poem_id) ?? [];
    source.push({ sequence: item.sequence, title: titleByCollection.get(item.collection_id) ?? "未命名诗词册" });
    sourcesByPoem.set(item.poem_id, source);
  }
  const attemptsByPoem = new Map<string, RawAttempt[]>();
  for (const attempt of ((attemptRows ?? []) as RawAttempt[])) {
    const history = attemptsByPoem.get(attempt.poem_id) ?? [];
    history.push(attempt);
    attemptsByPoem.set(attempt.poem_id, history);
  }

  const poems = ((poemRows ?? []) as Poem[]).map((poem) => {
    const attempts = attemptsByPoem.get(poem.id) ?? [];
    const scored = attempts.filter((attempt) => attempt.score !== null);
    const sourceRows = sourcesByPoem.get(poem.id) ?? [];
    const lastScore = scored[0]?.score ?? null;
    return {
      ...poem,
      sequence: Math.min(...sourceRows.map((row) => row.sequence)),
      sourceCollectionIds: [...new Set(items.filter((item) => item.poem_id === poem.id).map((item) => item.collection_id))],
      sourceTitles: [...new Set(sourceRows.sort((a, b) => a.sequence - b.sequence).map((row) => row.title))],
      attemptCount: attempts.length,
      practiceDays: new Set(attempts.map((attempt) => attempt.recited_local_date)).size,
      lastRecitedAt: attempts[0]?.recited_at ?? null,
      lastRecitedDate: attempts[0]?.recited_local_date ?? null,
      lastScore,
      averageScore: scored.length ? Math.round((scored.reduce((sum, attempt) => sum + (attempt.score ?? 0), 0) / scored.length) * 10) / 10 : null,
      scoreCount: scored.length,
      attempts,
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
