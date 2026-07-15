import Link from "next/link";
import { PoemControls, PoemPagination } from "@/components/poem-controls";
import { formatPoemDate, loadPoemProgress, recommendationForPoem, type PoemProgress } from "@/lib/poems";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ learner?: string; q?: string; filter?: string; collection?: string; page?: string }>;
const PAGE_SIZE = 24;

function safeFilter(value: string | undefined) {
  return ["all", "never", "few", "unscored", "low", "stale"].includes(value ?? "") ? value! : "all";
}

function safePage(value: string | undefined) {
  const page = Number(value ?? 1);
  return Number.isInteger(page) ? Math.max(1, Math.min(page, 100000)) : 1;
}

function matchesFilter(poem: PoemProgress, filter: string) {
  const stale = poem.lastRecitedAt && new Date(poem.lastRecitedAt).getTime() < Date.now() - 14 * 24 * 60 * 60 * 1000;
  if (filter === "never") return poem.attemptCount === 0;
  if (filter === "few") return poem.attemptCount < 2;
  if (filter === "unscored") return poem.attemptCount > 0 && poem.scoreCount === 0;
  if (filter === "low") return poem.lastScore !== null && poem.lastScore <= 6;
  if (filter === "stale") return Boolean(stale);
  return true;
}

function poemHref(poemId: string, learnerId: string) {
  return `/poems/${poemId}?learner=${encodeURIComponent(learnerId)}`;
}

export default async function PoemsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: learners, error: learnersError } = await supabase.from("learner_profiles").select("id,display_name").order("created_at");
  if (learnersError) return <section className="panel"><h1>诗词背诵暂时打不开</h1><p className="error">{learnersError.message}</p></section>;
  const learner = learners?.find((item) => item.id === params.learner) ?? learners?.[0];
  if (!learner) return <section className="empty panel"><span className="empty-mark">🌱</span><h1>先创建孩子档案</h1><p className="lede">创建档案、导入诗词后，就能在这里记录每一次背诵。</p><Link className="primary" href="/parent">去家长页</Link></section>;

  let loaded: Awaited<ReturnType<typeof loadPoemProgress>>;
  try {
    loaded = await loadPoemProgress(supabase, learner.id);
  } catch (error) {
    return <section className="panel"><h1>诗词背诵还差最后一步</h1><p className="lede">请先在 Supabase SQL Editor 运行诗词模块数据库脚本，之后刷新本页即可。</p><p className="notice">脚本位置：<code>supabase/008_poem_recitation_mvp.sql</code></p><p className="error">{error instanceof Error ? error.message : "读取诗词数据失败"}</p></section>;
  }
  const { collections, poems } = loaded;
  if (collections.length === 0) return <section className="empty panel"><span className="empty-mark">卷</span><h1>{learner.display_name} 还没有诗词册</h1><p className="lede">先到家长页下载 CSV 模板，导入第一批 28 首诗词。</p><Link className="primary" href="/parent">去导入诗词</Link></section>;

  const query = (params.q ?? "").trim().slice(0, 60);
  const filter = safeFilter(params.filter);
  const selectedCollection = collections.find((collection) => collection.id === params.collection);
  const selectedPoemIds = selectedCollection
    ? new Set(poems.filter((poem) => poem.sourceCollectionIds.includes(selectedCollection.id)).map((poem) => poem.id))
    : null;
  const filtered = poems.filter((poem) => {
    const haystack = `${poem.title} ${poem.author} ${poem.dynasty ?? ""} ${poem.content}`.toLocaleLowerCase();
    return (!query || haystack.includes(query.toLocaleLowerCase())) && matchesFilter(poem, filter) && (!selectedPoemIds || selectedPoemIds.has(poem.id));
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(safePage(params.page), pageCount);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const practiced = poems.filter((poem) => poem.attemptCount > 0).length;
  const waitingScore = poems.filter((poem) => poem.attemptCount > 0 && poem.scoreCount === 0).length;
  const recommended = [...poems].sort((left, right) => {
    const order = (poem: PoemProgress) => poem.attemptCount === 0 ? 0 : poem.scoreCount === 0 ? 1 : poem.lastScore !== null && poem.lastScore <= 6 ? 2 : poem.attemptCount < 2 ? 3 : 4;
    return order(left) - order(right) || left.attemptCount - right.attemptCount || left.sequence - right.sequence;
  }).slice(0, 4);

  return <div>
    <header className="hero"><p className="eyebrow">Poem recitation</p><h1>诗词背诵 · 轻轻记下每一次。</h1><p className="lede">背诵可以在任何地方完成；这里负责记录哪天背过、背过几次，以及家长给出的掌握评分。</p></header>
    <PoemControls learners={learners ?? []} learnerId={learner.id} collections={collections} collectionId={selectedCollection?.id} query={query} filter={filter} />

    <section className="today-card poem-summary">
      <p className="eyebrow">{learner.display_name} 的背诵概览</p>
      <div className="today-grid"><div className="metric"><span className="metric-label">已打卡</span><span className="metric-value">{practiced}</span><small>/ {poems.length} 首</small></div><div className="metric"><span className="metric-label">背诵记录</span><span className="metric-value">{poems.reduce((sum, poem) => sum + poem.attemptCount, 0)}</span><small>每次背诵都单独保留</small></div><div className="metric"><span className="metric-label">待评分</span><span className="metric-value">{waitingScore}</span><small>已经练过，暂未打分</small></div></div>
      <p className="small muted">同一天背两遍会记录两次；“暂不评分”也很有价值，它说明孩子今天已经练过这首诗。</p>
    </section>

    <section className="panel poem-recommendations"><div className="section-heading"><div><h2>建议今天多看一看</h2><p className="library-meta">优先显示还没打卡、背得较少或等待家长评分的诗词。</p></div></div><div className="poem-suggestion-grid">{recommended.map((poem) => <Link key={poem.id} className="poem-suggestion" href={poemHref(poem.id, learner.id)}><span className="poem-suggestion-title">{poem.title}</span><span>{poem.author}{poem.dynasty ? ` · ${poem.dynasty}` : ""}</span><strong>{recommendationForPoem(poem)}</strong></Link>)}</div></section>

    <section className="panel">
      <div className="library-header"><div><h2>{learner.display_name} 的诗词册</h2><p className="library-meta">共 {poems.length} 首 · 筛选到 {filtered.length} 首 · 每页 {PAGE_SIZE} 首{selectedCollection ? ` · 来源：${selectedCollection.title}` : ""}</p></div></div>
      {rows.length === 0 ? <p className="notice">没有找到符合条件的诗词。</p> : <div className="poem-grid">{rows.map((poem) => <Link className="poem-card" key={poem.id} href={poemHref(poem.id, learner.id)}>
        <div className="poem-card-top"><span className="poem-card-seal">诗</span><span className="poem-card-source">{poem.sourceTitles.join(" · ")}</span></div>
        <h3>{poem.title}</h3><p className="poem-byline">{poem.author}{poem.dynasty ? ` · ${poem.dynasty}` : ""}</p>
        <div className="poem-card-stats"><span>背诵 {poem.attemptCount} 次</span><span>{poem.lastRecitedDate ? `最近 ${formatPoemDate(poem.lastRecitedDate)}` : "尚未打卡"}</span></div>
        <div className="poem-card-foot"><span className={`poem-status ${poem.attemptCount === 0 ? "unstarted" : poem.scoreCount === 0 ? "unscored" : poem.lastScore !== null && poem.lastScore <= 6 ? "needs-work" : "tracked"}`}>{recommendationForPoem(poem)}</span><span className="poem-score">{poem.lastScore !== null ? `最近 ${poem.lastScore} 分` : poem.attemptCount ? "未评分" : ""}</span></div>
      </Link>)}</div>}
      <PoemPagination learnerId={learner.id} query={query} filter={filter} collectionId={selectedCollection?.id} page={page} pageCount={pageCount} />
    </section>
  </div>;
}
