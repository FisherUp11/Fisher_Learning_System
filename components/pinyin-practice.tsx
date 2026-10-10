"use client";

import { useEffect, useRef, useState } from "react";
import { answerPinyin, loadPinyinToday } from "@/lib/pinyin-actions";
import { pinyinCategoryLabel } from "@/lib/pinyin-catalog";
import { useImmediateStudy } from "@/components/use-immediate-study";
import type { StudyAnswer } from "@/lib/study-answer-sync";

type Today = Awaited<ReturnType<typeof loadPinyinToday>>;
function savePinyin(answer: StudyAnswer) { return answerPinyin(answer); }
function advancePinyin(today: Today): Today { return { ...today, items: today.items.slice(1) }; }
function reconcilePinyin(saved: Awaited<ReturnType<typeof answerPinyin>>): Today | null { return saved.today; }

export function PinyinPractice({ learnerId }: { learnerId: string }) {
  const study = useImmediateStudy({ scope: "pinyin", learnerId, load: loadPinyinToday, save: savePinyin, advance: advancePinyin, reconcile: reconcilePinyin });
  const today = study.data;
  const busy = study.blocked;
  const [revealed, setRevealed] = useState(false);
  const [heard, setHeard] = useState(false);
  const [listening, setListening] = useState(false);
  const current = today?.items[0];
  const speechToken = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const commit = study.lastCommit;
  const message = study.status !== "ready" || !commit ? "" : commit.saved.idempotent ? "上次的记录已经同步，不会重复计数。" : commit.saved.passed ? "今天这个拼音认住啦！"
    : commit.answer.result === "known" ? "先记住一次，稍后再独立认一次。" : commit.answer.result === "helped" ? "提示不算答错；稍后藏起来再认。" : "没关系，稍后我们再见一次。";

  useEffect(() => {
    return () => {
      speechToken.current += 1;
      audioRef.current?.pause();
      audioRef.current?.dispatchEvent(new Event("ended"));
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [learnerId]);

  function answer(result: "known" | "again" | "helped") {
    if (!current || busy || listening) return;
    if (study.submit({ itemId: current.item_id, result, assisted: revealed || heard })) {
      speechToken.current += 1;
      setRevealed(false);
      setHeard(false);
    }
  }

  async function listen() {
    if (!current || listening) return;
    setHeard(true);
    setRevealed(true);
    setListening(true);
    const token = ++speechToken.current;
    try {
      const response = await fetch(`/api/speech?text=${encodeURIComponent(current.example_hanzi)}&slow=1&learner=${encodeURIComponent(learnerId)}`);
      if (!response.ok) throw new Error("speech unavailable");
      const url = URL.createObjectURL(await response.blob());
      try {
        if (token !== speechToken.current) return;
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.playbackRate = 0.88;
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("audio unavailable"));
          void audio.play().catch(reject);
        });
      } finally { URL.revokeObjectURL(url); }
    } catch {
      if (token === speechToken.current && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(current.example_hanzi);
        utterance.lang = "zh-CN";
        utterance.rate = 0.7;
        window.speechSynthesis.speak(utterance);
      }
    } finally { if (token === speechToken.current) { audioRef.current = null; setListening(false); } }
  }

  const feedback = <div className="study-sync-feedback" role="status">
    {study.status === "saving" && <p className="hint">上一张正在后台保存，可以先认下一个拼音；保存后即可继续作答。</p>}
    {study.error && <><p className="error">{study.error}</p><button className="secondary" onClick={study.retry}>{study.status === "save-error" ? "重试保存上一张" : "重试加载"}</button>{study.status === "save-error" && <button className="text-button" onClick={study.discard}>以数据库记录重新加载</button>}</>}
  </div>;
  if (study.status === "loading" && !today) return <section className="pinyin-practice panel"><p className="muted">正在准备拼音小练习…</p></section>;
  if (!today) return <section className="pinyin-practice panel"><h2>正在同步拼音记录</h2>{feedback}</section>;
  if (!today || today.mode === "off") return null;
  return <section className="pinyin-practice panel" aria-label="今日拼音小练习">
    <p className="eyebrow">今天的小尾巴 · 拼音</p>
    <h2>认一认，再读一读</h2>
    <p className="muted">今天 {today.passed} / {today.total} 个拼音已认住。拼音成绩与汉字成绩分开记录。</p>
    {current ? <>
      <div className="pinyin-practice-card">
        <span className="card-kind">{pinyinCategoryLabel(current.category, current.unit_code)} · {current.kind === "new" ? "新拼音" : current.kind === "spot" ? "轻松抽查" : current.kind === "retry" ? "再确认一次" : "复习／续学"}</span>
        <strong>{current.unit_code}</strong>
        {current.required_confirmations === 2 && <small>独立认出 {current.clean_streak} / 2 次</small>}
        {revealed && <p className="pinyin-example">示例音：{current.example_hanzi} <span>{current.example_pinyin}</span><small>这是完整音节示例，由家长带孩子读字母发音。</small></p>}
        {revealed && current.mnemonic && <p className="pinyin-mnemonic"><small>记忆口诀</small>{current.mnemonic}</p>}
      </div>
      {!revealed ? <div className="pinyin-practice-actions">
        <button className="answer-known" disabled={busy || listening} onClick={() => answer("known")}>自己认出来了</button>
        <button className="answer-again" onClick={() => setRevealed(true)}>看口诀／再学一下</button>
      </div> : <>
        <div className="pinyin-practice-actions">
          <button className="secondary" disabled={listening} onClick={() => void listen()}>{listening ? "正在慢读…" : heard ? "🔊 再听示例音" : "🔊 听示例音"}</button>
          <button className="secondary" disabled={busy || listening} onClick={() => void answer("helped")}>提示后想起来了</button>
          <button className="answer-again" disabled={busy || listening} onClick={() => void answer("again")}>还没认出来</button>
        </div>
        <p className="hint">提示后想起不会降级；真的没有认出才记作“还没认出来”。</p>
      </>}
    </> : <p className="pinyin-finish">{study.status !== "ready" ? "正在确认刚才的记录，暂不算完成。" : today.total ? "拼音小练习完成！明天再见。🌿" : "今天没有这几类的待练卡片；新勾选的类别将在下一份每日计划里安排。"}</p>}
    {message && <p className="answer-notice" role="status">{message}</p>}
    {feedback}
  </section>;
}
