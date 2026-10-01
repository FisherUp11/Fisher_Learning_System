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
  await requireAccountModule(supabase, access, userId, key);
  const { data, error } = await supabase.from("learner_module_access")
    .select("enabled").eq("learner_id", learnerId).eq("module_key", key).maybeSingle();
  if (error) throw new Error(`读取孩子模块权限失败：${error.message}`);
  if (!data?.enabled) throw new Error(`这个孩子尚未开通“${MODULE_LABELS[key]}”，请联系空间 owner。`);
}
