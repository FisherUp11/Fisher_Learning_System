import { redirect } from "next/navigation";
import { OwnerUserCard, OwnerUserCreateForm } from "@/components/owner-user-manager";
import { loadAccessContext } from "@/lib/access";
import { loadLearnerDashboard } from "@/lib/dashboard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function formatLastSignIn(value: string | null | undefined) {
  if (!value) return "尚未登录";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export default async function OwnerUsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(supabase, user.id);
  if (!access?.isOwner) redirect(access?.isAdmin ? "/admin" : "/parent");

  const [membersResult, profilesResult, familiesResult, familyMembersResult, learnersResult] = await Promise.all([
    supabase.from("workspace_members").select("user_id,role,status,joined_at").eq("workspace_id", access.workspaceId).order("joined_at"),
    supabase.from("workspace_user_profiles").select("user_id,display_name,must_change_password").eq("workspace_id", access.workspaceId),
    supabase.from("families").select("id,name,status").eq("workspace_id", access.workspaceId).eq("status", "active").order("created_at"),
    supabase.from("family_members").select("family_id,user_id,status,families!inner(workspace_id)").eq("families.workspace_id", access.workspaceId),
    supabase.from("learner_profiles").select("id,display_name,timezone,family_id").order("created_at"),
  ]);
  const firstError = [membersResult.error, profilesResult.error, familiesResult.error, familyMembersResult.error, learnersResult.error].find(Boolean);
  if (firstError) throw new Error(`读取用户目录失败：${firstError.message}`);

  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.user_id, profile]));
  const familyByUser = new Map((familyMembersResult.data ?? []).filter((item) => item.status === "active").map((item) => [item.user_id, item.family_id]));
  const familyOptions = (familiesResult.data ?? []).map((family) => ({ id: family.id, name: family.name }));
  const dashboards = await Promise.all((learnersResult.data ?? []).map(async (learner) => ({
    learner,
    dashboard: await loadLearnerDashboard(supabase, learner.id, learner.timezone),
  })));

  let authDirectory = new Map<string, { email: string; lastSignInAt: string | null }>();
  let secretConfigError = "";
  try {
    const admin = createAdminClient();
    const authRows = await Promise.all((membersResult.data ?? []).map(async (member) => {
      const { data, error } = await admin.auth.admin.getUserById(member.user_id);
      if (error || !data.user) return [member.user_id, { email: `账号 ${member.user_id.slice(0, 8)}…`, lastSignInAt: null }] as const;
      return [member.user_id, { email: data.user.email ?? `账号 ${member.user_id.slice(0, 8)}…`, lastSignInAt: data.user.last_sign_in_at ?? null }] as const;
    }));
    authDirectory = new Map(authRows);
  } catch (error) {
    secretConfigError = error instanceof Error ? error.message : "Supabase Secret key 尚未配置";
    authDirectory.set(user.id, { email: user.email ?? "当前账号", lastSignInAt: user.last_sign_in_at ?? null });
  }

  return <div>
    <header className="hero"><p className="eyebrow">Owner only</p><h1>用户与家庭</h1><p className="lede">这是空间最高权限页面。owner 拥有全部管理员能力，并可创建账号、分配角色与家庭、停用访问和重置临时密码。</p></header>
    {secretConfigError && <section className="panel warning-panel"><h2>还差一项服务端配置</h2><p>{secretConfigError}</p><p>请按部署文档填写 <code>SUPABASE_SECRET_KEY</code>；在此之前，账号列表仍可查看，但不能创建账号或重置密码。</p></section>}
    <section className="panel"><div className="section-heading"><div><p className="eyebrow">New account</p><h2>创建登录账号</h2></div></div><OwnerUserCreateForm families={familyOptions} /></section>
    <section className="panel"><div className="section-heading"><div><p className="eyebrow">Account directory</p><h2>空间账号</h2></div><span className="library-meta">{membersResult.data?.length ?? 0} 个</span></div>
      <div className="owner-user-list">{(membersResult.data ?? []).map((member) => {
        const profile = profiles.get(member.user_id);
        const familyId = familyByUser.get(member.user_id) ?? null;
        const auth = authDirectory.get(member.user_id);
        const childPulses = dashboards.filter(({ learner }) => learner.family_id === familyId).map(({ learner, dashboard }) => ({ id: learner.id, name: learner.display_name, stable: dashboard.stable, due: dashboard.due, todayRemaining: dashboard.todayRemaining }));
        return <OwnerUserCard key={member.user_id} families={familyOptions} childPulses={childPulses} member={{
          userId: member.user_id,
          email: auth?.email ?? `账号 ${member.user_id.slice(0, 8)}…`,
          displayName: profile?.display_name ?? (member.role === "owner" ? "空间所有者" : member.role === "admin" ? "管理员" : "家长"),
          role: member.role,
          status: member.status,
          familyId,
          mustChangePassword: profile?.must_change_password ?? false,
          lastSignInLabel: formatLastSignIn(auth?.lastSignInAt),
          isOwner: member.role === "owner",
        }} />;
      })}</div>
    </section>
  </div>;
}
