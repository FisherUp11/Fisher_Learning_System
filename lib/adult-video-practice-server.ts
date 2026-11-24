import "server-only";
import { localDay } from "@/lib/adult-learning";
import type { VideoCard, VideoOrigin, VideoPracticeQueue } from "@/lib/adult-video";
import type { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;
type PendingRow = Omit<VideoCard, "phrase" | "meaning" | "origins"> & {
  concept: {
    phrase: string;
    meaning: string;
    links: (Pick<VideoOrigin, "pronunciation" | "example" | "start_second"> & {
      video: (Pick<VideoOrigin, "id" | "youtube_id" | "title"> & { created_at: string }) | null;
    })[];
  } | null;
};

export async function readVideoPracticeQueue(db: Db, ownerId: string, profileId: string, today = localDay()): Promise<VideoPracticeQueue> {
  const [pending, totals] = await Promise.all([
    db.from("adult_video_daily_items").select(
      "concept_id,queue_kind,attempt_count,confirmations,had_failure,concept:adult_english_concepts!adult_video_daily_items_concept_id_owner_id_fkey(phrase,meaning,links:adult_video_terms!adult_video_terms_concept_id_owner_id_fkey(pronunciation,example,start_second,video:adult_video_sources!adult_video_terms_video_id_owner_id_fkey(id,youtube_id,title,created_at)))",
      { count: "exact" },
    ).eq("owner_id", ownerId).eq("profile_id", profileId).eq("local_date", today).is("completed_at", null)
      // Match adult_video_snapshot, including retries after not-yet-shown cards.
      .order("last_answered_at", { ascending: true, nullsFirst: true }).order("ordinal").order("concept_id").limit(2),
    db.from("adult_video_daily_items").select("concept_id", { count: "exact", head: true })
      .eq("owner_id", ownerId).eq("profile_id", profileId).eq("local_date", today),
  ]);
  if (pending.error || totals.error || pending.count === null || totals.count === null)
    throw new Error("暂时无法同步今日词卡，请重试加载。");
  const cards = (pending.data as unknown as PendingRow[]).map(({ concept, ...row }) => {
    if (!concept) throw new Error("暂时无法读取词卡内容，请重试加载。");
    const origins = concept.links.flatMap(({ video, ...link }) => video ? [{ ...video, ...link }] : []);
    origins.sort((a, b) => Number(b.start_second !== null) - Number(a.start_second !== null)
      || Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id));
    return { ...row, phrase: concept.phrase, meaning: concept.meaning,
      origins: origins.map(({ id, title, youtube_id, start_second, example, pronunciation }) => ({ id, title, youtube_id, start_second, example, pronunciation })) };
  });
  return { today, total: totals.count, remaining: pending.count, cards };
}
