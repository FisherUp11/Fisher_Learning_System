import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LearnerOverview = {
  learner_id: string;
  display_name: string;
  family_id: string;
  family_name: string;
  family_status: string;
  created_at: string;
  hanzi_started: number;
  hanzi_stable: number;
  hanzi_due: number;
  answers_7d: number;
  first_try_7d: number;
  first_try_known_7d: number;
  poem_records_7d: number;
  game_sessions_7d: number;
  music_records_7d: number;
  catechism_records_7d: number;
  active_days_7d: number;
  active_seconds_7d: number;
  last_activity_at: string | null;
  music_items_assigned: number;
};

/** One RPC for every learner (needs migration 022); returns null when it is not installed yet. */
export async function loadWorkspaceOverview(supabase: SupabaseClient, workspaceId: string) {
  const { data, error } = await supabase.rpc("workspace_learner_overview", { p_workspace_id: workspaceId });
  if (error) return null;
  return (data ?? []) as LearnerOverview[];
}

export const overviewNow = () => Date.now();

export function firstTryRate(row: LearnerOverview) {
  return Number(row.first_try_7d) ? Math.round(Number(row.first_try_known_7d) / Number(row.first_try_7d) * 100) : null;
}

export function attentionReasons(row: LearnerOverview, assignedCount: number) {
  const reasons: string[] = [];
  const last = row.last_activity_at ? new Date(row.last_activity_at).getTime() : 0;
  if (!last) reasons.push("还没有学习记录");
  else if (Date.now() - last > 7 * 86_400_000) reasons.push(`${Math.floor((Date.now() - last) / 86_400_000)} 天未学习`);
  if (Number(row.hanzi_due) >= 40) reasons.push(`到期字积压 ${row.hanzi_due}`);
  const rate = firstTryRate(row);
  if (rate !== null && Number(row.first_try_7d) >= 10 && rate < 60) reasons.push(`首答率 ${rate}%`);
  if (!assignedCount) reasons.push("还没分配内容");
  return reasons;
}
