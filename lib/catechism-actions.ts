"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { localDateInTimezone, type CatechismAttemptResult } from "@/lib/catechism";
import type { CatechismFormState } from "@/lib/catechism-form-state";
import { assertAdmin, loadAccessContext } from "@/lib/access";
import { checkImportWrite, existingImportMessage, finishImportCollection, ImportProblem, prepareImportCollection, retryImportDatabaseCall } from "@/lib/import-safety";
import { checkLength, checkSequence, ImportIssues, readCsvUpload, readImportTable, STABLE_KEY } from "@/lib/csv-import";

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录家长账号");
  return { supabase, user };
}

function cleanOptional(input: FormDataEntryValue | null, limit: number) {
  return String(input ?? "").trim().slice(0, limit) || null;
}

function failure(error: unknown): CatechismFormState {
  return { status: "error", message: error instanceof Error ? error.message : "操作失败，请稍后再试", details: error instanceof ImportProblem ? error.details : undefined };
}

export async function importCatechismCollection(_previousState: CatechismFormState, formData: FormData): Promise<CatechismFormState> {
  try {
    const { supabase, user } = await authenticatedClient();
    const access = await loadAccessContext(supabase, user.id);
    if (!access) throw new Error("当前账号还没有学习空间");
    const learnerIds = [...new Set(formData.getAll("learner_ids").map(String).filter(Boolean))];
    const title = String(formData.get("collection_title") ?? "要理问答").trim().slice(0, 120);
    const englishTitle = cleanOptional(formData.get("english_title"), 180);
    const sourceNote = cleanOptional(formData.get("source_note"), 500);
    const licenseNote = cleanOptional(formData.get("license_note"), 500);
    const publishNow = formData.get("publish_now") === "on";
    const canPublishNow = access.isAdmin && publishNow;
    const file = formData.get("catechism_csv_file");
    if (!title) throw new Error("请填写问答册名称");
    if (!learnerIds.length) throw new Error("请至少选择一位孩子");
    const text = await readCsvUpload(file, 3_000_000);

    const { data: ownedLearners, error: learnerError } = await supabase
      .from("learner_profiles")
      .select("id,families!inner(workspace_id)")
      .in("id", learnerIds)
      .eq("families.workspace_id", access.workspaceId);
    if (learnerError) throw new Error(learnerError.message);
    if ((ownedLearners?.length ?? 0) !== learnerIds.length) throw new Error("有孩子档案不属于当前家长账号");

    const rows = readImportTable(text, "catechism", 500);
    const issues = new ImportIssues();
    const keys = new Map<string, number>();
    const sequences = new Map<number, number>();
    const items = rows.map((row, index) => {
      const get = (key: string) => row.get(key).replace(/\\n/g, "\n");
      const itemKey = get("item_key");
      const questionZh = get("question_zh");
      const questionEn = get("question_en");
      const answerZh = get("answer_zh");
      const answerEn = get("answer_en");
      const sectionTitle = get("section") || null;
      const scriptureReference = get("scripture_reference") || null;
      const parentNote = get("parent_note") || null;
      if (!STABLE_KEY.test(itemKey)) issues.add(row.line, `编号“${itemKey || "空"}”只能使用英文字母、数字、下划线或短横线`);
      else if (keys.has(itemKey)) issues.add(row.line, `编号“${itemKey}”与第 ${keys.get(itemKey)} 行重复`);
      else keys.set(itemKey, row.line);
      const sequence = checkSequence(issues, row, index + 1, sequences, true);
      for (const [label, fieldValue] of [["中文问题", questionZh], ["英文问题", questionEn], ["中文答案", answerZh], ["英文答案", answerEn]] as const) {
        if (!fieldValue) issues.add(row.line, `${label}不能为空`);
      }
      checkLength(issues, row, "中文问题", questionZh, 2000);
      checkLength(issues, row, "英文问题", questionEn, 3000);
      checkLength(issues, row, "中文答案", answerZh, 4000);
      checkLength(issues, row, "英文答案", answerEn, 6000);
      checkLength(issues, row, "章节", sectionTitle, 120);
      checkLength(issues, row, "出处", scriptureReference, 1000);
      checkLength(issues, row, "家长备注", parentNote, 1000);
      return { item_key: itemKey, sort_order: sequence, section_title: sectionTitle, question_zh: questionZh, question_en: questionEn, answer_zh: answerZh, answer_en: answerEn, scripture_reference: scriptureReference, parent_note: parentNote, status: "active" };
    });
    issues.throwIfAny();

    const hashItems = (rows: typeof items) => createHash("sha256").update(rows.map((item) => [item.item_key, item.sort_order, item.section_title ?? "", item.question_zh, item.answer_zh, item.question_en, item.answer_en, item.scripture_reference ?? "", item.parent_note ?? ""].join("|")).join("\n")).digest("hex");
    const prepared = await prepareImportCollection({
      supabase, table: "catechism_collections", itemTable: "catechism_items", itemForeignKey: "collection_id",
      workspaceId: access.workspaceId, userId: user.id, expectedCount: items.length,
      fingerprint: hashItems([...items].sort((a, b) => a.sort_order - b.sort_order)), legacyFingerprint: hashItems(items),
      values: {
        submitted_for_learner_id: learnerIds[0],
        title,
        english_title: englishTitle,
        source_note: sourceNote,
        license_note: licenseNote,
      },
    });
    let collection = prepared.collection;
    if (!prepared.complete) {
      const { error: itemError } = await retryImportDatabaseCall(() => supabase.from("catechism_items")
        .upsert(items.map((item) => ({ ...item, collection_id: collection.id })), { onConflict: "collection_id,item_key", ignoreDuplicates: true }));
      checkImportWrite(itemError, "保存问答内容失败");
      const { count: directoryCount, error: directoryCountError } = await retryImportDatabaseCall(() => supabase
        .from("catechism_items").select("*", { count: "exact", head: true }).eq("collection_id", collection.id));
      checkImportWrite(directoryCountError, "核对问答目录失败");
      if (directoryCount !== items.length) throw new Error(`问答目录只保存了 ${directoryCount ?? 0}/${items.length} 问，请用同一份文件重试。`);
    }
    if (prepared.resumable) collection = await finishImportCollection(supabase, "catechism_collections", collection, access.isAdmin, canPublishNow, user.id);
    const canAssign = canPublishNow && collection.status === "published" && collection.review_status === "approved";
    if (canAssign) {
      const { error: linkError } = await supabase.from("learner_catechism_collections").upsert(learnerIds.map((learnerId) => ({
        learner_id: learnerId,
        collection_id: collection.id,
        assigned_by: user.id,
        assignment_status: "active",
        unassigned_at: null,
      })));
      checkImportWrite(linkError, "问答册已保存，但关联孩子失败");
    }

    revalidatePath("/parent");
    revalidatePath("/catechism");
    revalidatePath("/catechism/study");
    revalidatePath("/catechism/manage");
    revalidatePath("/admin/resources");
    revalidatePath("/admin/assignments");
    return { status: "success", message: prepared.complete && !prepared.resumable ? existingImportMessage(collection, canAssign, "问答册") : canAssign ? `已导入 ${items.length} 问，并关联到 ${learnerIds.length} 位孩子。` : access.isAdmin ? `已导入 ${items.length} 问为草稿；发布后再分配给孩子。` : `已提交 ${items.length} 问，等待管理员审核和分配。`, savedAt: new Date().toISOString() };
  } catch (error) {
    return failure(error);
  }
}

export async function recordCatechismAttempt(input: {
  learnerId: string;
  itemId: string;
  result: CatechismAttemptResult;
  requestId: string;
  note?: string;
}) {
  const { supabase } = await authenticatedClient();
  const { data: learner, error: learnerError } = await supabase
    .from("learner_profiles")
    .select("id,timezone")
    .eq("id", input.learnerId)
    .single();
  if (learnerError || !learner) throw new Error("找不到这个孩子档案");
  if (!/^[0-9a-f-]{36}$/i.test(input.requestId)) throw new Error("本次练习编号无效");
  const { data, error } = await supabase.rpc("record_catechism_attempt", {
    p_learner_id: input.learnerId,
    p_item_id: input.itemId,
    p_result: input.result,
    p_local_date: localDateInTimezone(learner.timezone),
    p_request_id: input.requestId,
    p_note: input.note?.trim().slice(0, 500) || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/catechism");
  revalidatePath("/catechism/study");
  return Array.isArray(data) ? data[0] : data;
}

export async function updateCatechismItem(_previousState: CatechismFormState, formData: FormData): Promise<CatechismFormState> {
  try {
    const { supabase } = await authenticatedClient();
    const itemId = String(formData.get("item_id") ?? "");
    const sortOrder = Number(formData.get("sort_order"));
    const itemKey = String(formData.get("item_key") ?? "").trim();
    const questionZh = String(formData.get("question_zh") ?? "").trim();
    const questionEn = String(formData.get("question_en") ?? "").trim();
    const answerZh = String(formData.get("answer_zh") ?? "").trim();
    const answerEn = String(formData.get("answer_en") ?? "").trim();
    if (!itemId || !questionZh || !questionEn || !answerZh || !answerEn) throw new Error("中英文问题和中英文答案都不能为空");
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(itemKey)) throw new Error("item_key 格式不正确");
    if (!Number.isInteger(sortOrder) || sortOrder < 1) throw new Error("显示顺序必须是大于 0 的整数");
    const { data: updatedItem, error } = await supabase.from("catechism_items").update({
      item_key: itemKey,
      sort_order: sortOrder,
      section_title: cleanOptional(formData.get("section_title"), 120),
      question_zh: questionZh.slice(0, 2000),
      question_en: questionEn.slice(0, 3000),
      answer_zh: answerZh.slice(0, 4000),
      answer_en: answerEn.slice(0, 6000),
      scripture_reference: cleanOptional(formData.get("scripture_reference"), 1000),
      parent_note: cleanOptional(formData.get("parent_note"), 1000),
      status: formData.get("status") === "archived" ? "archived" : "active",
      updated_at: new Date().toISOString(),
    }).eq("id", itemId).select("id").single();
    if (error || !updatedItem) throw new Error(error?.message ?? "找不到这条问答或没有修改权限");
    revalidatePath("/catechism");
    revalidatePath("/catechism/study");
    revalidatePath("/catechism/manage");
    revalidatePath(`/catechism/manage/${itemId}`);
    return { status: "success", message: "问答内容已保存，孩子下次学习时会看到新内容。", savedAt: new Date().toISOString() };
  } catch (error) {
    return failure(error);
  }
}

export async function updateCatechismCollection(_previousState: CatechismFormState, formData: FormData): Promise<CatechismFormState> {
  try {
    const { supabase, user } = await authenticatedClient();
    const access = await loadAccessContext(supabase, user.id);
    assertAdmin(access);
    const collectionId = String(formData.get("collection_id") ?? "");
    const title = String(formData.get("title") ?? "").trim().slice(0, 120);
    const status = String(formData.get("status") ?? "published");
    if (!collectionId || !title) throw new Error("问答册名称不能为空");
    if (!["draft", "published", "archived"].includes(status)) throw new Error("发布状态无效");
    const learnerIds = [...new Set(formData.getAll("learner_ids").map(String).filter(Boolean))];
    if (learnerIds.length) {
      const { data: ownedLearners, error: learnerError } = await supabase.from("learner_profiles").select("id").in("id", learnerIds);
      if (learnerError) throw new Error(learnerError.message);
      if ((ownedLearners?.length ?? 0) !== learnerIds.length) throw new Error("有孩子档案不属于当前账号");
    }
    const { data: updatedCollection, error } = await supabase.from("catechism_collections").update({
      title,
      english_title: cleanOptional(formData.get("english_title"), 180),
      source_note: cleanOptional(formData.get("source_note"), 500),
      license_note: cleanOptional(formData.get("license_note"), 500),
      status,
      updated_at: new Date().toISOString(),
    }).eq("id", collectionId).eq("workspace_id", access.workspaceId).select("id").single();
    if (error || !updatedCollection) throw new Error(error?.message ?? "找不到这份问答册或没有修改权限");
    const { data: existingLinks, error: existingError } = await supabase.from("learner_catechism_collections").select("learner_id,assignment_status").eq("collection_id", collectionId);
    if (existingError) throw new Error(existingError.message);
    const existingIds = new Set((existingLinks ?? []).filter((row: { assignment_status?: string }) => row.assignment_status !== "inactive").map((row) => row.learner_id));
    const toAdd = learnerIds.filter((id) => !existingIds.has(id));
    const toRemove = [...existingIds].filter((id) => !learnerIds.includes(id));
    if (toAdd.length) {
      if (status !== "published") throw new Error("请先发布问答册，再分配给孩子");
      const { error: addError } = await supabase.from("learner_catechism_collections").upsert(toAdd.map((learnerId) => ({ learner_id: learnerId, collection_id: collectionId, assigned_by: user.id, assignment_status: "active", unassigned_at: null })));
      if (addError) throw new Error(addError.message);
    }
    if (toRemove.length) {
      const { error: removeError } = await supabase.from("learner_catechism_collections").update({ assignment_status: "inactive", unassigned_at: new Date().toISOString() }).eq("collection_id", collectionId).in("learner_id", toRemove);
      if (removeError) throw new Error(removeError.message);
    }
    revalidatePath("/catechism");
    revalidatePath("/catechism/study");
    revalidatePath("/catechism/manage");
    return { status: "success", message: status === "published" ? "问答册已发布。" : status === "archived" ? "问答册已归档，学习历史仍然保留。" : "问答册已保存为草稿。", savedAt: new Date().toISOString() };
  } catch (error) {
    return failure(error);
  }
}
