import type { SupabaseClient } from "@supabase/supabase-js";
import { formatPoemDate } from "@/lib/poems";
import { loadPoemSummary, loadPoemVideo } from "@/lib/poem-detail";
import { readPracticeHistory } from "@/lib/practice-history";
import { PracticeHistory } from "@/components/practice-history";
import { PoemVideoEditor } from "@/components/poem-video-editor";
import { PoemDetailRetry } from "@/components/poem-detail-retry";

type PracticeProps = { db: SupabaseClient; learnerId: string; poemId: string };

export function PoemSummaryLoading() {
  return <section className="today-card poem-detail-summary poem-section-loading" role="status" aria-busy="true"><p className="eyebrow">背诵情况</p><p className="small muted">正在读取背诵统计，正文可以先读起来。</p></section>;
}

export function PoemHistoryLoading() {
  return <section className="panel recitation-history poem-section-loading" role="status" aria-busy="true"><h2>背诵记录</h2><p className="small muted">正在读取最近的记录…</p></section>;
}

export async function PoemDetailSummary({ db, learnerId, poemId }: PracticeProps) {
  let poem;
  try { poem = await loadPoemSummary(db, learnerId, poemId); }
  catch { return <section className="today-card poem-detail-summary"><h2>背诵情况</h2><PoemDetailRetry message="背诵统计暂时没有读到，不能视为零次；正文和打卡仍可使用。" /></section>; }
  return <section className="today-card poem-detail-summary"><p className="eyebrow">背诵情况</p><div className="today-grid"><div className="metric"><span className="metric-label">累计背诵</span><span className="metric-value">{poem.attemptCount}</span><small>次</small></div><div className="metric"><span className="metric-label">练习日期</span><span className="metric-value">{poem.practiceDays}</span><small>天</small></div><div className="metric"><span className="metric-label">最近评分</span><span className="metric-value">{poem.lastScore ?? "—"}</span><small>{poem.lastScore ? "/ 10 分" : poem.attemptCount ? "尚未评分" : "先背一次"}</small></div></div><p className="small muted">{poem.lastRecitedDate ? `最近一次：${formatPoemDate(poem.lastRecitedDate)}。` : "还没有背诵记录。"}{poem.averageScore !== null ? ` 已评分 ${poem.scoreCount} 次，平均 ${poem.averageScore} 分。` : ""}</p></section>;
}

export async function PoemDetailHistory({ db, learnerId, poemId }: PracticeProps) {
  let history;
  try { history = await readPracticeHistory(db, "poem", learnerId, poemId); }
  catch { return <section className="panel recitation-history"><h2>背诵记录</h2><PoemDetailRetry message="历史记录暂时没能加载，已保存的打卡不会丢失。" /></section>; }
  return <PracticeHistory key={`${poemId}:${history.total}`} kind="poem" learnerId={learnerId} itemId={poemId} initialPage={history} />;
}

export async function PoemVideoLink({ db, poemId, title }: { db: SupabaseClient; poemId: string; title: string }) {
  let video;
  try { video = await loadPoemVideo(db, poemId); }
  catch { return <p className="poem-video-note">音乐视频链接暂时未读到，可以先读诗或打卡。</p>; }
  return video.url ? <div className="poem-video-content"><a className="secondary poem-video-link" href={video.url} target="_blank" rel="noopener noreferrer" aria-label={`打开《${title}》音乐视频，小鹅通新页面`}>♫ 听唱这首诗 <span aria-hidden="true">↗</span></a><p className="poem-video-note">视频由小鹅通播放，可能需要微信登录；观看不会自动计入背诵次数。</p></div> : null;
}

export async function PoemVideoManagement({ db, poemId }: { db: SupabaseClient; poemId: string }) {
  let video;
  try { video = await loadPoemVideo(db, poemId); }
  catch { return <PoemDetailRetry message="音乐视频管理暂时无法读取，请稍后重试。" />; }
  return video.setupMissing ? <p className="notice">要给诗词添加音乐视频，请先在 Supabase 运行 <code>supabase/033_poem_music_video_links.sql</code>。</p> : <PoemVideoEditor key={`${poemId}:${video.url ?? ""}`} poemId={poemId} initialUrl={video.url} />;
}
