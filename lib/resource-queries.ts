import type { SupabaseClient } from "@supabase/supabase-js";

type PageResult = { data: unknown[] | null; error: { message: string } | null };
const PAGE_SIZE = 500;

/** Metadata only. Always provide a deterministic order including a unique key. */
export async function loadResourceRows<T>(fetchPage: (from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 200000; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) throw new Error("资源目录返回格式异常，请稍后重试");
    rows.push(...data as T[]);
    if (data.length < PAGE_SIZE) return rows;
  }
  throw new Error("资源数量超过当前目录保护上限，请联系系统 owner；未展示不完整统计");
}

/** Bound UUID IN lists as well as returned rows (avoids long URLs at 1000+ items). */
export async function loadResourceBatches<T>(ids: string[], fetchPage: (ids: string[], from: number, to: number) => PromiseLike<PageResult>): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const batch = ids.slice(index, index + 100);
    rows.push(...await loadResourceRows<T>((from, to) => fetchPage(batch, from, to)));
  }
  return rows;
}

export async function loadPracticeSummaries<T extends { id: string }>(db: SupabaseClient, kind: "poem" | "music" | "catechism", learnerId: string) {
  const { data, error } = await db.rpc("resource_practice_summary", { p_kind: kind, p_learner_id: learnerId });
  if (error) throw new Error(`学习汇总读取失败：${error.message}。请确认已运行 036 SQL`);
  if (!Array.isArray(data)) throw new Error("学习汇总返回格式异常；没有数据不代表练习次数为零");
  return new Map((data as T[]).map(row => [row.id, row]));
}
