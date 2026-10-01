import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { localDay, type Maxim, type MaximState } from "@/lib/family-maxims";
import styles from "@/components/family-maxims.module.css";

export const dynamic="force-dynamic";
const PAGE_SIZE=20;

export default async function FamilyMaximsPage({searchParams}:{searchParams:Promise<{learner?:string;q?:string;filter?:string;page?:string}>}) {
  const params=await searchParams;
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  const access=user?await loadAccessContext(supabase,user.id):null;
  if (!user || !access?.familyId) return <section className="panel"><h1>请先加入一个家庭</h1></section>;
  const [maximsResult,learnersResult,grantsResult]=await Promise.all([
    supabase.from("family_maxims").select("id,text_zh,text_en,source_title,source_detail,translation_version,explanation_zh,child_explanation_zh,tags,archived_at,created_at").eq("family_id",access.familyId).order("created_at",{ascending:false}).limit(2000),
    supabase.from("learner_profiles").select("id,display_name,timezone").eq("family_id",access.familyId).order("created_at"),
    supabase.from("learner_module_access").select("learner_id").eq("module_key","family_maxims").eq("enabled",true),
  ]);
  if (maximsResult.error) return <section className="panel"><h1>请先启用家中箴言</h1><p className="error">{maximsResult.error.message}</p><p>请先在 Supabase 运行 <code>supabase/025_family_maxims.sql</code>。</p></section>;
  const allowed=new Set((grantsResult.data??[]).map((row)=>row.learner_id));
  const learners=(learnersResult.data??[]).filter((row)=>allowed.has(row.id));
  const learner=learners.find((row)=>row.id===params.learner)??learners[0];
  const [assignedResult,statesResult]=learner?await Promise.all([
    supabase.from("learner_family_maxims").select("maxim_id,active").eq("learner_id",learner.id),
    supabase.from("family_maxim_states").select("maxim_id,language,stage,due_on,total_attempts,independent_days,last_result").eq("learner_id",learner.id).eq("language","zh"),
  ]):[{data:[],error:null},{data:[],error:null}];
  const assigned=new Set((assignedResult.data??[]).filter((row)=>row.active).map((row)=>row.maxim_id));
  const states=new Map(((statesResult.data??[]) as MaximState[]).map((row)=>[row.maxim_id,row]));
  const query=(params.q??"").trim().toLocaleLowerCase().slice(0,80);
  const filter=["all","assigned","unassigned","due","learning","mastered","archived"].includes(params.filter??"")?params.filter!:"all";
  const today=learner?localDay(learner.timezone):"";
  const matched=((maximsResult.data??[]) as Maxim[]).filter((item)=>{
    const state=states.get(item.id);
    if (query && !`${item.text_zh} ${item.text_en} ${item.source_title} ${item.source_detail} ${item.tags}`.toLocaleLowerCase().includes(query)) return false;
    if (filter==="archived") return Boolean(item.archived_at);
    if (item.archived_at) return false;
    if (filter==="assigned") return assigned.has(item.id);
    if (filter==="unassigned") return !assigned.has(item.id);
    if (filter==="due") return Boolean(assigned.has(item.id) && state?.due_on && state.due_on<=today);
    if (filter==="learning") return Boolean(assigned.has(item.id) && state?.total_attempts && state.stage<2);
    if (filter==="mastered") return Boolean(assigned.has(item.id) && state && state.stage>=2);
    return true;
  });
  const pageCount=Math.max(1,Math.ceil(matched.length/PAGE_SIZE));
  const page=Math.min(pageCount,Math.max(1,Number.parseInt(params.page??"1")||1));
  const rows=matched.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  const href=(nextPage:number)=>`/maxims?${new URLSearchParams({ ...(learner?{learner:learner.id}:{}),q:query,filter,page:String(nextPage) })}`;
  return <div className={styles.wrap}>
    <header className={`${styles.hero} hero`}><p className="eyebrow">Our family · Our words</p><h1>家中箴言</h1><p className="lede">父母珍藏的话，慢慢成为孩子生命里的话。</p><div className={styles.heroActions}><Link className="primary" href="/maxims/study">今天背一背</Link><Link className="secondary" href="/maxims/manage">写下一句</Link></div></header>
    <section className="panel"><div className={styles.sectionHead}><div><p className="eyebrow">Family collection</p><h2>家中册</h2><p className={styles.muted}>共 {(maximsResult.data??[]).filter((item)=>!item.archived_at).length} 条 · 当前筛选 {matched.length} 条</p></div><Link href="/maxims/shared" className={styles.quietLink}>看看大家分享的 →</Link></div>
      <form action="/maxims" className={styles.filters}>
        {learner && <label>查看孩子<select name="learner" defaultValue={learner.id}>{learners.map((item)=><option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label>}
        <label>检索<input name="q" defaultValue={query} placeholder="原句、出处或标签" /></label>
        <label>范围<select name="filter" defaultValue={filter}><option value="all">全部在册</option><option value="assigned">已给孩子</option><option value="unassigned">尚未分配</option><option value="due">到期复习</option><option value="learning">学习中</option><option value="mastered">已背出两天以上</option><option value="archived">已移出</option></select></label><button className="secondary">筛选</button>
      </form>
      {!learner && <p className="notice">还没有开通此模块的孩子。owner 可在“用户与家庭”中给孩子开通。</p>}
      <div className={styles.list}>{rows.map((item)=>{const state=states.get(item.id);return <Link className={styles.listItem} key={item.id} href={`/maxims/${item.id}`}><div className={styles.listText}><span className={styles.listQuote}>{item.text_zh}</span><span className={styles.listEnglish} lang="en">{item.text_en}</span><small>{[item.source_title,item.source_detail].filter(Boolean).join(" · ")||"父母珍藏"}</small></div><div className={styles.itemSide}><span className={styles.status}>{item.archived_at?"已移出":!learner?"在册":!assigned.has(item.id)?"待选给孩子":!state?.total_attempts?"还没背":state.stage>=2?"渐渐记住了":state.due_on && state.due_on<=today?"该复习了":"学习中"}</span>{assigned.has(item.id) && <small>中文练习 {state?.total_attempts??0} 次</small>}<span className={styles.arrow}>↗</span></div></Link>;})}</div>
      {!rows.length && <p className="notice">这里还没有符合条件的箴言。可以先逐条写下，或从 CSV 导入。</p>}
      {pageCount>1 && <nav className={styles.pagination} aria-label="箴言册分页"><Link className="secondary" aria-disabled={page===1} href={href(Math.max(1,page-1))}>上一页</Link><span>第 {page} / {pageCount} 页</span><Link className="secondary" aria-disabled={page===pageCount} href={href(Math.min(pageCount,page+1))}>下一页</Link></nav>}
    </section>
  </div>;
}
