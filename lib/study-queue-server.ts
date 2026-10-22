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

// A stale, locally persisted card may belong to a day already completed on another
// device (or before the old queue refilled). The database has rolled its write
// back. A fresh authorized empty queue acknowledges that terminal state, so the
// existing client can discard the stale request without inventing an answer.
type CompletedHanziDay = {
  idempotent: true;
  daily_complete: true;
  today_remaining: 0;
  today_total?: number;
  today_passed?: number;
  daily_passed?: boolean;
  reward: null;
  queue: QueueItem[];
  queueError: null;
};
export async function recoverCompletedHanziDay(supabase: SupabaseClient, learnerId: string, error: { code?: string }): Promise<CompletedHanziDay | null> {
  if (error.code !== "PZ039") return null;
  const next = await committedHanziQueue(supabase, learnerId);
  if (!next.queue || next.queue.length > 0) return null;
  return { idempotent: true, daily_complete: true, today_remaining: 0, reward: null, ...next };
}
