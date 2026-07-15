"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type Learner = {
  id: string;
  display_name: string;
  daily_new_limit: number;
  active_package_id: string | null;
};

export type QueueItem = {
  session_item_id: string;
  session_id: string;
  queue_position: number;
  queue_kind: "new" | "review" | "carry" | "new_reinforcement" | "error_reinforcement";
  character_id: string;
  hanzi: string;
  pinyin_marked: string;
  meaning: string;
  word_one: string | null;
  word_two: string | null;
  example_sentence: string | null;
  stage: number;
  due_at: string | null;
};

async function authenticatedClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录家长账号");
  return { supabase, user };
}

function normalizeDailyNewLimit(value: FormDataEntryValue | null) {
  const parsed = Number(value ?? 5);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(50, Math.floor(parsed))) : 5;
}

export async function loadTodayQueue(learnerId: string): Promise<QueueItem[]> {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase.rpc("get_today_queue", { p_learner_id: learnerId });
  if (error) throw new Error(error.message);
  return (data ?? []) as QueueItem[];
}

export async function answerQueueItem(input: {
  learnerId: string;
  sessionItemId: string;
  result: "known" | "again";
  requestId: string;
}) {
  const { supabase } = await authenticatedClient();
  const { data, error } = await supabase.rpc("answer_queue_item", {
    p_learner_id: input.learnerId,
    p_session_item_id: input.sessionItemId,
    p_result: input.result,
    p_request_id: input.requestId,
  });
  if (error) throw new Error(error.message);
  return data as { next_stage?: number; next_due_at?: string; reinforcement_added?: boolean; pending_count?: number; idempotent?: boolean };
}

export async function createLearner(formData: FormData) {
  const { supabase, user } = await authenticatedClient();
  const displayName = String(formData.get("display_name") ?? "").trim().slice(0, 24);
  const dailyNewLimit = normalizeDailyNewLimit(formData.get("daily_new_limit"));
  if (!displayName) throw new Error("请填写孩子昵称");

  const { error } = await supabase.from("learner_profiles").insert({
    parent_user_id: user.id,
    display_name: displayName,
    daily_new_limit: dailyNewLimit,
    timezone: "Asia/Shanghai",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/learn");
  revalidatePath("/parent");
}

export async function updateLearnerSettings(formData: FormData) {
  const { supabase, user } = await authenticatedClient();
  const learnerId = String(formData.get("learner_id") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim().slice(0, 24);
  const dailyNewLimit = normalizeDailyNewLimit(formData.get("daily_new_limit"));
  if (!learnerId || !displayName) throw new Error("孩子昵称不能为空");

  const { error } = await supabase
    .from("learner_profiles")
    .update({ display_name: displayName, daily_new_limit: dailyNewLimit })
    .eq("id", learnerId)
    .eq("parent_user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/learn");
  revalidatePath("/parent");
}

export async function deleteLearnerAndCurrentLibrary(formData: FormData) {
  const { supabase, user } = await authenticatedClient();
  const learnerId = String(formData.get("learner_id") ?? "");
  if (!learnerId) throw new Error("缺少孩子档案");

  const { data: learner, error: learnerError } = await supabase
    .from("learner_profiles")
    .select("id,display_name,active_package_id")
    .eq("id", learnerId)
    .eq("parent_user_id", user.id)
    .single();
  if (learnerError || !learner) throw new Error("找不到这个孩子档案");

  const packageId = learner.active_package_id;
  const { data: packageCharacters, error: charactersError } = packageId
    ? await supabase.from("package_characters").select("character_id").eq("package_id", packageId)
    : { data: [], error: null };
  if (charactersError) throw new Error(charactersError.message);

  const { data: otherPackageUsers, error: otherUsersError } = packageId
    ? await supabase
      .from("learner_profiles")
      .select("id")
      .eq("parent_user_id", user.id)
      .eq("active_package_id", packageId)
      .neq("id", learnerId)
    : { data: [], error: null };
  if (otherUsersError) throw new Error(otherUsersError.message);

  // 先删孩子，让外键级联清除每日队列、学习状态和回答历史。
  const { error: deleteLearnerError } = await supabase
    .from("learner_profiles")
    .delete()
    .eq("id", learnerId)
    .eq("parent_user_id", user.id);
  if (deleteLearnerError) throw new Error(deleteLearnerError.message);

  // 当前字册没有被其他孩子使用时，同时移除字册和其中已无引用的汉字内容。
  if (packageId && (otherPackageUsers?.length ?? 0) === 0) {
    const characterIds = (packageCharacters ?? []).map((item) => item.character_id);
    const { error: deletePackageError } = await supabase
      .from("content_packages")
      .delete()
      .eq("id", packageId)
      .eq("created_by", user.id);
    if (deletePackageError) throw new Error(deletePackageError.message);

    if (characterIds.length > 0) {
      const { data: stillUsed, error: stillUsedError } = await supabase
        .from("package_characters")
        .select("character_id")
        .in("character_id", characterIds);
      if (stillUsedError) throw new Error(stillUsedError.message);
      const usedIds = new Set((stillUsed ?? []).map((item) => item.character_id));
      const orphanIds = characterIds.filter((id) => !usedIds.has(id));
      if (orphanIds.length > 0) {
        const { error: deleteCharactersError } = await supabase
          .from("characters")
          .delete()
          .eq("created_by", user.id)
          .in("id", orphanIds);
        if (deleteCharactersError) throw new Error(deleteCharactersError.message);
      }
    }
  }

  revalidatePath("/learn");
  revalidatePath("/library");
  revalidatePath("/parent");
}

async function getOwnedLearner(learnerId: string) {
  const { supabase, user } = await authenticatedClient();
  if (!learnerId) throw new Error("请选择孩子");

  const { data: learner, error } = await supabase
    .from("learner_profiles")
    .select("id")
    .eq("id", learnerId)
    .eq("parent_user_id", user.id)
    .single();
  if (error || !learner) throw new Error("找不到这个孩子档案");
  return { supabase, user };
}

async function assertCharacterInLearnerLibrary(supabase: Awaited<ReturnType<typeof createClient>>, learnerId: string, characterId: string, packageId?: string) {
  const { data: links, error: linksError } = await supabase
    .from("learner_content_packages")
    .select("package_id")
    .eq("learner_id", learnerId);
  if (linksError || !links?.length) throw new Error("找不到这个孩子的字库归属，请先运行 006 数据库脚本");
  const allowedPackageIds = packageId ? [packageId] : links.map((link) => link.package_id);
  if (packageId && !links.some((link) => link.package_id === packageId)) throw new Error("这个字册不属于该孩子");
  const { data: membership, error: membershipError } = await supabase
    .from("package_characters")
    .select("character_id")
    .in("package_id", allowedPackageIds)
    .eq("character_id", characterId)
    .maybeSingle();
  if (membershipError || !membership) throw new Error("这个字不在该孩子的字库中");
}

export async function updateCharacterContent(formData: FormData) {
  const learnerId = String(formData.get("learner_id") ?? "");
  const characterId = String(formData.get("character_id") ?? "");
  const pinyinMarked = String(formData.get("pinyin_marked") ?? "").trim().slice(0, 40);
  const meaning = String(formData.get("meaning") ?? "").trim().slice(0, 100);
  const wordOne = String(formData.get("word_one") ?? "").trim().slice(0, 100) || null;
  const wordTwo = String(formData.get("word_two") ?? "").trim().slice(0, 100) || null;
  const exampleSentence = String(formData.get("example_sentence") ?? "").trim().slice(0, 300) || null;
  if (!characterId || !pinyinMarked || !meaning) throw new Error("拼音和释义不能为空");

  const { supabase, user } = await getOwnedLearner(learnerId);
  await assertCharacterInLearnerLibrary(supabase, learnerId, characterId);

  const { error } = await supabase
    .from("characters")
    .update({ pinyin_marked: pinyinMarked, meaning, word_one: wordOne, word_two: wordTwo, example_sentence: exampleSentence })
    .eq("id", characterId)
    .eq("created_by", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/library");
  revalidatePath("/learn");
}

export async function removeCharacterFromCurrentPackage(formData: FormData) {
  const learnerId = String(formData.get("learner_id") ?? "");
  const characterId = String(formData.get("character_id") ?? "");
  const packageId = String(formData.get("package_id") ?? "");
  if (!characterId || !packageId) throw new Error("请先选择要管理的具体字册");

  const { supabase } = await getOwnedLearner(learnerId);
  await assertCharacterInLearnerLibrary(supabase, learnerId, characterId, packageId);
  const { data: sessions, error: sessionsError } = await supabase
    .from("daily_sessions")
    .select("id")
    .eq("learner_id", learnerId);
  if (sessionsError) throw new Error(sessionsError.message);

  const sessionIds = (sessions ?? []).map((session) => session.id);
  if (sessionIds.length > 0) {
    const { error: pendingError } = await supabase
      .from("daily_session_items")
      .delete()
      .in("session_id", sessionIds)
      .eq("character_id", characterId)
      .eq("status", "pending");
    if (pendingError) throw new Error(pendingError.message);
  }

  const { error } = await supabase
    .from("package_characters")
    .delete()
    .eq("package_id", packageId)
    .eq("character_id", characterId);
  if (error) throw new Error(error.message);
  revalidatePath("/library");
  revalidatePath("/learn");
  revalidatePath("/parent");
}

type ParsedCharacter = {
  character: string;
  pinyin_marked: string;
  meaning: string;
  word_one: string | null;
  word_two: string | null;
  example_sentence: string | null;
  sequence: number;
};

type ParsedPoem = {
  poem_key: string;
  title: string;
  author: string;
  dynasty: string | null;
  content: string;
  sequence: number;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = ""; continue;
    }
    cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function pick(record: Record<string, string>, key: string) {
  return (record[key] ?? "").trim();
}

export async function importCharacters(formData: FormData) {
  const { supabase, user } = await authenticatedClient();
  const learnerId = String(formData.get("learner_id") ?? "");
  const title = String(formData.get("package_title") ?? "学前识字包").trim().slice(0, 60);
  const file = formData.get("csv_file");
  if (!learnerId || !(file instanceof File) || file.size === 0) throw new Error("请选择孩子并上传 CSV 文件");
  if (file.size > 2_000_000) throw new Error("CSV 请控制在 2MB 内");

  const rows = parseCsv(await file.text());
  if (rows.length < 2) throw new Error("CSV 至少应包含表头和一行汉字");
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  for (const required of ["character", "pinyin_marked", "meaning"]) {
    if (!headers.includes(required)) throw new Error(`CSV 缺少必填列：${required}`);
  }
  const seen = new Set<string>();
  const characters: ParsedCharacter[] = rows.slice(1).map((cells, index) => {
    const record = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]));
    const character = pick(record, "character");
    const pinyinMarked = pick(record, "pinyin_marked");
    const meaning = pick(record, "meaning");
    if (!/^[\u3400-\u9fff]$/u.test(character)) throw new Error(`第 ${index + 2} 行：character 必须是一个汉字`);
    if (!pinyinMarked || !meaning) throw new Error(`第 ${index + 2} 行：拼音和释义不能为空`);
    if (seen.has(character)) throw new Error(`第 ${index + 2} 行：汉字“${character}”重复`);
    seen.add(character);
    const suppliedSequence = Number(pick(record, "sequence"));
    return {
      character,
      pinyin_marked: pinyinMarked,
      meaning,
      word_one: pick(record, "word_1") || null,
      word_two: pick(record, "word_2") || null,
      example_sentence: pick(record, "example_sentence") || null,
      sequence: Number.isFinite(suppliedSequence) && suppliedSequence > 0 ? Math.floor(suppliedSequence) : index + 1,
    };
  });

  const { data: learner, error: learnerError } = await supabase
    .from("learner_profiles")
    .select("id")
    .eq("id", learnerId)
    .eq("parent_user_id", user.id)
    .single();
  if (learnerError || !learner) throw new Error("找不到这个孩子档案");

  const code = `package-${Date.now()}`;
  const { data: packageRow, error: packageError } = await supabase
    .from("content_packages")
    .insert({ created_by: user.id, code, title, status: "published" })
    .select("id")
    .single();
  if (packageError || !packageRow) throw new Error(packageError?.message ?? "创建学习包失败");

  const imported: Array<{ id: string; character: string }> = [];
  for (let index = 0; index < characters.length; index += 100) {
    const batch = characters.slice(index, index + 100);
    const { data, error } = await supabase
      .from("characters")
      .upsert(batch.map((item) => ({
        created_by: user.id,
        character: item.character,
        pinyin_marked: item.pinyin_marked,
        meaning: item.meaning,
        word_one: item.word_one,
        word_two: item.word_two,
        example_sentence: item.example_sentence,
      })), { onConflict: "created_by,character" })
      .select("id,character");
    if (error) throw new Error(error.message);
    imported.push(...(data ?? []));
  }
  const idsByCharacter = new Map(imported.map((item) => [item.character, item.id]));
  const joins = characters.map((item) => ({ package_id: packageRow.id, character_id: idsByCharacter.get(item.character), sequence: item.sequence }));
  if (joins.some((item) => !item.character_id)) throw new Error("导入后无法找到部分汉字，请重新上传");
  const { error: joinError } = await supabase.from("package_characters").insert(joins);
  if (joinError) throw new Error(joinError.message);

  const { error: packageLinkError } = await supabase
    .from("learner_content_packages")
    .insert({ learner_id: learnerId, package_id: packageRow.id });
  if (packageLinkError) throw new Error(`字册已创建，但无法关联到孩子：${packageLinkError.message}`);

  const { error: updateError } = await supabase
    .from("learner_profiles")
    .update({ active_package_id: packageRow.id })
    .eq("id", learnerId)
    .eq("parent_user_id", user.id);
  if (updateError) throw new Error(updateError.message);
  revalidatePath("/learn");
  revalidatePath("/parent");
  revalidatePath("/library");
}

export async function importPoems(formData: FormData) {
  const { supabase, user } = await authenticatedClient();
  const learnerId = String(formData.get("learner_id") ?? "");
  const title = String(formData.get("poem_collection_title") ?? "第一批古诗词").trim().slice(0, 80);
  const file = formData.get("poem_csv_file");
  if (!learnerId || !(file instanceof File) || file.size === 0) throw new Error("请选择孩子并上传诗词 CSV 文件");
  if (!title) throw new Error("请填写诗词册名称");
  if (file.size > 2_000_000) throw new Error("CSV 请控制在 2MB 内");

  const rows = parseCsv(await file.text());
  if (rows.length < 2) throw new Error("CSV 至少应包含表头和一首诗词");
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").trim());
  for (const required of ["poem_key", "title", "author", "content"]) {
    if (!headers.includes(required)) throw new Error(`CSV 缺少必填列：${required}`);
  }

  const seen = new Set<string>();
  const poems: ParsedPoem[] = rows.slice(1).map((cells, index) => {
    const record = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ""]));
    const poemKey = pick(record, "poem_key");
    const poemTitle = pick(record, "title");
    const author = pick(record, "author");
    const dynasty = pick(record, "dynasty") || null;
    const content = pick(record, "content").replace(/\\n/g, "\n");
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(poemKey)) throw new Error(`第 ${index + 2} 行：poem_key 只能使用字母、数字、下划线或短横线`);
    if (!poemTitle || !author || !content) throw new Error(`第 ${index + 2} 行：标题、作者和正文不能为空`);
    if (poemTitle.length > 80 || author.length > 50 || (dynasty?.length ?? 0) > 30 || content.length > 4000) throw new Error(`第 ${index + 2} 行：有字段超过长度限制`);
    if (seen.has(poemKey)) throw new Error(`第 ${index + 2} 行：poem_key“${poemKey}”重复`);
    seen.add(poemKey);
    const suppliedSequence = Number(pick(record, "sequence"));
    return {
      poem_key: poemKey,
      title: poemTitle,
      author,
      dynasty,
      content,
      sequence: Number.isFinite(suppliedSequence) && suppliedSequence > 0 ? Math.floor(suppliedSequence) : index + 1,
    };
  });

  const { data: learner, error: learnerError } = await supabase
    .from("learner_profiles")
    .select("id")
    .eq("id", learnerId)
    .eq("parent_user_id", user.id)
    .single();
  if (learnerError || !learner) throw new Error("找不到这个孩子档案");

  const { data: collection, error: collectionError } = await supabase
    .from("poem_collections")
    .insert({ created_by: user.id, code: `poems-${Date.now()}`, title, status: "published" })
    .select("id")
    .single();
  if (collectionError || !collection) throw new Error(collectionError?.message ?? "创建诗词册失败");

  const imported: Array<{ id: string; poem_key: string }> = [];
  for (let index = 0; index < poems.length; index += 100) {
    const batch = poems.slice(index, index + 100);
    const { data, error } = await supabase
      .from("poems")
      .upsert(batch.map((poem) => ({
        created_by: user.id,
        poem_key: poem.poem_key,
        title: poem.title,
        author: poem.author,
        dynasty: poem.dynasty,
        content: poem.content,
        updated_at: new Date().toISOString(),
      })), { onConflict: "created_by,poem_key" })
      .select("id,poem_key");
    if (error) throw new Error(error.message);
    imported.push(...(data ?? []));
  }
  const idsByKey = new Map(imported.map((poem) => [poem.poem_key, poem.id]));
  const items = poems.map((poem) => ({ collection_id: collection.id, poem_id: idsByKey.get(poem.poem_key), sequence: poem.sequence }));
  if (items.some((item) => !item.poem_id)) throw new Error("导入后无法找到部分诗词，请重新上传");
  const { error: itemError } = await supabase.from("poem_collection_items").insert(items);
  if (itemError) throw new Error(itemError.message);

  const { error: linkError } = await supabase
    .from("learner_poem_collections")
    .insert({ learner_id: learnerId, collection_id: collection.id });
  if (linkError) throw new Error(`诗词册已创建，但无法关联到孩子：${linkError.message}`);

  revalidatePath("/parent");
  revalidatePath("/poems");
}

function localDateInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function recordPoemRecitation(formData: FormData) {
  const { supabase, user } = await authenticatedClient();
  const learnerId = String(formData.get("learner_id") ?? "");
  const poemId = String(formData.get("poem_id") ?? "");
  const scoreValue = String(formData.get("score") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 300) || null;
  if (!learnerId || !poemId) throw new Error("缺少孩子或诗词信息");
  const score = scoreValue ? Number(scoreValue) : null;
  if (score !== null && (!Number.isInteger(score) || score < 1 || score > 10)) throw new Error("掌握评分请选择 1–10 分，或暂不评分");

  const { data: learner, error: learnerError } = await supabase
    .from("learner_profiles")
    .select("id,timezone")
    .eq("id", learnerId)
    .eq("parent_user_id", user.id)
    .single();
  if (learnerError || !learner) throw new Error("找不到这个孩子档案");

  const { data: collections, error: collectionsError } = await supabase
    .from("learner_poem_collections")
    .select("collection_id")
    .eq("learner_id", learnerId);
  if (collectionsError || !collections?.length) throw new Error("找不到这个孩子的诗词册，请先运行 008 数据库脚本并导入诗词");
  const { data: membership, error: membershipError } = await supabase
    .from("poem_collection_items")
    .select("poem_id")
    .in("collection_id", collections.map((item) => item.collection_id))
    .eq("poem_id", poemId)
    .limit(1);
  if (membershipError || !membership?.length) throw new Error("这首诗不属于该孩子的诗词册");

  const { error } = await supabase.from("poem_recitation_attempts").insert({
    learner_id: learnerId,
    poem_id: poemId,
    recorded_by: user.id,
    recited_local_date: localDateInTimezone(learner.timezone),
    score,
    note,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/poems");
  revalidatePath(`/poems/${poemId}`);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
