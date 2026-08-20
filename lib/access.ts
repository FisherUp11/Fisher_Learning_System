import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkspaceRole = "owner" | "admin" | "parent";

export type AccessContext = {
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  isAdmin: boolean;
  isOwner: boolean;
  familyId: string | null;
};

export async function loadAccessContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccessContext | null> {
  const { data: memberships, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id,role")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("joined_at")
    .limit(1);
  if (membershipError) throw new Error(`无法读取学习空间：${membershipError.message}`);
  const membership = memberships?.[0] as { workspace_id: string; role: WorkspaceRole } | undefined;
  if (!membership) return null;

  const [{ data: workspace, error: workspaceError }, { data: familyMemberships, error: familyError }] = await Promise.all([
    supabase.from("learning_workspaces").select("name").eq("id", membership.workspace_id).single(),
    supabase.from("family_members").select("family_id").eq("user_id", userId).eq("status", "active").limit(1),
  ]);
  if (workspaceError || !workspace) throw new Error("无法读取学习空间名称");
  if (familyError) throw new Error(`无法读取家庭关系：${familyError.message}`);

  return {
    workspaceId: membership.workspace_id,
    workspaceName: workspace.name,
    role: membership.role,
    isAdmin: membership.role === "owner" || membership.role === "admin",
    isOwner: membership.role === "owner",
    familyId: familyMemberships?.[0]?.family_id ?? null,
  };
}

export function assertAdmin(access: AccessContext | null): asserts access is AccessContext {
  if (!access?.isAdmin) throw new Error("只有学习空间管理员可以执行这项操作");
}

export function assertOwner(access: AccessContext | null): asserts access is AccessContext {
  if (!access?.isOwner) throw new Error("只有学习空间所有者可以执行这项操作");
}
