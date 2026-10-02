import "server-only";
import { createHash } from "node:crypto";
import { adultContext, allRows, callAdultAI, checked, numberValue, ownedProfile, reserveJob, textValue, uuid } from "./adult-server";
import { localDay, normalizeText } from "./adult-learning";
import { prepareEnglishSource } from "./english-source";
import { academicChunks, validateAcademicCandidates } from "./adult-academic";

type Context = Awaited<ReturnType<typeof adultContext>>;
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const aiPrompt = `你是给已有 CET-6 基础的成人编写生物学专业英语词卡的编辑。仅根据输入的 english_source 提取 3～6 条值得长期记忆的专业术语、学术搭配或可迁移表达。普通 CET-6 高频词、姓名、章节编号和公式不要入选。优先精确的生物学术语，同时适当选择描述机制、因果与比较的表达。不得把相邻中文译文当成独立事实。phrase 必须是英文原文出现的词形或连续短语；source_quote 必须逐字摘自英文原文、是一句有语境的完整英文句子（可不含段落编号）；translation 是该句简明中文解释。中文 meaning 简洁准确。同一段不要重复近义词。只输出 JSON：{"items":[{"phrase":"","meaning":"","source_quote":"","translation":"","category":"word|phrase|sentence"}]}。`;

export async function academicData(ctx: Context, profileId?: string | null, sourceId?: string | null) {
  const { db, user } = ctx; const today = localDay();
  const profiles = checked(await db.from("adult_profiles").select("id,name,archived").eq("owner_id",user.id).order("created_at"));
  const profile = profiles.find(p => p.id === profileId && !p.archived) ?? profiles.find(p => !p.archived) ?? null;
  const [courses,sources,links,terms,concepts,chunks] = await Promise.all([
    allRows((f,t) => db.from("adult_academic_courses").select("id,title,created_at").eq("owner_id",user.id).order("created_at").range(f,t)),
    allRows((f,t) => db.from("adult_academic_sources").select("id,course_id,title,archived,published_at,created_at").eq("owner_id",user.id).order("created_at",{ascending:false}).range(f,t)),
    allRows((f,t) => db.from("adult_academic_source_concepts").select("source_id,concept_id,chunk_ordinal,source_quote,translation").eq("owner_id",user.id).order("source_id").range(f,t)),
    allRows((f,t) => db.from("adult_academic_terms").select("canonical_key,concept_id,category").eq("owner_id",user.id).order("canonical_key").range(f,t)),
    allRows((f,t) => db.from("adult_english_concepts").select("id,phrase,meaning,example").eq("owner_id",user.id).order("id").range(f,t)),
    sourceId ? allRows((f,t) => db.from("adult_academic_chunks").select("id,source_id,ordinal,status,candidates,error").eq("owner_id",user.id).eq("source_id",uuid(sourceId)).order("ordinal").range(f,t)) : Promise.resolve([]),
  ]);
  if (sourceId && !sources.some(s => s.id === sourceId)) throw new Error("讲义不存在或无权限");
  if (!profile) return { profiles, profile, today, courses, sources, links, terms, concepts, chunks, settings:null, states:[], items:[] };
  const [settings,states,items] = await Promise.all([
    db.from("adult_academic_settings").select("profile_id,daily_new,daily_review,focus_course_id").eq("profile_id",profile.id).maybeSingle(),
    allRows((f,t) => db.from("adult_english_word_states").select("concept_id,stage,attempts,independent_days,spaced_success,due_date,priority").eq("profile_id",profile.id).order("concept_id").range(f,t)),
    db.from("adult_academic_daily_items").select("profile_id,local_date,concept_id,queue_kind,confirmations,had_failure,attempt_count,last_answered_at,completed_at").eq("profile_id",profile.id).eq("local_date",today).order("last_answered_at",{ascending:true}),
  ]);
  return { profiles, profile, today, courses, sources, links, terms, concepts, chunks, settings:checked(settings), states, items:checked(items) };
}

export async function academicCommand(ctx: Context, action: string, b: Record<string, unknown>) {
  const { db, user } = ctx;
  if (action === "academic-course") {
    const title = textValue(b.title,100);
    const result = await db.from("adult_academic_courses").insert({title}).select("id").single();
    if (result.error?.code === "23505") return {message:"这门课程已经存在，可以直接选择。"};
    const row=checked(result); return {id:row.id,message:"课程已创建。现在可以逐讲导入。"};
  }
  if (action === "academic-import") {
    const courseId=uuid(b.course_id), title=textValue(b.title,120), body=textValue(b.body,150000,80);
    checked(await db.from("adult_academic_courses").select("id").eq("id",courseId).eq("owner_id",user.id).single());
    const parts=academicChunks(body), contentHash=digest(normalizeText(body));
    let source=checked(await db.from("adult_academic_sources").select("id").eq("owner_id",user.id).eq("content_hash",contentHash).maybeSingle());
    if (!source) {
      const inserted=await db.from("adult_academic_sources").insert({course_id:courseId,title,body,content_hash:contentHash}).select("id").single();
      if (inserted.error?.code === "23505") source=checked(await db.from("adult_academic_sources").select("id").eq("owner_id",user.id).eq("content_hash",contentHash).single());
      else source=checked(inserted);
    }
    const rows=parts.map((part,i)=>({source_id:source!.id,ordinal:i+1,excerpt:part}));
    for (let i=0;i<rows.length;i+=50) checked(await db.from("adult_academic_chunks").upsert(rows.slice(i,i+50),{onConflict:"source_id,ordinal",ignoreDuplicates:true}));
    return {id:source.id,message:`讲义已保存，共 ${parts.length} 段。相同正文不会重复导入；接下来可逐段提取候选词。`};
  }
  if (action === "academic-generate") {
    const chunk=checked(await db.from("adult_academic_chunks").select("*").eq("id",uuid(b.chunk_id)).eq("owner_id",user.id).single());
    const source=checked(await db.from("adult_academic_sources").select("id,archived,published_at").eq("id",chunk.source_id).eq("owner_id",user.id).single());
    if(source.archived) throw new Error("请先恢复归档讲义");
    if(source.published_at) throw new Error("讲义已加入词库，不能重新覆盖候选；新版本请重新导入修订后的原文。");
    if(chunk.status==="complete") return {id:chunk.id,message:"本段已经提取完成，不会重复调用 AI。"};
    const cached=await reserveJob(ctx,chunk.id,"academic"); let durable=!!cached;
    try {
      checked(await db.from("adult_academic_chunks").update({status:"running",error:null,updated_at:new Date().toISOString()}).eq("id",chunk.id));
      const prepared=prepareEnglishSource(chunk.excerpt);
      const result=cached?{content:cached.result,model:cached.model,usage:cached.usage}:await callAdultAI(aiPrompt,{english_source:prepared.english,chinese_reference:prepared.chinese,course:"专业学术英语",level:"CET-6 基础"},"adult.academic");
      if(!cached) checked(await db.from("adult_ai_jobs").update({result:result.content,model:result.model,usage:result.usage,updated_at:new Date().toISOString()}).eq("id",chunk.id));
      const candidates=validateAcademicCandidates(result.content,chunk.excerpt);
      checked(await db.from("adult_ai_jobs").update({status:"complete",updated_at:new Date().toISOString()}).eq("id",chunk.id)); durable=true;
      checked(await db.from("adult_academic_chunks").update({status:"complete",candidates,error:null,updated_at:new Date().toISOString()}).eq("id",chunk.id));
      return {id:chunk.id,message:`第 ${chunk.ordinal} 段提取完成，得到 ${candidates.length} 条候选。`};
    } catch(e) {
      if(!durable) await db.from("adult_ai_jobs").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",chunk.id);
      await db.from("adult_academic_chunks").update({status:"failed",error:e instanceof Error?e.message:"生成失败",updated_at:new Date().toISOString()}).eq("id",chunk.id);
      throw e;
    }
  }
  if (action === "academic-publish") {
    const sourceId=uuid(b.source_id);
    if(!Array.isArray(b.selected)) throw new Error("请选择要加入词库的候选词");
    const selected=b.selected.map(x=>{
      if(!x||typeof x!=="object") throw new Error("候选编号无效");
      const choice=x as Record<string,unknown>;
      return {chunk_id:uuid(choice.chunk_id),index:numberValue(choice.index,0,20,true),match_id:choice.match_id?uuid(choice.match_id):null,new_sense:choice.new_sense===true};
    });
    const result=checked(await db.rpc("adult_academic_publish",{p_source:sourceId,p_selected:selected}));
    return {message:`已加入词库：新增 ${result.new_terms} 条，复用 ${result.reused_terms} 条；本讲关联 ${result.source_links} 条。原有记忆进度不变。`};
  }
  if (action === "academic-settings") {
    const profile=await ownedProfile(ctx,b.profile_id);
    const course=b.focus_course_id?uuid(b.focus_course_id):null;
    if(course) checked(await db.from("adult_academic_courses").select("id").eq("id",course).eq("owner_id",user.id).single());
    checked(await db.from("adult_academic_settings").upsert({profile_id:profile.id,daily_new:numberValue(b.daily_new,0,20,true),daily_review:numberValue(b.daily_review,1,50,true),focus_course_id:course},{onConflict:"profile_id"}));
    return {message:"专业英语节奏已保存；今天已排好的任务不变，从下一天开始按新设置选词。"};
  }
  if (action === "academic-start") {
    const profile=await ownedProfile(ctx,b.profile_id);
    const count=checked(await db.rpc("adult_academic_start_day",{p_profile:profile.id}));
    return {message:count?`今天有 ${count} 条待练词句，可以随时暂停后继续。`:"今天暂时没有到期词句；先导入并确认一讲，或明天再来。"};
  }
  if (action === "academic-answer") {
    const profile=await ownedProfile(ctx,b.profile_id);
    const result=checked(await db.rpc("adult_academic_answer",{p_request:uuid(b.id),p_profile:profile.id,p_concept:uuid(b.concept_id),p_result:b.result}));
    return {message:result.completed?`本词今天已完成；下次复习 ${result.due_date}。`:"已记录，稍后还会再出现一次，确认是否真的记住。",answer:result};
  }
  if (action === "academic-archive") {
    checked(await db.from("adult_academic_sources").update({archived:b.archived===true}).eq("id",uuid(b.source_id)).eq("owner_id",user.id));
    return {message:b.archived?"讲义已归档，不再挑入新任务；既有学习记录保留。":"讲义已恢复。"};
  }
  throw new Error("未知专业英语操作");
}
