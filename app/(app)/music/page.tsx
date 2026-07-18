import Link from "next/link";
import { loadMusicProgress, type MusicProgress } from "@/lib/music-data";
import { currentMusicTimestamp, formatMusicDate, musicRecommendation, musicStageNames, musicTypeMeta } from "@/lib/music";
import { createClient } from "@/lib/supabase/server";
import type { MusicItemType } from "@/lib/music-actions";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ learner?: string; type?: string }>;

function typeChoice(value: string | undefined): MusicItemType | "all" {
  return (["song", "instrument", "rhythm"] as string[]).includes(value ?? "") ? value as MusicItemType : "all";
}

function priority(item: MusicProgress, now: number) {
  if (!item.attemptCount) return 0;
  if (["instrument_again", "rhythm_again"].includes(item.lastResult ?? "")) return 1;
  if (item.dueAt && new Date(item.dueAt).getTime() <= now) return 2;
  return 3 + item.stage;
}

export default async function MusicPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: learners, error: learnerError } = await supabase.from("learner_profiles").select("id,display_name").order("created_at");
  if (learnerError) return <section className="panel"><h1>音乐天地暂时打不开</h1><p className="error">{learnerError.message}</p></section>;
  const learner = learners?.find((item) => item.id === params.learner) ?? learners?.[0];
  if (!learner) return <section className="empty panel"><span className="empty-mark">♪</span><h1>先创建孩子档案</h1><Link className="primary" href="/parent">去家长页</Link></section>;
  let items: MusicProgress[];
  try {
    items = await loadMusicProgress(supabase, learner.id);
  } catch (error) {
    return <section className="panel"><h1>音乐天地还差最后一步</h1><p className="lede">请先在 Supabase SQL Editor 运行音乐模块数据库脚本。</p><p className="notice"><code>supabase/009_music_learning_mvp.sql</code></p><p className="error">{error instanceof Error ? error.message : "读取失败"}</p></section>;
  }
  const selectedType = typeChoice(params.type);
  const now = currentMusicTimestamp();
  const visibleItems = selectedType === "all" ? items : items.filter((item) => item.itemType === selectedType);
  const attempts = items.reduce((sum, item) => sum + item.attemptCount, 0);
  const due = items.filter((item) => !item.attemptCount || (item.dueAt && new Date(item.dueAt).getTime() <= now)).length;
  const stable = items.filter((item) => item.stage >= 5).length;
  const recommended = [...items].sort((left, right) => priority(left, now) - priority(right, now) || left.attemptCount - right.attemptCount).slice(0, 6);
  const learnerQuery = `learner=${encodeURIComponent(learner.id)}`;
  return <div>
    <header className="hero music-home-hero"><p className="eyebrow">Music garden</p><h1>音乐天地</h1><p className="lede">听一听，唱一唱，再把节奏轻轻拍出来。每一次练习，都会留下温柔而清楚的记录。</p></header>
    {learners && learners.length > 1 && <form className="learner-switch" method="get"><label>今天和哪位孩子练习？<select name="learner" defaultValue={learner.id}>{learners.map((choice) => <option value={choice.id} key={choice.id}>{choice.display_name}</option>)}</select></label><button className="secondary" type="submit">切换</button></form>}
    {items.length === 0 ? <section className="empty panel"><span className="empty-mark">♫</span><h2>{learner.display_name} 还没有音乐内容</h2><p className="lede">家长先创建内容、上传音频并发布，就会出现在这里。</p><Link className="primary" href="/music/manage">去音乐内容工作台</Link></section> : <>
      <section className="today-card music-overview"><p className="eyebrow">{learner.display_name} 的音乐记录</p><div className="today-grid"><div className="metric"><span className="metric-label">练习记录</span><span className="metric-value">{attempts}</span><small>每次都独立保留</small></div><div className="metric"><span className="metric-label">今天建议练</span><span className="metric-value">{due}</span><small>已到复习时间</small></div><div className="metric"><span className="metric-label">稳定掌握</span><span className="metric-value">{stable}</span><small>阶段 5 以上</small></div></div></section>
      <section className="panel music-today"><div className="library-header"><div><p className="eyebrow">今天的音乐练习</p><h2>先从这些开始</h2></div><Link className="text-button" href="/music/manage">家长管理</Link></div><div className="music-today-grid">{recommended.map((item, index) => <Link className={`music-today-card ${item.itemType}`} href={`/music/${item.id}?${learnerQuery}`} key={item.id}><span className="music-today-number">0{index + 1}</span><span className={`music-type-mark ${item.itemType}`}>{musicTypeMeta[item.itemType].mark}</span><div><strong>{item.title}</strong><small>{musicTypeMeta[item.itemType].label} · {musicRecommendation(item, now)}</small></div></Link>)}</div></section>
      <nav className="music-category-nav" aria-label="音乐内容分类"><Link className={selectedType === "all" ? "active" : ""} href={`/music?${learnerQuery}`}>全部</Link>{(["song", "instrument", "rhythm"] as MusicItemType[]).map((type) => <Link className={selectedType === type ? "active" : ""} href={`/music?${learnerQuery}&type=${type}`} key={type}>{musicTypeMeta[type].label}</Link>)}</nav>
      <section className="panel"><div className="library-header"><div><h2>{selectedType === "all" ? "全部音乐内容" : musicTypeMeta[selectedType].label}</h2><p className="library-meta">显示 {visibleItems.length} 项；按需要选择，不必一次全部完成。</p></div></div><div className="music-library-grid">{visibleItems.map((item) => <Link className={`music-library-card ${item.itemType}`} href={`/music/${item.id}?${learnerQuery}`} key={item.id}><div className="music-library-card-head"><span className={`music-type-mark ${item.itemType}`}>{musicTypeMeta[item.itemType].mark}</span><span>{item.category || musicTypeMeta[item.itemType].action}</span></div><h3>{item.title}</h3><p>{item.description || musicTypeMeta[item.itemType].description}</p><div className="music-progress-line"><span style={{ width: `${Math.max(5, item.stage / 7 * 100)}%` }} /></div><div className="music-library-foot"><strong>{item.attemptCount ? musicStageNames[item.stage] : "还没练过"}</strong><span>{item.dueAt ? `下次 ${formatMusicDate(item.dueAt)}` : "现在可以开始"}</span></div></Link>)}</div></section>
    </>}
  </div>;
}
