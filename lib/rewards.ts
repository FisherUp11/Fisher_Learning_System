import type { SupabaseClient } from "@supabase/supabase-js";
import { loadResourceRows } from "@/lib/resource-queries";
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
  const [accountResult, walletResult, ledgerResult, catalogItems, redemptions] = await Promise.all([
    supabase
      .from("reward_accounts")
      .select("sticker_goal,growth_points_per_sticker,daily_growth_point_limit,growth_points")
      .eq("learner_id", learnerId)
      .maybeSingle(),
    supabase.rpc("reward_wallet_summary", { p_learner_id: learnerId }),
    supabase
      .from("reward_ledger")
      .select("id,event_type,amount,title,note,sticker_code,local_date,reference_id,created_at")
      .eq("learner_id", learnerId)
      .order("created_at", { ascending: false }).order("id").limit(20),
    loadResourceRows<RewardCatalogItem>((from, to) => supabase.from("reward_catalog_items")
      .select("id,learner_id,title,sticker_cost,icon,note,status,created_at,updated_at")
      .or(`learner_id.eq.${learnerId},learner_id.is.null`)
      .order("created_at", { ascending: false }).order("id").range(from, to)),
    loadResourceRows<RewardRedemption>((from, to) => supabase.from("reward_redemptions")
      .select("id,learner_id,reward_item_id,title_snapshot,sticker_cost,note,status,redeemed_at,local_date,reversed_at,reversal_note")
      .eq("learner_id", learnerId).order("redeemed_at", { ascending: false }).order("id").range(from, to)),
  ]);

  if (accountResult.error) throw new Error(errorText(accountResult.error, "无法读取贴纸设置"));
  if (ledgerResult.error) throw new Error(errorText(ledgerResult.error, "无法读取贴纸记录"));
  if (walletResult.error) throw new Error("无法读取完整贴纸余额，请确认已运行 037 愿望清单 SQL 后重试");

  const account = accountResult.data as RewardAccountRow | null;
  const ledger = (ledgerResult.data ?? []) as RewardLedgerRow[];
  const wallet = walletResult.data as { balance: number; lifetimeEarned: number; lifetimeSpent: number } | null;
  if (!wallet || ![wallet.balance,wallet.lifetimeEarned,wallet.lifetimeSpent].every(Number.isFinite)) throw new Error("贴纸余额返回异常，暂不显示错误的兑换进度");

  return {
    balance: wallet.balance,
    lifetimeEarned: wallet.lifetimeEarned,
    lifetimeSpent: wallet.lifetimeSpent,
    stickerGoal: account?.sticker_goal ?? 10,
    growthPoints: account?.growth_points ?? 0,
    growthPointsPerSticker: account?.growth_points_per_sticker ?? 3,
    dailyGrowthLimit: account?.daily_growth_point_limit ?? 2,
    ledger,
    catalogItems,
    redemptions,
  };
}

export function formatRewardDate(value: string) {
  const [, month, day] = value.slice(0, 10).split("-");
  return `${Number(month)}月${Number(day)}日`;
}
