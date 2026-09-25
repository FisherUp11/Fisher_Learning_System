"use client";
import Link from "next/link";
import { useState } from "react";
import type { ListeningSession, ListeningAttempt, ChoiceQuestion, ListeningTerm } from "@/lib/english-listening";
import type { RunCommand } from "./adult-hub";
import { PrivateAudio } from "./adult-english-study";
import s from "./adult-growth.module.css";

export function ListeningStudy({ session, attempts, run, pending }: { session: ListeningSession; attempts: ListeningAttempt[]; run: RunCommand; pending: boolean }) {
  const tasks = [
    ...session.review_words.map((word, i) => ({ id: `r:${i}`, word, question: undefined as ChoiceQuestion | undefined })),
    ...(session.snapshot?.questions ?? []).map((question, i) => ({ id: `q:${i}`, question, word: undefined as ListeningTerm | undefined })),
    ...(session.snapshot?.expressions ?? []).map((word, i) => ({ id: `w:${i}`, word, question: undefined as ChoiceQuestion | undefined })),
  ];
  const [acks, setAcks] = useState<ListeningAttempt[]>([]);
  const records = [...acks, ...attempts.filter(a => !acks.some(x => x.id === a.id))];
  const done = new Set(records.map(a => a.task_id));
  const [selected, setSelected] = useState(() => tasks.find(t => !attempts.some(a => a.task_id === t.id))?.id ?? tasks[0]?.id);
  const [finished, setFinished] = useState(!!session.completed_at);
  const [textOpen, setTextOpen] = useState(false), [helped, setHelped] = useState(session.assisted);
  const task = tasks.find(t => t.id === selected);
  const completed = tasks.every(t => done.has(t.id));
  async function reveal() {
    if (textOpen) { setTextOpen(false); return; }
    if (!helped) { const result = await run("listen-hint", { session_id: session.id }); if (!result) return; setHelped(true); }
    setTextOpen(true);
  }
  function next() {
    const index = tasks.findIndex(t => t.id === selected);
    const remaining = tasks.slice(index + 1).find(t => !done.has(t.id)) ?? tasks.find(t => t.id !== selected && !done.has(t.id));
    if (remaining) setSelected(remaining.id); else setFinished(true);
  }
  return <>
    <section className={s.card}><div className={s.between}><div><span className={s.eyebrow}>LISTEN · UNDERSTAND · REMEMBER</span><h2>{session.snapshot?.title ?? "今天，巩固熟悉的词句"}</h2><p className={s.muted}>{session.local_date} · 已记录 {done.size} / {tasks.length} 项 · 刷新后继续</p></div><span className={s.badge}>约 10～15 分钟</span></div>
      <div className={s.progress}><div style={{ width: `${tasks.length ? done.size / tasks.length * 100 : 0}%` }} /></div>
      <div className={s.taskList}>{tasks.map((t, i) => <button key={t.id} disabled={pending} className={selected === t.id && !finished ? s.current : done.has(t.id) ? s.done : ""} aria-label={`第 ${i + 1} 项，${done.has(t.id) ? "已记录" : "未完成"}`} onClick={() => { setSelected(t.id); setFinished(false); }}>{done.has(t.id) ? "✓" : i + 1}</button>)}</div>
    </section>
    {completed && finished ? <section className={`${s.card} ${s.empty}`}><span className={s.eyebrow}>A LITTLE MORE CONFIDENT</span><h2>今天，又听懂了一点</h2><p>练习已保存。完成不代表全部掌握，明天继续跨天复习。</p><div className={s.row}><Link className={`${s.button} ${s.primary}`} href="/english/progress">查看我的积累 →</Link><button className={s.button} onClick={() => setFinished(false)}>回看今天的题目</button></div></section> : <>
      {session.snapshot && <section className={s.card}><h3>先听，再选出你理解的意思</h3><p className={s.muted}>可慢速、循环、多听几遍，不要求录音。看原文后继续练也很好，系统会单独标记为辅助理解。</p><PrivateAudio body={{ session_id: session.id, target: "summary" }} /><button disabled={pending} className={s.button} onClick={() => void reveal()}>{textOpen ? "收起原文" : "查看听力稿与中文辅助"}</button>{textOpen && <div className={s.document}><p>{session.snapshot.summary}</p><hr /><p>{session.snapshot.translation}</p></div>}{(helped || session.assisted) && <p className={s.muted}>已使用原文辅助；已保存的首次成绩不会被覆盖。</p>}</section>}
      {task && <AnswerCard key={task.id} id={task.id} sessionId={session.id} question={task.question} word={task.word} records={records.filter(a => a.task_id === task.id)} run={run} pending={pending} onSaved={a => setAcks(old => [a, ...old.filter(x => x.id !== a.id)])} onNext={next} />}
    </>}
  </>;
}

function AnswerCard({ id, sessionId, question, word, records, run, pending, onSaved, onNext }: {
  id: string; sessionId: string; question?: ChoiceQuestion; word?: ListeningTerm; records: ListeningAttempt[]; run: RunCommand; pending: boolean; onSaved: (a: ListeningAttempt) => void; onNext: () => void;
}) {
  const [choice, setChoice] = useState<number | null>(null), [hint, setHint] = useState(false), [retry, setRetry] = useState(false);
  const latest = records[0]; const feedback = !!latest && !retry;
  const item = question ?? word!;
  async function submit(rating?: "known" | "again") {
    const result = await run("listen-answer", { session_id: sessionId, task_id: id, selected: rating ? null : choice, rating: rating ?? null, assisted: hint || records.length > 0 });
    if (result?.listeningAttempt) { onSaved(result.listeningAttempt); setRetry(false); }
  }
  async function showHint() {
    // Persist question assistance before revealing it so a refresh cannot restore a blind score.
    if (!hint) { const result = await run("listen-hint", { session_id: sessionId, task_id: id }); if (!result) return; }
    setHint(true);
  }
  return <section className={`${s.task} ${s.form}`}><span className={s.eyebrow}>{id.startsWith("r:") ? "REVIEW · 到期词句" : question ? "LISTENING · 理解选择题" : "VOCABULARY · 会议词句"}</span><h2>{question?.prompt ?? word?.phrase}</h2>
    {word && <><span className={s.badge}>{{ word: "单词", phrase: "短语", sentence: "短句" }[word.category]}</span><PrivateAudio body={{ session_id: sessionId, target: id }} /></>}
    <fieldset className={s.choiceGroup} disabled={pending || feedback}><legend className={s.muted}>选择最符合的意思</legend>{item.options.map((option, i) => <label key={i} className={`${s.choice} ${choice === i ? s.chosen : ""}`}><input type="radio" name={`answer-${id}`} checked={choice === i} onChange={() => setChoice(i)} /><span className={s.choiceLetter}>{"ABCD"[i]}</span><span>{option}</span></label>)}</fieldset>
    {!feedback && <div className={s.row}><button className={`${s.button} ${s.primary}`} disabled={pending || choice === null} onClick={() => void submit()}>确认答案</button><button className={s.button} disabled={pending || hint} onClick={() => void showHint()}>{question ? "需要中文题意" : "先看看释义与例句"}</button></div>}
    {(hint || feedback) && <div className={s.document}>{question ? <><p>{question.translation}</p>{feedback && <><strong>参考答案：{"ABCD"[question.correct]} · {question.options[question.correct]}</strong><p>{question.explanation}</p><blockquote>{question.evidence}</blockquote><PrivateAudio body={{ session_id: sessionId, target: id }} /></>}</> : <><strong>{word!.meaning}</strong><p>应用例句：{word!.example}</p><p className={s.muted}>纪要原句：{word!.source_quote}</p></>}</div>}
    {hint && !feedback && <p className={s.muted}>使用辅助后仍可继续答题，会如实记录为辅助练习。</p>}
    {word && !feedback && <details className={s.details}><summary>本次只记自评，不做选择题</summary><p className={s.muted}>自评不算独立答对，也不会直接提升记忆阶段。</p><div className={s.row}><button disabled={pending} className={s.button} onClick={() => void submit("known")}>感觉熟悉了</button><button disabled={pending} className={s.button} onClick={() => void submit("again")}>还需要再学</button></div></details>}
    {feedback && <><div className={s.banner} role="status">{latest.correct ? "已保存 · 这次回答正确" : "已保存 · 这次还需要巩固"}{latest.assisted ? "（辅助 / 重练 / 自评）" : "（独立作答）"}。{latest.selected !== null && `你选择了 ${"ABCD"[latest.selected]}。`}</div><div className={s.row}><button disabled={pending} className={`${s.button} ${s.primary}`} onClick={onNext}>下一项 / 完成 →</button><button disabled={pending} className={s.button} onClick={() => { setRetry(true); setChoice(null); setHint(true); }}>再练一次</button></div></>}
  </section>;
}
