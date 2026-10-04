"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";

async function authorized(learnerId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录");
  await requireChildModule(supabase, await loadAccessContext(supabase, user.id), user.id, learnerId, "hanzi");
  return supabase;
}

export async function savePinyinSettings(formData: FormData) {
  const learnerId = String(formData.get("learner_id") ?? "");
  const mode = String(formData.get("mode") ?? "off");
  const dailyLimit = Number(formData.get("daily_limit") ?? 4);
  if (!learnerId || !["off", "finals", "initials", "both"].includes(mode)) throw new Error("请选择有效的拼音模式");
  if (![3, 4, 5].includes(dailyLimit)) throw new Error("每天请选择 3–5 个拼音");
  const supabase = await authorized(learnerId);
  const { error } = await supabase.from("pinyin_settings")
    .upsert({ learner_id: learnerId, mode, daily_limit: dailyLimit, updated_at: new Date().toISOString() });
  if (error) throw new Error(`拼音设置保存失败：${error.message}`);
  revalidatePath("/parent");
  revalidatePath("/learn");
  return { status: "success", message: "拼音设置已保存。尚未开始的今日拼音任务会立即采用；已生成的任务保留至今天结束，明天按新设置生成。" };
}

export async function loadPinyinToday(learnerId: string) {
  const supabase = await authorized(learnerId);
  const { data, error } = await supabase.rpc("pinyin_get_today", { p_learner_id: learnerId });
  if (error) throw new Error(error.code === "PGRST202" ? "请先运行 supabase/029_pinyin_learning.sql" : error.message);
  return data as {
    mode: "off" | "finals" | "initials" | "both";
    total: number;
    passed: number;
    items: Array<{
      item_id: string; unit_code: string; category: "final" | "initial";
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
  return data as { passed?: boolean; stage?: number; idempotent?: boolean };
}

export async function recordHanziHintRetry(input: { learnerId: string; sessionItemId: string; requestId: string }) {
  const supabase = await authorized(input.learnerId);
  const { data, error } = await supabase.rpc("record_hanzi_hint_retry", {
    p_learner_id: input.learnerId, p_session_item_id: input.sessionItemId, p_request_id: input.requestId,
  });
  if (error) throw new Error(error.code === "PGRST202" ? "请先运行 supabase/029_pinyin_learning.sql" : error.message);
  return data as { today_total?: number; today_passed?: number; today_remaining?: number; daily_passed?: boolean };
}
