import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { loadLearnerDashboard } from "@/lib/dashboard";
import { beijingDate, describeHanziTerm, type HanziTerm } from "@/lib/hanzi-terms";
import { OwnerHanziTermManager } from "@/components/owner-hanzi-term-manager";
import { PinyinParentPanel } from "@/components/pinyin-parent-panel";
import { MODULE_LABELS, type ChildModuleKey } from "@/lib/module-keys";
import { LearnerSettingsEditor } from "@/components/learner-settings-editor";

export const dynamic = "force-dynamic";

export default async function ManagedLearnerPage({ params, searchParams }: {
  params: Promise<{ learnerId: string }>; searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { learnerId } = await params;
  if (!/^[\da-f-]{36}$/i.test(learnerId)) notFound();
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(db, user.id);
  if (!access?.isAdmin) redirect("/parent");
  const { data: learner, error } = await db.from("learner_profiles")
    .select("id,display_name,family_id,timezone,daily_new_limit,catechism_daily_new_limit,catechism_review_limit,hanzi_review_mode,hanzi_base_review_limit,hanzi_max_review_limit,families!inner(name,status,workspace_id)")
    .eq("id", learnerId).eq("families.workspace_id", access.workspaceId).maybeSingle();
  if (error || !learner) notFound();
  const family = (Array.isArray(learner.families) ? learner.families[0] : learner.families);
  const query = await searchParams;
  const q = (query.q ?? "").trim().slice(0, 60);
  const requestedPage = Number(query.page ?? 1);
  const page = Number.isInteger(requestedPage) ? Math.max(1, Math.min(10000, requestedPage)) : 1;
  const [dashboard, termResult, moduleResult, siblings, billing, events, library, parents] = await Promise.all([
    loadLearnerDashboard(db, learner.id),
    db.from("learner_hanzi_terms").select("learner_id,mode,starts_on,valid_until,version").eq("learner_id", learner.id).maybeSingle(),
    db.from("learner_module_access").select("module_key,enabled").eq("learner_id", learner.id),
    db.from("learner_profiles").select("id,display_name").eq("family_id", learner.family_id).order("created_at").order("id"),
    access.isOwner ? db.from("family_hanzi_billing").select("standard_learner_id").eq("family_id", learner.family_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    access.isOwner ? db.from("hanzi_term_events").select("id,created_at,action,months,amount_cents,after_state,note").eq("learner_id", learner.id).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: [], error: null }),
    db.rpc("get_library_rows", { p_learner_id: learner.id, p_query: q, p_status: "all", p_attempts: "all", p_priority: "all", p_package_id: null, p_page: page, p_page_size: 48 }),
    access.isOwner ? db.from("family_members").select("user_id").eq("family_id", learner.family_id).eq("status", "active") : Promise.resolve({ data: [], error: null }),
  ]);
  const term = termResult.data as HanziTerm | null;
  const enabled = Boolean(moduleResult.data?.find(row => row.module_key === "hanzi")?.enabled);
  const status = describeHanziTerm(term, enabled);
  // Parent account entry is independent of a child's license. Warn, never silently enable it.
  const parentIds = (parents.data ?? []).map(row => row.user_id);
  const accountFlags = access.isOwner && parentIds.length ? await db.from("account_module_access").select("user_id,enabled,workspace_members!inner(status)").eq("workspace_id", access.workspaceId).eq("module_key", "hanzi").eq("workspace_members.status", "active").in("user_id", parentIds) : { data: [], error: null };
  const rows = (library.data ?? []) as Array<{ character_id: string; hanzi: string; pinyin_marked: string; attempt_count: number; known_count: number; again_count: number; stage: number; needs_review: boolean; filtered_count: number; source_package_titles: string }>;
  const pages = Math.max(1, Math.ceil(Number(rows[0]?.filtered_count ?? 0) / 48));
  const href = (p: number) => `/admin/learners/${learner.id}?${new URLSearchParams({ q, page: String(p) })}`;
  return <div>
    <Link className="back-link" href="/admin/families">← 家庭与孩子</Link>
    <header className="hero"><p className="eyebrow">Managed child · Read-only overview</p><h1>{learner.display_name}</h1><p className="lede">{family?.name} · 管理查看，不会切换你的日常学习身份，也不会代孩子记成绩。</p><p className="small muted">家庭状态：{family?.status === "active" ? "正常" : "已停用"}</p></header>
    <section className="today-card"><div className="today-grid"><div className="metric"><span>已学汉字</span><strong className="metric-value">{dashboard.started}</strong></div><div className="metric"><span>稳定认识</span><strong className="metric-value">{dashboard.stable}</strong></div><div className="metric"><span>到期待复习</span><strong className="metric-value">{dashboard.due}</strong></div><div className="metric"><span>7 天首答率</span><strong className="metric-value">{dashboard.firstAttemptRate === null ? "—" : `${dashboard.firstAttemptRate}%`}</strong></div></div><p className="small muted">诗词册 {dashboard.assignedPoemCollections} · 音乐 {dashboard.assignedMusicItems} · 问答册 {dashboard.assignedCatechismCollections}</p></section>
    <section className="panel"><div className="library-header"><div><h2>汉字学习 · {status.label}</h2><p>{status.detail}</p></div><Link className="secondary compact" href={`/admin/assignments?learner=${learner.id}`}>分配学习资源</Link></div>
      {termResult.error ? <p className="notice">请先整段运行 supabase/038_child_hanzi_terms.sql，再使用有效期管理。</p> : <>
        <p className="small muted">汉字授权同时涵盖拼音和青蛙跳字；其他模块仍沿用原来的开关。到期只阻止新学习，不删除数据。</p>
        <div className="term-module-list">{moduleResult.data?.map(row => <span className="org-chip" key={row.module_key}>{MODULE_LABELS[row.module_key as ChildModuleKey]} · {row.module_key === "hanzi" ? status.label : row.enabled ? "已开通" : "未开通"}</span>)}</div>
        {access.isOwner && <>
          {(parents.error || accountFlags.error) ? <p className="notice">家长入口状态暂未读取成功。请在用户管理中确认家长账号正常且已开通汉字。</p> : !accountFlags.data?.some(row => row.enabled) && <p className="notice">这个家庭尚无已开启汉字入口的家长账号。孩子授权不会自动打开账号入口，请到 <Link href="/admin/users">用户管理</Link> 核对账号状态并开通。</p>}
          {(billing.error || events.error) ? <p className="error">收费资料读取失败，请刷新后再操作。</p> : <OwnerHanziTermManager key={learner.id} learnerId={learner.id} learnerName={learner.display_name} term={term} enabled={enabled} siblings={siblings.data ?? []} standardLearnerId={billing.data?.standard_learner_id ?? null} today={beijingDate()} />}
        </>}
        {!access.isOwner && <p className="notice">你可以查看概况和分配资源；有效期、收费记录仅 owner 可维护。</p>}
      </>}
    </section>
    <section className="panel"><h2>管理学习设置</h2><p className="small muted">明确在管理中心维护这位孩子的资料与节奏，不切换日常学习身份，不修改历史成绩。</p><LearnerSettingsEditor key={JSON.stringify(learner)} learner={learner} /></section>
    {access.isOwner && !events.error && <section className="panel"><h2>最近授权记录</h2><p className="small muted">仅记录 owner 人工确认的开通与收款，不代表在线支付凭证；最近 20 条，完整流水保留在数据库。</p><div className="list">{!events.data?.length ? <p className="muted">还没有人工调整。升级前已开通的权限按长期授权保留。</p> : events.data.map(event => <article className="list-row" key={event.id}><div><strong>{event.action === "term" ? `开通 / 续期 ${event.months} 个月 · ¥${event.amount_cents / 100}` : event.action === "permanent" ? "长期授权" : "暂停 / 恢复"}</strong><p className="small muted">{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(event.created_at))}{event.note ? ` · ${event.note}` : ""}</p></div></article>)}</div></section>}
    <section className="panel"><h2>字库与记忆进度</h2><form className="org-toolbar" action={`/admin/learners/${learner.id}`}><label>搜索汉字、拼音或释义<input name="q" defaultValue={q} /></label><button className="secondary">搜索</button></form>
      {library.error ? <p className="error">字库读取失败，请稍后刷新。</p> : <><p className="small muted">每页 48 字 · 只读查看，不改变重点字、阶段或学习次数。</p><div className="managed-character-grid">{rows.map(row => <article key={row.character_id}><strong>{row.hanzi}</strong><span>{row.pinyin_marked}</span><small>练 {row.attempt_count} 次 · 阶段 {row.stage}</small><small>认识 {row.known_count} · 再学 {row.again_count}{row.needs_review ? " · 待复习" : ""}</small><small title={row.source_package_titles}>{row.source_package_titles}</small></article>)}</div>{!rows.length && <p className="muted">没有符合条件的字。</p>}<nav className="term-pagination" aria-label="字库翻页">{page > 1 && <Link className="secondary compact" href={href(page - 1)}>上一页</Link>}<span>第 {page} 页{rows.length ? ` / ${pages}` : ""}</span>{page < pages && <Link className="secondary compact" href={href(page + 1)}>下一页</Link>}</nav></>}
    </section>
    <PinyinParentPanel supabase={db} learnerId={learner.id} learnerName={learner.display_name} timezone={learner.timezone} readOnly />
  </div>;
}
