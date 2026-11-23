import "server-only";
import { adultContext, uuid } from "@/lib/adult-server";
import { loadAccessContext } from "@/lib/access";
import { requireAccountModule } from "@/lib/module-access";
import type { VideoSnapshot } from "@/lib/adult-video";

export async function videoContext() {
  const ctx = await adultContext();
  await requireAccountModule(ctx.db, await loadAccessContext(ctx.db, ctx.user.id), ctx.user.id, "adult_english");
  return ctx;
}

export function videoDatabaseError(e: { code?: string; message: string }) {
  if (["42P01", "42883", "PGRST202", "PGRST205"].includes(e.code ?? "")) return "视频跟读尚未升级：请先在 Supabase 运行 041 SQL。原有英语模块不受影响。";
  if (e.code === "P0001" || e.code === "42501") return e.message;
  if (["23514", "22023", "22P02", "23502"].includes(e.code ?? "")) return "提交的数据格式不正确，请检查内容后重试。";
  return "暂时无法确认结果，请重试；同一次打卡或作答不会重复记录。";
}

export async function loadVideoPage(query: { profile?: string; video?: string; page?: string; words?: string }) {
  const { db, user } = await videoContext();
  const profiles = await db.from("adult_profiles").select("id,name").eq("owner_id", user.id).eq("archived", false).order("created_at").limit(20);
  if (profiles.error) throw new Error(videoDatabaseError(profiles.error));
  const people = profiles.data ?? [];
  const profile = people.find(row => row.id === query.profile) ?? people[0] ?? null;
  if (!profile) return { people, profile, data: null, error: "" };
  let video = null;
  if (query.video) { try { video = uuid(query.video); } catch { /* invalid bookmarks fall back to the weekly video */ } }
  const page = (raw: unknown) => typeof raw === "string" && /^\d{1,4}$/.test(raw) ? Math.max(1, Number(raw)) : 1;
  const result = await db.rpc("adult_video_snapshot", {
    p_profile: profile.id, p_video: video, p_video_page: page(query.page), p_word_page: page(query.words),
  });
  return { people, profile, data: result.data as VideoSnapshot | null, error: result.error ? videoDatabaseError(result.error) : "" };
}
