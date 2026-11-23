const idPattern = /^[A-Za-z0-9_-]{11}$/;
const youtubeHosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export function youtubeId(raw: string) {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("请输入完整的 YouTube 视频链接"); }
  if (url.protocol !== "https:" || !youtubeHosts.has(url.hostname) || url.username || url.password || url.port)
    throw new Error("只接受 HTTPS 的 YouTube 视频链接");
  const [, type, key] = url.pathname.split("/");
  const id = url.hostname === "youtu.be" ? type
    : url.pathname === "/watch" ? url.searchParams.get("v")
    : ["shorts", "live", "embed"].includes(type) ? key : null;
  if (!id || !idPattern.test(id)) throw new Error("未找到视频编号，请复制单个视频的分享链接");
  return id;
}

export function parseVideoTimestamp(value: string): number | null {
  const raw = value.trim();
  if (!raw) return null;
  const pieces = raw.split(":");
  const valid = pieces.length === 1 ? /^\d{1,5}$/.test(raw)
    : pieces.length <= 3 && /^\d{1,3}$/.test(pieces[0]) && pieces.slice(1).every(piece => /^\d{2}$/.test(piece) && Number(piece) < 60);
  const second = pieces.reduce((sum, v) => sum * 60 + Number(v), 0);
  if (!valid || second > 86399) throw new Error("时间点请填 mm:ss、h:mm:ss 或秒数，留空也可以");
  return second;
}

export function videoTime(seconds: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${seconds >= 3600 ? `${Math.floor(seconds / 3600)}:` : ""}${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

export function youtubeHref(id: string, second?: number | null) {
  if (!idPattern.test(id)) throw new Error("视频编号无效");
  return `https://www.youtube.com/watch?v=${id}${Number.isInteger(second) && second! >= 0 && second! <= 86399 ? `&t=${second}s` : ""}`;
}

export type VideoImportRow = { word: string; meaning: string; example: string; pronunciation: string; timestamp: number | null; track: boolean };
export type VideoSummary = { id: string; youtube_id: string; title: string; word_count: number; practice_count: number; last_on: string | null };
export type VideoOrigin = { id: string; youtube_id: string; title: string; start_second: number | null; example: string; pronunciation: string };
export type VideoWord = { concept_id: string; phrase: string; meaning: string; example: string; pronunciation: string; start_second: number | null;
  tracked: boolean; stage: number | null; attempts: number | null; due_date: string | null };
export type VideoCard = { concept_id: string; phrase: string; meaning: string; queue_kind: "new" | "review"; attempt_count: number;
  confirmations: number; had_failure: boolean; origins: VideoOrigin[] };
export type VideoSnapshot = {
  today: string; daily_new: number; tracked: number; focus: VideoSummary | null; selected: VideoSummary | null; videos: VideoSummary[];
  history: { id: string; local_date: string; created_at: string }[]; words: VideoWord[]; video_page: number; word_page: number;
  total_videos: number; total_words: number; current: VideoCard | null; total_today: number; remaining: number; due: number;
};
export type VideoAction =
  | { type: "start" }
  | { type: "focus" | "checkin"; videoId: string; requestId?: string }
  | { type: "track"; conceptId: string; enabled: boolean }
  | { type: "edit_timestamp"; videoId: string; conceptId: string; timestamp: string }
  | { type: "settings"; dailyNew: number }
  | { type: "answer"; conceptId: string; day: string; result: "known" | "again"; requestId: string }
  | { type: "import"; title: string; url: string; rows: VideoImportRow[] };
