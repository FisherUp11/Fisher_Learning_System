"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { recordCatechismAttempt } from "@/lib/catechism-actions";
import type { CatechismAttemptResult, CatechismQueueItem } from "@/lib/catechism";

type Language = "zh" | "en";

function browserSpeak(text: string, language: Language) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = language === "en" ? "en-US" : "zh-CN";
  utterance.rate = language === "en" ? 0.78 : 0.76;
  window.speechSynthesis.speak(utterance);
}

export function CatechismStudyExperience({ learnerId, learnerName, initialQueue, today }: {
  learnerId: string;
  learnerName: string;
  initialQueue: CatechismQueueItem[];
  today: string;
}) {
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answerVisible, setAnswerVisible] = useState(false);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [recitedCount, setRecitedCount] = useState(0);
  const [againCount, setAgainCount] = useState(0);
  const [isPending, startTransition] = useTransition();
  const item = initialQueue[index];

  useEffect(() => () => {
    audioRef.current?.pause();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  function stopSpeaking() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(null);
  }

  async function speak(text: string, language: Language, label: string) {
    stopSpeaking();
    setError("");
    setSpeaking(label);
    try {
      const response = await fetch("/api/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang: language, slow: true }) });
      if (!response.ok) throw new Error("azure-unavailable");
      const source = URL.createObjectURL(await response.blob());
      audioUrlRef.current = source;
      const audio = new Audio(source);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(source); audioUrlRef.current = null; setSpeaking(null); };
      audio.onerror = () => { URL.revokeObjectURL(source); audioUrlRef.current = null; browserSpeak(text, language); setSpeaking(null); };
      await audio.play();
    } catch {
      browserSpeak(text, language);
      setSpeaking(null);
    }
  }

  function submit(result: CatechismAttemptResult) {
    if (!item || !answerVisible) return;
    setError("");
    setMessage("");
    stopSpeaking();
    startTransition(async () => {
      try {
        await recordCatechismAttempt({ learnerId, itemId: item.id, result, note, requestId: crypto.randomUUID() });
        if (result === "recited") setRecitedCount((count) => count + 1);
        else setAgainCount((count) => count + 1);
        setMessage(result === "recited" ? "已记下：基本完整地背出来了。" : "已记下：明天会优先再问一次。");
        setNote("");
        setAnswerVisible(false);
        setIndex((current) => current + 1);
        if (index + 1 >= initialQueue.length) router.refresh();
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "记录失败，请稍后再试");
      }
    });
  }

  if (!item) return <section className="catechism-complete panel">
    <span className="catechism-seal" aria-hidden="true">问</span>
    <p className="eyebrow">Today is complete</p>
    <h1>{initialQueue.length ? "今天的问答完成了。" : "今天暂时没有待学问题。"}</h1>
    <p className="lede">{initialQueue.length ? `${learnerName} 今天背出 ${recitedCount} 问，${againCount} 问会在近期优先复习。` : "到期问题完成后，系统会在合适的日期再次安排。"}</p>
    <div className="catechism-complete-actions"><Link className="primary" href={`/catechism?learner=${encodeURIComponent(learnerId)}`}>查看问答册</Link><Link className="secondary" href="/catechism/manage">家长管理</Link></div>
  </section>;

  const progress = initialQueue.length ? Math.round((index / initialQueue.length) * 100) : 100;
  return <div className="catechism-study-wrap">
    <div className="progress-head"><span>{item.queueKind === "new" ? "今天的新问题" : "到期复习"}</span><span>{index + 1} / {initialQueue.length}</span></div>
    <div className="progress-line"><span style={{ width: `${progress}%` }} /></div>
    {message && <p className="answer-notice" role="status">{message}</p>}
    <article className={`catechism-study-card ${answerVisible ? "answer-open" : ""}`}>
      <header className="catechism-card-meta"><div><span className="catechism-seal" aria-hidden="true">问</span><span><strong>第 {item.sequence} 问</strong><small>{item.collectionTitle}{item.sectionTitle ? ` · ${item.sectionTitle}` : ""}</small></span></div><span className={`catechism-kind ${item.queueKind}`}>{item.queueKind === "new" ? "新问题" : `阶段 ${item.stage} · 复习`}</span></header>
      <section className="catechism-question-block">
        <div className="catechism-language-heading"><span>中文问题</span><button type="button" className="catechism-listen" disabled={Boolean(speaking)} onClick={() => speak(item.questionZh, "zh", "question-zh")}>{speaking === "question-zh" ? "朗读中…" : "▶ 朗读中文问题"}</button></div>
        <h1>{item.questionZh}</h1>
        {item.questionEn && <div className="catechism-english-question" lang="en"><div className="catechism-language-heading"><span>English question</span><button type="button" className="catechism-listen english" disabled={Boolean(speaking)} onClick={() => speak(item.questionEn!, "en", "question-en")}>{speaking === "question-en" ? "Reading…" : "▶ Read English"}</button></div><p>{item.questionEn}</p></div>}
      </section>
      {!answerVisible ? <div className="catechism-reveal-area"><p>让孩子先口头回答，再打开答案核对。</p><button className="primary" type="button" onClick={() => setAnswerVisible(true)}>查看中英文答案</button></div> : <section className="catechism-answer-reveal">
        <div className="catechism-answer-column"><div className="catechism-language-heading"><span>中文答案</span><button type="button" className="catechism-listen" disabled={Boolean(speaking)} onClick={() => speak(item.answerZh, "zh", "answer-zh")}>{speaking === "answer-zh" ? "朗读中…" : "▶ 朗读中文答案"}</button></div><p>{item.answerZh}</p></div>
        {item.answerEn && <div className="catechism-answer-column english" lang="en"><div className="catechism-language-heading"><span>English answer</span><button type="button" className="catechism-listen english" disabled={Boolean(speaking)} onClick={() => speak(item.answerEn!, "en", "answer-en")}>{speaking === "answer-en" ? "Reading…" : "▶ Read English"}</button></div><p>{item.answerEn}</p></div>}
        {item.scriptureReference && <div className="catechism-scripture"><span>经文出处</span><p>{item.scriptureReference}</p></div>}
        <details className="catechism-note"><summary>添加本次家长备注（可选）</summary><textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="例如：英文答案中间停顿了一次" /></details>
      </section>}
    </article>
    {answerVisible && <section className="catechism-judgement"><p>家长判断标准：内容与原答案基本相同（约 80%–100%）即可选择“背出来了”。</p><div><button type="button" className="answer-known" disabled={isPending} onClick={() => submit("recited")}>{isPending ? "记录中…" : "背出来了"}</button><button type="button" className="answer-again" disabled={isPending} onClick={() => submit("again")}>{isPending ? "记录中…" : "还要再背"}</button></div></section>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="hint">学习日期：{today} · 每一次判断都会独立保留</p>
  </div>;
}
