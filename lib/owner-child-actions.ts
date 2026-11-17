"use server";

import { revalidatePath } from "next/cache";
import { assertOwner, loadAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { CHILD_MODULES, MODULE_LABELS, type ChildModuleKey } from "@/lib/module-keys";

async function ownerSession() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) throw new Error("请先登录");
  const access = await loadAccessContext(db, user.id);
  assertOwner(access);
  return { db, access };
}

export async function ownerCreateChild(form: FormData) {
  try {
    const { db, access } = await ownerSession();
    const { data, error } = await db.rpc("owner_create_learner", {
      p_workspace_id: access.workspaceId,
      p_family_id: String(form.get("family_id") ?? ""),
      p_parent_user_id: String(form.get("parent_user_id") ?? ""),
      p_display_name: String(form.get("display_name") ?? "").trim(),
      p_daily_new_limit: Number(form.get("daily_new_limit")),
      p_allow_same_name: form.get("allow_same_name") === "on",
      p_request_id: String(form.get("request_id") ?? ""),
    });
    if (error) throw new Error(error.message);
    revalidatePath("/admin/users"); revalidatePath("/admin/families"); revalidatePath("/admin");
    revalidatePath("/parent");
    return { status: "success", message: `${data.duplicate ? "此前已创建，没有重复添加。" : "孩子档案已创建在所选家长的家庭下。"}下一步设置免费试用或正式开通，再分配字册；不会自动开启任何付费权限。`, learnerId: String(data.learner_id) };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "创建结果未确认，请在用户目录核对后再试。" };
  }
}

export async function ownerManageChildAccess(form: FormData) {
  try {
    const { db, access } = await ownerSession();
    const modules = form.getAll("modules").map(String) as ChildModuleKey[];
    if (!modules.length || modules.some(key => !CHILD_MODULES.includes(key))) throw new Error("请至少选择一个儿童学习模块");
    const action = String(form.get("action"));
    const learnerId = String(form.get("learner_id"));
    const { data, error } = await db.rpc("owner_manage_child_access", {
      p_workspace_id: access.workspaceId, p_learner_id: learnerId, p_action: action,
      p_months: action === "term" ? Number(form.get("months")) : null,
      p_modules: modules,
      p_enabled: Object.fromEntries(modules.map(key => [key, form.get(`enabled_${key}`) === "on"])),
      p_expected_versions: Object.fromEntries(modules.map(key => [key, Number(form.get(`version_${key}`))])),
      p_standard_learner_id: String(form.get("standard_learner_id") ?? "") || null,
      p_expected_cents: Number(form.get("cents")),
      p_convert_permanent: form.get("convert_permanent") === "on",
      p_note: String(form.get("note") ?? "").trim(), p_request_id: String(form.get("request_id") ?? ""),
    });
    if (error) throw new Error(error.message);
    for (const path of ["/admin", "/admin/users", "/admin/families", `/admin/learners/${learnerId}`, `/admin/learners/${learnerId}/access`]) revalidatePath(path);
    revalidatePath("/", "layout");
    return { status: "success", message: `${data.duplicate ? "此前已完成，没有重复延期。" : "已保存。"}${modules.map(key => MODULE_LABELS[key]).join("、")}的授权与开关已更新；本次记录金额 ¥${Number(data.amount_cents) / 100}，不会在线扣款。家长账号、家庭状态和学习记录未改变。` };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "结果未确认，请先核对授权记录；使用原操作重试不会重复延期。" };
  }
}
