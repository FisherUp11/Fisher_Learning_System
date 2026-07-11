"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { answerQueueItem, loadTodayQueue, type Learner, type QueueItem } from "@/lib/actions";

function kindLabel(kind: QueueItem["queue_kind"]) {
  if (kind === "new" || kind === "new_reinforcement") return "今天的新朋友";
  if (kind === "error_reinforcement") return "我们再见一次";
  return "复习一下";
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function speakWithBrowser(text: string, repeats: number, token: number, activeToken: MutableRefObject<number>) {
  if (!("speechSynthesis" in window)) return Promise.resolve();
  window.speechSynthesis.cancel();
  return (async () => {
    for (let index = 0; index < repeats; index += 1) {
      if (token !== activeToken.current) return;
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "zh-CN";
        utterance.rate = 0.66;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      });
      if (index < repeats - 1 && token === activeToken.current) await wait(420);
    }
  })();
}

function playAudio(audio: HTMLAudioElement) {
  return new Promise<void>((resolve, reject) => {
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("audio playback failed"));
    void audio.play().catch(reject);
  });
}

export function LearningExperience({ learner }: { learner: Learner }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [speaking, setSpeaking] = useState<"character" | "pinyin" | "context" | null>(null);
  const queueRequest = useRef(0);
  const speechToken = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const current = queue[0];
  async function refreshQueue(options: { foreground?: boolean } = {}) {
    const foreground = options.foreground ?? true;
    const request = ++queueRequest.current;
    if (foreground) setLoading(true);
    else setSyncing(true);

    try {
      setError("");
      const items = await loadTodayQueue(learner.id);
      if (request !== queueRequest.current) return;
      setQueue(items);
      setRevealed(items[0]?.queue_kind === "new");
    } catch (cause) {
      if (request !== queueRequest.current) return;
      setError(cause instanceof Error ? cause.message : "今日任务加载失败");
    } finally {
      if (request === queueRequest.current) {
        if (foreground) setLoading(false);
        else setSyncing(false);
      }
    }
  }

  useEffect(() => {
    let active = true;
    const request = ++queueRequest.current;
    async function loadInitialQueue() {
      try {
        const items = await loadTodayQueue(learner.id);
        if (!active || request !== queueRequest.current) return;
        setQueue(items);
        setRevealed(items[0]?.queue_kind === "new");
      } catch (cause) {
        if (!active || request !== queueRequest.current) return;
        setError(cause instanceof Error ? cause.message : "今日任务加载失败");
      } finally {
        if (active && request === queueRequest.current) setLoading(false);
      }
    }
    void loadInitialQueue();
    return () => { active = false; };
  }, [learner.id]);

  async function answer(result: "known" | "again") {
    if (!current || answering) return;
    // 先取消任何过期的后台同步，避免它把旧队列写回界面。
    queueRequest.current += 1;
    setAnswering(true);
    setError("");
    try {
      await answerQueueItem({ learnerId: learner.id, sessionItemId: current.session_item_id, result, requestId: crypto.randomUUID() });

      // 记录成功后立即切换卡片，不让一次附加的“刷新队列”阻塞孩子继续学习。
      const remaining = queue.slice(1);
      setQueue(remaining);
      setRevealed(remaining[0]?.queue_kind === "new");
      void refreshQueue({ foreground: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "这次回答没有保存，请再试一次");
    } finally {
      setAnswering(false);
    }
  }

  function stopSpeaking() {
    speechToken.current += 1;
    audioRef.current?.pause();
    audioRef.current?.dispatchEvent(new Event("ended"));
    audioRef.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(null);
  }

  async function speakText(text: string, repeats: number, kind: "character" | "pinyin" | "context") {
    if (!text || speaking) return;
    const token = ++speechToken.current;
    setSpeaking(kind);
    try {
      const response = await fetch(`/api/speech?text=${encodeURIComponent(text)}&slow=1`);
      if (!response.ok) throw new Error("speech unavailable");
      const objectUrl = URL.createObjectURL(await response.blob());
      try {
        for (let index = 0; index < repeats; index += 1) {
          if (token !== speechToken.current) return;
          const audio = new Audio(objectUrl);
          audio.playbackRate = 0.88;
          audioRef.current = audio;
          await playAudio(audio);
          if (index < repeats - 1 && token === speechToken.current) await wait(420);
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      if (token === speechToken.current) await speakWithBrowser(text, repeats, token, speechToken);
    } finally {
      if (token === speechToken.current) {
        audioRef.current = null;
        setSpeaking(null);
      }
    }
  }

  if (loading && queue.length === 0) return <p className="muted">正在准备今天的汉字…</p>;
  if (error && !current) return <section className="panel"><p className="error">{error}</p><button className="secondary" onClick={() => void refreshQueue()}>重新加载</button></section>;
  if (!current) {
    return <section className="empty panel"><span className="empty-mark">🌱</span><h1>今天完成啦！</h1><p className="lede">慢慢记住，比一次学很多更厉害。</p><button className="secondary" onClick={() => void refreshQueue()}>看看有没有新任务</button></section>;
  }

  const percentage = Math.min(100, Math.max(8, (current.queue_position / Math.max(current.queue_position + queue.length - 1, 1)) * 100));
  return (
    <section className="learning-wrap">
      <div className="progress-head"><span>{kindLabel(current.queue_kind)}</span><span>还剩 {queue.length} 个</span></div>
      <div className="progress-line"><span style={{ width: `${percentage}%` }} /></div>
      <article className="character-card">
        <span className={`card-kind ${current.queue_kind === "review" || current.queue_kind === "carry" ? "review" : ""}`}>{kindLabel(current.queue_kind)}</span>
        <div className="character" aria-label={`汉字 ${current.hanzi}`}>{current.hanzi}</div>
        <button className="listen" disabled={Boolean(speaking)} onClick={() => void speakText(current.hanzi, 3, "character")}>{speaking === "character" ? "正在慢读…" : "🔊 汉字慢读 3 遍"}</button>
        {revealed && <div className="answer-panel">
          <p className="pinyin">{current.pinyin_marked}</p><p className="meaning">{current.meaning}</p>
          {(current.word_one || current.word_two) && <p className="words">{[current.word_one, current.word_two].filter(Boolean).join(" · ")}</p>}
          {current.example_sentence && <p className="words">“{current.example_sentence}”</p>}
          <div className="listen-tools">
            <button className="listen small-listen" disabled={Boolean(speaking)} onClick={() => void speakText(current.pinyin_marked, 2, "pinyin")}>{speaking === "pinyin" ? "正在慢读…" : "🔊 拼音读 2 遍"}</button>
            {(current.word_one || current.word_two || current.example_sentence) && <button className="listen small-listen" disabled={Boolean(speaking)} onClick={() => void speakText([[current.word_one, current.word_two].filter(Boolean).join("，"), current.example_sentence].filter(Boolean).join("。"), 1, "context")}>{speaking === "context" ? "正在朗读…" : "🔊 词语和句子"}</button>}
            {speaking && <button className="stop-listen" type="button" onClick={stopSpeaking}>停止朗读</button>}
          </div>
        </div>}
      </article>
      {!revealed ? <><button className="secondary full" onClick={() => setRevealed(true)}>看看答案</button><p className="hint">先在心里想一想，再打开答案。</p></> : <div className="answers"><button className="answer-known" disabled={answering} onClick={() => void answer("known")}>{answering ? "记录中…" : "我认识"}</button><button className="answer-again" disabled={answering} onClick={() => void answer("again")}>{answering ? "记录中…" : "再学一次"}</button></div>}
      {syncing && <p className="hint">已记录，正在准备后面的字…</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
