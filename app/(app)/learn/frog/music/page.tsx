import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";
import { orderLearners } from "@/components/learner-options";
import { HanziFrogMusicManager } from "@/components/hanzi-frog-music-manager";
import type { FrogMusicTrack } from "@/lib/hanzi-frog-music-actions";
import { isR2Configured } from "@/lib/r2";

export const dynamic = "force-dynamic";

export default async function FrogMusicPage({ searchParams }: { searchParams: Promise<{ learner?: string }> }) {
  const { learner: learnerId } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const access = user ? await loadAccessContext(supabase, user.id) : null;
  const { data: rawLearners } = await supabase.from("learner_profiles")
    .select("id,display_name,family_id,families(name)").order("created_at");
  const learner = orderLearners(rawLearners, access?.familyId).find((item) => item.id === learnerId);
  if (!learner || !user) return <section className="panel"><h1>先选一位孩子</h1><Link href="/learn">回到学字</Link></section>;
  try { await requireChildModule(supabase, access, user.id, learner.id, "hanzi"); }
  catch (error) { return <section className="panel"><h1>暂时不能维护配乐</h1><p>{error instanceof Error ? error.message : "请联系管理员"}</p></section>; }
  const { data, error } = await supabase.from("hanzi_frog_music_tracks")
    .select("id,title,source_type,audio_url,original_name").eq("learner_id", learner.id).order("created_at", { ascending: true });
  if (error) return <section className="panel"><h1>配乐维护还差一步</h1><p className="error">{error.message}</p><p>请先运行 supabase/031_hanzi_frog_music.sql 和 032_hanzi_frog_r2_music.sql。</p></section>;
  return <HanziFrogMusicManager learnerId={learner.id} learnerName={learner.display_name} initialTracks={(data ?? []) as FrogMusicTrack[]} r2Configured={isR2Configured()} />;
}
