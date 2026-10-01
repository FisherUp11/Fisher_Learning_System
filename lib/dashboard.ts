import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type LearnerDashboard = {
  started: number;
  stable: number;
  mastered: number;
  due: number;
  firstAttemptRate: number | null;
  firstAttemptCount: number;
  todayAnswered: number;
  todayRemaining: number;
  assignedPackages: number;
  assignedPoemCollections: number;
  assignedMusicItems: number;
  assignedCatechismCollections: number;
  musicDue: number;
  catechismDue: number;
};

/** Exact aggregate; no 1,000-row PostgREST truncation or eleven parallel queries. */
export async function loadLearnerDashboard(
  supabase: SupabaseClient,
  learnerId: string,
): Promise<LearnerDashboard> {
  const { data, error } = await supabase.rpc("learner_dashboard_snapshot", { p_learner_id: learnerId });
  if (error || !data) throw new Error(`无法读取孩子学习概况：${error?.message ?? "无数据"}。请确认已运行 supabase/023_capacity_guard_50_learners.sql。`);
  const row = data as Record<string, number | null>;
  const count = (field: keyof LearnerDashboard) => Number(row[field] ?? 0);
  return {
    started: count("started"), stable: count("stable"), mastered: count("mastered"), due: count("due"),
    firstAttemptRate: row.firstAttemptRate === null ? null : count("firstAttemptRate"),
    firstAttemptCount: count("firstAttemptCount"), todayAnswered: count("todayAnswered"), todayRemaining: count("todayRemaining"),
    assignedPackages: count("assignedPackages"), assignedPoemCollections: count("assignedPoemCollections"),
    assignedMusicItems: count("assignedMusicItems"), assignedCatechismCollections: count("assignedCatechismCollections"),
    musicDue: count("musicDue"), catechismDue: count("catechismDue"),
  };
}
