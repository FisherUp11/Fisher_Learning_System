import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import type { AccessContext } from "@/lib/access";
import { ACCOUNT_MODULES, MODULE_LABELS, type ModuleKey, type ChildModuleKey } from "@/lib/module-keys";

export const loadAccountModules = cache(async (supabase: SupabaseClient, access: AccessContext, userId: string): Promise<ModuleKey[]> => {
  const { data, error } = await supabase.from("account_module_access")
    .select("module_key").eq("workspace_id", access.workspaceId).eq("user_id", userId).eq("enabled", true);
  if (error) throw new Error(`读取模块开通状态失败：${error.message}。请检查是否已运行对应的模块 SQL`);
  const enabled = new Set((data ?? []).map((row) => row.module_key));
  return ACCOUNT_MODULES.filter((key) => enabled.has(key)) as ModuleKey[];
});

export async function requireAccountModule(supabase: SupabaseClient, access: AccessContext | null, userId: string, key: ModuleKey) {
  if (!access) throw new Error("尚未加入学习空间");
  const modules = await loadAccountModules(supabase, access, userId);
  if (!modules.includes(key)) throw new Error(`当前账号尚未开通“${MODULE_LABELS[key]}”，请联系空间 owner。`);
}

export async function requireChildModule(supabase: SupabaseClient, access: AccessContext | null, userId: string, learnerId: string, key: ChildModuleKey) {
  // One authoritative round trip includes account, family, child switch and expiry.
  // Do not cache a successful grant across requests or skip it for an owner.
  if (key === "hanzi") {
    if (!access) throw new Error("尚未加入学习空间");
    const result = await supabase.rpc("can_study_child_module", { p_learner_id: learnerId, p_module_key: key });
    if (result.error) throw new Error("汉字授权校验暂不可用，请联系 owner 确认已运行 038 SQL。");
    if (result.data !== true) throw new Error("汉字学习未开通、已到期、已暂停或家庭已停用。请联系 owner；已有字库和学习记录不会丢失，可在“册”和“家”查看。");
    return;
  }
  await requireAccountModule(supabase, access, userId, key);
  const { data, error } = await supabase.from("learner_module_access")
    .select("enabled").eq("learner_id", learnerId).eq("module_key", key).maybeSingle();
  if (error) throw new Error(`读取孩子模块权限失败：${error.message}`);
  if (!data?.enabled) throw new Error(`这个孩子尚未开通“${MODULE_LABELS[key]}”，请联系空间 owner。`);
}
