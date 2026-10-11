import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PracticeHistoryPage, PracticeKind } from "@/lib/practice-history-values";

export async function readPracticeHistory(db:SupabaseClient, kind:PracticeKind, learnerId:string, itemId:string, page=1):Promise<PracticeHistoryPage> {
  const {data,error} = await db.rpc("resource_practice_history", {p_kind:kind,p_learner_id:learnerId,p_item_id:itemId,p_page:page});
  if(error) throw new Error(`练习记录读取失败：${error.message}。请确认已运行 036 SQL`);
  if(!data || !Array.isArray(data.rows) || !Number.isInteger(data.page) || !Number.isInteger(data.pages) || !Number.isFinite(data.total)) throw new Error("练习记录返回格式异常");
  return data as PracticeHistoryPage;
}
