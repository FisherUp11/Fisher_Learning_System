import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";
import { LearnerOptions, orderLearners } from "@/components/learner-options";
import { KidsEnglishStudy, type KidsQueueWord } from "@/components/kids-english-study";

export const dynamic = "force-dynamic";

export default async function KidsEnglishPage({ searchParams }: { searchParams: Promise<{ learner?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const access = user ? await loadAccessContext(supabase,user.id) : null;
  if (!user || !access) return null;
  const { data: rawLearners } = await supabase.from("learner_profiles").select("id,display_name,family_id,families(name)").order("created_at");
  const { data: grants } = await supabase.from("learner_module_access").select("learner_id").eq("module_key","kids_english").eq("enabled",true);
  const allowed = new Set((grants ?? []).map((row) => row.learner_id));
  const learners = orderLearners((rawLearners ?? []).filter((row) => allowed.has(row.id)),access.familyId);
  const learner = learners.find((row) => row.id === params.learner) ?? learners[0];
  if (!learner) return <section className="empty panel"><h1>还没有开通儿童英语的孩子</h1><p>请让 owner 在“用户与家庭”开通账号与孩子模块，再分配单词册。</p></section>;
  const loaded = await (async () => {
    await requireChildModule(supabase,access,user.id,learner.id,"kids_english");
    const { data, error } = await supabase.rpc("get_kids_english_queue",{ p_learner_id: learner.id });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Omit<KidsQueueWord,"videos">[];
    const wordIds = rows.map((row) => row.word_id);
    const { data: links } = wordIds.length ? await supabase.from("kids_english_word_videos").select("word_id,video_id,kids_english_videos(id,title)").in("word_id",wordIds) : { data: [] };
    const queue: KidsQueueWord[] = rows.map((row) => ({ ...row, videos: (links ?? []).filter((link) => link.word_id === row.word_id).map((link) => {
      const video = Array.isArray(link.kids_english_videos) ? link.kids_english_videos[0] : link.kids_english_videos;
      return video ? { id: video.id, title: video.title } : null;
    }).filter((video): video is { id: string; title: string } => Boolean(video)) }));
    return queue;
  })().then((queue) => ({ queue, error: "" }), (error: unknown) => ({ queue: [] as KidsQueueWord[], error: error instanceof Error ? error.message : "读取失败" }));
  if (loaded.error) return <section className="panel"><h1>单词学习暂时打不开</h1><p className="error">{loaded.error}</p><p>请确认已运行 <code>supabase/024_module_access_and_kids_english.sql</code>，并已开通模块、分配已发布的单词册。</p></section>;
  const queue = loaded.queue;
  return <div><header className="hero kids-hero"><p className="eyebrow">Little words, big world</p><h1>听一听，认一认。</h1><p className="lede">今天一点点，明天再遇见。会认的单词先独立说出来，需要时再看课堂视频。</p></header>
      {learners.length > 1 && <form action="/kids-english" className="learner-switch"><label>今天是谁学英语？<select name="learner" defaultValue={learner.id}><LearnerOptions learners={learners} /></select></label><button className="secondary">切换</button></form>}
      {queue.length ? <KidsEnglishStudy key={learner.id} learnerId={learner.id} learnerName={learner.display_name} initialQueue={queue} /> : <section className="panel kids-finish"><span aria-hidden="true">✦</span><h2>{learner.display_name}，今天没有待学单词</h2><p>可能已经完成今日任务，也可能尚未分配已审核的单词册。</p><Link href={`/kids-english/library?learner=${learner.id}`} className="secondary">查看单词册</Link>{access.isAdmin && <Link href="/admin/assignments?module=kids_english" className="text-button">去分配字册</Link>}</section>}
    </div>;
}
