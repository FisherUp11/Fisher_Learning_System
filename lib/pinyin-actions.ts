"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";
import { pinyinSettingsPayload, type PinyinCategory } from "@/lib/pinyin-catalog";
import { committedHanziQueue } from "@/lib/study-queue-server";

async function authorized(learnerId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录");
  await requireChildModule(supabase, await loadAccessContext(supabase, user.id), user.id, learnerId, "hanzi");
  return supabase;
}

export async function savePinyinSettings(formData: FormData) {
  const learnerId = String(formData.get("learner_id") ?? "");
  if (!learnerId) throw new Error("请先选择孩子");
  const settings = pinyinSettingsPayload(formData);
  const supabase = await authorized(learnerId);
  const { error } = await supabase.from("pinyin_settings")
    .upsert({ learner_id: learnerId, ...settings, updated_at: new Date().toISOString() });
  if (error) throw new Error(`拼音设置保存失败：${error.message}`);
  revalidatePath("/parent");
  revalidatePath("/learn");
  return { status: "success", message: "拼音设置已保存。取消勾选的类别立即暂停、记录保留；新增类别、数量和顺序在尚未生成的今日任务或明日任务生效。随机新拼音不会重复首次加入，复习仍按记忆曲线安排。" };
}

export async function savePinyinMnemonic(formData: FormData) {
  const learnerId = String(formData.get("learner_id") ?? "");
  const code = String(formData.get("unit_code") ?? "").trim();
  const mnemonic = String(formData.get("mnemonic") ?? "").trim();
  const reset = formData.get("intent") === "reset";
  if (!learnerId || !code || [...mnemonic].length > 160) throw new Error("请选择拼音，口诀最多 160 字");
  const supabase = await authorized(learnerId);
  const { data: unit, error: lookupError } = await supabase.from("pinyin_units").select("code").eq("code", code).maybeSingle();
  if (lookupError || !unit) throw new Error("这个拼音不存在，请刷新后再试");
  const { error } = reset ? await supabase.from("pinyin_mnemonics").delete().eq("learner_id", learnerId).eq("unit_code", code)
    : await supabase.from("pinyin_mnemonics").upsert({ learner_id: learnerId, unit_code: code, mnemonic, updated_at: new Date().toISOString() });
  if (error) throw new Error(`口诀保存失败：${error.message}`);
  revalidatePath("/parent");
  revalidatePath("/learn");
  return { status: "success", message: reset ? "已恢复这个拼音的默认口诀。" : "口诀已保存，仅用于这位孩子，不影响学习次数和记忆阶段。" };
}

export async function loadPinyinToday(learnerId: string) {
  const supabase = await authorized(learnerId);
  const { data, error } = await supabase.rpc("pinyin_get_today", { p_learner_id: learnerId });
  if (error) throw new Error(error.code === "PGRST202" ? "请先运行 supabase/029_pinyin_learning.sql" : error.message);
  return data as {
    mode: "off" | "finals" | "initials" | "both";
    total: number;
    passed: number;
    selected_categories: PinyinCategory[];
    items: Array<{
      item_id: string; unit_code: string; category: PinyinCategory; mnemonic: string;
      example_hanzi: string; example_pinyin: string; kind: "new" | "review" | "spot" | "retry";
      stage: number; clean_streak: number; required_confirmations: number; attempts: number;
    }>;
  };
}

export async function answerPinyin(input: { learnerId: string; itemId: string; result: "known" | "again" | "helped"; requestId: string }) {
  const supabase = await authorized(input.learnerId);
  const { data, error } = await supabase.rpc("pinyin_answer", {
    p_learner_id: input.learnerId, p_item_id: input.itemId, p_result: input.result, p_request_id: input.requestId,
  });
  if (error) throw new Error(error.message);
  const saved = data as { passed?: boolean; stage?: number; idempotent?: boolean };
  try {
    const { data: today, error: syncError } = await supabase.rpc("pinyin_get_today", { p_learner_id: input.learnerId });
    if (syncError || !today || !Array.isArray(today.items) || typeof today.total !== "number" || typeof today.passed !== "number") {
      throw new Error(syncError?.message ?? "拼音队列响应格式不正确");
    }
    return { ...saved, today: today as Awaited<ReturnType<typeof loadPinyinToday>>, queueError: null };
  } catch {
    return { ...saved, today: null, queueError: "回答已保存，拼音队列暂未同步" };
  }
}

export async function recordHanziHintRetry(input: { learnerId: string; sessionItemId: string; requestId: string }) {
  const supabase = await authorized(input.learnerId);
  const { data, error } = await supabase.rpc("record_hanzi_hint_retry", {
    p_learner_id: input.learnerId, p_session_item_id: input.sessionItemId, p_request_id: input.requestId,
  });
  if (error) throw new Error(error.code === "PGRST202" ? "请先运行 supabase/029_pinyin_learning.sql" : error.message);
  return { ...(data as { today_total?: number; today_passed?: number; today_remaining?: number; daily_passed?: boolean; idempotent?: boolean }),
    ...await committedHanziQueue(supabase, input.learnerId) };
}
