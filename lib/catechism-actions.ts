"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { localDateInTimezone, type CatechismAttemptResult } from "@/lib/catechism";
import type { CatechismFormState } from "@/lib/catechism-form-state";

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录家长账号");
  return { supabase, user };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === "," && !quoted) { row.push(cell.trim()); cell = ""; continue; }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += character;
  }
  if (quoted) throw new Error("CSV 中有未闭合的双引号");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function value(record: Record<string, string>, key: string) {
  return (record[key] ?? "").trim().replace(/\\n/g, "\n");
}

function cleanOptional(input: FormDataEntryValue | null, limit: number) {
  return String(input ?? "").trim().slice(0, limit) || null;
}

function failure(error: unknown): CatechismFormState {
  return { status: "error", message: error instanceof Error ? error.message : "操作失败，请稍后再试" };
}

export async function importCatechismCollection(_previousState: CatechismFormState, formData: FormData): Promise<CatechismFormState> {
  try {
    const { supabase, user } = await authenticatedClient();
    const learnerIds = [...new Set(formData.getAll("learner_ids").map(String).filter(Boolean))];
    const title = String(formData.get("collection_title") ?? "儿童信仰问答").trim().slice(0, 120);
    const englishTitle = cleanOptional(formData.get("english_title"), 180);
    const sourceNote = cleanOptional(formData.get("source_note"), 500);
    const licenseNote = cleanOptional(formData.get("license_note"), 500);
    const publishNow = formData.get("publish_now") === "on";
    const file = formData.get("catechism_csv_file");
    if (!title) throw new Error("请填写问答册名称");
    if (!learnerIds.length) throw new Error("请至少选择一位孩子");
    if (!(file instanceof File) || file.size === 0) throw new Error("请选择要理问答 CSV 文件");
    if (file.size > 3_000_000) throw new Error("CSV 请控制在 3MB 内");

    const { data: ownedLearners, error: learnerError } = await supabase
      .from("learner_profiles")
      .select("id")
      .eq("parent_user_id", user.id)
      .in("id", learnerIds);
    if (learnerError) throw new Error(learnerError.message);
    if ((ownedLearners?.length ?? 0) !== learnerIds.length) throw new Error("有孩子档案不属于当前家长账号");

    const rows = parseCsv(await file.text());
    if (rows.length < 2) throw new Error("CSV 至少应包含表头和一条问答");
    if (rows.length > 501) throw new Error("一次最多导入 500 条问答");
    const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
    for (const required of ["item_key", "sequence", "question_zh", "question_en", "answer_zh", "answer_en"]) {
      if (!headers.includes(required)) throw new Error(`CSV 缺少必填列：${required}`);
    }

    const keys = new Set<string>();
    const sequences = new Set<number>();
    const items = rows.slice(1).map((cells, index) => {
      const record = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]));
      const itemKey = value(record, "item_key");
      const sequence = Number(value(record, "sequence"));
      const questionZh = value(record, "question_zh");
      const questionEn = value(record, "question_en");
      const answerZh = value(record, "answer_zh");
      const answerEn = value(record, "answer_en");
      const sectionTitle = value(record, "section") || null;
      const scriptureReference = value(record, "scripture_reference") || null;
      const parentNote = value(record, "parent_note") || null;
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(itemKey)) throw new Error(`第 ${index + 2} 行：item_key 只能使用字母、数字、下划线或短横线`);
      if (!Number.isInteger(sequence) || sequence < 1) throw new Error(`第 ${index + 2} 行：sequence 必须是大于 0 的整数`);
      if (!questionZh || !questionEn || !answerZh || !answerEn) throw new Error(`第 ${index + 2} 行：中英文问题和中英文答案都不能为空`);
      if (questionZh.length > 2000 || questionEn.length > 3000 || answerZh.length > 4000 || answerEn.length > 6000) throw new Error(`第 ${index + 2} 行：问题或答案超过长度限制`);
      if ((sectionTitle?.length ?? 0) > 120 || (scriptureReference?.length ?? 0) > 1000 || (parentNote?.length ?? 0) > 1000) throw new Error(`第 ${index + 2} 行：章节、经文或备注超过长度限制`);
      if (keys.has(itemKey)) throw new Error(`第 ${index + 2} 行：item_key“${itemKey}”重复`);
      if (sequences.has(sequence)) throw new Error(`第 ${index + 2} 行：sequence“${sequence}”重复`);
      keys.add(itemKey);
      sequences.add(sequence);
      return { item_key: itemKey, sort_order: sequence, section_title: sectionTitle, question_zh: questionZh, question_en: questionEn, answer_zh: answerZh, answer_en: answerEn, scripture_reference: scriptureReference, parent_note: parentNote, status: "active" };
    });

    const { data: collection, error: collectionError } = await supabase
      .from("catechism_collections")
      .insert({
        created_by: user.id,
        code: `catechism-${crypto.randomUUID()}`,
        title,
        english_title: englishTitle,
        source_note: sourceNote,
        license_note: licenseNote,
        status: "draft",
      })
      .select("id")
      .single();
    if (collectionError || !collection) throw new Error(collectionError?.message ?? "创建问答册失败");
    const { error: itemError } = await supabase.from("catechism_items").insert(items.map((item) => ({ ...item, collection_id: collection.id })));
    if (itemError) throw new Error(itemError.message);
    const { error: linkError } = await supabase.from("learner_catechism_collections").insert(learnerIds.map((learnerId) => ({ learner_id: learnerId, collection_id: collection.id })));
    if (linkError) throw new Error(`问答册已创建，但关联孩子失败：${linkError.message}`);
    if (publishNow) {
      const { error: publishError } = await supabase.from("catechism_collections").update({ status: "published", updated_at: new Date().toISOString() }).eq("id", collection.id);
      if (publishError) throw new Error(`内容已作为草稿导入，但发布失败：${publishError.message}`);
    }

    revalidatePath("/parent");
    revalidatePath("/catechism");
    revalidatePath("/catechism/study");
    revalidatePath("/catechism/manage");
    return { status: "success", message: `已导入 ${items.length} 问，并关联到 ${learnerIds.length} 位孩子。`, savedAt: new Date().toISOString() };
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
  const { supabase, user } = await authenticatedClient();
  const { data: learner, error: learnerError } = await supabase
    .from("learner_profiles")
    .select("id,timezone")
    .eq("id", input.learnerId)
    .eq("parent_user_id", user.id)
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
    const collectionId = String(formData.get("collection_id") ?? "");
    const title = String(formData.get("title") ?? "").trim().slice(0, 120);
    const status = String(formData.get("status") ?? "published");
    if (!collectionId || !title) throw new Error("问答册名称不能为空");
    if (!["draft", "published", "archived"].includes(status)) throw new Error("发布状态无效");
    const learnerIds = [...new Set(formData.getAll("learner_ids").map(String).filter(Boolean))];
    if (learnerIds.length) {
      const { data: ownedLearners, error: learnerError } = await supabase.from("learner_profiles").select("id").eq("parent_user_id", user.id).in("id", learnerIds);
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
    }).eq("id", collectionId).eq("created_by", user.id).select("id").single();
    if (error || !updatedCollection) throw new Error(error?.message ?? "找不到这份问答册或没有修改权限");
    const { data: existingLinks, error: existingError } = await supabase.from("learner_catechism_collections").select("learner_id").eq("collection_id", collectionId);
    if (existingError) throw new Error(existingError.message);
    const existingIds = new Set((existingLinks ?? []).map((row) => row.learner_id));
    const toAdd = learnerIds.filter((id) => !existingIds.has(id));
    const toRemove = [...existingIds].filter((id) => !learnerIds.includes(id));
    if (toAdd.length) {
      const { error: addError } = await supabase.from("learner_catechism_collections").insert(toAdd.map((learnerId) => ({ learner_id: learnerId, collection_id: collectionId })));
      if (addError) throw new Error(addError.message);
    }
    if (toRemove.length) {
      const { error: removeError } = await supabase.from("learner_catechism_collections").delete().eq("collection_id", collectionId).in("learner_id", toRemove);
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
