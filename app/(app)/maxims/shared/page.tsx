import Link from "next/link";
import { FeedbackForm } from "@/components/feedback-form";
import { adoptFamilyMaximShare, withdrawFamilyMaximShare } from "@/lib/family-maxims-actions";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import styles from "@/components/family-maxims.module.css";

export const dynamic="force-dynamic";
export default async function FamilyMaximSharedPage() {
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  const access=user?await loadAccessContext(supabase,user.id):null;
  if (!user || !access?.familyId) return <section className="panel"><h1>请先加入家庭</h1></section>;
  const [feedResult,mineResult,ownResult]=await Promise.all([
    supabase.from("family_maxim_shares").select("id,source_family_id,text_zh,text_en,source_title,source_detail,translation_version,explanation_zh,fingerprint,created_at").eq("workspace_id",access.workspaceId).eq("status","approved").order("created_at",{ascending:false}).limit(100),
    supabase.from("family_maxim_shares").select("id,status,source_maxim_id,text_zh,created_at").eq("workspace_id",access.workspaceId).eq("published_by",user.id).order("created_at",{ascending:false}).limit(40),
    supabase.from("family_maxims").select("fingerprint").eq("family_id",access.familyId).limit(2000),
  ]);
  if (feedResult.error) return <section className="panel"><h1>共享区暂时打不开</h1><p className="error">{feedResult.error.message}</p></section>;
  const fingerprints=new Set((ownResult.data??[]).map((row)=>row.fingerprint));
  return <div className={styles.wrap}><header className="hero"><p className="eyebrow">Thoughtfully shared</p><h1>大家分享的箴言</h1><p className="lede">只在当前学习空间可见。看看是否值得收进自己家；不收也不会增加孩子的学习任务。</p></header>
    <section className="panel"><div className={styles.sectionHead}><div><h2>共享书架</h2><p className={styles.muted}>{feedResult.data?.length??0} 条已审核分享 · 收入后是一份独立副本</p></div><Link className={styles.quietLink} href="/maxims">回家中册 →</Link></div><div className={styles.sharedGrid}>{(feedResult.data??[]).map((share)=><article className={styles.sharedCard} key={share.id}><p className={styles.sharedQuote}>{share.text_zh}</p><p lang="en">{share.text_en}</p><small>{[share.source_title,share.source_detail,share.translation_version].filter(Boolean).join(" · ")||"家庭分享"}</small>{share.explanation_zh && <details><summary>看看意思介绍</summary><p>{share.explanation_zh}</p></details>}{share.source_family_id===access.familyId?<span className={styles.status}>来自你家</span>:fingerprints.has(share.fingerprint)?<span className={styles.status}>已经在你家</span>:<FeedbackForm action={adoptFamilyMaximShare} confirm={{title:"收进家中册？",description:"会新增一份属于你家的副本，不会自动分配给孩子。",confirmLabel:"收进我家"}}><input type="hidden" name="share_id" value={share.id}/><button className="secondary">收进我家</button></FeedbackForm>}</article>)}</div>{!feedResult.data?.length && <p className="notice">共享书架还空着。家长可从自己的箴言详情中提交分享，管理员审核后会出现在这里。</p>}</section>
    <section className="panel"><h2>我提交的分享</h2><div className={styles.list}>{(mineResult.data??[]).map((share)=><div className={styles.childRow} key={share.id}><div><strong>{share.text_zh}</strong><small>{share.status==="pending"?"等待审核":share.status==="approved"?"已公开给当前学习空间":share.status==="rejected"?"未通过":"已撤回"}</small></div>{["pending","approved"].includes(share.status)&&<FeedbackForm action={withdrawFamilyMaximShare} confirm={{title:"撤回分享？",description:"已被其他家庭收下的副本不会删除。",confirmLabel:"确认撤回"}}><input type="hidden" name="share_id" value={share.id}/><button className="secondary">撤回</button></FeedbackForm>}</div>)}</div>{!mineResult.data?.length&&<p className={styles.muted}>你还没有提交分享。</p>}</section>
  </div>;
}
