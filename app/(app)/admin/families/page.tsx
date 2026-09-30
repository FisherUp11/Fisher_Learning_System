import Link from "next/link";
import { redirect } from "next/navigation";
import { loadAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { displayCatechismTitle } from "@/lib/catechism";
import { attentionReasons, firstTryRate, loadWorkspaceOverview, overviewNow, type LearnerOverview } from "@/lib/workspace-overview";

export const dynamic = "force-dynamic";

type Titled = { learner_id: string; title: string };
const titleOf = (value: unknown) => {
  const row = (Array.isArray(value) ? value[0] : value) as { title?: string } | null;
  return row?.title ?? "";
};
const ago = (iso: string | null) => {
  if (!iso) return "从未";
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
};

export default async function FamiliesPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(supabase, user.id);
  if (!access?.isAdmin) redirect("/parent");
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 40);
  const view = params.view === "attention" || params.view === "inactive" ? params.view : "all";

  const [overview, familiesResult, membersResult, profilesResult, packages, poems, catechism, folders] = await Promise.all([
    loadWorkspaceOverview(supabase, access.workspaceId),
    supabase.from("families").select("id,name,status,created_at").eq("workspace_id", access.workspaceId).order("created_at"),
    supabase.from("family_members").select("family_id,user_id,status"),
    supabase.from("workspace_user_profiles").select("user_id,display_name"),
    supabase.from("learner_content_packages").select("learner_id,content_packages!inner(title,status,review_status)").eq("assignment_status", "active").eq("content_packages.status", "published").eq("content_packages.review_status", "approved"),
    supabase.from("learner_poem_collections").select("learner_id,poem_collections!inner(title,status,review_status)").eq("assignment_status", "active").eq("poem_collections.status", "published").eq("poem_collections.review_status", "approved"),
    supabase.from("learner_catechism_collections").select("learner_id,catechism_collections!inner(title,status,review_status)").eq("assignment_status", "active").eq("catechism_collections.status", "published").eq("catechism_collections.review_status", "approved"),
    supabase.from("learner_music_folders").select("learner_id,music_folders!inner(title)").eq("assignment_status", "active"),
  ]);
  if (!overview) return <section className="panel"><h1>家庭与孩子总览还差一步</h1><p className="notice">请先在 Supabase SQL Editor 整段运行 <code>supabase/022_music_folders_activity_and_cost.sql</code>，然后刷新。</p><Link className="secondary" href="/admin">返回管理首页</Link></section>;

  const titled = (rows: unknown[] | null, key: string): Titled[] => (rows ?? []).map((row) => ({ learner_id: (row as { learner_id: string }).learner_id, title: titleOf((row as Record<string, unknown>)[key]) }));
  const resourcesBy = (rows: Titled[]) => {
    const map = new Map<string, string[]>();
    for (const row of rows) map.set(row.learner_id, [...(map.get(row.learner_id) ?? []), row.title]);
    return map;
  };
  const packageMap = resourcesBy(titled(packages.data, "content_packages"));
  const poemMap = resourcesBy(titled(poems.data, "poem_collections"));
  const catechismMap = resourcesBy(titled(catechism.data, "catechism_collections").map((row) => ({ ...row, title: displayCatechismTitle(row.title) })));
  const folderMap = resourcesBy(folders.error ? [] : titled(folders.data, "music_folders"));
  const assignedCount = (row: LearnerOverview) => (packageMap.get(row.learner_id)?.length ?? 0) + (poemMap.get(row.learner_id)?.length ?? 0) + (catechismMap.get(row.learner_id)?.length ?? 0) + Number(row.music_items_assigned);

  const names = new Map((profilesResult.data ?? []).map((profile) => [profile.user_id, profile.display_name as string]));
  const parentsOf = (familyId: string) => (membersResult.data ?? []).filter((member) => member.family_id === familyId && member.status === "active").map((member) => names.get(member.user_id) ?? "家长");
  const families = (familiesResult.data ?? []).filter((family) => family.status === "active" || overview.some((row) => row.family_id === family.id));

  const week = 7 * 86_400_000;
  const now = overviewNow();
  const activeThisWeek = overview.filter((row) => row.last_activity_at && now - new Date(row.last_activity_at).getTime() <= week);
  const flagged = overview.map((row) => ({ row, reasons: attentionReasons(row, assignedCount(row)) })).filter((item) => item.reasons.length);
  const matches = (row: LearnerOverview) => {
    if (query && !`${row.display_name} ${row.family_name} ${parentsOf(row.family_id).join(" ")}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (view === "attention") return attentionReasons(row, assignedCount(row)).length > 0;
    if (view === "inactive") return !row.last_activity_at || now - new Date(row.last_activity_at).getTime() > week;
    return true;
  };
  const familyMatches = (family: { id: string; name: string }) => !query || `${family.name} ${parentsOf(family.id).join(" ")}`.toLowerCase().includes(query.toLowerCase());
  const visibleFamilies = families.map((family) => ({ family, kids: overview.filter((row) => row.family_id === family.id && (matches(row) || (view === "all" && familyMatches(family)))) }))
    .filter(({ family, kids }) => kids.length || (view === "all" && familyMatches(family) && !overview.some((row) => row.family_id === family.id)));
  const openAll = visibleFamilies.length <= 6 || Boolean(query) || view !== "all";

  return <div>
    <header className="hero admin-hero"><p className="eyebrow">Families &amp; children</p><h1>家庭与孩子总览</h1><p className="lede">像组织图一样：空间 → 家庭 → 孩子。点开家庭即可看到每个孩子最近的学习情况和已分配资源。</p></header>
    <section className="today-card"><div className="today-grid admin-metrics">
      <div className="metric"><span className="metric-label">家庭</span><strong className="metric-value">{families.filter((family) => family.status === "active").length}</strong></div>
      <div className="metric"><span className="metric-label">孩子</span><strong className="metric-value">{overview.length}</strong></div>
      <div className="metric"><span className="metric-label">7 天内学习过</span><strong className="metric-value">{activeThisWeek.length}</strong></div>
      <div className="metric"><span className="metric-label">需要关注</span><strong className="metric-value">{flagged.length}</strong></div>
    </div></section>

    {flagged.length > 0 && <section className="panel"><h2>提醒</h2><ul className="plain-list">{flagged.slice(0, 12).map(({ row, reasons }) => <li key={row.learner_id}><Link href={`/parent?learner=${row.learner_id}`}>{row.display_name}</Link>（{row.family_name}）：{reasons.join("、")}</li>)}</ul>{flagged.length > 12 && <p className="org-empty-note">还有 {flagged.length - 12} 位，选择“只看需要关注”查看全部。</p>}</section>}

    <section className="panel">
      <form className="org-toolbar" action="/admin/families" method="get">
        <label>搜索孩子、家庭或家长<input name="q" defaultValue={query} placeholder="例如：小满、王家" /></label>
        <label>显示<select name="view" defaultValue={view}><option value="all">全部</option><option value="attention">只看需要关注</option><option value="inactive">7 天未学习</option></select></label>
        <button className="secondary" type="submit">筛选</button>
        {(query || view !== "all") && <Link className="text-button" href="/admin/families">清除</Link>}
      </form>
    </section>

    <section className="panel">
      <div className="org-root"><span className="org-family-mark" aria-hidden="true">空</span><div><strong>{access.workspaceName}</strong><small>{access.isOwner ? "你是空间所有者" : "你是空间管理员"} · {families.length} 个家庭 · {overview.length} 个孩子</small></div></div>
      {!visibleFamilies.length ? <p className="notice">没有符合条件的家庭或孩子。</p> : <div className="org-tree">{visibleFamilies.map(({ family, kids }) => {
        const allKids = overview.filter((row) => row.family_id === family.id);
        const familyFlags = allKids.filter((row) => attentionReasons(row, assignedCount(row)).length).length;
        const parents = parentsOf(family.id);
        return <details className="org-family" key={family.id} open={openAll || family.id === access.familyId}>
          <summary>
            <span className="org-family-mark" aria-hidden="true">家</span>
            <span className="org-family-title"><strong>{family.name}{family.id === access.familyId ? "（我的家庭）" : ""}{family.status !== "active" ? "（已停用）" : ""}</strong><small>{parents.length ? `家长：${parents.join("、")}` : "家长信息仅 owner 可见"}</small></span>
            <span className="org-chip">{allKids.length} 个孩子</span>
            {familyFlags > 0 ? <span className="org-chip warn">{familyFlags} 位需关注</span> : allKids.length > 0 && <span className="org-chip good">状态良好</span>}
          </summary>
          <div className="org-kids">{!kids.length ? <p className="org-empty-note">这个家庭还没有创建孩子档案。</p> : kids.map((row) => {
            const reasons = attentionReasons(row, assignedCount(row));
            const rate = firstTryRate(row);
            const records = Number(row.answers_7d) + Number(row.poem_records_7d) + Number(row.game_sessions_7d) + Number(row.music_records_7d) + Number(row.catechism_records_7d);
            const folderTitles = folderMap.get(row.learner_id) ?? [];
            return <article className="org-kid" key={row.learner_id}>
              <div className="org-kid-head"><span aria-hidden="true">🌱</span><h3>{row.display_name}</h3><span className="org-chip">最近学习：{ago(row.last_activity_at)}</span>{reasons.map((reason) => <span className="org-chip warn" key={reason}>{reason}</span>)}</div>
              <dl>
                <div><dt>7 天使用</dt><dd>{Math.round(Number(row.active_seconds_7d) / 60)} 分</dd></div>
                <div><dt>7 天学习天数</dt><dd>{row.active_days_7d}</dd></div>
                <div><dt>7 天学习记录</dt><dd>{records}</dd></div>
                <div><dt>稳定认识字</dt><dd>{row.hanzi_stable}</dd></div>
                <div><dt>到期待复习</dt><dd>{row.hanzi_due}</dd></div>
                <div><dt>7 天首答率</dt><dd>{rate === null ? "—" : `${rate}%`}</dd></div>
              </dl>
              <div className="org-resources">
                <span>字册：{packageMap.get(row.learner_id)?.join("、") || <em>无</em>}</span>
                <span>诗词：{poemMap.get(row.learner_id)?.join("、") || <em>无</em>}</span>
                <span>音乐：{row.music_items_assigned} 条{folderTitles.length ? `（文件夹：${folderTitles.join("、")}）` : ""}</span>
                <span>问答：{catechismMap.get(row.learner_id)?.join("、") || <em>无</em>}</span>
              </div>
              <div className="org-kid-links"><Link className="secondary compact" href={`/parent?learner=${row.learner_id}`}>学习详情</Link><Link className="secondary compact" href={`/admin/assignments?learner=${row.learner_id}`}>分配内容</Link><Link className="text-button" href={`/library?learner=${row.learner_id}`}>字库</Link><Link className="text-button" href={`/poems?learner=${row.learner_id}`}>诗词</Link></div>
            </article>;
          })}</div>
        </details>;
      })}</div>}
    </section>
    <section className="panel"><p className="library-meta">“最近学习”取各模块学习记录和 App 使用时间中最新的一次；使用时长从运行 022 脚本并部署新版后开始累计。</p>{access.isOwner && <Link className="text-button" href="/admin/members">邀请新的家庭 →</Link>}</section>
  </div>;
}
