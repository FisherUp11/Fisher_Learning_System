import { createClient } from "@/lib/supabase/server";
import { LearningExperience } from "@/components/learning-experience";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";
import { LearnerOptions, orderLearners } from "@/components/learner-options";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function LearnPage({ searchParams }: { searchParams: Promise<{ learner?: string }> }) {
  const supabase = await createClient();
  const params = await searchParams;
  const { data: { user } } = await supabase.auth.getUser();
  const access = user ? await loadAccessContext(supabase, user.id) : null;
  const { data: rawLearners, error } = await supabase
    .from("learner_profiles")
    .select("id,display_name,daily_new_limit,active_package_id,family_id,families(name)")
    .order("created_at", { ascending: true });
  const learners = orderLearners(rawLearners, access?.familyId);

  if (error) return <section className="panel"><h1>还没有准备好</h1><p className="error">{error.message}</p></section>;
  const learner = learners?.find((item) => item.id === params.learner) ?? learners?.[0];
  if (!learner) {
    return <section className="empty panel"><span className="empty-mark">🌱</span><h1>先为孩子建一个小档案</h1><p className="lede">到“家长”页填写昵称，然后导入第一份汉字 CSV。</p><a className="primary" href="/parent">去家长页</a></section>;
  }
  try { if (user) await requireChildModule(supabase,access,user.id,learner.id,"hanzi"); }
  catch (error) { return <section className="panel"><h1>这位孩子暂未开通汉字学习</h1><p>{error instanceof Error ? error.message : "请联系 owner 开通"}</p></section>; }
  if (!learner.active_package_id) {
    return <section className="empty panel"><span className="empty-mark">📚</span><h1>{learner.display_name} 的字册还是空的</h1><p className="lede">到“家长”页上传 CSV 后，就能开始今天的学习。</p><a className="primary" href="/parent">导入汉字</a></section>;
  }
  return <>
    {(learners?.length ?? 0) > 1 && <form action="/learn" className="learner-switch"><label>今天是谁学习？<select name="learner" defaultValue={learner.id}><LearnerOptions learners={learners} /></select></label><button className="secondary" type="submit">切换</button></form>}
    <Link className="frog-entry" href={`/learn/frog?learner=${learner.id}`}><span aria-hidden="true">🐸</span><span><strong>青蛙跳字岛</strong><small>听一个字，找一片字叶 · 趣味复习，不替代正式认字</small></span><span aria-hidden="true">去玩 →</span></Link>
    <LearningExperience key={learner.id} learner={learner} />
    <span hidden data-current-learner={learner.id} />
  </>;
}
