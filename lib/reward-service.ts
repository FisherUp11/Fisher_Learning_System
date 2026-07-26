import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RewardOutcome } from "@/lib/reward-types";

type RewardPayload = Record<string, unknown> | null;

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function mapRewardPayload(payload: RewardPayload, systemError: string | null = null): RewardOutcome {
  return {
    eligible: Boolean(payload?.eligible),
    awarded: Boolean(payload?.awarded),
    credited: Boolean(payload?.credited),
    duplicate: Boolean(payload?.duplicate),
    dailyLimitReached: Boolean(payload?.daily_limit_reached),
    reason: String(payload?.reason ?? (systemError ? "unavailable" : "none")),
    amount: numberValue(payload?.amount),
    balance: numberValue(payload?.balance),
    progress: numberValue(payload?.progress),
    needed: numberValue(payload?.needed),
    goal: numberValue(payload?.goal, 10),
    stickerCode: typeof payload?.sticker_code === "string" ? payload.sticker_code : null,
    title: typeof payload?.title === "string" ? payload.title : null,
    systemError,
  };
}

export async function claimHanziCompletionReward(supabase: SupabaseClient, learnerId: string) {
  const { data, error } = await supabase.rpc("claim_hanzi_daily_reward", { p_learner_id: learnerId });
  return error
    ? mapRewardPayload(null, error.message)
    : mapRewardPayload((data ?? null) as RewardPayload);
}

export async function registerActivityReward(
  supabase: SupabaseClient,
  input: { learnerId: string; activityType: "poem" | "song" | "instrument" | "rhythm"; sourceRecordId: string },
) {
  const { data, error } = await supabase.rpc("register_reward_activity", {
    p_learner_id: input.learnerId,
    p_activity_type: input.activityType,
    p_source_record_id: input.sourceRecordId,
  });
  return error
    ? mapRewardPayload(null, error.message)
    : mapRewardPayload((data ?? null) as RewardPayload);
}
