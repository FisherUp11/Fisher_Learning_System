import "server-only";
import { listeningSourceInput, prepareEnglishSource } from "./english-source";
import { createHash, randomUUID } from "node:crypto";
import { adultCommand, adultContext, allRows, callAdultAI, checked, ownedProfile, reserveJob, uuid } from "./adult-server";
import { addDays, localDay, normalizeText, type AdultProfile, type EnglishConcept } from "./adult-learning";
import { rotateOptions, splitMeeting, validateListening, type ListeningContent, type ListeningLesson, type ReviewWord, type Section, type WordState } from "./english-listening";
type Context = Awaited<ReturnType<typeof adultContext>>;
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const conceptKey = (phrase: string, meaning: string) => digest(`${normalizeText(phrase)}\n${normalizeText(meaning)}`);
export async function listeningData(ctx: Context, profileId?: string | null) {
  const { db, user } = ctx; const today = localDay();
  const profiles = checked(await db.from("adult_profiles").select("*").eq("owner_id", user.id).order("created_at")) as AdultProfile[];
  const profile = profiles.find(p => p.id === profileId && !p.archived) ?? profiles.find(p => !p.archived);
  if (!profile) return { profiles, profile: null, today };
  const [sources, sections, lessons, concepts, links, states, sessions, attempts, current] = await Promise.all([
    allRows((f,t) => db.from("adult_english_sources").select("id,title,meeting_date,priority,archived,created_at").eq("owner_id",user.id).order("created_at",{ascending:false}).order("id").range(f,t)),
    allRows((f,t) => db.from("adult_english_sections").select("id,source_id,ordinal,title,word_count").eq("owner_id",user.id).order("source_id").order("ordinal").range(f,t)),
    allRows((f,t) => db.from("adult_english_lessons").select("id,source_id,section_id,status,error,created_at,format_version").eq("owner_id",user.id).eq("format_version",2).order("created_at",{ascending:false}).order("id").range(f,t)),
    allRows((f,t) => db.from("adult_english_concepts").select("*").eq("owner_id",user.id).order("id").range(f,t)),
    allRows((f,t) => db.from("adult_english_lesson_concepts").select("*").eq("owner_id",user.id).order("lesson_id").order("concept_id").range(f,t)),
    allRows((f,t) => db.from("adult_english_word_states").select("*").eq("profile_id",profile.id).order("concept_id").range(f,t)),
    allRows((f,t) => db.from("adult_listening_sessions").select("id,lesson_id,local_date,completed_at,assisted").eq("profile_id",profile.id).order("local_date",{ascending:false}).range(f,t)),
    allRows((f,t) => db.from("adult_listening_attempts").select("*").eq("profile_id",profile.id).gte("local_date",addDays(today,-29)).order("created_at",{ascending:false}).order("id").range(f,t)),
    db.from("adult_listening_sessions").select("*").eq("profile_id",profile.id).eq("local_date",today).maybeSingle(),
  ]);
  return { profiles, profile, today, listening: { sources, sections, lessons, concepts, links, states, sessions, attempts, current: checked(current) } };
}
export async function lessonDetail(ctx: Context, id: string) {
  const lesson = checked(await ctx.db.from("adult_english_lessons").select("*").eq("id",uuid(id)).eq("owner_id",ctx.user.id).eq("format_version",2).single()) as ListeningLesson;
  const section = checked(await ctx.db.from("adult_english_sections").select("*").eq("id",lesson.section_id).single()) as Section;
  return { lesson, section };
}
const prompt = `你是 CET-6 基础的成人英语教练。根据本节英文会议纪要或课程字幕整理一节听力课：忠实于原文事实、日期、数字、决定，不编造。正常听力稿250～350英文词；很短原文可80～200词，不为凑字数编造。保留有用的原文英文表达，删除无意义重复。标题为简短中文主题。选择题3道：主旨、细节、原因或行动；英文问题和英文四选一，有唯一最佳答案，干扰项合理且不得存在两个都对的答案。中文解释必须引用听力稿的原句evidence。词句4～6项，适合已有六级基础，可用于工作或日常理解，忠实于原文题材，以搭配短语为主；source_quote逐字来自输入的本节原文，example明确为新编的应用例句。词句options为四个不同中文意思，正确选项文字必须等于meaning。仅JSON：{"title":"","summary":"英文听力稿","translation":"中文辅助","questions":[{"prompt":"","translation":"中文题意","options":["A内容","B内容","C内容","D内容"],"correct":0,"explanation":"中文解析","evidence":"听力稿原句"}],"expressions":[{"phrase":"","meaning":"","example":"","source_quote":"","category":"word|phrase|sentence","options":["中文意思1","中文意思2","中文意思3","中文意思4"],"correct":0}]}。options不要附带ABCD编号。correct从0到3。`;

const bilingualInstructions = `\n输入可能来自会议纪要或课程字幕。english_source 是唯一英文事实主体；chinese_reference 和 bilingual_pairs 的中文只是译文参考，不是额外发言，不重复计算内容。中文与英文冲突时以英文为准，不根据中文补造英文事实。仅围绕原文题材，不把普通课程强行改造成商务会议。英文听力稿、英文题目、词句phrase和example不得混入中文。词句source_quote必须逐字摘自english_source，不能引用中文或回译中文。保留英文原表达中适合CET-6学习者的词、搭配和短句，优先可迁移表达；不必为了会议用途扭曲课程含义。`;

export async function listeningCommand(ctx: Context, action: string, b: Record<string, unknown>): Promise<{message:string;id?:string;listeningAttempt?:import("./english-listening").ListeningAttempt}> {
  const { db, user } = ctx;
  if (action === "listen-import") {
    if (typeof b.body !== "string" || prepareEnglishSource(b.body).englishWords < 80) throw new Error("请提供至少 80 词的独立英文正文。双语字幕请一行英文、一行中文，可交换先后顺序。");
    const saved = await adultCommand(ctx,"source",b);
    if (!saved.id) return saved;
    const source = checked(await db.from("adult_english_sources").select("body").eq("id",saved.id).single());
    checked(await db.rpc("adult_split_source", { p_source: saved.id, p_parts: splitMeeting(source.body).map(excerpt => ({ excerpt, word_count: prepareEnglishSource(excerpt).englishWords })) }));
    return { id: saved.id, message: "资料已保存并分节（重复正文沿用原资料）。打开目录，生成第 1 节即可开始。" };
  }
  if (action === "listen-split") {
    const source = checked(await db.from("adult_english_sources").select("body").eq("id",uuid(b.source_id)).eq("owner_id",user.id).single());
    checked(await db.rpc("adult_split_source",{p_source:b.source_id,p_parts:splitMeeting(source.body).map(excerpt=>({excerpt,word_count:prepareEnglishSource(excerpt).englishWords}))}));
    return { message:"分节目录已准备好，旧版课程与记录保留。" };
  }
  if (action === "listen-generate") {
    await ownedProfile(ctx,b.profile_id);
    const section = checked(await db.from("adult_english_sections").select("*").eq("id",uuid(b.section_id)).eq("owner_id",user.id).single()) as Section;
    const learningSource = listeningSourceInput(section.excerpt!);
    const source = checked(await db.from("adult_english_sources").select("archived").eq("id",section.source_id).single());
    if (source.archived) throw new Error("请先恢复归档资料");
    const active = checked(await db.from("adult_english_lessons").select("*").eq("section_id",section.id).in("status",["generating","draft","failed"]).maybeSingle()) as ListeningLesson | null;
    if (active?.status === "draft") return { id:active.id,message:"已有草稿，请先预览；不会重复生成。" };
    const id = active?.id ?? uuid(b.id);
    if (!active) {
      const existing = checked(await db.from("adult_english_lessons").select("id,section_id,status").eq("id",id).maybeSingle());
      if (existing) {
        if (existing.section_id !== section.id) throw new Error("生成编号与小节不匹配");
        return { id, message:"此版本已经生成，请查看本节版本。" };
      }
      const insert = await db.from("adult_english_lessons").insert({ id,source_id:section.source_id,section_id:section.id,format_version:2,level:"practical" });
      if (insert.error?.code === "23505") throw new Error("本节已经在另一窗口生成，请重新加载目录后重试");
      checked(insert);
    }
    const cached = await reserveJob(ctx,id,"lesson"); let durable = !!cached;
    try {
      checked(await db.from("adult_english_lessons").update({status:"generating",error:null}).eq("id",id).neq("status","published"));
      const result = cached ? {content:cached.result,model:cached.model,usage:cached.usage} : await callAdultAI(prompt + bilingualInstructions,{...learningSource,level:"CET-6 基础，听力需要循序渐进"});
      // Persist raw output too: invalid output can be inspected; a fresh retry may replace it.
      if (!cached) checked(await db.from("adult_ai_jobs").update({result:result.content,model:result.model,usage:result.usage,updated_at:new Date().toISOString()}).eq("id",id));
      const content = validateListening(result.content,section.excerpt!);
      checked(await db.from("adult_ai_jobs").update({status:"complete",updated_at:new Date().toISOString()}).eq("id",id)); durable=true;
      checked(await db.from("adult_english_lessons").update({status:"draft",content,error:null,updated_at:new Date().toISOString()}).eq("id",id).neq("status","published"));
      return { id,message:"本节草稿已生成。请核对听力稿、三道题和词句，再确认发布。" };
    } catch (e) {
      if (!durable) await db.from("adult_ai_jobs").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",id);
      await db.from("adult_english_lessons").update({status:"failed",error:e instanceof Error?e.message:"生成失败",updated_at:new Date().toISOString()}).eq("id",id).neq("status","published");
      throw e;
    }
  }
  if (action === "listen-draft" || action === "listen-publish") {
    const {lesson,section} = await lessonDetail(ctx,uuid(b.id));
    if (lesson.status === "published" && action === "listen-publish") return {message:"这版课程已经发布，不会重复添加。"};
    if (lesson.status !== "draft") throw new Error("只有草稿可以修改，已发布内容请创建新版本。");
    const content=validateListening(b.content,section.excerpt!);
    if (action === "listen-draft") checked(await db.from("adult_english_lessons").update({content}).eq("id",lesson.id).eq("status","draft"));
    else checked(await db.rpc("adult_publish_lesson",{p_lesson:lesson.id,p_content:content,p_expressions:content.expressions.map(e=>({...e,key:conceptKey(e.phrase,e.meaning)}))}));
    return {message:action === "listen-draft"?"草稿已保存。":"已发布，可以在今日练习中选择本节。"};
  }
  if (action === "listen-start") {
    const profile = await ownedProfile(ctx,b.profile_id); const today=localDay();
    const previous=checked(await db.from("adult_listening_sessions").select("id").eq("profile_id",profile.id).eq("local_date",today).maybeSingle());
    if(previous) return {message:"继续今天已开始的计划，明天再选新小节。"};
    const loaded=await listeningData(ctx,profile.id); if(!loaded.listening) throw new Error("请选择成人档案");
    const d=loaded.listening;
    const available=(d.lessons as ListeningLesson[]).filter(l=>l.status==="published"&&!d.sources.find(s=>s.id===l.source_id)?.archived);
    const latest=available.filter((l,i)=>available.findIndex(x=>x.section_id===l.section_id)===i);
    const activeIds=new Set(latest.map(l=>l.id));
    const activeConcepts=new Set(d.links.filter(l=>activeIds.has(l.lesson_id)).map(l=>l.concept_id));
    const dueAll=(d.states as WordState[]).filter(s=>activeConcepts.has(s.concept_id)&&s.due_date<=today).sort((a,z)=>Number(z.priority)-Number(a.priority)||a.due_date.localeCompare(z.due_date));
    const due=dueAll.slice(0,Math.min(profile.daily_review,5));
    const completed=new Set(d.sessions.filter(s=>s.completed_at).map(s=>s.lesson_id));
    const lastStudy = (id:string) => d.sessions.find(s=>s.lesson_id===id)?.local_date??"";
    const rank = (l:ListeningLesson) => d.sections.find(s=>s.id===l.section_id)?.ordinal??999;
    // Last session's first attempts, not answer-spamming, identify weak listening sections.
    const weak=(id:string)=>{const session=d.sessions.find(s=>s.lesson_id===id);if(!session)return false;const records=d.attempts.filter(a=>a.session_id===session.id&&a.kind==="listening");const first=records.filter((a,i)=>!records.slice(i+1).some(x=>x.task_id===a.task_id));return first.some(a=>!a.correct||a.assisted);};
    const eligible=latest.filter(l=>!completed.has(l.id)||lastStudy(l.id)<addDays(today,weak(l.id)?0:-2));
    const chosen=b.review_only===true || (dueAll.length>=5&&!b.lesson_id) ? undefined : b.lesson_id ? latest.find(l=>l.id===b.lesson_id) : eligible.sort((a,z)=>Number(weak(z.id))-Number(weak(a.id))||Number(completed.has(a.id))-Number(completed.has(z.id))||Number(d.sources.find(s=>s.id===z.source_id)?.priority)-Number(d.sources.find(s=>s.id===a.source_id)?.priority)||lastStudy(a.id).localeCompare(lastStudy(z.id))||rank(a)-rank(z))[0];
    if(b.lesson_id&&!chosen&&b.review_only!==true) throw new Error("所选课程未发布或已归档");
    const ids=new Set(due.map(st=>d.links.find(l=>activeIds.has(l.lesson_id)&&l.concept_id===st.concept_id)?.lesson_id).filter(Boolean) as string[]); if(chosen) ids.add(chosen.id);
    const full = ids.size ? checked(await db.from("adult_english_lessons").select("*").in("id",[...ids]).eq("owner_id",user.id)) as ListeningLesson[] : [];
    const bind=(c:ListeningContent)=>({...c,expressions:c.expressions.map(e=>({...e,concept_id:(d.concepts as EnglishConcept[]).find(x=>normalizeText(x.phrase)===normalizeText(e.phrase)&&normalizeText(x.meaning)===normalizeText(e.meaning))?.id}))});
    const offset=parseInt(randomUUID().slice(0,4),16);
    let snapshot:ListeningContent|null=chosen?bind(full.find(l=>l.id===chosen.id)!.content!):null;
    if(snapshot) snapshot={...snapshot,questions:snapshot.questions.map((q,i)=>rotateOptions(q,offset+i)),expressions:snapshot.expressions.filter(e=>!d.states.some(st=>st.concept_id===e.concept_id&&st.due_date>today)).map((e,i)=>rotateOptions(e,offset+i+1))};
    const currentConcepts=new Set(snapshot?.expressions.map(e=>e.concept_id));
    const review_words:ReviewWord[]=due.filter(st=>!currentConcepts.has(st.concept_id)).flatMap(st=>{
      const lesson=full.find(l=>d.links.some(x=>x.lesson_id===l.id&&x.concept_id===st.concept_id));
      const c=(d.concepts as EnglishConcept[]).find(c=>c.id===st.concept_id);
      const term=lesson?.content?.expressions.find(e=>c&&normalizeText(e.phrase)===normalizeText(c.phrase)&&normalizeText(e.meaning)===normalizeText(c.meaning));
      return term&&lesson?[{...rotateOptions(term,offset+2),concept_id:st.concept_id,lesson_id:lesson.id}]:[];
    });
    if(!snapshot&&!review_words.length) throw new Error("暂无到期词句或可学小节，请先生成并发布一节课程，或手动选择已发布小节。");
    const insert=await db.from("adult_listening_sessions").insert({profile_id:profile.id,local_date:today,lesson_id:chosen?.id??null,snapshot,review_words});
    if(insert.error?.code!=="23505") checked(insert);
    return {message:"今日听力与词句计划已准备好；随时暂停，刷新后可以继续。"};
  }
  if(action === "listen-hint") {
    checked(await db.rpc("adult_listening_hint", {p_session:uuid(b.session_id),p_task:b.task_id??null}));
    return {message:"辅助标记已保存；对应作答会与独立练习区分。"};
  }
  if(action === "listen-answer") {
    const attempt=checked(await db.rpc("adult_listening_answer",{p_id:uuid(b.id),p_session:uuid(b.session_id),p_task:String(b.task_id),p_selected:Number.isInteger(b.selected)?b.selected:null,p_rating:b.rating??null,p_assisted:b.assisted===true}));
    return {listeningAttempt:attempt,message:attempt.correct?"已记录：回答正确。看解析再巩固一下。":"已记录：还需要巩固。答案解析会帮助你定位原句。"};
  }
  if(action === "listen-priority") {
    await ownedProfile(ctx,b.profile_id);
    const concept=uuid(b.concept_id);
    // Insert defaults only for a new state; changing priority must not reset the schedule.
    checked(await db.from("adult_english_word_states").upsert({profile_id:b.profile_id,concept_id:concept,due_date:localDay()},{onConflict:"profile_id,concept_id",ignoreDuplicates:true}));
    checked(await db.from("adult_english_word_states").update({priority:b.priority===true}).eq("profile_id",b.profile_id).eq("concept_id",concept));
    return {message:b.priority?"已加入重点复习。":"已取消重点，原学习记录保留。"};
  }
  throw new Error("未知英语操作");
}
