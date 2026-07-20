import Link from "next/link";
import { buildCatechismQueue, catechismStageLabel, catechismStatus, formatCatechismDate, loadCatechismProgress, localDateInTimezone, type CatechismProgress } from "@/lib/catechism";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ learner?: string; q?: string; filter?: string; collection?: string; page?: string }>;
const PAGE_SIZE = 20;

function safePage(value: string | undefined) {
  const page = Number(value ?? 1);
  return Number.isInteger(page) ? Math.max(1, Math.min(100000, page)) : 1;
}

function safeFilter(value: string | undefined) {
  return ["all", "new", "again", "learning", "stable", "due"].includes(value ?? "") ? value! : "all";
}

function href(params: { learnerId: string; query: string; filter: string; collectionId?: string; page?: number }) {
  const search = new URLSearchParams({ learner: params.learnerId });
  if (params.query) search.set("q", params.query);
  if (params.filter !== "all") search.set("filter", params.filter);
  if (params.collectionId) search.set("collection", params.collectionId);
  if ((params.page ?? 1) > 1) search.set("page", String(params.page));
  return `/catechism?${search.toString()}`;
}

function matchesFilter(item: CatechismProgress, filter: string, today: string) {
  const status = catechismStatus(item, today).key;
  if (filter === "learning") return ["learning", "familiar"].includes(status);
  return filter === "all" || status === filter;
}

export default async function CatechismPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: learners, error: learnerError } = await supabase.from("learner_profiles").select("id,display_name,timezone,catechism_daily_new_limit,catechism_review_limit").order("created_at");
  if (learnerError) return <section className="panel"><h1>儿童信仰问答还差最后一步</h1><p className="lede">请先在 Supabase SQL Editor 运行数据库脚本，再刷新页面。</p><p className="notice"><code>supabase/010_catechism_learning_mvp.sql</code></p><p className="error">{learnerError.message}</p></section>;
  const learner = learners?.find((row) => row.id === params.learner) ?? learners?.[0];
  if (!learner) return <section className="empty panel"><span className="empty-mark">问</span><h1>先创建孩子档案</h1><p className="lede">创建孩子后，就能分配儿童信仰问答并记录每次背诵。</p><Link className="primary" href="/parent">去家长页</Link></section>;

  let loaded: Awaited<ReturnType<typeof loadCatechismProgress>>;
  try {
    loaded = await loadCatechismProgress(supabase, learner.id);
  } catch (error) {
    return <section className="panel"><h1>问答模块暂时打不开</h1><p className="notice">请确认已经整段运行 <code>supabase/010_catechism_learning_mvp.sql</code>。</p><p className="error">{error instanceof Error ? error.message : "读取失败"}</p></section>;
  }
  const { collections, items } = loaded;
  if (!collections.length) return <section className="empty panel"><span className="empty-mark">问</span><h1>{learner.display_name} 还没有问答册</h1><p className="lede">先下载 CSV 模板并导入“儿童信仰问答”。</p><Link className="primary" href="/catechism/manage">去导入问答册</Link></section>;

  const today = localDateInTimezone(learner.timezone);
  const queue = buildCatechismQueue(items, today, learner.catechism_daily_new_limit, learner.catechism_review_limit);
  const query = (params.q ?? "").trim().slice(0, 100);
  const filter = safeFilter(params.filter);
  const selectedCollection = collections.find((row) => row.id === params.collection);
  const filtered = items.filter((item) => {
    const haystack = `${item.sequence} ${item.questionZh} ${item.questionEn ?? ""} ${item.answerZh} ${item.answerEn ?? ""} ${item.scriptureReference ?? ""}`.toLocaleLowerCase();
    return (!query || haystack.includes(query.toLocaleLowerCase())) && matchesFilter(item, filter, today) && (!selectedCollection || item.collectionId === selectedCollection.id);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(safePage(params.page), pageCount);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const stable = items.filter((item) => item.stage >= 7).length;
  const practiced = items.filter((item) => item.totalAttempts > 0).length;
  const due = items.filter((item) => item.totalAttempts > 0 && item.nextReviewDate && item.nextReviewDate <= today).length;

  return <div>
    <header className="hero catechism-hero"><p className="eyebrow">Faith & memory</p><h1>儿童信仰问答</h1><p className="lede">中英文一起问，先让孩子口头回答，再揭晓答案。家长判断“背出来了”或“还要再背”，系统负责安排下一次。</p></header>
    <section className="catechism-switch panel">
      <form action="/catechism" method="get" className="learner-switch"><label>查看哪位孩子？<select name="learner" defaultValue={learner.id}>{learners?.map((row) => <option value={row.id} key={row.id}>{row.display_name}</option>)}</select></label><button className="secondary" type="submit">切换</button></form>
    </section>
    <section className="today-card catechism-overview">
      <div className="section-heading"><div><p className="eyebrow">{learner.display_name} 的今日安排</p><h2>{queue.queue.length ? `今天还有 ${queue.queue.length} 问` : "今天已经完成"}</h2></div><Link className="primary" href={`/catechism/study?learner=${encodeURIComponent(learner.id)}`}>{queue.queue.length ? "开始问一问" : "查看今日页面"}</Link></div>
      <div className="today-grid"><div className="metric"><span className="metric-label">已经开始</span><span className="metric-value">{practiced}</span><small>/ {items.length} 问</small></div><div className="metric"><span className="metric-label">稳定记住</span><span className="metric-value">{stable}</span><small>阶段 7</small></div><div className="metric"><span className="metric-label">今天到期</span><span className="metric-value">{due}</span><small>最多安排 {learner.catechism_review_limit} 问</small></div></div>
      <p className="small muted">每天默认 {learner.catechism_daily_new_limit} 个新问题、最多 {learner.catechism_review_limit} 个到期复习；家长可在“家长”页调整。</p>
    </section>
    <section className="panel catechism-library">
      <div className="library-header"><div><h2>{learner.display_name} 的问答册</h2><p className="library-meta">共 {items.length} 问 · 筛选到 {filtered.length} 问 · 每页 {PAGE_SIZE} 问{selectedCollection ? ` · ${selectedCollection.title}` : ""}</p></div><Link className="text-button" href="/catechism/manage">导入 / 修正内容</Link></div>
      <form action="/catechism" method="get" className="catechism-filters">
        <input type="hidden" name="learner" value={learner.id} />
        <label>搜索<input name="q" defaultValue={query} placeholder="问题、答案、英文或经文出处" /></label>
        <label>掌握状态<select name="filter" defaultValue={filter}><option value="all">全部状态</option><option value="new">未开始</option><option value="again">还要再背</option><option value="learning">正在学习</option><option value="stable">稳定记住</option><option value="due">今天到期</option></select></label>
        <label>问答册<select name="collection" defaultValue={selectedCollection?.id ?? ""}><option value="">全部问答册</option>{collections.map((row) => <option value={row.id} key={row.id}>{row.title}</option>)}</select></label>
        <button className="secondary" type="submit">筛选</button>
        {(query || filter !== "all" || selectedCollection) && <Link className="text-button" href={`/catechism?learner=${learner.id}`}>清除条件</Link>}
      </form>
      {rows.length ? <div className="catechism-list">{rows.map((item) => {
        const status = catechismStatus(item, today);
        return <details className="catechism-list-row" key={item.id}><summary><span className="catechism-number">{item.sequence}</span><span className="catechism-list-question"><strong>{item.questionZh}</strong><small lang="en">{item.questionEn ?? "暂无英文问题"}</small><em>{item.collectionTitle}</em></span><span className="catechism-list-stats"><strong>练习 {item.totalAttempts} 次</strong><small>背出 {item.successCount} · 再背 {item.againCount}</small><small>阶段 {item.stage} · {catechismStageLabel(item.stage)}</small></span><span className={`catechism-status ${status.key}`}>{status.label}</span></summary><div className="catechism-list-detail"><div><span>最近练习</span><strong>{formatCatechismDate(item.lastPracticedLocalDate)}</strong></div><div><span>下次复习</span><strong>{formatCatechismDate(item.nextReviewDate)}</strong></div><div><span>练习天数</span><strong>{new Set(item.attempts.map((attempt) => attempt.practicedLocalDate)).size} 天</strong></div><div><span>最近结果</span><strong>{item.lastResult === "recited" ? "背出来了" : item.lastResult === "again" ? "还要再背" : "尚未开始"}</strong></div>{item.parentNote && <p><span>家长说明：</span>{item.parentNote}</p>}{item.attempts.length > 0 && <section className="catechism-attempt-history"><h3>最近练习记录</h3>{item.attempts.slice(0, 8).map((attempt) => <div key={attempt.id}><span>{formatCatechismDate(attempt.practicedLocalDate)}</span><strong>{attempt.result === "recited" ? "背出来了" : "还要再背"}</strong><small>阶段 {attempt.stageBefore} → {attempt.stageAfter}{attempt.note ? ` · ${attempt.note}` : ""}</small></div>)}</section>}<Link className="catechism-practice-one" href={`/catechism/study?learner=${learner.id}&item=${item.id}`}>单独练这一问</Link></div></details>;
      })}</div> : <p className="notice">没有找到符合条件的问题。</p>}
      <nav className="library-pagination" aria-label="问答册分页"><Link aria-disabled={page <= 1} className={`secondary ${page <= 1 ? "disabled" : ""}`} href={page <= 1 ? href({ learnerId: learner.id, query, filter, collectionId: selectedCollection?.id, page }) : href({ learnerId: learner.id, query, filter, collectionId: selectedCollection?.id, page: page - 1 })}>上一页</Link><span>第 {page} / {pageCount} 页</span><Link aria-disabled={page >= pageCount} className={`secondary ${page >= pageCount ? "disabled" : ""}`} href={page >= pageCount ? href({ learnerId: learner.id, query, filter, collectionId: selectedCollection?.id, page }) : href({ learnerId: learner.id, query, filter, collectionId: selectedCollection?.id, page: page + 1 })}>下一页</Link></nav>
    </section>
  </div>;
}
