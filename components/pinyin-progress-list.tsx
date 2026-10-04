"use client";

import { useState } from "react";

export type PinyinProgressRow = {
  code: string; category: "final" | "initial"; example: string;
  stage: number | null; attempts: number; known: number; again: number; helped: number; dueAt: string | null;
};

export function PinyinProgressList({ rows, now, timezone }: { rows: PinyinProgressRow[]; now: string; timezone: string }) {
  const [filter, setFilter] = useState("all");
  const visible = rows.filter((row) => {
    if (filter === "final") return row.category === "final";
    if (filter === "initial") return row.category === "initial";
    if (filter === "unseen") return row.stage === null;
    if (filter === "due") return row.stage !== null && Boolean(row.dueAt && row.dueAt <= now);
    if (filter === "mastered") return row.stage === 7;
    return true;
  });
  return <div className="pinyin-stat-wrap">
    <label className="pinyin-filter">查看哪些拼音<select value={filter} onChange={(event) => setFilter(event.target.value)}>
      <option value="all">全部</option><option value="final">单韵母</option><option value="initial">声母</option>
      <option value="unseen">还没学</option><option value="due">到期复习</option><option value="mastered">第 7 阶段</option>
    </select></label>
    <div className="pinyin-stat-list">
      {visible.map((row) => <div className="pinyin-stat-row" key={row.code}>
        <strong>{row.code}</strong><span>{row.category === "final" ? "韵母" : "声母"} · {row.example}</span>
        <span>{row.stage === null ? "还没学" : `第 ${row.stage} 阶段`}</span>
        <small>练 {row.attempts} 次 · 自己认出 {row.known} · 未认出 {row.again}{row.helped ? ` · 提示 ${row.helped}` : ""}</small>
        <small>{row.stage === null ? "等待首次学习" : row.dueAt && row.dueAt <= now ? "已到期" : row.dueAt ? `下次 ${new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(row.dueAt))}` : ""}</small>
      </div>)}
      {visible.length === 0 && <p className="muted">这一类暂时没有拼音。</p>}
    </div>
  </div>;
}
