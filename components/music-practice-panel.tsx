"use client";

/* eslint-disable @next/next/no-img-element -- R2 签名 URL 为短时动态 host/query，不适合经 Next Image 代理与缓存。 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordMusicPractice, type MusicItemType, type MusicPracticeResult } from "@/lib/music-actions";

type AssetView = { id: string; assetType: string; label: string | null; originalName: string; url: string | null };

const results: Record<MusicItemType, Array<{ value: MusicPracticeResult; label: string; tone: string }>> = {
  song: [
    { value: "song_listened", label: "只听过", tone: "quiet" },
    { value: "song_sang_along", label: "跟着唱", tone: "warm" },
    { value: "song_prompted", label: "提示下会唱", tone: "growing" },
    { value: "song_independent", label: "独立会唱", tone: "strong" },
  ],
  instrument: [{ value: "instrument_again", label: "还没认出来", tone: "quiet" }, { value: "instrument_known", label: "认出来了", tone: "strong" }],
  rhythm: [{ value: "rhythm_again", label: "需要再练", tone: "quiet" }, { value: "rhythm_known", label: "能打出来", tone: "strong" }],
};

export function MusicPracticePanel({ learnerId, itemId, itemType, title, lyrics, correctAnswer, instructions, assets }: {
  learnerId: string;
  itemId: string;
  itemType: MusicItemType;
  title: string;
  lyrics: string | null;
  correctAnswer: string | null;
  instructions: string | null;
  assets: AssetView[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [answerVisible, setAnswerVisible] = useState(false);
  const [guessNote, setGuessNote] = useState("");
  const [message, setMessage] = useState("");
  const audio = assets.find((asset) => ["audio", "demo_audio"].includes(asset.assetType) && asset.url);
  const cover = assets.find((asset) => ["cover", "instrument_image"].includes(asset.assetType) && asset.url);
  const sheets = assets.filter((asset) => ["score", "rhythm_sheet"].includes(asset.assetType) && asset.url);

  function practice(result: MusicPracticeResult) {
    setMessage("");
    startTransition(async () => {
      try {
        await recordMusicPractice({ learnerId, itemId, result, guessNote: itemType === "instrument" ? guessNote : "", requestId: crypto.randomUUID() });
        setMessage("这一次已经记下，系统会按新的时间安排下次练习。");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "记录失败，请稍后再试");
      }
    });
  }

  return <>
    <section className={`music-learning-card ${itemType}`}>
      <div className="music-card-heading"><span className={`music-type-mark ${itemType}`}>{itemType === "song" ? "唱" : itemType === "instrument" ? "听" : "拍"}</span><div><p>{itemType === "song" ? "唱一唱" : itemType === "instrument" ? "先听，再猜" : "跟着节拍练一练"}</p><h1>{title}</h1></div></div>
      {cover?.url && (itemType !== "instrument" || answerVisible) && <img className="music-main-image" src={cover.url} alt={cover.label ?? title} />}
      {!cover?.url && <div className="music-cover-placeholder" aria-hidden="true"><span>♪</span><small>{title.slice(0, 4)}</small></div>}
      {audio?.url ? <div className="music-player"><span>{itemType === "song" ? "歌曲音频·循环播放" : itemType === "instrument" ? "辨音片段·循环播放" : "节奏示范·循环播放"}</span><audio controls loop preload="metadata" src={audio.url}>你的浏览器不支持音频播放。</audio></div> : <p className="notice">家长还没有上传音频；可以先阅读内容，但暂时不能播放。</p>}
      {instructions && <p className="music-instructions">{instructions}</p>}
      {itemType === "instrument" && <div className="instrument-answer"><label htmlFor="instrument-guess">孩子猜的是什么？（可不填）<input id="instrument-guess" maxLength={300} placeholder="例如：钢琴" value={guessNote} onChange={(event) => setGuessNote(event.target.value)} /></label>{answerVisible ? <div className="answer-reveal"><span>正确答案</span><strong>{correctAnswer}</strong></div> : <button className="secondary" type="button" onClick={() => setAnswerVisible(true)}>揭晓乐器答案</button>}</div>}
    </section>
    {itemType === "song" && lyrics && <section className="panel music-lyrics"><p className="eyebrow">歌词</p>{lyrics.split(/\r?\n/).map((line, index) => line.trim() ? <p key={`${line}-${index}`}>{line}</p> : <br key={`blank-${index}`} />)}</section>}
    {sheets.length > 0 && <section className="panel"><h2>{itemType === "song" ? "琴谱" : "练习谱"}</h2><p className="library-meta">点击图片可打开原图查看。</p><div className="music-sheet-gallery">{sheets.map((sheet, index) => <a href={sheet.url!} target="_blank" rel="noreferrer" key={sheet.id}><img src={sheet.url!} alt={sheet.label ?? `${title} 第 ${index + 1} 张谱`} /><span>{sheet.label ?? `${itemType === "song" ? "琴谱" : "节奏谱"} ${index + 1}`}</span></a>)}</div></section>}
    <section className="music-checkin"><div><p className="eyebrow">本次练习结果</p><h2>{itemType === "song" ? "今天唱到哪一步？" : itemType === "instrument" ? "这次认出来了吗？" : "这次能打出来吗？"}</h2>{itemType === "song" && <p>“只听过”只记录接触次数，不会被当成已经会唱。</p>}</div><div className={`music-result-grid ${itemType}`}>{results[itemType].map((result) => <button type="button" className={`music-result ${result.tone}`} disabled={isPending || (itemType === "instrument" && !answerVisible)} onClick={() => practice(result.value)} key={result.value}>{isPending ? "记录中…" : result.label}</button>)}</div>{itemType === "instrument" && !answerVisible && <p className="field-note">揭晓答案后才能记录结果。</p>}{message && <p className={message.startsWith("这一次") ? "success" : "error"}>{message}</p>}</section>
  </>;
}
