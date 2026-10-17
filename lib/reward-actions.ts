"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mapRewardPayload } from "@/lib/reward-service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function authenticatedRewardClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录家长账号");
  return { supabase, user };
}

function requireUuid(value: string, message: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(message);
  return value;
}

function revalidateRewardPages() {
  revalidatePath("/rewards");
  revalidatePath("/rewards/manage");
}

export async function grantManualReward(input: {
  learnerId: string;
  kind: "math" | "bonus" | "initial" | "correction";
  amount: number;
  note?: string;
  localDate?: string;
  requestId: string;
}) {
  const { supabase } = await authenticatedRewardClient();
  const learnerId = requireUuid(input.learnerId, "请选择正确的孩子档案");
  const requestId = requireUuid(input.requestId, "本次奖励编号不正确");
  const amount = Math.trunc(Number(input.amount));
  if (!Number.isFinite(amount)) throw new Error("贴纸数量不正确");
  if (input.kind === "correction" && !input.note?.trim()) throw new Error("修正贴纸必须填写原因");

  const { data, error } = await supabase.rpc("grant_manual_reward", {
    p_learner_id: learnerId,
    p_kind: input.kind,
    p_amount: amount,
    p_note: input.note?.trim().slice(0, 300) || null,
    p_local_date: input.localDate || null,
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
  revalidateRewardPages();
  return mapRewardPayload((data ?? null) as Record<string, unknown> | null);
}

export async function createRewardCatalogItem(input: {
  learnerId: string;
  requestId: string;
  title: string;
  stickerCost: number;
  icon: string;
  note?: string;
}) {
  return saveRewardWish(input);
}

export async function updateRewardCatalogItem(input: {
  learnerId: string; itemId: string; requestId: string; title: string; stickerCost: number; icon: string; note?: string;
}) {
  return saveRewardWish(input);
}

async function saveRewardWish(input: {
  learnerId: string; itemId?: string; requestId: string; title: string; stickerCost: number; icon: string; note?: string;
}) {
  const { supabase } = await authenticatedRewardClient();
  const learnerId = requireUuid(input.learnerId, "请选择愿望所属的孩子");
  const requestId = requireUuid(input.requestId, "保存编号不正确");
  const itemId = input.itemId ? requireUuid(input.itemId, "愿望编号不正确") : null;
  const title = input.title.trim().slice(0, 80);
  const stickerCost = Number(input.stickerCost);
  const icon = input.icon.trim().slice(0, 12) || "🎁";
  const note = input.note?.trim().slice(0, 300) || null;
  if (!title) throw new Error("请填写礼物名称");
  if (!Number.isInteger(stickerCost) || stickerCost < 1 || stickerCost > 100) {
    throw new Error("兑换贴纸数应为 1–100");
  }

  const { data, error } = await supabase.rpc("save_reward_wish", {
    p_learner_id: learnerId, p_item_id: itemId, p_title: title, p_cost: stickerCost,
    p_icon: icon, p_note: note, p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
  revalidateRewardPages();
  if (typeof data !== "string" || !UUID_PATTERN.test(data)) throw new Error("服务器没有确认保存，请重试；不会重复创建同一请求");
  return { ok: true, message: itemId ? `已更新愿望：${title}` : `已加入孩子的愿望清单：${title}` };
}

export async function setRewardCatalogItemStatus(input: {
  learnerId: string;
  itemId: string;
  status: "active" | "archived";
}) {
  const { supabase, user } = await authenticatedRewardClient();
  const itemId = requireUuid(input.itemId, "礼物编号不正确");
  const learnerId = requireUuid(input.learnerId, "请选择孩子");
  if (!["active", "archived"].includes(input.status)) throw new Error("愿望状态不正确");
  const { data, error } = await supabase
    .from("reward_catalog_items")
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .or(`learner_id.eq.${learnerId},and(learner_id.is.null,created_by.eq.${user.id})`)
    .select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("未找到可以修改的愿望，或没有权限");
  revalidateRewardPages();
  return { ok: true };
}

export async function redeemReward(input: {
  learnerId: string;
  rewardItemId: string;
  note?: string;
  requestId: string;
  expectedCost: number;
}) {
  const { supabase } = await authenticatedRewardClient();
  const learnerId = requireUuid(input.learnerId, "请选择正确的孩子档案");
  const rewardItemId = requireUuid(input.rewardItemId, "礼物编号不正确");
  const requestId = requireUuid(input.requestId, "本次兑换编号不正确");
  if (!Number.isInteger(input.expectedCost) || input.expectedCost < 1 || input.expectedCost > 100) throw new Error("兑换贴纸数不正确");
  const { data, error } = await supabase.rpc("redeem_reward_wish", {
    p_learner_id: learnerId,
    p_reward_item_id: rewardItemId,
    p_note: input.note?.trim().slice(0, 300) || null,
    p_request_id: requestId,
    p_expected_cost: input.expectedCost,
  });
  if (error) throw new Error(error.message);
  if (!data || (!data.redeemed && !data.duplicate) || !Number.isFinite(data.balance)) throw new Error("服务器尚未确认兑换结果，请使用同一请求重试");
  revalidateRewardPages();
  return data as {
    redeemed?: boolean;
    duplicate?: boolean;
    balance?: number;
    title?: string;
    cost?: number;
  };
}

export async function reverseRewardRedemption(input: {
  redemptionId: string;
  note?: string;
  requestId: string;
}) {
  const { supabase } = await authenticatedRewardClient();
  const redemptionId = requireUuid(input.redemptionId, "兑换记录编号不正确");
  const requestId = requireUuid(input.requestId, "本次撤销编号不正确");
  const { data, error } = await supabase.rpc("reverse_reward_redemption", {
    p_redemption_id: redemptionId,
    p_note: input.note?.trim().slice(0, 300) || null,
    p_request_id: requestId,
  });
  if (error) throw new Error(error.message);
  revalidateRewardPages();
  return data as {
    reversed?: boolean;
    duplicate?: boolean;
    balance?: number;
    title?: string;
    amount?: number;
  };
}
