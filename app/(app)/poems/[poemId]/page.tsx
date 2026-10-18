import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PoemRecitationForm } from "@/components/poem-recitation-form";
import { PoemDetailHistory, PoemDetailSummary, PoemHistoryLoading, PoemSummaryLoading, PoemVideoLink, PoemVideoManagement } from "@/components/poem-detail-sections";
import { loadPoemDetail } from "@/lib/poem-detail";
import { createPageClient, getPageUser } from "@/lib/supabase/page-client";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ poemId: string }>; searchParams: Promise<{ learner?: string }> };
const isId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export default async function PoemDetailPage({ params, searchParams }: PageProps) {
  const [{ poemId }, query] = await Promise.all([params, searchParams]);
  if (!isId(poemId) || (query.learner && !isId(query.learner))) return <section className="panel"><h1>诗词链接不完整</h1><Link className="secondary" href="/poems">返回诗词册</Link></section>;
  const supabase = await createPageClient();
  const user = await getPageUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(supabase,user.id);
  // 列表链接总是带 learner：不再读取所有家庭/所有孩子再在应用内查找。
  let learnerQuery = supabase.from("learner_profiles").select("id,display_name").eq("family_id",access?.familyId ?? "00000000-0000-0000-0000-000000000000");
  if (query.learner) learnerQuery = learnerQuery.eq("id", query.learner);
  const {data:learner,error:learnerError} = await learnerQuery.order("created_at").limit(1).maybeSingle();
  if (learnerError) throw new Error("孩子档案暂时读取失败");
  if (!learner) return <section className="empty panel"><h1>{query.learner ? "无法查看这个孩子档案" : "先创建孩子档案"}</h1><Link className="secondary" href={query.learner ? "/poems" : "/parent"}>{query.learner ? "返回诗词册" : "去家长页"}</Link></section>;
  try { await requireChildModule(supabase, access, user.id, learner.id, "poem"); }
  catch (error) { return <section className="panel"><h1>这位孩子暂未开通诗词背诵</h1><p>{error instanceof Error ? error.message : "请联系 owner 开通"}</p></section>; }
  const poem = await loadPoemDetail(supabase, learner.id, poemId);
  if (!poem) return <section className="empty panel"><span className="empty-mark">卷</span><h1>没有找到这首诗</h1><p className="lede">它可能不属于 {learner.display_name} 的诗词册，或已经被移除。</p><Link className="secondary" href={`/poems?learner=${learner.id}`}>返回诗词册</Link></section>;
  const lines = poem.content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  return <div className="poem-detail-page">
    <Link className="back-link" href={`/poems?learner=${learner.id}`}>← 返回 {learner.display_name} 的诗词册</Link>
    <section className="poem-paper">
      <p className="eyebrow">{poem.sourceTitles.join(" · ")}</p>
      <h1>{poem.title}</h1>
      <p className="poem-detail-byline">{poem.author}{poem.dynasty ? ` · ${poem.dynasty}` : ""}</p>
      <div className="poem-lines" aria-label={`${poem.title} 正文`}>{lines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</div>
      <div className="poem-learning-actions"><Link className="primary poem-game-entry" href={`/poems/game?learner=${learner.id}&poem=${poem.id}`}>驾驶小坦克复习这首诗</Link></div>
      <Suspense key={`video:${poem.id}`} fallback={<p className="poem-video-note" role="status">正在查看音乐视频入口…</p>}><PoemVideoLink db={supabase} poemId={poem.id} title={poem.title} /></Suspense>
    </section>

    <Suspense key={`summary:${learner.id}:${poem.id}`} fallback={<PoemSummaryLoading />}><PoemDetailSummary db={supabase} learnerId={learner.id} poemId={poem.id} /></Suspense>
    <PoemRecitationForm key={`${learner.id}:${poem.id}`} learnerId={learner.id} poemId={poem.id} />
    <Suspense key={`history:${learner.id}:${poem.id}`} fallback={<PoemHistoryLoading />}><PoemDetailHistory db={supabase} learnerId={learner.id} poemId={poem.id} /></Suspense>
    {access?.isAdmin && <Suspense key={`manage:${poem.id}`} fallback={null}><PoemVideoManagement db={supabase} poemId={poem.id} /></Suspense>}
  </div>;
}
