import Link from "next/link";
import { PoemRecitationForm } from "@/components/poem-recitation-form";
import { PoemVideoEditor } from "@/components/poem-video-editor";
import { formatPoemDate, loadPoemProgress } from "@/lib/poems";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ poemId: string }>; searchParams: Promise<{ learner?: string }> };

function formatRecordedAt(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export default async function PoemDetailPage({ params, searchParams }: PageProps) {
  const [{ poemId }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();
  const { data: learners, error: learnersError } = await supabase.from("learner_profiles").select("id,display_name").order("created_at");
  if (learnersError) return <section className="panel"><h1>诗词暂时打不开</h1><p className="error">{learnersError.message}</p></section>;
  const learner = learners?.find((item) => item.id === query.learner) ?? learners?.[0];
  if (!learner) return <section className="empty panel"><h1>先创建孩子档案</h1><Link className="primary" href="/parent">去家长页</Link></section>;
  const { data: { user } } = await supabase.auth.getUser();
  const access = user ? await loadAccessContext(supabase, user.id) : null;
  try { if (user) await requireChildModule(supabase, access, user.id, learner.id, "poem"); }
  catch (error) { return <section className="panel"><h1>这位孩子暂未开通诗词背诵</h1><p>{error instanceof Error ? error.message : "请联系 owner 开通"}</p></section>; }
  const { poems } = await loadPoemProgress(supabase, learner.id);
  const poem = poems.find((item) => item.id === poemId);
  if (!poem) return <section className="empty panel"><span className="empty-mark">卷</span><h1>没有找到这首诗</h1><p className="lede">它可能不属于 {learner.display_name} 的诗词册，或已经被移除。</p><Link className="secondary" href={`/poems?learner=${learner.id}`}>返回诗词册</Link></section>;
  // 独立读取可使尚未运行 033 SQL 的旧环境继续正常显示诗词与背诵记录。
  const { data: videoRow, error: videoError } = await supabase.from("poems")
    .select("music_video_url").eq("id", poem.id).maybeSingle();
  const videoSetupMissing = Boolean(videoError?.message.includes("music_video_url"));
  if (videoError && !videoSetupMissing) throw new Error(`无法读取诗词视频链接：${videoError.message}`);
  const musicVideoUrl = typeof videoRow?.music_video_url === "string"
    && /^https:\/\/[a-z0-9-]+\.h5\.xiaoeknow\.com\/p\/course\/video\//i.test(videoRow.music_video_url)
    ? videoRow.music_video_url : null;
  const lines = poem.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return <div className="poem-detail-page">
      <Link className="back-link" href={`/poems?learner=${learner.id}`}>← 返回 {learner.display_name} 的诗词册</Link>
      <section className="poem-paper">
        <p className="eyebrow">{poem.sourceTitles.join(" · ")}</p>
        <h1>{poem.title}</h1>
        <p className="poem-detail-byline">{poem.author}{poem.dynasty ? ` · ${poem.dynasty}` : ""}</p>
        <div className="poem-lines" aria-label={`${poem.title} 正文`}>{lines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</div>
        <div className="poem-learning-actions">
          {musicVideoUrl && <a className="secondary poem-video-link" href={musicVideoUrl} target="_blank" rel="noopener noreferrer" aria-label={`打开《${poem.title}》音乐视频，小鹅通新页面`}>♫ 听唱这首诗 <span aria-hidden="true">↗</span></a>}
          <Link className="primary poem-game-entry" href={`/poems/game?learner=${learner.id}&poem=${poem.id}`}>驾驶小坦克复习这首诗</Link>
        </div>
        {musicVideoUrl && <p className="poem-video-note">视频由小鹅通播放，可能需要微信登录；观看不会自动计入背诵次数。</p>}
      </section>

      <section className="today-card poem-detail-summary"><p className="eyebrow">背诵情况</p><div className="today-grid"><div className="metric"><span className="metric-label">累计背诵</span><span className="metric-value">{poem.attemptCount}</span><small>次</small></div><div className="metric"><span className="metric-label">练习日期</span><span className="metric-value">{poem.practiceDays}</span><small>天</small></div><div className="metric"><span className="metric-label">最近评分</span><span className="metric-value">{poem.lastScore ?? "—"}</span><small>{poem.lastScore ? "/ 10 分" : poem.attemptCount ? "尚未评分" : "先背一次"}</small></div></div><p className="small muted">{poem.lastRecitedDate ? `最近一次：${formatPoemDate(poem.lastRecitedDate)}。` : "还没有背诵记录。"}{poem.averageScore !== null ? ` 已评分 ${poem.scoreCount} 次，平均 ${poem.averageScore} 分。` : ""}</p></section>

      <PoemRecitationForm learnerId={learner.id} poemId={poem.id} />

      <section className="panel recitation-history"><h2>背诵记录</h2><p className="library-meta">记录的是孩子真实练习的日期和时间。暂不评分的打卡会清楚标出，之后不影响继续记录。</p>{poem.attempts.length === 0 ? <p className="notice">还没有记录。背过或读过一次后，点上面的“今天背过一次”。</p> : <div className="history-list">{poem.attempts.map((attempt) => <div className="history-row" key={attempt.id}><div><strong>{formatPoemDate(attempt.recited_local_date)}</strong><span>{formatRecordedAt(attempt.recited_at)}</span></div><span className={`history-score ${attempt.score === null ? "unscored" : ""}`}>{attempt.score === null ? "暂未评分" : `${attempt.score} / 10 分`}</span>{attempt.note && <p>{attempt.note}</p>}</div>)}</div>}</section>
      {access?.isAdmin && (videoSetupMissing
        ? <p className="notice">要给诗词添加音乐视频，请先在 Supabase 运行 <code>supabase/033_poem_music_video_links.sql</code>。</p>
        : <PoemVideoEditor poemId={poem.id} initialUrl={musicVideoUrl} />)}
  </div>;
}
