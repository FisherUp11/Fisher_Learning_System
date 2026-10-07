"use client";

import { useState } from "react";
import { PINYIN_CATEGORIES, PINYIN_CATEGORY_LABELS, pinyinCategoryLabel, type PinyinCategory } from "@/lib/pinyin-catalog";

export type PinyinProgressRow = {
  code: string; category: PinyinCategory; example: string; introduced: boolean; enabled: boolean;
  stage: number | null; attempts: number; known: number; again: number; helped: number; dueAt: string | null;
};

export function PinyinProgressList({ rows, now, timezone }: { rows: PinyinProgressRow[]; now: string; timezone: string }) {
  const [filter, setFilter] = useState("all");
  const visible = rows.filter((row) => {
    if (PINYIN_CATEGORIES.includes(filter as PinyinCategory)) return row.category === filter;
    if (filter === "unseen") return !row.introduced;
    if (filter === "waiting") return row.introduced && row.stage === null;
    if (filter === "paused") return !row.enabled;
    if (filter === "due") return row.enabled && (Boolean(row.dueAt && row.dueAt <= now) || (row.introduced && row.stage === null));
    if (filter === "mastered") return row.stage === 7;
    return true;
  });
  return <div className="pinyin-stat-wrap">
    <label className="pinyin-filter">查看哪些拼音<select value={filter} onChange={(event) => setFilter(event.target.value)}>
      <option value="all">全部</option>{PINYIN_CATEGORIES.map((category) => <option key={category} value={category}>{PINYIN_CATEGORY_LABELS[category]}</option>)}
      <option value="unseen">尚未加入</option><option value="waiting">已加入、待首次练习</option><option value="due">到期复习／续学</option><option value="paused">未勾选（已暂停）</option><option value="mastered">第 7 阶段</option>
    </select></label>
    <div className="pinyin-stat-list">
      {visible.map((row) => <div className="pinyin-stat-row" key={row.code}>
        <strong>{row.code}</strong><span>{pinyinCategoryLabel(row.category, row.code)} · {row.example}</span>
        <span>{row.stage === null ? row.introduced ? "已加入·待练" : "尚未加入" : `第 ${row.stage} 阶段`}</span>
        <small>练 {row.attempts} 次 · 自己认出 {row.known} · 未认出 {row.again}{row.helped ? ` · 提示 ${row.helped}` : ""}</small>
        <small>{!row.enabled ? "未勾选·已暂停" : row.stage === null ? "等待首次练习" : row.dueAt && row.dueAt <= now ? "已到期" : row.dueAt ? `下次 ${new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(row.dueAt))}` : ""}</small>
      </div>)}
      {visible.length === 0 && <p className="muted">这一类暂时没有拼音。</p>}
    </div>
  </div>;
}
