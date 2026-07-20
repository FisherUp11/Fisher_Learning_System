import Link from "next/link";
import { CatechismStudyExperience } from "@/components/catechism-study-experience";
import { buildCatechismQueue, loadCatechismProgress, localDateInTimezone } from "@/lib/catechism";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ learner?: string; item?: string }>;

export default async function CatechismStudyPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: learners, error: learnerError } = await supabase.from("learner_profiles").select("id,display_name,timezone,catechism_daily_new_limit,catechism_review_limit").order("created_at");
  if (learnerError) return <section className="panel"><h1>请先运行信仰问答 SQL</h1><p className="notice"><code>supabase/010_catechism_learning_mvp.sql</code></p><p className="error">{learnerError.message}</p></section>;
  const learner = learners?.find((row) => row.id === params.learner) ?? learners?.[0];
  if (!learner) return <section className="empty panel"><h1>还没有孩子档案</h1><Link className="primary" href="/parent">去创建</Link></section>;
  const today = localDateInTimezone(learner.timezone);
  let queue: ReturnType<typeof buildCatechismQueue>["queue"];
  try {
    const { items } = await loadCatechismProgress(supabase, learner.id);
    const selectedItem = items.find((item) => item.id === params.item);
    queue = selectedItem
      ? [{ ...selectedItem, queueKind: selectedItem.totalAttempts ? "review" as const : "new" as const }]
      : buildCatechismQueue(items, today, learner.catechism_daily_new_limit, learner.catechism_review_limit).queue;
  } catch (error) {
    return <section className="panel"><h1>暂时无法生成今日问答</h1><p className="error">{error instanceof Error ? error.message : "读取失败"}</p><Link className="secondary" href="/catechism/manage">去检查问答册</Link></section>;
  }
  return <CatechismStudyExperience learnerId={learner.id} learnerName={learner.display_name} initialQueue={queue} today={today} />;
}
