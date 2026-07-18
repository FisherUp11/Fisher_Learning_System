import type { MusicItemType, MusicPracticeResult } from "@/lib/music-actions";

export const musicTypeMeta: Record<MusicItemType, { label: string; action: string; mark: string; description: string }> = {
  song: { label: "唱一唱", action: "听歌与跟唱", mark: "唱", description: "听旋律、看歌词，再慢慢唱熟" },
  instrument: { label: "辨声音", action: "乐器辨音", mark: "听", description: "先听声音，再猜是哪一种乐器" },
  rhythm: { label: "打节奏", action: "节奏练习", mark: "拍", description: "看提示、听示范，用手打出节拍" },
};

export const musicStageNames = ["刚接触", "开始熟悉", "初步记住", "正在巩固", "比较熟悉", "稳定掌握", "长期记忆", "熟练掌握"];

export const practiceResultLabels: Record<MusicPracticeResult, string> = {
  song_listened: "只听过",
  song_sang_along: "跟着唱",
  song_prompted: "提示下会唱",
  song_independent: "独立会唱",
  instrument_known: "认出来了",
  instrument_again: "还没认出来",
  rhythm_known: "能打出来",
  rhythm_again: "需要再练",
};

export function formatMusicDate(value: string | null) {
  if (!value) return "尚未安排";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(value));
}

export function currentMusicTimestamp() {
  return Date.now();
}

export function musicRecommendation(item: { attemptCount: number; stage: number; dueAt: string | null; lastResult: string | null }, now = currentMusicTimestamp()) {
  if (item.attemptCount === 0) return "还没练过";
  if (item.dueAt && new Date(item.dueAt).getTime() <= now) return "今天适合再练";
  if (["instrument_again", "rhythm_again"].includes(item.lastResult ?? "")) return "上次还不熟";
  if (item.stage <= 2) return "正在建立记忆";
  return "按计划复习";
}
