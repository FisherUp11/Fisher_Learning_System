"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { changeAdultVideo, createVideoAdultProfile, previewAdultVideo, reloadAdultVideoPractice, saveAdultVideoPracticeAnswer } from "@/lib/adult-video-actions";
import { previewNextVideoCard, selectVideoReviewRows, videoTime, youtubeHref, type VideoAction, type VideoAnswerReceipt, type VideoCard, type VideoImportRow, type VideoPracticeQueue, type VideoSnapshot, type VideoSummary, type VideoWord, type VideoWordStats } from "@/lib/adult-video";
import type { StudyAnswer } from "@/lib/study-answer-sync";
import { FeedbackForm } from "./feedback-form";
import { PrivateAudio } from "./adult-english-study";
import { useImmediateStudy } from "./use-immediate-study";
import s from "./adult-video.module.css";

const rounds = ["听懂主要意思", "逐句听，暂停后模仿", "少看字幕，跟原声读", "不看稿，试着复述几句"];
type Reply = { error?: string; result?: Record<string, unknown> };
type Run = (action: VideoAction, message: string | ((data: Record<string, unknown>) => string)) => Promise<Reply>;
type Preview = { title: string; url: string; rows: VideoImportRow[] };
type Practice = VideoPracticeQueue & { stats?: Record<string, VideoWordStats> };

async function saveAnswer(answer: StudyAnswer) {
  const response = await saveAdultVideoPracticeAnswer(answer);
  if ("error" in response) throw new Error(response.error);
  return response;
}

function showNext(practice: Practice, answer: StudyAnswer) {
  return previewNextVideoCard(practice, answer.itemId);
}

function reconcileAnswer(saved: VideoAnswerReceipt, previous: Practice | null): Practice | null {
  if (!saved.queue) return null;
  return { ...saved.queue, stats: saved.stats ? { ...previous?.stats, [saved.conceptId]: saved.stats } : previous?.stats };
}

export function NewVideoProfile() {
  return <section className={s.paper}><p className={s.kicker}>GET STARTED</p><h2>先建一个成人档案</h2><p className={s.dim}>和会议英语、专业英语共用档案。同个账号下，词库可共用，练习记录分开。</p>
    <FeedbackForm action={createVideoAdultProfile} className={s.form} pendingLabel="正在创建成人档案…"><label>档案名称<input name="name" maxLength={30} required placeholder="例如：爸爸" /></label><button className={s.dark}>创建档案</button></FeedbackForm>
  </section>;
}

function SourceLink({ id, second, children }: { id: string; second?: number | null; children: React.ReactNode }) {
  return <a href={youtubeHref(id, second)} target="_blank" rel="noopener noreferrer">{children} <span aria-hidden="true">↗</span></a>;
}

function VideoCounter({ count }: { count: number }) {
  return <div className={s.counter} aria-label={`已练 ${count} 次，目标 4 次`}>
    {rounds.map((name, i) => <span key={name} className={i < count ? s.marked : ""} title={name} aria-hidden="true">{i < count ? "✓" : `0${i + 1}`}</span>)}
  </div>;
}

export function AdultVideoDesk({ profileId, data, wordView }: { profileId: string; data: VideoSnapshot; wordView: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState("");
  const [refreshing, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const retryCheckins = useRef(new Map<string, string>());
  const study = useImmediateStudy<Practice, VideoAnswerReceipt>({
    scope: "adult-video", learnerId: profileId,
    initial: { today: data.today, total: data.total_today, remaining: data.remaining,
      cards: data.current ? (data.next_card ? [data.current, data.next_card] : [data.current]) : [] },
    load: reloadAdultVideoPractice, save: saveAnswer, advance: showNext, reconcile: reconcileAnswer,
  });
  const practice = study.data;
  const card = practice?.cards[0];
  const practiceTotal = practice?.total ?? data.total_today;
  const practiceRemaining = practice?.remaining ?? data.remaining;
  const disabled = Boolean(pending) || refreshing || study.blocked;
  const saved = study.lastCommit?.saved.result;

  function answer(result: "known" | "again") {
    if (!practice || !card || lock.current || refreshing) return;
    setNotice(""); setError("");
    study.submit({ itemId: card.concept_id, day: practice.today, result, assisted: false });
  }

  function href(query: { video?: string; page?: number; words?: number; view?: "words" } = {}) {
    const params = new URLSearchParams({ profile: profileId });
    if (query.video) params.set("video", query.video);
    if (query.page && query.page > 1) params.set("page", String(query.page));
    if (query.words && query.words > 1) params.set("words", String(query.words));
    if (query.view) params.set("view", query.view);
    return `/english/video?${params}${query.video ? "#video-library" : ""}`;
  }

  const run: Run = async (action, message) => {
    if (lock.current || study.blocked) return { error: "正在保存另一项操作" };
    lock.current = true; setPending(action.type); setNotice(""); setError("");
    try {
      const response = await changeAdultVideo(profileId, action);
      if (response.error || !response.result) {
        const detail = response.error || "暂时无法确认结果，请重试";
        setError(detail); return { error: detail };
      }
      setNotice(typeof message === "function" ? message(response.result) : message);
      if (action.type === "import" && typeof response.result.video_id === "string")
        startTransition(() => router.replace(href({ video: String(response.result!.video_id), view: "words" }), { scroll: false }));
      if (card && (action.type === "edit_timestamp" || action.type === "import")) void study.reload();
      return response;
    } catch {
      const detail = "网络暂时中断，保存结果未确认。请在此页按原操作重试。";
      setError(detail); return { error: detail };
    } finally { lock.current = false; setPending(""); }
  };

  async function log(video: VideoSummary) {
    if (lock.current) return;
    const key = retryCheckins.current.get(video.id) ?? crypto.randomUUID();
    retryCheckins.current.set(video.id, key);
    const reply = await run({ type: "checkin", videoId: video.id, requestId: key }, r =>
      r.duplicate ? `这轮已记录，共练习 ${r.count} 次，未重复打卡。` : `练习已记录 · 这是第 ${r.count} 次。`);
    if (!reply.error) retryCheckins.current.delete(video.id);
  }

  return <>
    <div className={s.statusDock}>{pending || notice ? <div className={s.feedback} role="status">{pending ? "正在保存，请稍候…" : notice}</div> : null}
      {error && <p className={s.error} role="alert">{error}</p>}</div>
    <div className={s.lanes}>
      <section className={`${s.paper} ${s.week}`}>
        <p className={s.kicker}>01 / 本周视频</p>
        {data.focus ? <>
          <h2>{data.focus.title}</h2>
          <VideoCounter count={data.focus.practice_count} />
          <p className={s.dim}>{data.focus.practice_count ? `已练 ${data.focus.practice_count} 次` : "还没开始"} · {rounds[data.focus.practice_count] ?? "已达成四轮目标，仍可继续练"}</p>
          <div className={s.buttons}><SourceLink id={data.focus.youtube_id}>打开原视频</SourceLink><button className={s.dark} disabled={disabled} onClick={() => void log(data.focus!)}>本次练完 ＋1</button></div>
        </> : <><h2>留一条视频，练深一点</h2><p className={s.dim}>先添加原视频和词表。从听懂、模仿到脱稿复述。</p><a href="#video-import">导入第一条视频 ↓</a></>}
      </section>
      <section className={`${s.paper} ${s.studySummary}`} id="video-study">
        <p className={s.kicker}>02 / 今日词卡</p><h2>{practiceTotal > 0 ? `还剩 ${practiceRemaining} 张` : practice?.today === data.today ? `${data.due} 张到期` : "今日词卡"}</h2>
        <p className={s.dim}>已选 {data.tracked} 个词句 · 每天最多 {data.daily_new} 个新词</p>
        {practiceTotal > 0 ? <a href="#video-current">{practiceRemaining ? "继续复习 ↓" : "查看今日完成 ↓"}</a>
          : <button className={s.dark} disabled={disabled || !data.tracked} onClick={() => void run({ type: "start" }, r => Number(r.remaining) ? "已安排今日词卡。" : "今天暂无符合条件的词卡。")}>安排今日词卡</button>}
        <details className={s.fold}><summary>调整每日新词</summary><form className={s.form} onSubmit={e => {
          e.preventDefault(); void run({ type: "settings", dailyNew: Number(new FormData(e.currentTarget).get("daily")) }, "设置已保存，已生成的今日队列不变。");
        }}><label>每日新词（0～20）<input name="daily" type="number" min={0} max={20} defaultValue={data.daily_new} required /></label><button className={s.light} disabled={disabled}>保存节奏</button></form></details>
      </section>
    </div>
    {(practiceTotal > 0 || study.status === "saving" || study.error) && <div id="video-current" className={s.practice}>
      {study.error ? <section className={s.paper}>
        <p className={s.error} role="alert">{study.error}</p><div className={s.buttons}>
          <button className={s.dark} onClick={study.retry}>{study.status === "save-error" ? "重试保存这次作答" : "重新加载词卡"}</button>
          {study.status === "save-error" && <button className={s.light} onClick={study.discard}>按云端记录重新加载</button>}
        </div></section> : study.status === "saving"
        ? <p className={s.feedback} role="status">{card ? "上一笔正在保存，可以先看词卡；保存后即可作答。" : "正在确认这次作答…"}</p>
        : study.status === "loading" ? <p className={s.feedback} role="status">正在同步今日词卡…</p>
        : saved && !notice && !pending && <p className={s.feedback} role="status">{saved.completed ? `上张词卡已完成 · ${saved.due_date} 再复习。` : "已记录，这张稍后再认一次。"}</p>}
      {card ? <RecallCard key={`${practice?.today}:${card.concept_id}:${card.attempt_count}`} card={card} focusId={data.focus?.id} disabled={disabled} answer={answer} />
        : !study.blocked && practiceRemaining === 0 && practiceTotal > 0 && <section className={s.paper}><p className={s.kicker}>DONE FOR TODAY</p><h2>今日词卡完成</h2><p className={s.dim}>已练 {practiceTotal} 张。下次到期再来巩固，也可以继续跟读本周视频。</p></section>}
    </div>}
    <section className={s.paper} id="video-library">
      <div className={s.heading}><div><p className={s.kicker}>THE SHELF / 视频架</p><h2>我的视频</h2></div><a href="#video-import">＋ 导入词表</a></div>
      {!data.videos.length ? <p className={s.dim}>还没有视频。导入后，这里会留下每次练习和对应的词表。</p> : <>
        <ul className={s.videoList}>{data.videos.map(video => <li key={video.id} className={data.selected?.id === video.id ? s.chosen : ""}>
          <Link href={href({ video: video.id, page: data.video_page, view: "words" })} aria-current={data.selected?.id === video.id ? "true" : undefined}><strong>{video.title}</strong><span>{video.word_count} 个词句 · 已练 {video.practice_count} 次{video.id === data.focus?.id ? " · 本周" : ""}</span></Link>
          <SourceLink id={video.youtube_id}>播放</SourceLink>
        </li>)}</ul>
        <Pagination label="视频列表分页" page={data.video_page} total={data.total_videos} size={12} link={page => href({ video: data.selected?.id, page, view: wordView ? "words" : undefined })} />
      </>}
      {data.selected && <article className={s.selectedVideo}>
        <div className={s.heading}><div><p className={s.kicker}>PRACTICE LOG</p><h3>{data.selected.title}</h3><p className={s.dim}>已练 {data.selected.practice_count} 次 · {data.selected.last_on ? `上次 ${data.selected.last_on}` : "还没打卡"}</p></div><VideoCounter count={data.selected.practice_count} /></div>
        <div className={s.buttons}><SourceLink id={data.selected.youtube_id}>打开原视频</SourceLink><button className={s.light} disabled={disabled} onClick={() => void log(data.selected!)}>本次练完 ＋1</button>
          {data.focus?.id !== data.selected.id && <button className={s.light} disabled={disabled} onClick={() => void run({ type: "focus", videoId: data.selected!.id }, "已设为本周视频。")}>设为本周视频</button>}</div>
        {!!data.history.length && <details className={s.fold}><summary>最近 {data.history.length} 次打卡</summary><ol className={s.history}>{data.history.map(log => <li key={log.id}>{log.local_date} · {new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(log.created_at))}</li>)}</ol></details>}
        <details key={`${data.selected.id}:${data.word_page}:${wordView}`} className={s.fold} open={wordView || undefined}>
          <summary>本篇词表 · {data.total_words} 项</summary><p className={s.dim}>只把想记的词加入轮转；取消不会删除词条或既有进度。</p>
          <ul className={s.words}>{data.words.map(word => <WordRow key={word.concept_id} word={{ ...word, ...practice?.stats?.[word.concept_id] }} video={data.selected!} disabled={disabled} run={run} />)}</ul>
          <Pagination label="本篇词表分页" page={data.word_page} total={data.total_words} size={30} link={words => href({ video: data.selected?.id, page: data.video_page, words, view: "words" })} />
        </details>
      </article>}
    </section>
    <ImportPanel key={data.selected?.id ?? "first"} video={data.selected} disabled={disabled} run={run} />
  </>;
}

function Pagination({ label, page, total, size, link }: { label: string; page: number; total: number; size: number; link: (page: number) => string }) {
  const pages = Math.ceil(total / size);
  if (pages <= 1) return null;
  return <nav className={s.pagination} aria-label={label}>{page > 1 && <Link href={link(page - 1)}>← 上一页</Link>}<span>{page} / {pages}</span>{page < pages && <Link href={link(page + 1)}>下一页 →</Link>}</nav>;
}

function RecallCard({ card, focusId, disabled, answer }: { card: VideoCard; focusId?: string; disabled: boolean; answer: (result: "known" | "again") => void }) {
  const [revealed, reveal] = useState(false);
  const focused = card.origins.find(source => source.id === focusId);
  const origins = focused ? [focused, ...card.origins.filter(source => source !== focused)] : card.origins;
  const origin = origins.find(source => source.example) ?? origins[0];
  return <section className={`${s.paper} ${s.recall}`}>
    <p className={s.kicker}>{card.queue_kind === "new" ? "NEW / 新词句" : "REVIEW / 到期复习"}{card.attempt_count > 0 ? " · 再确认" : ""}</p><h2 lang="en">{card.phrase}</h2>
    {origin?.pronunciation && <p className={s.phonetic}>{origin.pronunciation}</p>}
    <PrivateAudio body={{ concept_id: card.concept_id }} label="朗读词句" />
    {!revealed ? <button className={s.dark} onClick={() => reveal(true)}>我先回忆，再看答案</button> : <>
      <div className={s.answer}><strong>{card.meaning}</strong>{origin?.example && <><p lang="en">{origin.example}</p><PrivateAudio body={{ concept_id: card.concept_id, field: "video_example", video_id: origin.id }} label="朗读例句" /></>}</div>
      <div className={s.buttons}><button className={s.dark} disabled={disabled} onClick={() => answer("known")}>我记得</button><button className={s.light} disabled={disabled} onClick={() => answer("again")}>再学一次</button></div>
      <details className={s.fold}><summary>回到来源视频 · {origins.length} 个</summary><ul className={s.history}>{origins.map(source => <li key={source.id}><SourceLink id={source.youtube_id} second={source.start_second}>{source.title}{source.start_second === null ? " · 打开原视频" : ` · ${videoTime(source.start_second)}`}</SourceLink></li>)}</ul></details>
    </>}
  </section>;
}

function WordRow({ word, video, disabled, run }: { word: VideoWord; video: VideoSummary; disabled: boolean; run: Run }) {
  return <li><div className={s.heading}><div><strong lang="en">{word.phrase}</strong><span className={s.phonetic}>{word.pronunciation}</span><p>{word.meaning}</p></div>
    <button className={s.light} disabled={disabled} aria-pressed={word.tracked} onClick={() => void run({ type: "track", conceptId: word.concept_id, enabled: !word.tracked }, word.tracked ? "已移出后续复习，已有学习记录保留。" : "已加入后续复习。")}>{word.tracked ? "✓ 已加入" : "加入复习"}</button></div>
    <div className={s.buttons}><small className={s.dim}>{word.attempts ? `练 ${word.attempts} 次 · 阶段 ${word.stage} · ${word.due_date} 到期` : "尚未作答"}</small><SourceLink id={video.youtube_id} second={word.start_second}>{word.start_second === null ? "原视频" : `回看 ${videoTime(word.start_second)}`}</SourceLink></div>
    <details className={s.fold}><summary>例句与时间点</summary>{word.example && <p lang="en">{word.example}</p>}
      <form className={s.timeForm} onSubmit={e => {
        e.preventDefault(); void run({ type: "edit_timestamp", videoId: video.id, conceptId: word.concept_id, timestamp: String(new FormData(e.currentTarget).get("time") ?? "") }, "视频时间点已保存。");
      }}><label>视频时间点<input key={word.start_second ?? "empty"} name="time" placeholder="例如 02:14" maxLength={10} defaultValue={word.start_second === null ? "" : videoTime(word.start_second)} /></label><button className={s.light} disabled={disabled}>保存时间点</button></form>
    </details>
  </li>;
}

function ImportPanel({ video, disabled, run }: { video: VideoSummary | null; disabled: boolean; run: Run }) {
  const [previewing, startPreview] = useTransition();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [append, setAppend] = useState(false);
  const [added, setAdded] = useState(false);
  const selectedCount = preview?.rows.filter(row => row.track).length ?? 0;
  function selectForReview(first?: number) {
    setPreview(current => current ? { ...current, rows: selectVideoReviewRows(current.rows, first) } : current);
  }
  function invalidatePreview() { setPreview(null); setAdded(false); }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(""); setDetails([]); setAdded(false); setPreview(null);
    startPreview(async () => {
      try {
        const result = await previewAdultVideo(form);
        if ("error" in result) { setError(result.error ?? "预览失败"); setDetails(result.details ?? []); }
        else setPreview(result);
      } catch { setError("无法预览，请检查网络或文件大小（最多 1 MB）。"); }
    });
  }
  return <section className={s.paper} id="video-import"><div className={s.heading}><div><p className={s.kicker}>ADD A VIDEO / 导入</p><h2>导入视频词表</h2></div><a href="/api/templates/adult-video" download>下载 CSV 模板 ↓</a></div>
    <p className={s.dim}>一条视频只填一次链接；每次最多 200 行。例句、音标和时间点都可以留空。</p>
    {video && <label className={s.inline}><input type="checkbox" disabled={disabled || previewing} checked={append} onChange={e => { setAppend(e.target.checked); setPreview(null); setAdded(false); }} />给「{video.title}」追加词句</label>}
    <form key={String(append)} className={s.form} onSubmit={review} onChange={invalidatePreview}><label>视频标题<input name="title" maxLength={120} required readOnly={append} disabled={previewing || disabled} defaultValue={append ? video?.title : ""} placeholder="例如：一段关于长期决策的访谈" /></label>
      <label>YouTube 链接<input name="url" type="url" maxLength={500} required readOnly={append} disabled={previewing || disabled} defaultValue={append && video ? youtubeHref(video.youtube_id) : ""} placeholder="https://www.youtube.com/watch?v=…" /></label>
      <label>CSV 词表<input name="csv" type="file" accept=".csv,text/csv" required disabled={previewing || disabled} /></label><button className={s.light} disabled={previewing || disabled}>{previewing ? "正在预览…" : "检查文件并预览"}</button></form>
    {error && <div className={s.error} role="alert"><p>{error}</p>{!!details.length && <ul>{details.map((detail, i) => <li key={i}>{detail}</li>)}</ul>}</div>}
    {preview && !added && <div className={s.preview}><div className={s.heading}><div><h3>{preview.title} · {preview.rows.length} 项</h3><p className={s.dim}>全部词句都会保存；勾选项按每日上限分批进入学习和复习。</p></div>
      <div className={s.buttons}>
        <button type="button" className={s.light} disabled={disabled || selectedCount === preview.rows.length} onClick={() => selectForReview()}>全选加入复习</button>
        <button type="button" className={s.light} disabled={disabled || preview.rows.slice(0, 5).every(row => row.track)} onClick={() => selectForReview(5)}>勾选前 5 项</button>
      </div></div>
      <p className={s.dim} role="status">已选 {selectedCount} / {preview.rows.length} 项加入复习</p>
      <ul className={s.previewList}>{preview.rows.map((row, i) => <li key={i}><label className={s.inline}><input type="checkbox" checked={row.track} onChange={e => setPreview({ ...preview, rows: preview.rows.map((x, j) => i === j ? { ...x, track: e.target.checked } : x) })} disabled={disabled} /><span><strong lang="en">{row.word}</strong> · {row.meaning}{row.timestamp === null ? "" : ` · ${videoTime(row.timestamp)}`}{row.example && <small lang="en">{row.example}</small>}</span></label></li>)}</ul>
      <FeedbackForm action={async () => {
        const response = await run({ type: "import", ...preview }, r => `已导入：新增 ${r.new_terms} 个词句，复用 ${r.reused} 项，建立 ${r.new_links} 条视频关联。`);
        if (response.error) return { status: "error", message: response.error };
        setAdded(true);
        return { status: "success", message: "视频与词表已保存。原有词条进度不变。" };
      }} pendingLabel="正在写入词表…" successTitle="词表已保存" confirm={{ title: "确认导入这份词表？", description: `${preview.title}：保存全部 ${preview.rows.length} 项；勾选 ${selectedCount} 项加入复习。重复词会复用，不重置进度。`, confirmLabel: "确认导入" }}>
        <button className={s.dark} disabled={disabled}>确认保存词表</button>
      </FeedbackForm>
    </div>}
    {added && <p className={s.dim}>已保存，可以在上方「我的视频」查看词表。</p>}
  </section>;
}
