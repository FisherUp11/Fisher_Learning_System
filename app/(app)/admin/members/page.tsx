import { redirect } from "next/navigation";
import { AdminInviteForm } from "@/components/admin-invite-form";
import { revokeWorkspaceInvitation } from "@/lib/admin-actions";
import { loadAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminMembersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(supabase, user.id);
  if (!access?.isOwner) redirect(access?.isAdmin ? "/admin" : "/parent");
  const [{ data: members }, { data: families }, { data: invitations }] = await Promise.all([
    supabase.from("workspace_members").select("user_id,role,status,joined_at").eq("workspace_id", access.workspaceId).order("joined_at"),
    supabase.from("families").select("id,name,status,family_members(user_id,status)").eq("workspace_id", access.workspaceId).order("created_at"),
    supabase.from("workspace_invitations").select("id,invited_email,family_name,status,expires_at,created_at").eq("workspace_id", access.workspaceId).order("created_at", { ascending: false }),
  ]);

  return <div><header className="hero"><p className="eyebrow">Families & access</p><h1>邀请新家庭</h1><p className="lede">邀请链接只显示一次、7 天有效，并且必须使用指定邮箱登录。</p></header>
    <section className="panel"><h2>生成邀请</h2><AdminInviteForm /></section>
    <section className="panel"><h2>家庭</h2><div className="family-list">{(families ?? []).map((family) => <article key={family.id}><span className="resource-kind">家</span><div><h3>{family.name}</h3><p>{family.status === "active" ? "正常" : "已归档"} · {(family.family_members ?? []).filter((member) => member.status === "active").length} 位家长</p></div></article>)}</div></section>
    <section className="panel"><h2>空间成员</h2><div className="family-list">{(members ?? []).map((member) => <article key={member.user_id}><span className="resource-kind">{member.role === "parent" ? "家" : "管"}</span><div><h3>{member.user_id === user.id ? user.email : `账号 ${member.user_id.slice(0, 8)}…`}</h3><p>{member.role === "owner" ? "所有者" : member.role === "admin" ? "管理员" : "家长"} · {member.status === "active" ? "正常" : "已停用"}</p></div></article>)}</div></section>
    <section className="panel"><h2>邀请记录</h2>{!invitations?.length ? <p className="notice">还没有发出邀请。</p> : <div className="invitation-list">{invitations.map((invitation) => {
      const expired = invitation.status === "pending" && new Date(invitation.expires_at) <= new Date();
      return <article key={invitation.id}><div><h3>{invitation.invited_email}</h3><p>{invitation.family_name} · {expired ? "已过期" : invitation.status === "pending" ? "待接受" : invitation.status === "accepted" ? "已加入" : invitation.status === "revoked" ? "已撤销" : "已过期"}</p></div>{invitation.status === "pending" && !expired && <form action={revokeWorkspaceInvitation}><input type="hidden" name="invitation_id" value={invitation.id} /><button className="text-button danger">撤销</button></form>}</article>;
    })}</div>}</section>
  </div>;
}
