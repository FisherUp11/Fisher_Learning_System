"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assertAdmin, assertOwner, loadAccessContext } from "@/lib/access";
import { deleteR2Object, isR2Configured } from "@/lib/r2";

export type AdminActionState = {
  status: "idle" | "success" | "error";
  message: string;
  invitationPath?: string;
};

export type DuplicateCleanupState = {
  status: "idle" | "success" | "error";
  message: string;
};

async function adminClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录家长账号");
  const access = await loadAccessContext(supabase, user.id);
  assertAdmin(access);
  return { supabase, user, access };
}

async function ownerClient() {
  const result = await adminClient();
  assertOwner(result.access);
  return result;
}

export async function createWorkspaceInvitation(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  try {
    const { supabase, user, access } = await ownerClient();
    const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 320);
    const familyName = String(formData.get("family_name") ?? "").trim().slice(0, 80);
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("请填写正确的家长邮箱");
    if (!familyName) throw new Error("请填写家庭名称");
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const { error } = await supabase.from("workspace_invitations").insert({
      workspace_id: access.workspaceId,
      invited_email: email,
      family_name: familyName,
      token_hash: tokenHash,
      created_by: user.id,
    });
    if (error) throw new Error(error.message);
    await supabase.from("workspace_audit_events").insert({
      workspace_id: access.workspaceId,
      actor_user_id: user.id,
      event_type: "invitation.created",
      entity_type: "invitation",
      details: { email, family_name: familyName },
    });
    revalidatePath("/admin/members");
    return {
      status: "success",
      message: `已为 ${email} 生成 7 天有效的一次性邀请。`,
      invitationPath: `/join?token=${encodeURIComponent(token)}`,
    };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "生成邀请失败" };
  }
}

export async function revokeWorkspaceInvitation(formData: FormData) {
  const { supabase, access } = await ownerClient();
  const invitationId = String(formData.get("invitation_id") ?? "");
  const { error } = await supabase.from("workspace_invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("workspace_id", access.workspaceId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  revalidatePath("/admin/members");
}

export async function acceptWorkspaceInvitation(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/join?token=${token}`)}`);
  const { error } = await supabase.rpc("accept_workspace_invitation", { p_token: token });
  if (error) throw new Error(error.message);
  redirect("/parent?joined=1");
}

const resources = {
  hanzi: { table: "content_packages", label: "汉字册", assignmentTable: "learner_content_packages", resourceKey: "package_id" },
  poem: { table: "poem_collections", label: "诗词册", assignmentTable: "learner_poem_collections", resourceKey: "collection_id" },
  music: { table: "music_items", label: "音乐内容", assignmentTable: "learner_music_items", resourceKey: "item_id" },
  catechism: { table: "catechism_collections", label: "问答册", assignmentTable: "learner_catechism_collections", resourceKey: "collection_id" },
} as const;

export async function reviewWorkspaceResource(formData: FormData) {
  const { supabase, user, access } = await adminClient();
  const resourceType = String(formData.get("resource_type") ?? "") as keyof typeof resources;
  const resourceId = String(formData.get("resource_id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const resource = resources[resourceType];
  if (!resource || !resourceId || !["approve", "reject", "archive"].includes(decision)) throw new Error("审核参数不正确");
  const now = new Date().toISOString();
  const update = decision === "approve"
    ? { review_status: "approved", status: "published", approved_by: user.id, approved_at: now, updated_at: now }
    : decision === "reject"
      ? { review_status: "rejected", status: "draft", approved_by: null, approved_at: null, updated_at: now }
      : { status: "archived", updated_at: now };
  const { data, error } = await supabase.from(resource.table)
    .update(update)
    .eq("id", resourceId)
    .eq("workspace_id", access.workspaceId)
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? `找不到这份${resource.label}`);
  if (decision === "archive") {
    const { data: activeAssignments, error: assignmentReadError } = await supabase
      .from(resource.assignmentTable)
      .select("learner_id")
      .eq(resource.resourceKey, resourceId)
      .eq("assignment_status", "active");
    if (assignmentReadError) throw new Error(`资源已归档，但读取孩子分配失败：${assignmentReadError.message}`);
    const affectedLearnerIds = [...new Set((activeAssignments ?? []).map((assignment) => assignment.learner_id))];
    if (affectedLearnerIds.length) {
      const { error: deactivateError } = await supabase
        .from(resource.assignmentTable)
        .update({ assignment_status: "inactive", unassigned_at: now })
        .eq(resource.resourceKey, resourceId)
        .eq("assignment_status", "active");
      if (deactivateError) throw new Error(`资源已归档，但取消分配失败：${deactivateError.message}`);
      if (resourceType === "hanzi") {
        for (const learnerId of affectedLearnerIds) {
          const { data: learner } = await supabase.from("learner_profiles").select("active_package_id").eq("id", learnerId).single();
          if (learner?.active_package_id !== resourceId) continue;
          const { data: nextAssignments } = await supabase.from("learner_content_packages")
            .select("package_id")
            .eq("learner_id", learnerId)
            .eq("assignment_status", "active")
            .order("assignment_order")
            .limit(1);
          await supabase.from("learner_profiles").update({ active_package_id: nextAssignments?.[0]?.package_id ?? null }).eq("id", learnerId);
        }
      }
    }
  }
  await supabase.from("workspace_audit_events").insert({
    workspace_id: access.workspaceId,
    actor_user_id: user.id,
    event_type: `resource.${decision}`,
    entity_type: resourceType,
    entity_id: resourceId,
  });
  revalidatePath("/admin");
  revalidatePath("/admin/resources");
  revalidatePath("/admin/assignments");
  revalidatePath("/learn");
}

const assignments = {
  hanzi: { table: "learner_content_packages", resourceTable: "content_packages", key: "package_id" },
  poem: { table: "learner_poem_collections", resourceTable: "poem_collections", key: "collection_id" },
  music: { table: "learner_music_items", resourceTable: "music_items", key: "item_id" },
  catechism: { table: "learner_catechism_collections", resourceTable: "catechism_collections", key: "collection_id" },
} as const;

export async function toggleWorkspaceAssignment(formData: FormData) {
  const { supabase, user, access } = await adminClient();
  const resourceType = String(formData.get("resource_type") ?? "") as keyof typeof assignments;
  const learnerId = String(formData.get("learner_id") ?? "");
  const resourceId = String(formData.get("resource_id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  const assignment = assignments[resourceType];
  if (!assignment || !learnerId || !resourceId) throw new Error("分配参数不正确");

  const [{ data: learner }, { data: resource }] = await Promise.all([
    supabase.from("learner_profiles").select("id,active_package_id,families!inner(workspace_id)").eq("id", learnerId).single(),
    supabase.from(assignment.resourceTable).select("id,status,review_status").eq("id", resourceId).eq("workspace_id", access.workspaceId).single(),
  ]);
  const learnerWorkspace = (learner as { families?: { workspace_id?: string } | Array<{ workspace_id?: string }> } | null)?.families;
  const learnerWorkspaceId = Array.isArray(learnerWorkspace) ? learnerWorkspace[0]?.workspace_id : learnerWorkspace?.workspace_id;
  if (!learner || learnerWorkspaceId !== access.workspaceId) throw new Error("孩子不属于当前学习空间");
  if (!resource || resource.status !== "published" || resource.review_status !== "approved") throw new Error("资源需要先审核通过并发布");

  const row: Record<string, unknown> = {
    learner_id: learnerId,
    [assignment.key]: resourceId,
    assigned_by: user.id,
    assignment_status: active ? "active" : "inactive",
    unassigned_at: active ? null : new Date().toISOString(),
  };
  if (resourceType === "hanzi") {
    const { count } = await supabase.from("learner_content_packages")
      .select("package_id", { count: "exact", head: true })
      .eq("learner_id", learnerId)
      .eq("assignment_status", "active");
    row.assignment_order = Math.max(1, (count ?? 0) + 1);
  }
  const { error } = await supabase.from(assignment.table).upsert(row);
  if (error) throw new Error(error.message);
  if (resourceType === "hanzi") {
    if (active && !learner.active_package_id) {
      await supabase.from("learner_profiles").update({ active_package_id: resourceId }).eq("id", learnerId);
    } else if (!active && learner.active_package_id === resourceId) {
      const { data: next } = await supabase.from("learner_content_packages")
        .select("package_id")
        .eq("learner_id", learnerId)
        .eq("assignment_status", "active")
        .neq("package_id", resourceId)
        .order("assignment_order")
        .limit(1);
      await supabase.from("learner_profiles").update({ active_package_id: next?.[0]?.package_id ?? null }).eq("id", learnerId);
    }
  }
  await supabase.from("workspace_audit_events").insert({
    workspace_id: access.workspaceId,
    actor_user_id: user.id,
    event_type: active ? "assignment.activated" : "assignment.deactivated",
    entity_type: resourceType,
    entity_id: resourceId,
    details: { learner_id: learnerId },
  });
  revalidatePath("/admin/assignments");
  revalidatePath("/learn");
  revalidatePath("/poems");
  revalidatePath("/music");
  revalidatePath("/catechism");
}

export async function consolidateDuplicateResource(
  _previousState: DuplicateCleanupState,
  formData: FormData,
): Promise<DuplicateCleanupState> {
  try {
    const { supabase } = await ownerClient();
    const resourceType = String(formData.get("resource_type") ?? "");
    const keepId = String(formData.get("keep_id") ?? "");
    const removeId = String(formData.get("remove_id") ?? "");
    if (!['hanzi', 'poem', 'music', 'catechism'].includes(resourceType) || !keepId || !removeId) throw new Error("请选择要保留和清理的重复资源");
    const { data, error } = await supabase.rpc("owner_merge_duplicate_resource", {
      p_resource_type: resourceType,
      p_keep_id: keepId,
      p_remove_id: removeId,
    });
    if (error) throw new Error(error.message);
    const result = (data ?? {}) as { assignment_rows?: number; object_keys?: string[] };
    const objectKeys = Array.isArray(result.object_keys) ? result.object_keys.filter(Boolean) : [];
    let mediaWarning = "";
    if (objectKeys.length) {
      if (!isR2Configured()) {
        mediaWarning = ` 数据库记录已安全合并，但 R2 未配置，${objectKeys.length} 个旧媒体对象需要按文档手动删除。`;
      } else {
        const deletions = await Promise.allSettled(objectKeys.map((objectKey) => deleteR2Object(objectKey)));
        const failed = deletions.filter((item) => item.status === "rejected").length;
        if (failed) mediaWarning = ` 数据库记录已安全合并，但有 ${failed} 个 R2 文件删除失败，请按文档手动检查。`;
      }
    }
    revalidatePath("/admin");
    revalidatePath("/admin/resources");
    revalidatePath("/admin/assignments");
    revalidatePath("/learn");
    revalidatePath("/poems");
    revalidatePath("/music");
    revalidatePath("/catechism");
    return { status: "success", message: `重复资源已合并，迁移/确认了 ${result.assignment_rows ?? 0} 条孩子分配；被清理资源不再显示。${mediaWarning}` };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "重复资源清理失败" };
  }
}
