"use client";

import { useMemo, useState } from "react";
import { FeedbackForm } from "@/components/feedback-form";
import { linkKidsEnglishVideo } from "@/lib/kids-english-actions";

export function KidsEnglishWordPicker({ bookId, words, videos }: { bookId: string; words: Array<{ id: string; word: string; meaning_zh: string }>; videos: Array<{ id: string; title: string }> }) {
  const [query,setQuery] = useState("");
  const [checked,setChecked] = useState<string[]>([]);
  const visible = useMemo(() => words.filter((word) => `${word.word} ${word.meaning_zh}`.toLowerCase().includes(query.toLowerCase())),[query,words]);
  if (!videos.length) return <p className="notice">先上传一段课堂视频，再勾选它对应的单词。</p>;
  return <FeedbackForm action={linkKidsEnglishVideo} className="kids-link-form" pendingLabel="正在关联，请稍候…" confirm={{ title: "确认关联视频和单词？", description: "已经关联过的单词会被自动跳过，不会生成重复记录。" }} successTitle="视频已关联">
    <input type="hidden" name="book_id" value={bookId} />
    <label>选择课堂视频<select name="video_id" required>{videos.map((video) => <option value={video.id} key={video.id}>{video.title}</option>)}</select></label>
    <label>查找单词<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如 circle / 圆形" /></label>
    <div className="kids-picker-tools"><span>已选 {checked.length} / {words.length} 个</span><button type="button" className="text-button" onClick={() => setChecked([...new Set([...checked,...visible.map((word) => word.id)])])}>勾选当前结果</button><button type="button" className="text-button" onClick={() => setChecked([])}>清空</button></div>
    <div className="kids-word-picker-list">{visible.map((word) => <label key={word.id}><input name="word_ids" type="checkbox" value={word.id} checked={checked.includes(word.id)} onChange={(event) => setChecked((old) => event.target.checked ? [...old,word.id] : old.filter((id) => id !== word.id))} /><strong lang="en">{word.word}</strong><span>{word.meaning_zh}</span></label>)}</div>
    {checked.filter((id) => !visible.some((word) => word.id === id)).map((id) => <input key={id} name="word_ids" type="hidden" value={id} />)}
    <button className="primary" disabled={!checked.length}>关联到选中的 {checked.length} 个单词</button>
  </FeedbackForm>;
}
