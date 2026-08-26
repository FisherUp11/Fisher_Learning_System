import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PoemGameHistoryRow } from "@/lib/poem-game";

export async function loadPoemGameHistory(supabase: SupabaseClient, learnerId: string, poemId: string) {
  const { data, error } = await supabase
    .from("poem_game_sessions")
    .select("id,mode,played_at,duration_seconds,correct_count,wrong_count,first_try_correct_count,is_completed,recitation_score")
    .eq("learner_id", learnerId)
    .eq("poem_id", poemId)
    .order("played_at", { ascending: false })
    .limit(6);
  if (error) {
    const setupRequired = error.message.includes("poem_game_sessions") || error.message.includes("schema cache");
    return { rows: [] as PoemGameHistoryRow[], setupRequired, error: setupRequired ? null : error.message };
  }
  return { rows: (data ?? []) as PoemGameHistoryRow[], setupRequired: false, error: null };
}

