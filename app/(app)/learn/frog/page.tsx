import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";
import { orderLearners } from "@/components/learner-options";
import { HanziFrogGame } from "@/components/hanzi-frog-game";
import type { FrogWord } from "@/lib/hanzi-frog";

export const dynamic = "force-dynamic";

export default async function FrogPage({ searchParams }: { searchParams: Promise<{ learner?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const access = user ? await loadAccessContext(supabase, user.id) : null;
  const { data: rawLearners } = await supabase.from("learner_profiles")
    .select("id,display_name,family_id,families(name)").order("created_at");
  const learners = orderLearners(rawLearners, access?.familyId);
  const learner = learners.find((item) => item.id === params.learner) ?? learners[0];
  if (!learner || !user) return <section className="panel"><h1>先选一位孩子</h1><Link href="/learn">回到学字</Link></section>;
  try {
    await requireChildModule(supabase, access, user.id, learner.id, "hanzi");
  } catch (error) {
    return <section className="panel"><h1>暂时不能玩汉字游戏</h1><p>{error instanceof Error ? error.message : "请联系管理员"}</p></section>;
  }

  const { data: pool, error } = await supabase.rpc("get_hanzi_frog_pool", { p_learner_id: learner.id });
  if (error) return <section className="panel"><h1>游戏还差一步</h1><p className="error">{error.message}</p><p>请家长先运行 supabase/030_hanzi_frog_game.sql，再刷新。</p><Link href={`/learn?learner=${learner.id}`}>回到字卡</Link></section>;

  const historyQuery = await supabase.from("hanzi_frog_sessions")
    .select("id,difficulty,question_count,first_touch_correct,wrong_count,played_at")
    .eq("learner_id", learner.id).order("played_at", { ascending: false }).limit(5);

  let musicAllowed = false;
  try { await requireChildModule(supabase, access, user.id, learner.id, "music"); musicAllowed = true; }
  catch { /* BGM is optional; the character game still works. */ }
  let songs: { id: string; title: string }[] = [];
  if (musicAllowed) {
    const { data: assigned } = await supabase.from("learner_music_items")
      .select("item_id").eq("learner_id", learner.id).eq("assignment_status", "active").limit(100);
    const ids = (assigned ?? []).map((row) => row.item_id);
    if (ids.length) {
      const { data: published } = await supabase.from("music_items")
        .select("id,title").in("id", ids).eq("item_type", "song")
        .eq("status", "published").eq("review_status", "approved").limit(100);
      const publishedIds = (published ?? []).map((item) => item.id);
      if (publishedIds.length) {
        const { data: assets } = await supabase.from("music_assets")
          .select("item_id").in("item_id", publishedIds).eq("asset_type", "audio").limit(100);
        const withAudio = new Set((assets ?? []).map((asset) => asset.item_id));
        songs = (published ?? []).filter((song) => withAudio.has(song.id));
      }
    }
  }
  const { data: frogTracks } = await supabase.from("hanzi_frog_music_tracks")
    .select("id,title,source_type,audio_url").eq("learner_id", learner.id)
    .order("created_at", { ascending: true }).limit(50);
  const history = (historyQuery.data ?? []).map((item) => ({
    ...item,
    playedDate: new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric" }).format(new Date(item.played_at)),
  }));
  let weakWords: { hanzi: string; wrongCount: number }[] = [];
  if (history.length) {
    const { data: misses } = await supabase.from("hanzi_frog_taps")
      .select("target_character_id").in("session_id", history.map((item) => item.id))
      .eq("correct", false).limit(300);
    const counts = new Map<string, number>();
    for (const miss of misses ?? []) counts.set(miss.target_character_id, (counts.get(miss.target_character_id) ?? 0) + 1);
    const ids = [...counts.keys()];
    if (ids.length) {
      const { data: names } = await supabase.from("characters").select("id,character").in("id", ids);
      weakWords = (names ?? []).map((item) => ({ hanzi: item.character, wrongCount: counts.get(item.id) ?? 0 }))
        .sort((left, right) => right.wrongCount - left.wrongCount || left.hanzi.localeCompare(right.hanzi, "zh-CN")).slice(0, 6);
    }
  }
  return <HanziFrogGame learnerId={learner.id} learnerName={learner.display_name}
    words={(pool ?? []) as FrogWord[]}
    songs={[...((frogTracks ?? []).map((track) => ({
      id: track.id, title: track.title + (track.source_type === "r2" ? " · 已上传" : " · 在线"),
      audioUrl: track.source_type === "r2"
        ? "/api/hanzi-frog/music/audio?learner=" + encodeURIComponent(learner.id) + "&track=" + encodeURIComponent(track.id)
        : track.audio_url ?? "",
    })).filter((track) => track.audioUrl)),
      ...songs.map((song) => ({ ...song, title: song.title + " · 唱一唱", audioUrl: `/api/music/playlist-audio?learner=${encodeURIComponent(learner.id)}&item=${encodeURIComponent(song.id)}` }))]}
    history={history} weakWords={weakWords} />;
}
