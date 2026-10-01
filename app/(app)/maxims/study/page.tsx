import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";
import { localDay, makeDailyMaximQueue, type Maxim, type MaximAttempt, type MaximState } from "@/lib/family-maxims";
import { FeedbackForm } from "@/components/feedback-form";
import { saveFamilyMaximSettings } from "@/lib/family-maxims-actions";
import { FamilyMaximStudy } from "@/components/family-maxim-study";
import styles from "@/components/family-maxims.module.css";

export const dynamic="force-dynamic";
export default async function FamilyMaximsStudyPage({searchParams}:{searchParams:Promise<{learner?:string;lang?:string;item?:string}>}) {
  const params=await searchParams;
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  const access=user?await loadAccessContext(supabase,user.id):null;
  if (!user || !access?.familyId) return <section className="panel"><h1>请先加入一个家庭</h1></section>;
  const [learnerResult,grantResult]=await Promise.all([
    supabase.from("learner_profiles").select("id,display_name,timezone").eq("family_id",access.familyId).order("created_at"),
    supabase.from("learner_module_access").select("learner_id").eq("module_key","family_maxims").eq("enabled",true),
  ]);
  const allowed=new Set((grantResult.data??[]).map((row)=>row.learner_id));
  const learners=(learnerResult.data??[]).filter((row)=>allowed.has(row.id));
  const learner=learners.find((row)=>row.id===params.learner)??learners[0];
  if (!learner) return <section className="panel"><h1>还没有开通家中箴言的孩子</h1><p>请让 owner 在“用户与家庭”同时给家长账号和孩子开通该模块。</p></section>;
  try { await requireChildModule(supabase,access,user.id,learner.id,"family_maxims"); }
  catch(error) { return <section className="panel"><h1>暂时不能开始背诵</h1><p>{error instanceof Error?error.message:"请检查模块权限"}</p></section>; }
  const lang=params.lang==="en"?"en":"zh";
  const today=localDay(learner.timezone);
  const [assignmentResult,stateResult,attemptResult,settingsResult]=await Promise.all([
    supabase.from("learner_family_maxims").select("maxim_id").eq("learner_id",learner.id).eq("active",true),
    supabase.from("family_maxim_states").select("maxim_id,language,stage,due_on,total_attempts,independent_days,last_result").eq("learner_id",learner.id),
    supabase.from("family_maxim_attempts").select("maxim_id,language,stage_before,practiced_local_date").eq("learner_id",learner.id).eq("practiced_local_date",today),
    supabase.from("family_maxim_learning_settings").select("daily_new_limit,review_limit").eq("learner_id",learner.id).maybeSingle(),
  ]);
  const readError=[assignmentResult.error,stateResult.error,attemptResult.error,settingsResult.error].find(Boolean);
  if (readError) return <section className="panel"><h1>今日背诵暂时打不开</h1><p className="error">{readError.message}</p></section>;
  const ids=(assignmentResult.data??[]).map((row)=>row.maxim_id);
  const [maximResult,reflectionResult]=ids.length?await Promise.all([
    supabase.from("family_maxims").select("id,text_zh,text_en,source_title,source_detail,translation_version,explanation_zh,child_explanation_zh,tags,archived_at,created_at").eq("family_id",access.familyId).is("archived_at",null).in("id",ids).order("created_at"),
    supabase.from("family_maxim_reflections").select("maxim_id,body").eq("show_to_child",true).in("maxim_id",ids).order("created_at"),
  ]):[{data:[],error:null},{data:[],error:null}];
  if (maximResult.error || reflectionResult.error) return <section className="panel"><h1>读取箴言失败</h1><p className="error">{maximResult.error?.message??reflectionResult.error?.message}</p></section>;
  const messages=new Map<string,string[]>();
  for (const note of reflectionResult.data??[]) messages.set(note.maxim_id,[...(messages.get(note.maxim_id)??[]),note.body]);
  const all=(maximResult.data??[]) as Maxim[];
  const newLimit=settingsResult.data?.daily_new_limit??1;
  const reviewLimit=settingsResult.data?.review_limit??3;
  const chosen=all.find((item)=>item.id===params.item);
  const currentState=(stateResult.data??[]).find((state)=>state.maxim_id===chosen?.id&&state.language===lang);
  const queue=chosen?[{...chosen,queueKind:currentState?.total_attempts?"review" as const:"new" as const,stage:currentState?.stage??0,totalAttempts:currentState?.total_attempts??0,dueOn:currentState?.due_on??null,childMessages:messages.get(chosen.id)??[]}]:makeDailyMaximQueue(all,(stateResult.data??[]) as MaximState[],(attemptResult.data??[]) as MaximAttempt[],lang,today,newLimit,reviewLimit,messages);
  return <div className={styles.wrap}><header className="hero"><p className="eyebrow">One thought at a time</p><h1>今天背一背</h1><p className="lede">先听、先理解，再试着独立说出来。今天练过的，系统会在合适的日子再安排。</p></header>
    <div className={styles.studyControls}><form action="/maxims/study" className={styles.switchForm}><label>今天是谁？<select name="learner" defaultValue={learner.id}>{learners.map((item)=><option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label><label>背诵语言<select name="lang" defaultValue={lang}><option value="zh">中文先学</option><option value="en">英文练习</option></select></label><button className="secondary">切换</button></form><details className={styles.settings}><summary>调整每天数量</summary><FeedbackForm action={saveFamilyMaximSettings} className={styles.settingsForm}><input type="hidden" name="learner_id" value={learner.id}/><label>每天新句<select name="daily_new_limit" defaultValue={newLimit}>{[0,1,2,3,4,5].map((n)=><option key={n} value={n}>{n} 条</option>)}</select></label><label>最多复习<select name="review_limit" defaultValue={reviewLimit}>{[1,2,3,4,5,6,8,10,15,20].map((n)=><option key={n} value={n}>{n} 条</option>)}</select></label><button className="secondary">保存节奏</button></FeedbackForm></details></div>
    <FamilyMaximStudy key={`${learner.id}:${lang}:${params.item??"daily"}`} learnerId={learner.id} learnerName={learner.display_name} language={lang} initialQueue={queue}/>
    <p className={styles.belowStudy}><Link href="/maxims">查看家中册和学习足迹 →</Link></p>
  </div>;
}
