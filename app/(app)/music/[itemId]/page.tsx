import Link from "next/link";
import { MusicPracticePanel } from "@/components/music-practice-panel";
import { loadMusicProgress } from "@/lib/music-data";
import { createR2ReadUrl, isR2Configured } from "@/lib/r2";
import { formatMusicDate, musicStageNames, musicTypeMeta, practiceResultLabels } from "@/lib/music";
import { createClient } from "@/lib/supabase/server";
import type { MusicPracticeResult } from "@/lib/music-actions";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ itemId: string }>; searchParams: Promise<{ learner?: string }> };

export default async function MusicDetailPage({ params, searchParams }: PageProps) {
  const [{ itemId }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: learners } = await supabase.from("learner_profiles").select("id,display_name").order("created_at");
  const learner = learners?.find((item) => item.id === query.learner) ?? learners?.[0];
  if (!learner) return <section className="empty panel"><h1>先创建孩子档案</h1><Link className="primary" href="/parent">去家长页</Link></section>;
  const items = await loadMusicProgress(supabase, learner.id);
  const item = items.find((row) => row.id === itemId);
  if (!item) return <section className="empty panel"><span className="empty-mark">♪</span><h1>没有找到这条音乐内容</h1><p className="lede">它可能还没发布，或没有分配给 {learner.display_name}。</p><Link className="secondary" href={`/music?learner=${learner.id}`}>返回音乐天地</Link></section>;
  const r2Configured = isR2Configured();
  const assets = await Promise.all(item.assets.map(async (asset) => ({ id: asset.id, assetType: asset.asset_type, label: asset.label, originalName: asset.original_name, url: r2Configured ? await createR2ReadUrl(asset.object_key).catch(() => null) : null })));
  const meta = musicTypeMeta[item.itemType];
  return <div className="music-detail-page">
    <Link className="back-link" href={`/music?learner=${learner.id}`}>← 返回 {learner.display_name} 的音乐天地</Link>
    <MusicPracticePanel learnerId={learner.id} itemId={item.id} itemType={item.itemType} title={item.title} lyrics={item.lyrics} correctAnswer={item.correctAnswer} instructions={item.instructions} assets={assets} />
    <section className="today-card music-detail-progress"><p className="eyebrow">练习进度</p><div className="today-grid"><div className="metric"><span className="metric-label">累计练习</span><span className="metric-value">{item.attemptCount}</span><small>次</small></div><div className="metric"><span className="metric-label">当前阶段</span><span className="metric-value">{item.stage}</span><small>{musicStageNames[item.stage]}</small></div><div className="metric"><span className="metric-label">下次建议</span><span className="metric-value music-date-value">{item.dueAt ? formatMusicDate(item.dueAt) : "现在"}</span><small>{item.consecutiveSuccess ? `连续顺利 ${item.consecutiveSuccess} 次` : meta.description}</small></div></div></section>
    <section className="panel recitation-history"><h2>最近练习记录</h2><p className="library-meta">每次结果都会单独保留，便于家长观察真实变化。</p>{!item.attempts.length ? <p className="notice">还没有练习记录，完成上面的练习后选择一次结果。</p> : <div className="history-list">{item.attempts.slice(0, 30).map((attempt) => <div className="history-row" key={attempt.id}><div><strong>{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(attempt.practiced_at))}</strong><span>阶段 {attempt.previous_stage} → {attempt.next_stage}</span></div><span className="history-score">{practiceResultLabels[attempt.result as MusicPracticeResult] ?? attempt.result}</span>{attempt.guess_note && <p>当时猜：{attempt.guess_note}</p>}</div>)}</div>}</section>
  </div>;
}
