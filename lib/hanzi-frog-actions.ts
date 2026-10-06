"use server";

import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";
import type { FrogDifficulty } from "@/lib/hanzi-frog";

type SubmittedTap = { selectedId: string; elapsedMs: number; replayCount: number };
type SubmittedRound = { targetId: string; options: string[]; taps: SubmittedTap[]; replayCount: number };

export async function saveHanziFrogGame(input: {
  requestId: string; learnerId: string; difficulty: FrogDifficulty; durationMs: number; rounds: SubmittedRound[];
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录");
  await requireChildModule(supabase, await loadAccessContext(supabase, user.id), user.id, input.learnerId, "hanzi");
  if (input.rounds.length < 4 || input.rounds.length > 18 || input.durationMs < 0 || input.durationMs > 3600000) {
    throw new Error("游戏记录不完整，请重新开始一局");
  }
  const { data, error } = await supabase.rpc("save_hanzi_frog_game", {
    p_request_id: input.requestId,
    p_learner_id: input.learnerId,
    p_difficulty: input.difficulty,
    p_duration_ms: Math.round(input.durationMs),
    p_rounds: input.rounds,
  });
  if (error) throw new Error(error.message);
  return data as { session_id: string; question_count: number; first_touch_correct: number; wrong_count: number; replay_count: number };
}
