import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  RewardCatalogItem,
  RewardDashboard,
  RewardLedgerRow,
  RewardRedemption,
} from "@/lib/reward-types";

type RewardAccountRow = {
  sticker_goal: number;
  growth_points_per_sticker: number;
  daily_growth_point_limit: number;
  growth_points: number;
};

function errorText(error: { message?: string } | null, fallback: string) {
  return error?.message || fallback;
}

export async function loadRewardDashboard(
  supabase: SupabaseClient,
  learnerId: string,
): Promise<RewardDashboard> {
  const [accountResult, ledgerResult, catalogResult, redemptionResult] = await Promise.all([
    supabase
      .from("reward_accounts")
      .select("sticker_goal,growth_points_per_sticker,daily_growth_point_limit,growth_points")
      .eq("learner_id", learnerId)
      .maybeSingle(),
    supabase
      .from("reward_ledger")
      .select("id,event_type,amount,title,note,sticker_code,local_date,reference_id,created_at")
      .eq("learner_id", learnerId)
      .order("created_at", { ascending: false }),
    supabase
      .from("reward_catalog_items")
      .select("id,title,sticker_cost,icon,note,status,created_at,updated_at")
      .order("status")
      .order("created_at", { ascending: false }),
    supabase
      .from("reward_redemptions")
      .select("id,learner_id,reward_item_id,title_snapshot,sticker_cost,note,status,redeemed_at,local_date,reversed_at,reversal_note")
      .eq("learner_id", learnerId)
      .order("redeemed_at", { ascending: false }),
  ]);

  if (accountResult.error) throw new Error(errorText(accountResult.error, "无法读取贴纸设置"));
  if (ledgerResult.error) throw new Error(errorText(ledgerResult.error, "无法读取贴纸记录"));
  if (catalogResult.error) throw new Error(errorText(catalogResult.error, "无法读取礼物清单"));
  if (redemptionResult.error) throw new Error(errorText(redemptionResult.error, "无法读取兑换记录"));

  const account = accountResult.data as RewardAccountRow | null;
  const ledger = (ledgerResult.data ?? []) as RewardLedgerRow[];
  const balance = ledger.reduce((sum, entry) => sum + entry.amount, 0);

  return {
    balance,
    lifetimeEarned: ledger.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0),
    lifetimeSpent: Math.abs(ledger.reduce((sum, entry) => sum + Math.min(0, entry.amount), 0)),
    stickerGoal: account?.sticker_goal ?? 10,
    growthPoints: account?.growth_points ?? 0,
    growthPointsPerSticker: account?.growth_points_per_sticker ?? 3,
    dailyGrowthLimit: account?.daily_growth_point_limit ?? 2,
    ledger,
    catalogItems: (catalogResult.data ?? []) as RewardCatalogItem[],
    redemptions: (redemptionResult.data ?? []) as RewardRedemption[],
  };
}

export function formatRewardDate(value: string) {
  const [, month, day] = value.slice(0, 10).split("-");
  return `${Number(month)}月${Number(day)}日`;
}
