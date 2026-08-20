import Link from "next/link";
import { redirect } from "next/navigation";
import { loadAccessContext } from "@/lib/access";
import { loadLearnerDashboard } from "@/lib/dashboard";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(supabase, user.id);
  if (!access?.isAdmin) redirect("/parent");

  const [{ data: learners }, { count: familyCount }, packageResult, poemResult, musicResult, catechismResult] = await Promise.all([
    supabase.from("learner_profiles").select("id,display_name,timezone,family_id,families(name)").order("created_at"),
    supabase.from("families").select("id", { count: "exact", head: true }).eq("workspace_id", access.workspaceId).eq("status", "active"),
    supabase.from("content_packages").select("id,review_status").eq("workspace_id", access.workspaceId),
    supabase.from("poem_collections").select("id,review_status").eq("workspace_id", access.workspaceId),
    supabase.from("music_items").select("id,review_status").eq("workspace_id", access.workspaceId),
    supabase.from("catechism_collections").select("id,review_status").eq("workspace_id", access.workspaceId),
  ]);
  const dashboards = await Promise.all((learners ?? []).map(async (learner) => ({
    learner,
    dashboard: await loadLearnerDashboard(supabase, learner.id, learner.timezone),
  })));
  const allResources = [packageResult, poemResult, musicResult, catechismResult].flatMap((result) => result.data ?? []);
  const pending = allResources.filter((resource) => resource.review_status === "pending_review").length;

  return <div>
    <header className="hero admin-hero"><p className="eyebrow">Workspace admin</p><h1>{access.workspaceName}</h1><p className="lede">像班主任一样管理公共资源和分配，同时只用学习事实来看孩子的节奏。</p></header>
    <section className="today-card"><div className="today-grid admin-metrics">
      <div className="metric"><span className="metric-label">家庭</span><strong className="metric-value">{familyCount ?? 0}</strong></div>
      <div className="metric"><span className="metric-label">孩子</span><strong className="metric-value">{learners?.length ?? 0}</strong></div>
      <div className="metric"><span className="metric-label">公共资源</span><strong className="metric-value">{allResources.length}</strong></div>
      <div className="metric"><span className="metric-label">待审核</span><strong className="metric-value">{pending}</strong></div>
    </div></section>
    <section className="admin-shortcuts">
      <Link href="/admin/resources"><span>库</span><strong>审核资源<small>去重、发布与归档</small></strong></Link>
      <Link href="/admin/assignments"><span>配</span><strong>分配内容<small>按孩子管理学习册</small></strong></Link>
      {access.isOwner && <Link href="/admin/users"><span>人</span><strong>用户与家庭<small>账号、角色、密码与孩子概况</small></strong></Link>}
      {access.isOwner && <Link href="/admin/members"><span>邀</span><strong>邀请已有账号<small>一次性安全邀请</small></strong></Link>}
    </section>
    <section className="panel"><div className="section-heading"><div><p className="eyebrow">Learner pulse</p><h2>孩子学习概况</h2></div><Link className="text-button" href="/parent">进入详细家长看板</Link></div>
      {!dashboards.length ? <p className="notice">尚无孩子档案。邀请家长加入后，由家长创建孩子。</p> : <div className="learner-admin-grid">{dashboards.map(({ learner, dashboard }) => {
        const family = learner.families as { name?: string } | Array<{ name?: string }> | null;
        const familyName = Array.isArray(family) ? family[0]?.name : family?.name;
        return <article className="learner-admin-card" key={learner.id}>
          <div><span className="child-sprout">🌱</span><h3>{learner.display_name}</h3><p>{familyName ?? "未命名家庭"}</p></div>
          <dl><div><dt>稳定认识</dt><dd>{dashboard.stable}</dd></div><div><dt>当前到期</dt><dd>{dashboard.due}</dd></div><div><dt>7 天首答</dt><dd>{dashboard.firstAttemptRate === null ? "—" : `${dashboard.firstAttemptRate}%`}</dd></div><div><dt>今日待完成</dt><dd>{dashboard.todayRemaining}</dd></div></dl>
          <Link className="secondary" href={`/parent?learner=${learner.id}`}>查看详情</Link>
        </article>;
      })}</div>}
    </section>
  </div>;
}
