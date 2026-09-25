"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AdultData, RunCommand } from "./adult-hub";
import type { DailyPlan, EnglishAttempt, EnglishTask } from "@/lib/adult-learning";
import s from "./adult-growth.module.css";

const taskNames = { review: "到期复习", listen: "听懂意思", expression: "积累表达", speak: "模拟会议 · 开口说", quiz: "新情境小测" };
export function EnglishStudy({ data, run, pending }: { data: AdultData; run: RunCommand; pending: boolean }) {
  const plan = data.plan!; const attempts = (data.attempts ?? []).filter(a => a.plan_id === plan.id);
  const [selected, setSelected] = useState(() => plan.tasks.find(t => !attempts.some(a => a.task_id === t.id))?.id ?? plan.tasks[0]?.id);
  const [allDone, setAllDone] = useState(false);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const completedIds = new Set([...attempts.map(a => a.task_id), ...acknowledged]);
  const task = plan.tasks.find(t => t.id === selected) ?? plan.tasks[0];
  const completed = plan.tasks.every(t => completedIds.has(t.id));
  const needsPractice = plan.tasks.filter(t => attempts.find(a => a.task_id === t.id)?.result === "again");
  function next() {
    const index = plan.tasks.findIndex(t => t.id === selected);
    const remaining = plan.tasks.slice(index + 1).find(t => !completedIds.has(t.id)) ?? plan.tasks.find(t => t.id !== selected && !completedIds.has(t.id));
    if (remaining) setSelected(remaining.id); else setAllDone(true);
  }
  return <>
    <section className={s.card}><div className={s.between}><div><h2>{data.profile!.name} · {plan.mode === "short" ? "精简练习" : plan.mode === "weekly" ? "情境小测" : "今日短课"}</h2><span className={s.muted}>{plan.local_date} · 已记录 {completedIds.size} / {plan.tasks.length} 项</span></div><span className={s.badge}>可以暂停，记录会保留</span></div><div className={s.progress}><div style={{ width: `${completedIds.size / plan.tasks.length * 100}%` }} /></div><div className={s.taskList}>{plan.tasks.map((t, i) => <button disabled={pending} key={t.id} title={`${taskNames[t.kind]}：${t.prompt}`} aria-label={`第 ${i + 1} 项，${completedIds.has(t.id) ? "已记录" : "未完成"}`} className={selected === t.id && !allDone ? s.current : completedIds.has(t.id) ? s.done : ""} onClick={() => { setSelected(t.id); setAllDone(false); }}>{completedIds.has(t.id) ? "✓" : i + 1}</button>)}</div></section>
    {completed && allDone ? <section className={`${s.card} ${s.empty}`}><span className={s.eyebrow}>ONE STEP FURTHER</span><strong style={{ marginTop: 20 }}>{plan.mode === "short" ? "今日精简计划完成" : plan.mode === "weekly" ? "今天的小测已完成" : "今日练习计划完成"}</strong><p>你又为下次开会，多准备了一点从容。</p><p className={s.muted}>完成表示每项任务都有作答记录，不表示每个表达都已掌握。{needsPractice.length ? `还有 ${needsPractice.length} 项值得再练，系统会保留薄弱表达的复习建议。` : "明天继续跨天巩固，比今天一直刷题更有意义。"}</p><div className={s.row} style={{ justifyContent: "center" }}><Link className={`${s.button} ${s.primary}`} href="/english/progress">看看我的积累</Link><Link className={s.button} href="/together">也来动一动</Link></div></section> : task && <TaskCard key={task.id} plan={plan} task={task} attempts={attempts.filter(a => a.task_id === task.id)} run={run} pending={pending} onNext={next} onSaved={() => setAcknowledged(ids => [...ids, task.id])} />}
    {!!needsPractice.length && <section className={s.card}><h3>稍后再练一遍</h3><p className={s.muted}>做过其他任务后再回来。当天反复练只作巩固，不会一天刷到长期掌握。</p><div className={s.row}>{needsPractice.map(t => <button disabled={pending} className={s.button} key={t.id} onClick={() => { setSelected(t.id); setAllDone(false); }}>{taskNames[t.kind]} · 第 {plan.tasks.indexOf(t) + 1} 项</button>)}</div></section>}
  </>;
}
function TaskCard({ plan, task, attempts, run, pending, onNext, onSaved }: { plan: DailyPlan; task: EnglishTask; attempts: EnglishAttempt[]; run: RunCommand; pending: boolean; onNext: () => void; onSaved: () => void }) {
  const [response, setResponse] = useState(""); const [hinted, setHinted] = useState(false); const [hintOpen, setHintOpen] = useState(false);
  const [transcript, setTranscript] = useState<{ id: string; text: string } | null>(null);
  const [feedback, setFeedback] = useState(""); const [saved, setSaved] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false); const [self, setSelf] = useState("partial");
  async function submit(selfAssessment = false) {
    const result = await run("attempt", { plan_id: plan.id, task_id: task.id, response: response.trim() || (selfAssessment ? "本次已口头练习，由本人自评。" : ""), result: self, hinted: hinted || attempts.length > 0, mode: selfAssessment ? "self" : transcript ? response === transcript.text ? "speech" : "corrected" : "text", transcription_id: transcript?.id });
    if (result) { setFeedback(result.message); setSaved(true); onSaved(); }
  }
  return <section className={s.task}><span className={s.eyebrow}>{taskNames[task.kind]}</span><h2>{task.prompt}</h2>
    {task.audio && <PrivateAudio body={{ plan_id: plan.id, task_id: task.id }} />}
    <div className={s.row}><button className={s.button} type="button" onClick={() => { setHintOpen(v => !v); setHinted(true); }}>{hintOpen ? "隐藏提示" : task.kind === "listen" ? "查看原文 / 辅助理解" : "看一下提示"}</button><span className={s.muted}>{hinted ? "已使用提示，本次记录为辅助练习" : "先独立试一试，同义表达也可以"}</span></div>
    {hintOpen && <div className={s.document} style={{ marginTop: 16 }}>{task.hint}{task.skill === "speaking" && <PrivateAudio body={{ plan_id: plan.id, task_id: task.id, reference: true }} />}</div>}
    <div className={s.form} style={{ marginTop: 24 }}><label>{task.skill === "listening" ? "你听到了什么？可以用中文回答" : "说出你的回应，或先输入英文练习"}<textarea rows={4} maxLength={3000} value={response} disabled={pending || recordBusy || saved} onChange={e => setResponse(e.target.value)} placeholder={task.skill === "listening" ? "写下你理解的意思…" : "录音后会出现转写文字，也可以直接输入…"} /></label>
      <ShortRecorder planId={plan.id} taskId={task.id} disabled={pending || saved} onBusy={setRecordBusy} onTranscript={(text, id) => { setResponse(text); setTranscript({ id, text }); }} />
      {transcript && response !== transcript.text && <p className={s.muted}>转写经过人工修正：会提供内容建议，但不算未经提示的独立口语掌握。</p>}
      <p className={s.muted}>AI 只反馈意思与表达，不评发音。文字输入不计入“独立开口”掌握；录音识别失败不记为答错。</p>
      {!saved && <button disabled={pending || recordBusy || !response.trim()} className={`${s.button} ${s.primary}`} onClick={() => void submit()}>提交并获取内容反馈</button>}
    </div>
    {!saved && <details className={s.details}><summary>暂时不使用 AI：记录人工自评</summary><p className={s.muted}>麦克风或服务暂不可用也能继续。自评会保留真实练习，不算客观掌握。</p><div className={s.row}><select aria-label="本次自评" value={self} onChange={e => setSelf(e.target.value)}><option value="correct">意思能表达清楚</option><option value="partial">有提示才会 / 还不熟</option><option value="again">还需要再练</option></select><button disabled={pending || recordBusy} className={s.button} onClick={() => void submit(true)}>保存本次自评</button></div></details>}
    {feedback && <div className={s.banner} style={{ marginTop: 20 }} role="status">{feedback}</div>}
    {(saved || attempts.length > 0) && <div className={s.row} style={{ marginTop: 20 }}><button disabled={pending || recordBusy} className={`${s.button} ${s.primary}`} onClick={onNext}>继续下一项 / 查看完成情况 →</button>{saved && <button disabled={pending} className={s.button} onClick={() => { setSaved(false); setHinted(true); setFeedback(""); }}>本题再练一次</button>}</div>}
  </section>;
}
export function PrivateAudio({ body }: { body: Record<string, unknown> }) {
  const [slow, setSlow] = useState(true), [loop, setLoop] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [src, setSrc] = useState("");
  const urls = useRef(new Map<boolean, string>()); const alive = useRef(true); const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => { alive.current = true; const cache = urls.current; return () => { alive.current = false; for (const url of cache.values()) URL.revokeObjectURL(url); cache.clear(); }; }, []);
  async function load() {
    if (busy) return;
    const existing = urls.current.get(slow); if (existing) { setSrc(existing); if (audio.current) { audio.current.src = existing; void audio.current.play().catch(() => {}); } return; }
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/adult/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, slow, id: crypto.randomUUID() }), signal: AbortSignal.timeout(45000) });
      if (!r.ok) throw new Error((await r.json()).error);
      const blob = await r.blob(); if (!alive.current) return;
      const url = URL.createObjectURL(blob); urls.current.set(slow, url); setSrc(url);
      if (audio.current) { audio.current.src = url; void audio.current.play().catch(() => {}); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "播放失败，请重试"); } finally { if (alive.current) setBusy(false); }
  }
  return <div style={{ margin: "16px 0" }}><div className={s.row}><button disabled={busy} className={s.button} onClick={() => void load()}>{busy ? "准备音频…" : "听一听"}</button><label className={s.check}><input type="checkbox" checked={slow} onChange={e => { setSlow(e.target.checked); audio.current?.pause(); setSrc(""); }} />慢速</label><label className={s.check}><input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />循环播放</label></div><audio ref={audio} controls loop={loop} src={src || undefined} className={s.audio} style={{ display: src ? "block" : "none" }} preload="none" />{error && <p role="alert" className={s.muted}>{error}</p>}<span className={s.muted}>根据课程合成的语音 · 若未自动播放，请按播放器 ▶</span></div>;
}

async function wavBlob(blob: Blob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const length = Math.min(decoded.length, Math.floor(decoded.sampleRate * 30));
    const offline = new OfflineAudioContext(1, Math.ceil(length / decoded.sampleRate * 16000), 16000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    const array = new ArrayBuffer(44 + pcm.length * 2); const view = new DataView(array);
    const str = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    str(0, "RIFF"); view.setUint32(4, 36 + pcm.length * 2, true); str(8, "WAVE"); str(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, "data"); view.setUint32(40, pcm.length * 2, true);
    pcm.forEach((n, i) => { const v = Math.max(-1, Math.min(1, n)); view.setInt16(44 + i * 2, v < 0 ? v * 32768 : v * 32767, true); });
    return new Blob([array], { type: "audio/wav" });
  } finally { await context.close(); }
}
function ShortRecorder({ planId, taskId, disabled, onTranscript, onBusy }: { planId: string; taskId: string; disabled: boolean; onTranscript: (text: string, id: string) => void; onBusy: (busy: boolean) => void }) {
  const [recording, setRecording] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [src, setSrc] = useState("");
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null), alive = useRef(true), currentUrl = useRef(""), saved = useRef<Blob | null>(null), requestId = useRef("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (timer.current) clearTimeout(timer.current); if (recorder.current?.state === "recording") recorder.current.stop(); stream.current?.getTracks().forEach(t => t.stop()); if (currentUrl.current) URL.revokeObjectURL(currentUrl.current); }; }, []);
  async function transcribe(blob: Blob) {
    setBusy(true); onBusy(true); setError("");
    try {
      const f = new FormData(); f.set("id", requestId.current); f.set("plan_id", planId); f.set("task_id", taskId); f.set("audio", blob, "practice.wav");
      const r = await fetch("/api/adult/media", { method: "POST", body: f, signal: AbortSignal.timeout(45000) }); const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      if (alive.current) onTranscript(b.text, b.transcription_id);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "转写失败，可重试或文字作答"); }
    finally { if (alive.current) { setBusy(false); onBusy(false); } }
  }
  async function start() {
    if (recording || busy) return; setError(""); setBusy(true); onBusy(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("当前浏览器不支持录音，请使用 HTTPS 下的新版 Safari/Chrome，或文字作答。");
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(t => MediaRecorder.isTypeSupported(t));
      const rec = new MediaRecorder(media, type ? { mimeType: type } : undefined); recorder.current = rec;
      const chunks: Blob[] = []; rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        media.getTracks().forEach(t => t.stop()); if (timer.current) clearTimeout(timer.current);
        if (!alive.current) return;
        setRecording(false); setBusy(true);
        try {
          const wav = await wavBlob(new Blob(chunks, { type: rec.mimeType })); if (!alive.current) return;
          if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
          currentUrl.current = URL.createObjectURL(wav); saved.current = wav; requestId.current = crypto.randomUUID(); setSrc(currentUrl.current); await transcribe(wav);
        } catch { if (alive.current) { setError("无法解码这次录音，可重录或文字作答。"); setBusy(false); onBusy(false); } }
      };
      rec.start(); setRecording(true); setBusy(false); timer.current = setTimeout(() => { if (rec.state === "recording") rec.stop(); }, 30000);
    } catch (e) { stream.current?.getTracks().forEach(t => t.stop()); if (alive.current) { setError(e instanceof Error ? e.message : "录音不可用"); setBusy(false); onBusy(false); } }
  }
  return <div><div className={s.row}><button type="button" disabled={disabled || busy} className={`${s.button} ${recording ? s.recording : ""}`} onClick={() => recording ? recorder.current?.stop() : void start()}>{recording ? "■ 结束录音并转写" : busy ? "正在转写…" : "● 录一句（最多 30 秒）"}</button><span className={s.muted}>{recording ? "正在录音，30 秒自动结束" : "录音仅用于本次转写与临时回放，不长期保存"}</span></div>{src && <audio controls src={src} className={s.audio} />}{error && <div role="alert"><p className={s.muted}>{error}</p>{src && <button className={s.button} disabled={disabled || busy || recording} onClick={() => saved.current && void transcribe(saved.current)}>重试这段录音的转写</button>}</div>}</div>;
}
