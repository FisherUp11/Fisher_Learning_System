"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import Link from "next/link";
import { answerQueueItem, loadTodayQueue, type Learner, type QueueItem } from "@/lib/actions";
import { RewardCelebration } from "@/components/reward-celebration";
import type { RewardOutcome } from "@/lib/reward-types";

function kindLabel(kind: QueueItem["queue_kind"]) {
  if (kind === "new" || kind === "new_reinforcement") return "今天的新朋友";
  if (kind === "error_reinforcement" || kind === "same_day_retry") return "我们再见一次";
  return "复习一下";
}

type TodayProgress = { total: number; passed: number; remaining: number };

const EMPTY_PROGRESS: TodayProgress = { total: 0, passed: 0, remaining: 0 };

function progressFromItem(item: QueueItem | undefined): TodayProgress | null {
  if (!item) return null;
  return {
    total: item.today_total,
    passed: item.today_passed,
    remaining: item.today_remaining,
  };
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
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  const [assistedFor, setAssistedFor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [answering, setAnswering] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [speaking, setSpeaking] = useState<"character" | "pinyin" | "context" | null>(null);
  const [todayProgress, setTodayProgress] = useState<TodayProgress>(EMPTY_PROGRESS);
  const [answerNotice, setAnswerNotice] = useState("");
  const [memoryImage, setMemoryImage] = useState<{ characterId: string; source: string } | null>(null);
  const [memoryImageVisibleFor, setMemoryImageVisibleFor] = useState<string | null>(null);
  const [memoryImageLoading, setMemoryImageLoading] = useState(false);
  const [memoryImageError, setMemoryImageError] = useState<{ characterId: string; message: string } | null>(null);
  const [earnedReward, setEarnedReward] = useState<RewardOutcome | null>(null);
  const queueRequest = useRef(0);
  const speechToken = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const current = queue[0];
  const guidedAssistance = Boolean(current && current.failed_streak >= 3);
  const revealed = Boolean(current && (guidedAssistance || revealedFor === current.session_item_id));
  const assisted = Boolean(current && (guidedAssistance || assistedFor === current.session_item_id));
  const currentMemoryImage = current
    ? (memoryImage?.characterId === current.character_id ? memoryImage.source : null)
    : null;
  const memoryImageVisible = Boolean(currentMemoryImage && current && memoryImageVisibleFor === current.character_id);
  const currentMemoryImageError = current && memoryImageError?.characterId === current.character_id ? memoryImageError.message : "";
  async function refreshQueue(options: { foreground?: boolean } = {}) {
    const foreground = options.foreground ?? true;
    const request = ++queueRequest.current;
    if (foreground) setLoading(true);
    else setSyncing(true);

    try {
      setError("");
      const result = await loadTodayQueue(learner.id);
      if (request !== queueRequest.current) return;
      if (result.error) {
        setQueue([]);
        setTodayProgress(EMPTY_PROGRESS);
        setError(result.error);
        return;
      }
      const items = result.items;
      setQueue(items);
      const nextProgress = progressFromItem(items[0]);
      if (nextProgress) setTodayProgress(nextProgress);
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
        const result = await loadTodayQueue(learner.id);
        if (!active || request !== queueRequest.current) return;
        if (result.error) {
          setQueue([]);
          setTodayProgress(EMPTY_PROGRESS);
          setError(result.error);
          return;
        }
        const items = result.items;
        setQueue(items);
        const nextProgress = progressFromItem(items[0]);
        if (nextProgress) setTodayProgress(nextProgress);
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

  async function answer(result: "known" | "again", usedAssistance = assisted) {
    if (!current || answering) return;
    // 先取消任何过期的后台同步，避免它把旧队列写回界面。
    queueRequest.current += 1;
    setAnswering(true);
    setError("");
    try {
      stopSpeaking();
      const saved = await answerQueueItem({
        learnerId: learner.id,
        sessionItemId: current.session_item_id,
        result,
        requestId: crypto.randomUUID(),
        assisted: usedAssistance,
      });

      // 记录成功后立即切换卡片，不让一次附加的“刷新队列”阻塞孩子继续学习。
      const remaining = queue.slice(1);
      setQueue(remaining);
      setRevealedFor(null);
      setAssistedFor(null);
      setMemoryImageVisibleFor(null);
      if (
        typeof saved.today_total === "number"
        && typeof saved.today_passed === "number"
        && typeof saved.today_remaining === "number"
      ) {
        setTodayProgress({
          total: saved.today_total,
          passed: saved.today_passed,
          remaining: saved.today_remaining,
        });
      }
      if (saved.reward?.awarded) setEarnedReward(saved.reward);
      if (usedAssistance) {
        setAnswerNotice("这次是在帮助下认识的。已经放到后面，稍后再自己认两次。");
      } else if (saved.daily_passed) {
        const attemptNumber = saved.attempt_number ?? 1;
        setAnswerNotice(attemptNumber === 1 ? "一次就独立认出来啦！" : "两次都独立认出来啦，今天认住它了！");
      } else if (saved.clean_streak === 1 && saved.required_confirmations === 2) {
        setAnswerNotice("第一次独立认出啦！过几张再确认一次。");
      } else {
        setAnswerNotice("没关系，先认识一下，过几张我们再见。");
      }
      void refreshQueue({ foreground: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "这次回答没有保存，请再试一次");
    } finally {
      setAnswering(false);
    }
  }

  async function showMemoryImage() {
    if (!current || memoryImageLoading) return;
    markAssisted();
    if (memoryImage?.characterId === current.character_id) {
      setMemoryImageVisibleFor(current.character_id);
      return;
    }

    setMemoryImageLoading(true);
    setMemoryImageError(null);
    try {
      const response = await fetch("/api/ai/character-memory-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learnerId: learner.id, characterId: current.character_id }),
      });
      const payload = await response.json() as { image?: string; error?: string };
      if (!response.ok || !payload.image) throw new Error(payload.error ?? "联想图暂时画不出来");
      setMemoryImage({ characterId: current.character_id, source: payload.image });
      setMemoryImageVisibleFor(current.character_id);
    } catch (cause) {
      setMemoryImageError({ characterId: current.character_id, message: cause instanceof Error ? cause.message : "联想图暂时画不出来" });
    } finally {
      setMemoryImageLoading(false);
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
    if (kind === "character") markAssisted();
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

  function markAssisted() {
    if (!current) return;
    setAssistedFor(current.session_item_id);
    setRevealedFor(current.session_item_id);
  }

  if (loading && queue.length === 0) return <p className="muted">正在准备今天的汉字…</p>;
  if (error && !current) return <section className="panel"><p className="error">{error}</p><button className="secondary" onClick={() => void refreshQueue()}>重新加载</button></section>;
  if (!current && syncing && todayProgress.remaining > 0) return <section className="empty panel"><span className="empty-mark">🌱</span><h1>正在准备下一张</h1><p className="lede">刚才的字已经放到后面，稍后再独立认一认。</p></section>;
  if (!current) {
    return <section className="empty panel"><span className="empty-mark">🌱</span><h1>今天完成啦！</h1><p className="lede">今天的汉字都独立认出来了，慢慢记住最厉害。</p>{earnedReward && <p className="reward-complete-note">一枚“识字小达人”贴纸已经放进贴纸册。</p>}<button className="secondary" onClick={() => void refreshQueue()}>看看有没有新任务</button>{earnedReward && <RewardCelebration learnerId={learner.id} reward={earnedReward} message="今天的汉字都独立认出来啦！一枚“识字小达人”贴纸住进贴纸册啦！" />}</section>;
  }

  const percentage = todayProgress.total > 0
    ? Math.min(100, Math.max(todayProgress.passed > 0 ? 8 : 0, (todayProgress.passed / todayProgress.total) * 100))
    : 0;
  const confirmationRequired = current.required_confirmations === 2;
  const appearanceNumber = current.attempt_count + 1;
  return (
    <section className="learning-wrap">
      <div className="progress-head">
        <span>{kindLabel(current.queue_kind)}</span>
        <span aria-live="polite">今日已认出 {todayProgress.passed} / {todayProgress.total} 个字</span>
      </div>
      <div className="progress-line"><span style={{ width: `${percentage}%` }} /></div>
      <article className="character-card">
        <div className="card-status-row">
          <span className={`card-kind ${current.queue_kind === "review" || current.queue_kind === "carry" ? "review" : ""}`}>{kindLabel(current.queue_kind)}</span>
          {appearanceNumber > 1 && <span className="attempt-badge">第 {appearanceNumber} 次</span>}
        </div>
        {confirmationRequired && <div className="confirmation-strip" aria-label={`已完成 ${current.clean_streak} 次，共需 2 次独立认出`}>
          <span>独立认出</span>
          <span className={current.clean_streak >= 1 ? "confirmed" : ""}>🌱</span>
          <span className={current.clean_streak >= 2 ? "confirmed" : ""}>🌱</span>
        </div>}
        {guidedAssistance && <p className="guided-assistance-note">已经认真试了三次，先看看提示、听一听，稍后再自己认。</p>}
        <div className="character" aria-label={`汉字 ${current.hanzi}`}>{current.hanzi}</div>
        <div className="card-tools">
          <button className="listen" disabled={Boolean(speaking)} onClick={() => void speakText(current.hanzi, 3, "character")}>{speaking === "character" ? "正在慢读…" : "🔊 汉字慢读 3 遍"}</button>
          <button className="memory-image-button" disabled={memoryImageLoading} onClick={() => void showMemoryImage()}>{memoryImageLoading ? "正在画联想图…" : currentMemoryImage ? "🖼 再看联想图" : "🖼 看联想图"}</button>
        </div>
        {memoryImageVisible && currentMemoryImage && <section className="memory-image-panel" aria-label={`${current.hanzi} 的联想图`}>
          {/* GPT 图片以受保护的 data URL 返回，Next/Image 无法优化它。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={currentMemoryImage} alt={`帮助记住汉字“${current.hanzi}”的联想插图`} />
          <div><p>看一眼，想一想它和“{current.meaning}”有什么关系。</p><button type="button" className="text-button" onClick={() => setMemoryImageVisibleFor(null)}>收起图片，再认一认</button></div>
        </section>}
        {currentMemoryImageError && <p className="memory-image-error">{currentMemoryImageError}</p>}
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
      {!revealed ? <>
        <div className="answers">
          <button className="answer-known" disabled={answering} onClick={() => void answer("known", false)}>{answering ? "记录中…" : "我自己认出来了"}</button>
          <button className="answer-again" disabled={answering} onClick={markAssisted}>还要再学一次</button>
        </div>
        <p className="hint">没有听朗读、看答案或得到提示，才算独立认出。</p>
      </> : <>
        <button className="secondary full assisted-finish" disabled={answering} onClick={() => void answer("again", true)}>{answering ? "记录中…" : "学好了，稍后再自己认"}</button>
        <p className="hint assisted-hint">这次得到过帮助，不计独立确认；稍后会重新隐藏答案。</p>
      </>}
      {answerNotice && <p className="answer-notice" aria-live="polite">{answerNotice}</p>}
      {syncing && <p className="hint">已记录，正在准备后面的字…</p>}
      {error && <p className="error">{error}</p>}
      <details className="parent-learning-options">
        <summary>家长选项</summary>
        <p>如果孩子今天已经累了，可以先结束。未通过的字不会算完成，也不会发贴纸，明天会优先出现。</p>
        <Link className="text-button" href="/">今天先到这里</Link>
      </details>
    </section>
  );
}
