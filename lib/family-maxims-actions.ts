"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assertAdmin, loadAccessContext } from "@/lib/access";
import { requireAccountModule, requireChildModule } from "@/lib/module-access";
import { checkLength, ImportIssues, readCsvUpload, readImportTable } from "@/lib/csv-import";
import { ImportProblem } from "@/lib/import-safety";

type Feedback = { status: "success" | "error"; message: string; details?: string[] };
type MaximInput = { text_zh: string; text_en: string; source_title: string; source_detail: string; translation_version: string; explanation_zh: string; child_explanation_zh: string; tags: string; fingerprint: string; reflection?: string };

function fail(error: unknown): Feedback {
  return { status: "error", message: error instanceof Error ? error.message : "操作失败，请稍后重试", details: error instanceof ImportProblem ? error.details : undefined };
}
function field(data: FormData, key: string) { return String(data.get(key) ?? "").trim(); }
function fingerprint(input: Pick<MaximInput,"text_zh"|"text_en"|"source_title"|"source_detail"|"translation_version">) {
  return createHash("sha256").update(JSON.stringify([input.text_zh,input.text_en,input.source_title,input.source_detail,input.translation_version].map((value) => value.normalize("NFKC").trim().toLowerCase()))).digest("hex");
}
function formInput(data: FormData): MaximInput {
  const values = Object.fromEntries(["text_zh","text_en","source_title","source_detail","translation_version","explanation_zh","child_explanation_zh","tags"].map((key) => [key, field(data,key)])) as Omit<MaximInput,"fingerprint">;
  if (!values.text_zh || !values.text_en) throw new Error("中文和英文原句都需要填写");
  for (const [key,max] of Object.entries({ text_zh:1200,text_en:2000,source_title:160,source_detail:160,translation_version:120,explanation_zh:2000,child_explanation_zh:800,tags:200 })) {
    if (String(values[key as keyof typeof values]??"").length>max) throw new Error(`${key} 内容过长，请适当分段`);
  }
  return { ...values, fingerprint: fingerprint(values) };
}
async function familySession() {
  const supabase=await createClient();
  const { data: { user } }=await supabase.auth.getUser();
  if (!user) throw new Error("请先登录");
  const access=await loadAccessContext(supabase,user.id);
  if (!access?.familyId) throw new Error("当前账号还没有家庭档案");
  await requireAccountModule(supabase,access,user.id,"family_maxims");
  return { supabase,user,access };
}
async function ownMaxim(supabase: Awaited<ReturnType<typeof createClient>>, familyId: string, id: string) {
  const { data,error }=await supabase.from("family_maxims").select("id,family_id,workspace_id,text_zh,text_en,source_title,source_detail,translation_version,explanation_zh,fingerprint,archived_at").eq("id",id).eq("family_id",familyId).maybeSingle();
  if (error || !data) throw new Error("找不到本家庭的这条箴言");
  return data;
}
function refresh() { for (const path of ["/maxims","/maxims/manage","/maxims/study","/maxims/shared"]) revalidatePath(path); }

export async function saveFamilyMaxim(formData: FormData): Promise<Feedback> {
  try {
    const { supabase,user,access }=await familySession();
    const input=formInput(formData);
    const id=field(formData,"id");
    if (id) {
      await ownMaxim(supabase,access.familyId!,id);
      const { data,error }=await supabase.from("family_maxims").update({ ...input,updated_at:new Date().toISOString() }).eq("id",id).eq("family_id",access.familyId!).select("id").single();
      if (error || !data) throw new Error(error?.code==="23505"?"这一条已在家中册中，请修改原记录":error?.message??"没有保存成功");
      refresh(); return { status:"success",message:"箴言已修正；孩子已有的背诵记录保留。" };
    }
    const { data,error }=await supabase.from("family_maxims").insert({ ...input,workspace_id:access.workspaceId,family_id:access.familyId!,created_by:user.id }).select("id").single();
    if (error || !data) throw new Error(error?.code==="23505"?"这条箴言已经在家中册中，没有重复新增。":error?.message??"新增失败");
    refresh(); return { status:"success",message:"已收进家中册。接下来可以勾选给孩子背诵。" };
  } catch(error) { return fail(error); }
}

export async function importFamilyMaxims(formData: FormData): Promise<Feedback> {
  try {
    const { supabase,access }=await familySession();
    const text=await readCsvUpload(formData.get("csv_file"),2_000_000);
    const table=readImportTable(text,"family_maxims",200);
    const issues=new ImportIssues();
    const seen=new Map<string,number>();
    const rows=table.map((row) => {
      const values=Object.fromEntries(["text_zh","text_en","source_title","source_detail","translation_version","explanation_zh","child_explanation_zh","tags","reflection"].map((key)=>[key,row.get(key)])) as Omit<MaximInput,"fingerprint">;
      if (!values.text_zh || !values.text_en) issues.add(row.line,"中文原句、英文原句不能为空");
      for (const [key,label,max] of [["text_zh","中文原句",1200],["text_en","英文原句",2000],["source_title","出处书名",160],["source_detail","具体出处",160],["translation_version","译本版本",120],["explanation_zh","意思介绍",2000],["child_explanation_zh","给孩子的解释",800],["tags","标签",200],["reflection","父母感悟",3000]] as const) checkLength(issues,row,label,values[key]??"",max);
      const key=fingerprint(values);
      if (seen.has(key)) issues.add(row.line,`与第 ${seen.get(key)} 行是同一条箴言，请在文件中只保留一行`);
      else seen.set(key,row.line);
      return { ...values,fingerprint:key };
    });
    issues.throwIfAny();
    const { data,error }=await supabase.rpc("import_family_maxims",{ p_family_id:access.familyId!,p_rows:rows });
    if (error) throw new Error(error.message);
    refresh();
    return { status:"success",message:`导入完成：新增 ${data?.added??0} 条，跳过已存在 ${data?.skipped??0} 条。父母感悟默认仅本家庭可见。` };
  } catch(error) { return fail(error); }
}

export async function saveFamilyReflection(formData: FormData): Promise<Feedback> {
  try {
    const { supabase,user,access }=await familySession();
    const maximId=field(formData,"maxim_id");
    const body=field(formData,"body");
    if (!body || body.length>3000) throw new Error("感悟请填写 1～3000 字");
    const maxim=await ownMaxim(supabase,access.familyId!,maximId);
    if (maxim.archived_at) throw new Error("已移出的箴言不能再添加感悟");
    const id=field(formData,"reflection_id");
    const patch={ body,show_to_child:formData.get("show_to_child")==="on",updated_at:new Date().toISOString() };
    const result=id
      ? await supabase.from("family_maxim_reflections").update(patch).eq("id",id).eq("maxim_id",maximId).eq("author_user_id",user.id).select("id").single()
      : await supabase.from("family_maxim_reflections").insert({ ...patch,maxim_id:maximId,author_user_id:user.id }).select("id").single();
    if (result.error || !result.data) throw new Error(result.error?.message??"只能修改自己写的感悟");
    refresh(); return { status:"success",message:patch.show_to_child?"感悟已保存，并会出现在孩子的学习卡上。":"感悟已保存，仅本家庭成人可见。" };
  } catch(error) { return fail(error); }
}

export async function setFamilyMaximAssignment(formData: FormData): Promise<Feedback> {
  try {
    const { supabase,user,access }=await familySession();
    const learnerId=field(formData,"learner_id"),maximId=field(formData,"maxim_id");
    await requireChildModule(supabase,access,user.id,learnerId,"family_maxims");
    const maxim=await ownMaxim(supabase,access.familyId!,maximId);
    if (maxim.archived_at) throw new Error("已移出的箴言不能分配给孩子");
    const active=field(formData,"active")==="true";
    const { error }=await supabase.from("learner_family_maxims").upsert({ learner_id:learnerId,maxim_id:maximId,active },{ onConflict:"learner_id,maxim_id" });
    if (error) throw new Error(error.message);
    refresh(); return { status:"success",message:active?"已加入孩子的背诵册。":"已暂停给孩子学习；历史记录保留。" };
  } catch(error) { return fail(error); }
}

export async function saveFamilyMaximSettings(formData: FormData): Promise<Feedback> {
  try {
    const { supabase,user,access }=await familySession();
    const learnerId=field(formData,"learner_id");
    await requireChildModule(supabase,access,user.id,learnerId,"family_maxims");
    const dailyNew=Number(field(formData,"daily_new_limit"));
    const reviews=Number(field(formData,"review_limit"));
    if (!Number.isInteger(dailyNew) || dailyNew<0 || dailyNew>5 || !Number.isInteger(reviews) || reviews<1 || reviews>20) throw new Error("每天新句需为 0～5 条，复习需为 1～20 条");
    const { error }=await supabase.from("family_maxim_learning_settings").upsert({learner_id:learnerId,daily_new_limit:dailyNew,review_limit:reviews,updated_at:new Date().toISOString()},{onConflict:"learner_id"});
    if (error) throw new Error(error.message);
    refresh(); return {status:"success",message:"学习节奏已保存；下一次打开今日背诵时生效。"};
  } catch(error) { return fail(error); }
}

export async function archiveFamilyMaxim(formData: FormData): Promise<Feedback> {
  try {
    const { supabase,access }=await familySession();
    const id=field(formData,"maxim_id"),restore=field(formData,"restore")==="true";
    await ownMaxim(supabase,access.familyId!,id);
    if (!restore) {
      const { error:shareError }=await supabase.from("family_maxim_shares").update({status:"withdrawn"}).eq("source_maxim_id",id).eq("source_family_id",access.familyId!).in("status",["pending","approved"]);
      if (shareError) throw new Error(`先撤回分享失败：${shareError.message}`);
    }
    const { error }=await supabase.from("family_maxims").update({archived_at:restore?null:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id).eq("family_id",access.familyId!);
    if (error) throw new Error(error.message);
    refresh(); return { status:"success",message:restore?"已放回家中册。":"已从家中册移出；孩子的历史背诵记录仍保留，可随时恢复。" };
  } catch(error) { return fail(error); }
}

export async function submitFamilyMaximShare(formData: FormData): Promise<Feedback> {
  try {
    const { supabase,user,access }=await familySession();
    if (field(formData,"permission_confirmed")!=="yes") throw new Error("分享前请确认所用译文允许在当前学习空间分享");
    const maxim=await ownMaxim(supabase,access.familyId!,field(formData,"maxim_id"));
    if (maxim.archived_at) throw new Error("已移出的箴言不能分享");
    const { error }=await supabase.from("family_maxim_shares").insert({ workspace_id:access.workspaceId,source_maxim_id:maxim.id,source_family_id:access.familyId!,published_by:user.id,text_zh:maxim.text_zh,text_en:maxim.text_en,source_title:maxim.source_title,source_detail:maxim.source_detail,translation_version:maxim.translation_version,explanation_zh:field(formData,"include_explanation")==="yes"?maxim.explanation_zh:"",fingerprint:maxim.fingerprint,status:"pending" });
    if (error) throw new Error(error.code==="23505"?"这条箴言已经提交分享，等待管理员审核或已在共享区。":error.message);
    refresh(); revalidatePath("/admin/resources");
    return { status:"success",message:"已提交到当前学习空间，管理员审核后其他家庭才会看到。私人感悟不会分享。" };
  } catch(error) { return fail(error); }
}

export async function reviewFamilyMaximShare(formData: FormData): Promise<Feedback> {
  try {
    const supabase=await createClient();
    const { data:{user} }=await supabase.auth.getUser();
    if (!user) throw new Error("请先登录");
    const access=await loadAccessContext(supabase,user.id); assertAdmin(access);
    const status=field(formData,"decision");
    if (status!=="approved" && status!=="rejected") throw new Error("审核决定无效");
    const { data,error }=await supabase.from("family_maxim_shares").update({status}).eq("id",field(formData,"share_id")).eq("workspace_id",access.workspaceId).eq("status","pending").select("id").single();
    if (error || !data) throw new Error(error?.message??"分享已审核或不存在");
    refresh(); revalidatePath("/admin/resources");
    return { status:"success",message:status==="approved"?"已通过，其他家庭现在可以选择收入。":"已退回这条分享。" };
  } catch(error) { return fail(error); }
}

export async function withdrawFamilyMaximShare(formData: FormData): Promise<Feedback> {
  try {
    const { supabase,user,access }=await familySession();
    const { data,error }=await supabase.from("family_maxim_shares").update({status:"withdrawn"}).eq("id",field(formData,"share_id")).eq("workspace_id",access.workspaceId).eq("published_by",user.id).in("status",["pending","approved"]).select("id").single();
    if (error || !data) throw new Error(error?.message??"只能撤回自己提交、仍有效的分享");
    refresh(); return { status:"success",message:"分享已撤回。其他家庭之前主动收下的副本不会被删除。" };
  } catch(error) { return fail(error); }
}

export async function adoptFamilyMaximShare(formData: FormData): Promise<Feedback> {
  try {
    const { supabase,user,access }=await familySession();
    const { data:share,error:readError }=await supabase.from("family_maxim_shares").select("id,workspace_id,status,text_zh,text_en,source_title,source_detail,translation_version,explanation_zh,fingerprint").eq("id",field(formData,"share_id")).eq("workspace_id",access.workspaceId).eq("status","approved").maybeSingle();
    if (readError || !share) throw new Error("这条分享不存在或已撤回");
    const { error }=await supabase.from("family_maxims").insert({ workspace_id:access.workspaceId,family_id:access.familyId!,text_zh:share.text_zh,text_en:share.text_en,source_title:share.source_title,source_detail:share.source_detail,translation_version:share.translation_version,explanation_zh:share.explanation_zh,child_explanation_zh:"",tags:"",fingerprint:share.fingerprint,imported_from_share_id:share.id,created_by:user.id });
    if (error) throw new Error(error.code==="23505"?"这条箴言已在你家的册子里，没有重复收入。":error.message);
    refresh(); return { status:"success",message:"已收进你家的箴言册。你可以添加自己的解释与感悟，再决定是否给孩子背诵。" };
  } catch(error) { return fail(error); }
}

export async function recordFamilyMaximAttempt(input:{ learnerId:string;maximId:string;language:"zh"|"en";result:"read"|"prompted"|"independent"|"again";assisted:boolean;requestId:string }) {
  const { supabase,user,access }=await familySession();
  await requireChildModule(supabase,access,user.id,input.learnerId,"family_maxims");
  const { data,error }=await supabase.rpc("record_family_maxim_attempt",{ p_learner_id:input.learnerId,p_maxim_id:input.maximId,p_language:input.language,p_result:input.result,p_assisted:input.assisted,p_request_id:input.requestId });
  if (error) throw new Error(error.message);
  revalidatePath("/maxims/study"); revalidatePath("/maxims");
  return data as { stage:number;due_on:string;result:string;idempotent:boolean };
}
