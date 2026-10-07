"use client";

import { useEffect, useRef, useState } from "react";
import { answerPinyin, loadPinyinToday } from "@/lib/pinyin-actions";
import { pinyinCategoryLabel } from "@/lib/pinyin-catalog";

type Today = Awaited<ReturnType<typeof loadPinyinToday>>;

export function PinyinPractice({ learnerId }: { learnerId: string }) {
  const [today, setToday] = useState<Today | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [heard, setHeard] = useState(false);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const current = today?.items[0];
  const request = useRef(0);
  const saving = useRef(false);

  useEffect(() => {
    const id = ++request.current;
    void loadPinyinToday(learnerId).then((result) => {
      if (request.current === id) setToday(result);
    }).catch((cause) => {
      if (request.current === id) setError(cause instanceof Error ? cause.message : "拼音任务暂时无法加载");
    }).finally(() => { if (request.current === id) setLoading(false); });
    return () => { request.current += 1; };
  }, [learnerId]);

  async function answer(result: "known" | "again" | "helped") {
    if (!current || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    let recorded = false;
    try {
      const saved = await answerPinyin({ learnerId, itemId: current.item_id, result, requestId: crypto.randomUUID() });
      recorded = true;
      setMessage(saved.passed ? "今天这个拼音认住啦！" : result === "known" ? "先记住一次，稍后再独立认一次。" : result === "helped" ? "提示不算答错；稍后藏起来再认。" : "没关系，稍后我们再见一次。");
      setRevealed(false);
      setHeard(false);
      const refreshed = await loadPinyinToday(learnerId);
      setToday(refreshed);
    } catch (cause) {
      setError(recorded ? "已经记录成功，但后面的拼音没有刷新出来，请点重新加载。" : cause instanceof Error ? cause.message : "这次没有保存，请重试");
    } finally { saving.current = false; setBusy(false); }
  }

  async function reload() {
    setLoading(true);
    setError("");
    try { setToday(await loadPinyinToday(learnerId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "拼音任务暂时无法加载"); }
    finally { setLoading(false); }
  }

  async function listen() {
    if (!current || listening) return;
    setHeard(true);
    setRevealed(true);
    setListening(true);
    try {
      const response = await fetch(`/api/speech?text=${encodeURIComponent(current.example_hanzi)}&slow=1&learner=${encodeURIComponent(learnerId)}`);
      if (!response.ok) throw new Error("speech unavailable");
      const url = URL.createObjectURL(await response.blob());
      try {
        const audio = new Audio(url);
        audio.playbackRate = 0.88;
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("audio unavailable"));
          void audio.play().catch(reject);
        });
      } finally { URL.revokeObjectURL(url); }
    } catch {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(current.example_hanzi);
        utterance.lang = "zh-CN";
        utterance.rate = 0.7;
        window.speechSynthesis.speak(utterance);
      }
    } finally { setListening(false); }
  }

  if (loading) return <section className="pinyin-practice panel"><p className="muted">正在准备拼音小练习…</p></section>;
  if (error && !today) return <section className="pinyin-practice panel"><h2>拼音稍后再学</h2><p className="error">{error}</p><button className="secondary" onClick={() => void reload()}>重新加载</button></section>;
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
        <button className="answer-known" disabled={busy} onClick={() => void answer("known")}>自己认出来了</button>
        <button className="answer-again" disabled={busy} onClick={() => setRevealed(true)}>看口诀／再学一下</button>
      </div> : <>
        <div className="pinyin-practice-actions">
          <button className="secondary" disabled={busy || listening} onClick={() => void listen()}>{listening ? "正在慢读…" : heard ? "🔊 再听示例音" : "🔊 听示例音"}</button>
          <button className="secondary" disabled={busy || listening} onClick={() => void answer("helped")}>提示后想起来了</button>
          <button className="answer-again" disabled={busy || listening} onClick={() => void answer("again")}>还没认出来</button>
        </div>
        <p className="hint">提示后想起不会降级；真的没有认出才记作“还没认出来”。</p>
      </>}
      {busy && <p className="hint">正在记录…</p>}
    </> : <p className="pinyin-finish">{today.total ? "拼音小练习完成！明天再见。🌿" : "今天没有这几类的待练卡片；新勾选的类别将在下一份每日计划里安排。"}</p>}
    {message && <p className="answer-notice" role="status">{message}</p>}
    {error && <p className="error" role="alert">{error} <button className="text-button" onClick={() => void reload()}>重新加载</button></p>}
  </section>;
}
