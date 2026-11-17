import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OwnerChildCreateForm } from "@/components/owner-child-create-form";
import { loadAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OwnerCreateChildPage({ searchParams }: { searchParams: Promise<{ family?: string; parent?: string }> }) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(db, user.id);
  if (!access?.isOwner) redirect(access?.isAdmin ? "/admin" : "/parent");
  const query = await searchParams;
  if (!/^[\da-f-]{36}$/i.test(query.family ?? "")) redirect("/admin/users");
  const [family, members, profiles, accounts, children] = await Promise.all([
    db.from("families").select("id,name,status").eq("workspace_id", access.workspaceId).eq("id", query.family!).maybeSingle(),
    db.from("family_members").select("user_id").eq("family_id", query.family!).eq("status", "active"),
    db.from("workspace_user_profiles").select("user_id,display_name").eq("workspace_id", access.workspaceId),
    db.from("workspace_members").select("user_id").eq("workspace_id", access.workspaceId).eq("status", "active"),
    db.from("learner_profiles").select("id,display_name").eq("family_id", query.family!).order("created_at"),
  ]);
  if (family.error || !family.data) notFound();
  if (members.error || profiles.error || accounts.error || children.error) throw new Error("家庭成员读取失败，请刷新后再试。");
  const activeIds = new Set((accounts.data ?? []).map(row => row.user_id));
  const names = new Map((profiles.data ?? []).map(row => [row.user_id, row.display_name]));
  const parents = (members.data ?? []).filter(row => activeIds.has(row.user_id)).map(row => ({ id: row.user_id, name: names.get(row.user_id) ?? `家长 ${row.user_id.slice(0, 8)}` }));
  const targetStillValid = !query.parent || parents.some(row => row.id === query.parent);
  const selectedParent = parents.some(row => row.id === query.parent) ? query.parent! : parents[0]?.id ?? "";
  return <div><Link className="back-link" href="/admin/users">← 用户与家庭</Link>
    <header className="hero"><p className="eyebrow">Owner · New child</p><h1>为家长添加孩子</h1><p className="lede">所属家庭：{family.data.name}。无需切换家长账号，也不会改变你日常查看的家庭。</p></header>
    <section className="panel"><h2>已有孩子</h2><p>{children.data?.length ? children.data.map(row => row.display_name).join("、") : "这个家庭还没有孩子档案。"}</p><p className="helper-text">先确认没有重复档案。建立后再设置试用 / 有效期，并分配学习资源。</p></section>
    <section className="panel">{!targetStillValid ? <p className="notice">原选家长已不再是这个家庭的正常成员，请返回用户管理重新核对。系统不会自动换到另一位家长名下。</p> : family.data.status !== "active" || !parents.length ? <p className="notice">家庭已停用或没有正常家长账号，请先到用户管理核对，系统不会自动恢复账号。</p> : <OwnerChildCreateForm familyId={family.data.id} parents={parents} selectedParent={selectedParent} />}</section>
  </div>;
}
