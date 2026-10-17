import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPracticeSummaries, loadResourceRows } from "@/lib/resource-queries";
import type { PoemProgress } from "@/lib/poems";

type PoemContent = Pick<PoemProgress, "id" | "poem_key" | "title" | "author" | "dynasty" | "content">;
export type PoemDetail = PoemContent & { sourceTitles: string[] };
export type PoemSummary = Pick<PoemProgress, "id" | "attemptCount" | "practiceDays" | "lastRecitedDate" | "lastScore" | "averageScore" | "scoreCount">;
type DetailRow = {
  sequence: number;
  collection_id: string;
  poems: PoemContent;
  poem_collections: { id: string; title: string };
};

/** 一条有 RLS 的关联查询，只取当前诗及这个孩子的活跃来源，不加载整本目录。 */
export async function loadPoemDetail(db: SupabaseClient, learnerId: string, poemId: string): Promise<PoemDetail | null> {
  const rows = await loadResourceRows<DetailRow>((from, to) => db.from("poem_collection_items")
    .select("sequence,collection_id,poems!inner(id,poem_key,title,author,dynasty,content),poem_collections!inner(id,title,learner_poem_collections!inner(learner_id))")
    .eq("poem_id", poemId)
    .eq("poem_collections.learner_poem_collections.learner_id", learnerId)
    .eq("poem_collections.learner_poem_collections.assignment_status", "active")
    .order("collection_id").range(from, to));
  if (!rows.length) return null;
  const poem = rows[0].poems;
  if (!poem || poem.id !== poemId || typeof poem.content !== "string") throw new Error("诗词内容返回格式异常，请重试");
  return { ...poem, sourceTitles: [...new Set(rows.sort((a, b) => a.sequence - b.sequence || a.collection_id.localeCompare(b.collection_id)).map(row => row.poem_collections.title))] };
}

// 沿用 036 的准确库内汇总；只在正文之后的独立 Suspense 区块读取。
export async function loadPoemSummary(db: SupabaseClient, learnerId: string, poemId: string): Promise<PoemSummary> {
  const summaries = await loadPracticeSummaries<PoemSummary>(db, "poem", learnerId);
  return summaries.get(poemId) ?? { id: poemId, attemptCount: 0, practiceDays: 0, lastRecitedDate: null, lastScore: null, averageScore: null, scoreCount: 0 };
}

// 视频展示和管理入口共享一次查询；兼容尚未添加 033 字段的环境。
export const loadPoemVideo = cache(async (db: SupabaseClient, poemId: string) => {
  const { data, error } = await db.from("poems").select("music_video_url").eq("id", poemId).maybeSingle();
  const setupMissing = Boolean(error?.message.includes("music_video_url"));
  if (error && !setupMissing) throw new Error("视频链接暂时读取失败，请重试");
  const url = typeof data?.music_video_url === "string"
    && /^https:\/\/[a-z0-9-]+\.h5\.xiaoeknow\.com\/p\/course\/video\//i.test(data.music_video_url)
    ? data.music_video_url : null;
  return { url, setupMissing };
});
