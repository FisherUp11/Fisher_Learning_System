"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { answerKidsEnglishWord } from "@/lib/kids-english-actions";

export type KidsQueueWord = {
  word_id: string; word: string; phonetic: string; meaning_zh: string; example_en: string;
  example_zh: string | null; part_of_speech: string | null; queue_kind: string; stage: number;
  attempt_count: number; clean_streak: number; required_confirmations: number; today_remaining: number;
  videos: Array<{ id: string; title: string }>;
};

function browserSpeak(text: string) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.78;
  window.speechSynthesis.speak(utterance);
}

export function KidsEnglishStudy({ learnerId, learnerName, initialQueue }: { learnerId: string; learnerName: string; initialQueue: KidsQueueWord[] }) {
  const [queue,setQueue] = useState(initialQueue);
  const [revealed,setRevealed] = useState(false);
  const [openVideo,setOpenVideo] = useState<string | null>(null);
  const [assisted,setAssisted] = useState(false);
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  const [speaking,setSpeaking] = useState(false);
  const [isPending,startTransition] = useTransition();
  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const item = queue[0];

  useEffect(() => () => {
    audio.current?.pause();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  async function speak(text: string) {
    audio.current?.pause();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    setSpeaking(true);
    try {
      const response = await fetch("/api/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text,lang: "en",slow: true,learner: learnerId,module: "kids_english" }) });
      if (!response.ok) throw new Error("语音暂不可用");
      const src = URL.createObjectURL(await response.blob());
      objectUrl.current = src;
      const player = new Audio(src);
      audio.current = player;
      player.onended = () => setSpeaking(false);
      await player.play();
    } catch { browserSpeak(text); setSpeaking(false); }
  }

  function answer(result: "known" | "again") {
    if (!item || isPending) return;
    setError("");
    startTransition(async () => {
      try {
        const response = await answerKidsEnglishWord({ learnerId, wordId: item.word_id, result, assisted, requestId: crypto.randomUUID() });
        setQueue((old) => response.passed ? old.slice(1) : [...old.slice(1), { ...old[0], attempt_count: old[0].attempt_count+1, clean_streak: result === "known" && !assisted ? old[0].clean_streak+1 : 0, required_confirmations: result === "again" || assisted ? 2 : old[0].required_confirmations }]);
        setMessage(response.passed ? "今天这词认出来了！以后还会适时复习。" : result === "again" || assisted ? "我们再见它一次，慢慢记住就好。" : "答对一次啦，再独立认出一次更稳。" );
        setRevealed(false); setOpenVideo(null); setAssisted(false);
      } catch (caught) { setError(caught instanceof Error ? caught.message : "记录失败，请重试"); }
    });
  }

  if (!item) return <section className="kids-finish panel"><span aria-hidden="true">✦</span><p className="eyebrow">Today complete</p><h1>{learnerName}，今天的单词都练完了！</h1><p>明天系统会把需要复习的单词再带回来。现在可以看看自己的单词册。</p><Link className="primary" href={`/kids-english/library?learner=${encodeURIComponent(learnerId)}`}>查看单词册</Link></section>;
  return <div className="kids-study-wrap">
    <div className="kids-study-top"><span>{item.queue_kind === "new" ? "今天的新朋友" : "到期复习"}</span><strong>今天还剩 {queue.length} 个词</strong></div>
    <section className="kids-word-card" aria-live="polite">
      <p className="eyebrow">Listen · Look · Remember</p>
      <h1 lang="en">{item.word}</h1>
      <p className="kids-phonetic" lang="en">{item.phonetic}</p>
      <div className="kids-audio-actions"><button type="button" className="secondary" disabled={speaking} onClick={() => speak(item.word)}>🔊 {speaking ? "朗读中…" : "听单词"}</button><button type="button" className="secondary" onClick={() => speak(item.example_en)}>🔊 听例句</button></div>
      {!revealed ? <button type="button" className="kids-reveal" onClick={() => { setRevealed(true); setAssisted(true); }}>想好了吗？点我看意思 <span aria-hidden="true">↗</span></button> : <div className="kids-meaning"><strong>{item.meaning_zh}</strong><p lang="en">{item.example_en}</p>{item.example_zh && <small>{item.example_zh}</small>}</div>}
      {item.videos.length > 0 && <div className="kids-video-area"><p>想不起时，回看课堂小片段</p><div className="kids-video-tabs">{item.videos.map((video) => <button className="text-button" type="button" key={video.id} onClick={() => { setOpenVideo(openVideo === video.id ? null : video.id); setAssisted(true); }}>{openVideo === video.id ? "收起" : "▶"} {video.title}</button>)}</div>{openVideo && <video key={openVideo} controls playsInline preload="metadata" src={`/api/kids-english/video/${openVideo}?learner=${encodeURIComponent(learnerId)}&word=${encodeURIComponent(item.word_id)}`} />}</div>}
    </section>
    <div className="kids-answer-actions"><button className="primary" disabled={isPending} onClick={() => answer("known")}>{isPending ? "正在记录…" : "我认出了"}</button><button className="secondary" disabled={isPending} onClick={() => answer("again")}>再学一次</button></div>
    <p className="kids-study-hint">新词或初级复习要独立认出两次；看过答案或视频后这一轮算提示练习，下轮再独立试试。</p>
    {message && <p className="success-box" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}
