"use server";

import { revalidatePath } from "next/cache";
import { assertOwner, loadAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { lastUsableDate } from "@/lib/hanzi-terms";

export async function manageHanziTerm(form: FormData) {
  try {
    const db = await createClient();
    const { data: { user } } = await db.auth.getUser();
    if (!user) throw new Error("请先登录");
    const access = await loadAccessContext(db, user.id);
    assertOwner(access);
    const { data, error } = await db.rpc("owner_manage_hanzi_term", {
      p_workspace_id: access.workspaceId,
      p_learner_id: String(form.get("learner_id") ?? ""),
      p_action: String(form.get("action") ?? ""),
      p_months: form.get("action") === "term" ? Number(form.get("months")) : null,
      p_enabled: form.get("enabled") === "on",
      p_standard_learner_id: String(form.get("standard_learner_id") ?? "") || null,
      p_expected_version: Number(form.get("version")),
      p_expected_cents: Number(form.get("cents")),
      p_note: String(form.get("note") ?? "").trim(),
      p_request_id: String(form.get("request_id") ?? ""),
    });
    if (error) throw new Error(error.message);
    revalidatePath("/admin/families");
    revalidatePath("/admin/users");
    revalidatePath(`/admin/learners/${String(form.get("learner_id"))}`);
    revalidatePath("/parent");
    revalidatePath("/learn");
    const label = data.mode === "permanent" ? "长期授权" : `有效期至 ${lastUsableDate(data.valid_until)}（含当天）`;
    return { status: "success", message: `${data.duplicate ? "该操作已完成，没有重复延期。" : "已保存。"}${label}；孩子开关${data.enabled ? "已开启" : "保持暂停"}。账号与家庭状态未改动。` };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "保存未确认，请先刷新核对，不要重复延期。" };
  }
}
