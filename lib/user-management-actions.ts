"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { assertOwner, loadAccessContext } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type UserManagementState = {
  status: "idle" | "success" | "error";
  message: string;
  email?: string;
  temporaryPassword?: string;
};

async function ownerSession() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录");
  const access = await loadAccessContext(supabase, user.id);
  assertOwner(access);
  return { supabase, user, access };
}

function generatedTemporaryPassword() {
  return `Ya7!${randomBytes(9).toString("base64url")}`;
}

function validPassword(value: string) {
  return value.length >= 12 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

export async function createWorkspaceUser(
  _previousState: UserManagementState,
  formData: FormData,
): Promise<UserManagementState> {
  let createdUserId: string | null = null;
  try {
    const { supabase, access } = await ownerSession();
    const admin = createAdminClient();
    const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 320);
    const displayName = String(formData.get("display_name") ?? "").trim().slice(0, 80);
    const role = String(formData.get("role") ?? "parent");
    const familyId = String(formData.get("family_id") ?? "") || null;
    const newFamilyName = String(formData.get("new_family_name") ?? "").trim().slice(0, 80) || null;
    const suppliedPassword = String(formData.get("temporary_password") ?? "").trim();
    const temporaryPassword = suppliedPassword || generatedTemporaryPassword();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("请填写正确的登录邮箱");
    if (!displayName) throw new Error("请填写账号称呼，例如“哈森妈妈”");
    if (!['admin', 'parent'].includes(role)) throw new Error("角色只能是管理员或家长");
    if (role === "parent" && !familyId && !newFamilyName) throw new Error("家长账号需要选择已有家庭，或填写新家庭名称");
    if (!validPassword(temporaryPassword)) throw new Error("临时密码至少 12 位，并同时包含字母和数字");

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (error || !data.user) {
      const message = error?.message?.toLowerCase().includes("already")
        ? "这个邮箱已经注册。请改用“邀请家庭”让现有账号加入，不要覆盖对方密码。"
        : error?.message ?? "创建登录账号失败";
      throw new Error(message);
    }
    createdUserId = data.user.id;

    const { error: provisionError } = await supabase.rpc("owner_provision_workspace_user", {
      p_workspace_id: access.workspaceId,
      p_user_id: createdUserId,
      p_display_name: displayName,
      p_role: role,
      p_family_id: familyId,
      p_new_family_name: newFamilyName,
    });
    if (provisionError) throw new Error(provisionError.message);

    revalidatePath("/admin");
    revalidatePath("/admin/users");
    return {
      status: "success",
      message: "账号已创建。请现在把登录邮箱和临时密码交给家长；临时密码离开本页后不会再次显示。",
      email,
      temporaryPassword,
    };
  } catch (error) {
    if (createdUserId) {
      try { await createAdminClient().auth.admin.deleteUser(createdUserId); } catch { /* 回滚尽力而为 */ }
    }
    return { status: "error", message: error instanceof Error ? error.message : "创建账号失败" };
  }
}

export async function updateWorkspaceUser(
  _previousState: UserManagementState,
  formData: FormData,
): Promise<UserManagementState> {
  try {
    const { supabase, access } = await ownerSession();
    const userId = String(formData.get("user_id") ?? "");
    const displayName = String(formData.get("display_name") ?? "").trim().slice(0, 80);
    const role = String(formData.get("role") ?? "parent");
    const status = String(formData.get("status") ?? "active");
    const familyId = String(formData.get("family_id") ?? "") || null;
    if (!userId) throw new Error("缺少账号 ID");
    const { error } = await supabase.rpc("owner_update_workspace_user", {
      p_workspace_id: access.workspaceId,
      p_user_id: userId,
      p_display_name: displayName,
      p_role: role,
      p_status: status,
      p_family_id: familyId,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/admin");
    revalidatePath("/admin/users");
    return { status: "success", message: status === "suspended" ? "账号已停用，现有学习资料和历史仍完整保留。" : "账号资料与权限已保存。" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "保存账号失败" };
  }
}

export async function resetWorkspaceUserPassword(
  _previousState: UserManagementState,
  formData: FormData,
): Promise<UserManagementState> {
  try {
    const { supabase, user, access } = await ownerSession();
    const userId = String(formData.get("user_id") ?? "");
    if (!userId) throw new Error("缺少账号 ID");
    const { data: member, error: memberError } = await supabase.from("workspace_members")
      .select("user_id,role")
      .eq("workspace_id", access.workspaceId)
      .eq("user_id", userId)
      .single();
    if (memberError || !member) throw new Error("找不到这个空间账号");
    if (member.role === "owner") throw new Error("owner 请通过 Supabase/登录页的安全流程修改自己的密码");
    const temporaryPassword = generatedTemporaryPassword();
    const admin = createAdminClient();
    const { data: target, error: readError } = await admin.auth.admin.getUserById(userId);
    if (readError || !target.user) throw new Error(readError?.message ?? "找不到登录账号");
    const { error: passwordError } = await admin.auth.admin.updateUserById(userId, { password: temporaryPassword });
    if (passwordError) throw new Error(passwordError.message);
    const { error: profileError } = await supabase.from("workspace_user_profiles").update({
      must_change_password: true,
      password_reset_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("workspace_id", access.workspaceId).eq("user_id", userId);
    if (profileError) throw new Error(`密码已重置，但首次改密标记保存失败：${profileError.message}`);
    await supabase.from("workspace_audit_events").insert({
      workspace_id: access.workspaceId,
      actor_user_id: user.id,
      event_type: "user.password_reset",
      entity_type: "workspace_user",
      entity_id: userId,
      details: {},
    });
    revalidatePath("/admin/users");
    return {
      status: "success",
      message: "临时密码已重置。对方下次登录后必须先设置自己的新密码。",
      email: target.user.email,
      temporaryPassword,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "重置密码失败" };
  }
}

export async function changeInitialPassword(
  _previousState: UserManagementState,
  formData: FormData,
): Promise<UserManagementState> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("登录已过期，请重新登录");
    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("password_confirmation") ?? "");
    if (!validPassword(password)) throw new Error("新密码至少 12 位，并同时包含字母和数字");
    if (password !== confirmation) throw new Error("两次输入的新密码不一致");
    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) throw new Error(passwordError.message);
    const { error: flagError } = await supabase.rpc("complete_initial_password_change");
    if (flagError) throw new Error(`新密码已经保存，但完成标记失败：${flagError.message}`);
    return { status: "success", message: "新密码已设置，正在进入学习系统。" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "修改密码失败" };
  }
}
