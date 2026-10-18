import Link from "next/link";
import { MusicPracticePanel } from "@/components/music-practice-panel";
import { loadMusicProgress } from "@/lib/music-data";
import { createR2ReadUrl, isR2Configured } from "@/lib/r2";
import { formatMusicDate, musicStageNames, musicTypeMeta } from "@/lib/music";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";
import { PracticeHistory } from "@/components/practice-history";
import { readPracticeHistory } from "@/lib/practice-history";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ itemId: string }>; searchParams: Promise<{ learner?: string }> };

export default async function MusicDetailPage({ params, searchParams }: PageProps) {
  const [{ itemId }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const access = user ? await loadAccessContext(supabase,user.id) : null;
  const { data: learners } = await supabase.from("learner_profiles").select("id,display_name").eq("family_id",access?.familyId ?? "00000000-0000-0000-0000-000000000000").order("created_at");
  const learner = learners?.find((item) => item.id === query.learner) ?? learners?.[0];
  if (!learner) return <section className="empty panel"><h1>先创建孩子档案</h1><Link className="primary" href="/parent">去家长页</Link></section>;
  try { if (user) await requireChildModule(supabase,access,user.id,learner.id,"music"); }
  catch (error) { return <section className="panel"><h1>这位孩子暂未开通音乐天地</h1><p>{error instanceof Error ? error.message : "请联系 owner 开通"}</p></section>; }
  const items = await loadMusicProgress(supabase, learner.id);
  const item = items.find((row) => row.id === itemId);
  if (!item) return <section className="empty panel"><span className="empty-mark">♪</span><h1>没有找到这条音乐内容</h1><p className="lede">它可能还没发布，或没有分配给 {learner.display_name}。</p><Link className="secondary" href={`/music?learner=${learner.id}`}>返回音乐天地</Link></section>;
  const r2Configured = isR2Configured();
  const [assets,history] = await Promise.all([
    Promise.all(item.assets.map(async (asset) => ({ id: asset.id, assetType: asset.asset_type, label: asset.label, originalName: asset.original_name, url: r2Configured ? await createR2ReadUrl(asset.object_key).catch(() => null) : null }))),
    readPracticeHistory(supabase,"music",learner.id,item.id),
  ]);
  const meta = musicTypeMeta[item.itemType];
  return <div className="music-detail-page">
    <Link className="back-link" href={`/music?learner=${learner.id}`}>← 返回 {learner.display_name} 的音乐天地</Link>
    <MusicPracticePanel learnerId={learner.id} itemId={item.id} itemType={item.itemType} title={item.title} lyrics={item.lyrics} correctAnswer={item.correctAnswer} instructions={item.instructions} assets={assets} />
    <section className="today-card music-detail-progress"><p className="eyebrow">练习进度</p><div className="today-grid"><div className="metric"><span className="metric-label">累计练习</span><span className="metric-value">{item.attemptCount}</span><small>次</small></div><div className="metric"><span className="metric-label">当前阶段</span><span className="metric-value">{item.stage}</span><small>{musicStageNames[item.stage]}</small></div><div className="metric"><span className="metric-label">下次建议</span><span className="metric-value music-date-value">{item.dueAt ? formatMusicDate(item.dueAt) : "现在"}</span><small>{item.consecutiveSuccess ? `连续顺利 ${item.consecutiveSuccess} 次` : meta.description}</small></div></div></section>
    <PracticeHistory key={`${item.id}:${history.total}`} kind="music" learnerId={learner.id} itemId={item.id} initialPage={history} />
  </div>;
}
