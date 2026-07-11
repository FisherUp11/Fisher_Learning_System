import Link from "next/link";
import { LibraryControls, LibraryPagination } from "@/components/library-controls";
import { removeCharacterFromCurrentPackage, updateCharacterContent } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ learner?: string; q?: string; status?: string; attempts?: string; page?: string }>;

type LibraryRow = {
  character_id: string;
  hanzi: string;
  pinyin_marked: string;
  meaning: string;
  word_one: string | null;
  word_two: string | null;
  example_sentence: string | null;
  sequence: number;
  attempt_count: number;
  known_count: number;
  again_count: number;
  stage: number;
  due_at: string | null;
  last_result: "known" | "again" | null;
  consecutive_known: number;
  mastered_at: string | null;
  last_answered_at: string | null;
  needs_review: boolean;
  total_count: number;
  filtered_count: number;
  learned_total: number;
  stable_total: number;
  due_total: number;
};

const PAGE_SIZE = 48;
const stageNames = ["初次接触", "第 1 阶段", "第 2 阶段", "第 3 阶段", "第 4 阶段", "稳定认识", "长期记忆", "熟练掌握"];

function safeChoice(value: string | undefined, choices: readonly string[], fallback: string) {
  return value && choices.includes(value) ? value : fallback;
}

function safePage(value: string | undefined) {
  const page = Number(value ?? 1);
  return Number.isInteger(page) ? Math.max(1, Math.min(page, 100000)) : 1;
}

function formatDate(value: string | null) {
  if (!value) return "尚未安排";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(value));
}

function statusFor(row: LibraryRow) {
  if (row.attempt_count === 0) return { key: "unstarted", label: "还没学" };
  if (row.needs_review) return { key: "due", label: "现在复习" };
  if (row.stage >= 7) return { key: "mastered", label: "熟练掌握" };
  if (row.stage >= 5) return { key: "stable", label: "稳定认识" };
  return { key: "learning", label: "复习中" };
}

export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  const params = await searchParams;
  const query = (params.q ?? "").trim().slice(0, 60);
  const status = safeChoice(params.status, ["all", "unstarted", "learning", "learned", "stable", "mastered", "due"], "all");
  const attempts = safeChoice(params.attempts, ["all", "never", "1-2", "3-5", "6+"], "all");
  const page = safePage(params.page);
  const { data: learners, error: learnersError } = await supabase
    .from("learner_profiles")
    .select("id,display_name,daily_new_limit,active_package_id")
    .order("created_at", { ascending: true });

  if (learnersError) return <section className="panel"><h1>字库暂时打不开</h1><p className="error">{learnersError.message}</p></section>;
  const learner = learners?.find((item) => item.id === params.learner) ?? learners?.[0];
  if (!learner) return <section className="empty panel"><span className="empty-mark">🌱</span><h1>先创建孩子档案</h1><p className="lede">创建档案并导入字册后，就能在这里维护内容。</p><Link className="primary" href="/parent">去家长页</Link></section>;
  if (!learner.active_package_id) return <section className="empty panel"><span className="empty-mark">📚</span><h1>{learner.display_name} 还没有字册</h1><p className="lede">先在家长页选择这位孩子并上传 CSV。</p><Link className="primary" href="/parent">导入字册</Link></section>;

  const [{ data: packageRow, error: packageError }, { data: resultRows, error: rowsError }] = await Promise.all([
    supabase.from("content_packages").select("title").eq("id", learner.active_package_id).single(),
    supabase.rpc("get_library_rows", {
      p_learner_id: learner.id,
      p_query: query,
      p_status: status,
      p_attempts: attempts,
      p_page: page,
      p_page_size: PAGE_SIZE,
    }),
  ]);
  if (packageError) return <section className="panel"><h1>字库暂时打不开</h1><p className="error">{packageError.message}</p></section>;
  if (rowsError) return <section className="panel"><h1>还差最后一步</h1><p className="lede">请先在 Supabase SQL Editor 运行字库分页脚本，之后刷新本页即可。</p><p className="notice">脚本位置：<code>supabase/004_library_pagination.sql</code></p><p className="error">{rowsError.message}</p></section>;

  const rows = (resultRows ?? []) as LibraryRow[];
  // 即便筛选没有结果，也要取得总数；分页函数在空结果时没有返回数据行。
  const { data: overviewRows, error: overviewError } = rows.length === 0
    ? await supabase.rpc("get_library_rows", { p_learner_id: learner.id, p_query: "", p_status: "all", p_attempts: "all", p_page: 1, p_page_size: 1 })
    : { data: rows, error: null };
  if (overviewError) return <section className="panel"><h1>字库暂时打不开</h1><p className="error">{overviewError.message}</p></section>;
  const overview = (overviewRows?.[0] ?? null) as LibraryRow | null;
  const totalCount = overview?.total_count ?? 0;
  const filteredCount = rows[0]?.filtered_count ?? (query || status !== "all" || attempts !== "all" ? 0 : totalCount);
  const pageCount = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const learnedCount = overview?.learned_total ?? 0;
  const stableCount = overview?.stable_total ?? 0;
  const dueCount = overview?.due_total ?? 0;
  const unstartedCount = totalCount - learnedCount;

  return (
    <div key={`${learner.id}-${currentPage}-${status}-${attempts}-${query}`}>
      <header className="hero"><p className="eyebrow">Character library</p><h1>字库 · 掌握情况</h1><p className="lede">查看、修正 {learner.display_name} 正在学习的字册，也能按学习状态找到需要关心的字。</p></header>
      <LibraryControls learners={learners ?? []} learnerId={learner.id} query={query} status={status} attempts={attempts} />

      <section className="today-card library-summary">
        <p className="eyebrow">{packageRow.title}</p>
        <div className="today-grid">
          <div className="metric"><span className="metric-label">已学过</span><span className="metric-value">{learnedCount}</span><small>/ {totalCount} 字</small></div>
          <div className="metric"><span className="metric-label">稳定认识</span><span className="metric-value">{stableCount}</span><small>阶段 5 以上</small></div>
          <div className="metric"><span className="metric-label">现在该复习</span><span className="metric-value">{dueCount}</span><small>到期未复习</small></div>
        </div>
        <p className="small muted">还有 {unstartedCount} 个字尚未开始。阶段越高，下一次复习间隔越长；“现在复习”不代表没学会，只是记忆曲线提醒该再见面了。</p>
      </section>

      <section className="panel">
        <div className="library-header"><div><h2>{learner.display_name} 的字库</h2><p className="library-meta">共 {totalCount} 个字 · 筛选到 {filteredCount} 个 · 每页 {PAGE_SIZE} 个</p></div></div>
        {rows.length === 0 ? <p className="notice">没有找到符合条件的汉字。</p> : <div className="character-library">
          {rows.map((item) => {
            const itemStatus = statusFor(item);
            return <details className="library-row" key={item.character_id}>
              <summary>
                <span className="library-character" aria-hidden="true">{item.hanzi}</span>
                <span className="library-row-title"><strong>{item.pinyin_marked}</strong><span>{item.meaning}{item.word_one ? ` · ${item.word_one}` : ""}</span></span>
                <span className="library-quick-progress" aria-label={`${item.hanzi} 的学习概况`}>
                  <strong>学 {item.attempt_count} 次</strong>
                  <span>{item.attempt_count ? `${stageNames[item.stage]} · ${item.needs_review ? "现在复习" : `下次 ${formatDate(item.due_at)}`}` : "尚未开始"}</span>
                </span>
                <span className={`library-status ${itemStatus.key}`}>{itemStatus.label}</span>
              </summary>
              <div className="character-edit">
                <div className="learning-record" aria-label={`${item.hanzi} 的学习记录`}>
                  <div><span>回答</span><strong>{item.attempt_count} 次</strong></div>
                  <div><span>认识 / 再学</span><strong>{item.attempt_count ? `${item.known_count} / ${item.again_count}` : "—"}</strong></div>
                  <div><span>记忆阶段</span><strong>{item.attempt_count ? `${stageNames[item.stage]}（${item.stage} / 7）` : "尚未开始"}</strong></div>
                  <div><span>下一次复习</span><strong>{item.attempt_count ? (item.needs_review ? "现在就可以复习" : formatDate(item.due_at)) : "学完后安排"}</strong></div>
                </div>
                {item.attempt_count > 0 && <p className="library-meta">{item.last_answered_at ? `上次回答：${formatDate(item.last_answered_at)}；` : ""}{item.consecutive_known > 0 ? `连续认识 ${item.consecutive_known} 次。` : "最近一次选择了“再学一次”。"}</p>}
                <form action={updateCharacterContent} className="form-grid">
                  <input type="hidden" name="learner_id" value={learner.id} />
                  <input type="hidden" name="character_id" value={item.character_id} />
                  <label>拼音<input name="pinyin_marked" defaultValue={item.pinyin_marked} required maxLength={40} /></label>
                  <label>释义<input name="meaning" defaultValue={item.meaning} required maxLength={100} /></label>
                  <label>词语 1<input name="word_one" defaultValue={item.word_one ?? ""} maxLength={100} /></label>
                  <label>词语 2<input name="word_two" defaultValue={item.word_two ?? ""} maxLength={100} /></label>
                  <label>例句<input name="example_sentence" defaultValue={item.example_sentence ?? ""} maxLength={300} /></label>
                  <div className="character-edit-actions"><button className="secondary" type="submit">保存这个字</button></div>
                </form>
                <form action={removeCharacterFromCurrentPackage} className="remove-form">
                  <input type="hidden" name="learner_id" value={learner.id} />
                  <input type="hidden" name="character_id" value={item.character_id} />
                  <button className="text-button danger" type="submit">从 {learner.display_name} 的当前字册移除“{item.hanzi}”</button>
                </form>
              </div>
            </details>;
          })}
        </div>}
        <LibraryPagination learnerId={learner.id} query={query} status={status} attempts={attempts} page={currentPage} pageCount={pageCount} />
      </section>
      <section className="panel"><h2>如何理解这些状态？</h2><p className="small muted">“还没学”表示还未记录过回答；“复习中”表示正在建立记忆；阶段 5–6 是稳定认识；阶段 7 是熟练掌握，系统仍会在较长间隔后安排一次巩固。答错后会降级并尽快再见面。</p></section>
    </div>
  );
}
