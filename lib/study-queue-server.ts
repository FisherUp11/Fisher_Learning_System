import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueueItem } from "@/lib/actions";

// Only call after the caller's existing authentication/child-module checks.
export async function committedHanziQueue(supabase: SupabaseClient, learnerId: string) {
  try {
    const { data, error } = await supabase.rpc("get_today_queue", { p_learner_id: learnerId });
    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) throw new Error("今日队列响应格式不正确");
    const items = data as QueueItem[];
    if (items[0] && typeof items[0].today_total !== "number") throw new Error("今日队列版本需要升级");
    return { queue: items, queueError: null };
  } catch (cause) {
    console.error("[learn/commit-sync]", cause instanceof Error ? cause.message : cause);
    return { queue: null, queueError: "记录已保存，队列暂未同步" };
  }
}
