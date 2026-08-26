"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DesktopPoemTankGame } from "@/components/desktop-poem-tank-game";
import { MobilePoemGame } from "@/components/mobile-poem-game";
import { RewardCelebration } from "@/components/reward-celebration";
import { ratePoemGameSession, recordPoemGameResult } from "@/lib/poem-game-actions";
import { proceduralPoemMap, type PoemGameHistoryRow, type PoemGamePoem, type PoemGameSummary, type PoemMapBlueprint } from "@/lib/poem-game";
import { rewardProgressMessage, type RewardOutcome } from "@/lib/reward-types";

function resultAccuracy(summary: PoemGameSummary) {
  const total = summary.correctCount + summary.wrongCount;
  return total ? Math.round(summary.correctCount / total * 100) : 0;
}

function gameDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function PoemGameExperience({ learnerId, learnerName, poem, distractorLines, history, saveReady }: { learnerId: string; learnerName: string; poem: PoemGamePoem; distractorLines: string[]; history: PoemGameHistoryRow[]; saveReady: boolean }) {
  const [isNarrow, setIsNarrow] = useState(false);
  const [preferredMode, setPreferredMode] = useState<"auto" | "desktop" | "mobile">("auto");
  const [blueprint, setBlueprint] = useState<PoemMapBlueprint>(() => proceduralPoemMap(poem));
  const [mapStatus, setMapStatus] = useState("正在理解诗意…");
  const [summary, setSummary] = useState<PoemGameSummary | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [score, setScore] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [rating, setRating] = useState(false);
  const [reward, setReward] = useState<RewardOutcome | null>(null);
  const [rated, setRated] = useState(false);
  const [runKey, setRunKey] = useState(0);
  const [gameActive, setGameActive] = useState(false);
  const mode = preferredMode === "auto" ? (isNarrow ? "mobile" : "desktop") : preferredMode;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 759px)");
    const update = () => setIsNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ai/poem-game-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ learnerId, poemId: poem.id }),
    }).then(async (response) => response.ok ? response.json() as Promise<{ blueprint?: PoemMapBlueprint | null }> : null)
      .then((payload) => {
        if (cancelled) return;
        if (payload?.blueprint) {
          setBlueprint(payload.blueprint);
          setMapStatus(payload.blueprint.source === "ai" ? "AI 诗意地图已准备" : "诗意地图已准备");
        } else {
          setMapStatus("稳定诗意地图已准备");
        }
      })
      .catch(() => { if (!cancelled) setMapStatus("稳定诗意地图已准备"); });
    return () => { cancelled = true; };
  }, [learnerId, poem]);

  const saveResult = useCallback(async (nextSummary: PoemGameSummary) => {
    setGameActive(false);
    setSummary(nextSummary);
    setSaveStatus("saving");
    setMessage("");
    if (!saveReady) {
      setSaveStatus("error");
      setMessage("本局可以试玩，但数据库还没运行 018 脚本，因此暂时不能保存记录。");
      return;
    }
    try {
      const result = await recordPoemGameResult({
        clientSessionId: crypto.randomUUID(),
        learnerId,
        poemId: poem.id,
        mode: nextSummary.mode,
        durationSeconds: nextSummary.durationSeconds,
        completedStage: nextSummary.completedStage,
        isCompleted: nextSummary.isCompleted,
        attempts: nextSummary.attempts,
      });
      setSessionId(result.sessionId);
      setSaveStatus("saved");
      setMessage("本局学习证据已保存。现在可以由家长判断实际背诵程度。");
    } catch (error) {
      setSaveStatus("error");
      setMessage(error instanceof Error ? error.message : "本局暂时没有保存成功");
    }
  }, [learnerId, poem.id, saveReady]);

  async function submitRating() {
    if (!sessionId || score === null) return;
    setRating(true);
    setMessage("");
    try {
      const result = await ratePoemGameSession({ sessionId, learnerId, poemId: poem.id, score, note });
      setReward(result.reward);
      setRated(true);
      setMessage(`家长评分已记入原有诗词背诵记录。${rewardProgressMessage(result.reward)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "评分没有保存成功");
    } finally {
      setRating(false);
    }
  }

  function playAgain() {
    setSummary(null);
    setSessionId(null);
    setSaveStatus("idle");
    setMessage("");
    setScore(null);
    setNote("");
    setReward(null);
    setRated(false);
    setGameActive(false);
    setRunKey((value) => value + 1);
  }

  const resultStats = useMemo(() => summary ? [
    { label: "命中率", value: `${resultAccuracy(summary)}%` },
    { label: "首次答对", value: `${summary.firstTryCorrectCount}` },
    { label: "Boss 诗印", value: `${summary.bossHits}` },
    { label: "本局时长", value: `${Math.max(1, Math.ceil(summary.durationSeconds / 60))} 分` },
  ] : [], [summary]);

  return <div className="poem-game-experience">
    <section className="poem-game-brief panel">
      <div><p className="eyebrow">Today&apos;s poem mission</p><h2>{learnerName} · 《{poem.title}》</h2><p>{blueprint.brief}</p></div>
      <div className="poem-game-mode-switch" aria-label="游戏模式"><button type="button" disabled={gameActive} className={mode === "desktop" ? "active" : ""} onClick={() => setPreferredMode("desktop")}>电脑完整玩法</button><button type="button" disabled={gameActive} className={mode === "mobile" ? "active" : ""} onClick={() => setPreferredMode("mobile")}>手机轻量背诗</button></div>
      <span className={`poem-map-status ${blueprint.source === "ai" ? "ai" : ""}`}>{mapStatus}</span>
    </section>

    {!summary && (mode === "desktop"
      ? <DesktopPoemTankGame key={`desktop-${poem.id}-${runKey}`} poem={poem} distractorLines={distractorLines} blueprint={blueprint} onStart={() => setGameActive(true)} onFinish={saveResult} />
      : <MobilePoemGame key={`mobile-${poem.id}-${runKey}`} poem={poem} distractorLines={distractorLines} onStart={() => setGameActive(true)} onFinish={saveResult} />)}

    {summary && <section className="poem-game-result panel">
      <span className="poem-result-medal">守</span>
      <p className="eyebrow">Mission complete</p>
      <h2>{summary.isCompleted ? "诗境主线完成" : "本次练习已结束"}</h2>
      {saveStatus !== "error" && <p>{saveStatus === "saving" ? "正在把本局学习证据安全保存…" : message}</p>}
      <div className="poem-result-grid">{resultStats.map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>
      {saveStatus === "error" && <p className="error">{message}</p>}
      {saveStatus === "saved" && !rated && <div className="poem-parent-rating">
        <div><h3>请家长听孩子背一次，再评分</h3><p>游戏答题只代表识别表现，不自动等同“会背”；最终掌握程度仍由家长判断。</p></div>
        <div className="poem-score-buttons">{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <button type="button" className={score === value ? "selected" : ""} key={value} onClick={() => setScore(value)}><strong>{value}</strong><small>{value >= 9 ? "很熟" : value >= 7 ? "基本会背" : value >= 5 ? "还需练" : "需要多背"}</small></button>)}</div>
        <label>家长备注（可选）<input value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} placeholder="例如：第二句停顿，经提示后背出" /></label>
        <div className="poem-rating-actions"><button type="button" className="primary" disabled={score === null || rating} onClick={() => void submitRating()}>{rating ? "保存评分中…" : score === null ? "先选择 1–10 分" : `保存 ${score} 分并计入背诵记录`}</button><button type="button" className="text-button" onClick={playAgain}>暂不评分，再玩一局</button></div>
      </div>}
      {rated && <div className="success-box"><strong>评分已保存</strong><p>{message}</p></div>}
      {reward?.awarded && <RewardCelebration learnerId={learnerId} reward={reward} />}
      <button type="button" className="secondary" onClick={playAgain}>再玩一局</button>
    </section>}

    <section className="panel poem-game-history"><div className="section-heading"><div><h2>最近游戏记录</h2><p className="library-meta">游戏记录与家长背诵评分分开保存；没有评分也会保留本局逐题证据。</p></div></div>{!saveReady ? <p className="notice">请先运行 <code>supabase/018_poem_tank_game.sql</code>，即可开始保存场次和逐句掌握状态。</p> : history.length === 0 ? <p className="notice">这首诗还没有游戏记录，完成第一局后会出现在这里。</p> : <div className="poem-game-history-list">{history.map((row) => <article key={row.id}><span>{row.mode === "desktop" ? "电脑完整" : "手机轻量"}</span><strong>{gameDate(row.played_at)}</strong><small>首次答对 {row.first_try_correct_count} · 对 {row.correct_count} / 错 {row.wrong_count}</small><em>{row.recitation_score ? `家长 ${row.recitation_score} 分` : "暂未评分"}</em></article>)}</div>}</section>
  </div>;
}
