"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { registerActivityReward } from "@/lib/reward-service";
import type { PoemGameAttemptInput, PoemGameResultInput, PoemGameStage } from "@/lib/poem-game";

const validStages = new Set<PoemGameStage>(["warmup", "exposure", "choice", "order", "boss", "mobile"]);

function gameSetupMessage(message: string) {
  return message.includes("record_poem_game_result") || message.includes("schema cache") || message.includes("Could not find")
    ? "游戏记录功能尚未建好，请 owner 在 Supabase 运行 supabase/018_poem_tank_game.sql 后重试。"
    : message;
}

function cleanAttempt(attempt: PoemGameAttemptInput, index: number): PoemGameAttemptInput {
  const stage = validStages.has(attempt.stage) ? attempt.stage : "mobile";
  const lineIndex = attempt.lineIndex === null ? null : Math.max(0, Math.min(50, Math.floor(Number(attempt.lineIndex) || 0)));
  return {
    eventIndex: Math.max(0, Math.min(500, Math.floor(Number(attempt.eventIndex) || index))),
    stage,
    lineIndex,
    promptText: String(attempt.promptText || "诗句练习").slice(0, 500),
    expectedText: String(attempt.expectedText || "诗句").slice(0, 500),
    selectedText: String(attempt.selectedText || "未选择").slice(0, 500),
    isCorrect: Boolean(attempt.isCorrect),
    isFirstTry: Boolean(attempt.isFirstTry),
    responseMs: Math.max(0, Math.min(600000, Math.floor(Number(attempt.responseMs) || 0))),
  };
}

export async function recordPoemGameResult(input: PoemGameResultInput) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录家长账号");
  if (!/^[0-9a-f-]{36}$/i.test(input.clientSessionId) || !input.learnerId || !input.poemId) throw new Error("游戏记录编号无效");
  if (!validStages.has(input.completedStage) || !["desktop", "mobile"].includes(input.mode)) throw new Error("游戏结果格式无效");
  const attempts = (Array.isArray(input.attempts) ? input.attempts : []).slice(0, 500).map(cleanAttempt);
  const { data, error } = await supabase.rpc("record_poem_game_result", {
    p_client_session_id: input.clientSessionId,
    p_learner_id: input.learnerId,
    p_poem_id: input.poemId,
    p_mode: input.mode,
    p_duration_seconds: Math.max(0, Math.min(3600, Math.floor(Number(input.durationSeconds) || 0))),
    p_completed_stage: input.completedStage,
    p_is_completed: Boolean(input.isCompleted),
    p_attempts: attempts,
  });
  if (error) throw new Error(gameSetupMessage(error.message));
  const payload = data as { session_id?: string; duplicate?: boolean } | null;
  if (!payload?.session_id) throw new Error("游戏记录没有保存成功");
  revalidatePath("/poems/game");
  return { sessionId: payload.session_id, duplicate: Boolean(payload.duplicate) };
}

export async function ratePoemGameSession(input: { sessionId: string; learnerId: string; poemId: string; score: number; note?: string }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录家长账号");
  const score = Math.floor(Number(input.score));
  if (!input.sessionId || !input.learnerId || !input.poemId || score < 1 || score > 10) throw new Error("请选择 1–10 分的背诵评分");
  const { data, error } = await supabase.rpc("rate_poem_game_session", {
    p_session_id: input.sessionId,
    p_score: score,
    p_note: String(input.note ?? "").trim().slice(0, 300) || null,
  });
  if (error) throw new Error(gameSetupMessage(error.message));
  const payload = data as { recitation_attempt_id?: string; duplicate?: boolean } | null;
  if (!payload?.recitation_attempt_id) throw new Error("背诵评分没有保存成功");
  const reward = await registerActivityReward(supabase, {
    learnerId: input.learnerId,
    activityType: "poem",
    sourceRecordId: payload.recitation_attempt_id,
  });
  revalidatePath("/poems");
  revalidatePath(`/poems/${input.poemId}`);
  revalidatePath("/poems/game");
  revalidatePath("/rewards");
  return { reward, duplicate: Boolean(payload.duplicate) };
}

