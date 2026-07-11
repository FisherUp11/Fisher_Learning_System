import { createClient } from "@/lib/supabase/server";
import { LearningExperience } from "@/components/learning-experience";

export const dynamic = "force-dynamic";

export default async function LearnPage({ searchParams }: { searchParams: Promise<{ learner?: string }> }) {
  const supabase = await createClient();
  const params = await searchParams;
  const { data: learners, error } = await supabase
    .from("learner_profiles")
    .select("id,display_name,daily_new_limit,active_package_id")
    .order("created_at", { ascending: true });

  if (error) return <section className="panel"><h1>还没有准备好</h1><p className="error">{error.message}</p></section>;
  const learner = learners?.find((item) => item.id === params.learner) ?? learners?.[0];
  if (!learner) {
    return <section className="empty panel"><span className="empty-mark">🌱</span><h1>先为孩子建一个小档案</h1><p className="lede">到“家长”页填写昵称，然后导入第一份汉字 CSV。</p><a className="primary" href="/parent">去家长页</a></section>;
  }
  if (!learner.active_package_id) {
    return <section className="empty panel"><span className="empty-mark">📚</span><h1>{learner.display_name} 的字册还是空的</h1><p className="lede">到“家长”页上传 CSV 后，就能开始今天的学习。</p><a className="primary" href="/parent">导入汉字</a></section>;
  }
  return <>
    {(learners?.length ?? 0) > 1 && <form action="/learn" className="learner-switch"><label>今天是谁学习？<select name="learner" defaultValue={learner.id}>{learners?.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label><button className="secondary" type="submit">切换</button></form>}
    <LearningExperience key={learner.id} learner={learner} />
  </>;
}
