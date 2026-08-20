import Link from "next/link";
import { LibraryControls, LibraryPagination, type LibraryPackageChoice } from "@/components/library-controls";
import { LibraryPriorityManager, type LibraryRowView } from "@/components/library-priority-manager";
import { loadAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ learner?: string; q?: string; status?: string; attempts?: string; priority?: string; package?: string; page?: string }>;

type LibraryRow = LibraryRowView & {
  sequence: number;
  last_result: "known" | "again" | null;
  mastered_at: string | null;
  priority_selected_at: string | null;
  total_count: number;
  filtered_count: number;
  learned_total: number;
  stable_total: number;
  due_total: number;
  priority_total: number;
  priority_unstarted_total: number;
  priority_learning_total: number;
  priority_stable_total: number;
};

const PAGE_SIZE = 48;

function safeChoice(value: string | undefined, choices: readonly string[], fallback: string) {
  return value && choices.includes(value) ? value : fallback;
}

function safePage(value: string | undefined) {
  const page = Number(value ?? 1);
  return Number.isInteger(page) ? Math.max(1, Math.min(page, 100000)) : 1;
}

export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const params = await searchParams;
  const { data: { user } } = await supabase.auth.getUser();
  const access = user ? await loadAccessContext(supabase, user.id) : null;
  const query = (params.q ?? "").trim().slice(0, 60);
  const status = safeChoice(params.status, ["all", "unstarted", "learning", "learned", "stable", "mastered", "due"], "all");
  const attempts = safeChoice(params.attempts, ["all", "never", "1-2", "3-5", "6+"], "all");
  const priority = safeChoice(params.priority, ["all", "priority", "priority_unstarted", "priority_learning", "priority_stable"], "all");
  const page = safePage(params.page);
  const { data: learners, error: learnersError } = await supabase
    .from("learner_profiles")
    .select("id,display_name,daily_new_limit,active_package_id")
    .order("created_at", { ascending: true });

  if (learnersError) return <section className="panel"><h1>字库暂时打不开</h1><p className="error">{learnersError.message}</p></section>;
  const learner = learners?.find((item) => item.id === params.learner) ?? learners?.[0];
  if (!learner) return <section className="empty panel"><span className="empty-mark">🌱</span><h1>先创建孩子档案</h1><p className="lede">创建档案并导入字册后，就能在这里维护内容。</p><Link className="primary" href="/parent">去家长页</Link></section>;

  const { data: packageLinks, error: linksError } = await supabase
    .from("learner_content_packages")
    .select("package_id,linked_at")
    .eq("learner_id", learner.id)
    .eq("assignment_status", "active")
    .order("linked_at");
  if (linksError) return <section className="panel"><h1>还差最后一步</h1><p className="lede">请先在 Supabase SQL Editor 运行多字册修复脚本，之后刷新本页即可。</p><p className="notice">脚本位置：<code>supabase/006_multi_package_library.sql</code></p><p className="error">{linksError.message}</p></section>;
  const packageIds = (packageLinks ?? []).map((link) => link.package_id);
  if (packageIds.length === 0) return <section className="empty panel"><span className="empty-mark">📚</span><h1>{learner.display_name} 还没有可查看的字册</h1><p className="lede">请先运行 006 字册修复脚本；之后导入的每份 CSV 都会自动保留在这里。</p></section>;

  const { data: packageRows, error: packagesError } = await supabase
    .from("content_packages")
    .select("id,title,created_at")
    .in("id", packageIds)
    .order("created_at");
  if (packagesError) return <section className="panel"><h1>字库暂时打不开</h1><p className="error">{packagesError.message}</p></section>;
  const packages = (packageRows ?? []) as LibraryPackageChoice[];
  const selectedPackage = packages.find((item) => item.id === params.package);
  const packageId = selectedPackage?.id;

  const { data: resultRows, error: rowsError } = await supabase.rpc("get_library_rows", {
    p_learner_id: learner.id,
    p_query: query,
    p_status: status,
    p_attempts: attempts,
    p_priority: priority,
    p_package_id: packageId ?? null,
    p_page: page,
    p_page_size: PAGE_SIZE,
  });
  if (rowsError) return <section className="panel"><h1>字库查询规则还没有准备好</h1><p className="error">{rowsError.message}</p><p className="notice">请在 Supabase SQL Editor 确认已按顺序运行到 <code>supabase/016_adaptive_queue_and_shared_content_rpcs.sql</code>，然后刷新本页。</p></section>;

  const rows = (resultRows ?? []) as LibraryRow[];
  const { data: overviewRows, error: overviewError } = rows.length === 0
    ? await supabase.rpc("get_library_rows", { p_learner_id: learner.id, p_query: "", p_status: "all", p_attempts: "all", p_priority: "all", p_package_id: packageId ?? null, p_page: 1, p_page_size: 1 })
    : { data: rows, error: null };
  if (overviewError) return <section className="panel"><h1>字库暂时打不开</h1><p className="error">{overviewError.message}</p></section>;
  const overview = (overviewRows?.[0] ?? null) as LibraryRow | null;
  const totalCount = overview?.total_count ?? 0;
  const filteredCount = rows[0]?.filtered_count ?? (query || status !== "all" || attempts !== "all" || priority !== "all" ? 0 : totalCount);
  const pageCount = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const learnedCount = overview?.learned_total ?? 0;
  const stableCount = overview?.stable_total ?? 0;
  const dueCount = overview?.due_total ?? 0;
  const priorityCount = overview?.priority_total ?? 0;
  const priorityUnstartedCount = overview?.priority_unstarted_total ?? 0;
  const priorityLearningCount = overview?.priority_learning_total ?? 0;
  const priorityStableCount = overview?.priority_stable_total ?? 0;
  const unstartedCount = totalCount - learnedCount;
  const overviewTitle = selectedPackage ? selectedPackage.title : `全部已导入字册 · ${packages.length} 份`;

  return (
    <div key={`${learner.id}-${packageId ?? "all"}-${currentPage}-${status}-${attempts}-${priority}-${query}`}>
      <header className="hero"><p className="eyebrow">Character library</p><h1>字库 · 掌握情况</h1><p className="lede">这里汇总 {learner.display_name} 的全部导入字册；可以按某次导入筛选，也能看到每个字来自哪一份字册。</p></header>
      <LibraryControls learners={learners ?? []} learnerId={learner.id} packages={packages} packageId={packageId} query={query} status={status} attempts={attempts} priority={priority} />

      <section className="today-card library-summary">
        <p className="eyebrow">{overviewTitle}</p>
        <div className="today-grid">
          <div className="metric"><span className="metric-label">已学过</span><span className="metric-value">{learnedCount}</span><small>/ {totalCount} 字</small></div>
          <div className="metric"><span className="metric-label">稳定认识</span><span className="metric-value">{stableCount}</span><small>阶段 5 以上</small></div>
          <div className="metric"><span className="metric-label">现在该复习</span><span className="metric-value">{dueCount}</span><small>到期未复习</small></div>
        </div>
        <p className="small muted">还有 {unstartedCount} 个字尚未开始。阶段越高，下一次复习间隔越长；“现在复习”不代表没学会，只是记忆曲线提醒该再见面了。</p>
      </section>

      <section className="priority-overview" aria-label="重点字概况">
        <div className="priority-overview-head">
          <span className="priority-mark" aria-hidden="true">★</span>
          <div><p className="eyebrow">线下阅读配套</p><h2>重点字进度</h2></div>
        </div>
        <div className="priority-metrics">
          <div><span>重点字</span><strong>{priorityCount}</strong></div>
          <div><span>尚未开始</span><strong>{priorityUnstartedCount}</strong></div>
          <div><span>正在巩固</span><strong>{priorityLearningCount}</strong></div>
          <div><span>稳定掌握</span><strong>{priorityStableCount}</strong></div>
        </div>
        <p className="small muted">重点字只改变队列先后：未到复习日不会提前出现，答对、答错和复习间隔仍完全使用原来的记忆规则。</p>
      </section>

      <section className="panel">
        <div className="library-header"><div><h2>{learner.display_name} 的全部字库</h2><p className="library-meta">{overviewTitle} · 共 {totalCount} 个不同汉字 · 筛选到 {filteredCount} 个 · 每页 {PAGE_SIZE} 个</p></div></div>
        {rows.length === 0 ? <p className="notice">没有找到符合条件的汉字。可以清除筛选条件，或先从全部字库勾选重点字。</p> : <LibraryPriorityManager key={rows.map((row) => `${row.character_id}:${row.is_priority ? 1 : 0}`).join("|")} rows={rows} learnerId={learner.id} selectedPackage={selectedPackage} totalPriorityCount={priorityCount} canManageContent={Boolean(access?.isAdmin)} />}
        <LibraryPagination learnerId={learner.id} query={query} status={status} attempts={attempts} priority={priority} packageId={packageId} page={currentPage} pageCount={pageCount} />
      </section>
      <section className="panel"><h2>如何理解这些状态？</h2><p className="small muted">“还没学”表示还未记录过回答；“复习中”表示正在建立记忆；阶段 5–6 是稳定认识；阶段 7 是熟练掌握。不同字册中重复出现的同一个字会共享同一份学习记录和重点标记，但来源会全部标注。当天已经生成的学习队列不会中途重排，新保存的重点设置从后续尚未生成的队列开始生效。</p></section>
    </div>
  );
}
