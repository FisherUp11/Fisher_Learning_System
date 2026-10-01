"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireAccountModule, requireChildModule } from "@/lib/module-access";
import { checkLength, checkSequence, ImportIssues, readCsvUpload, readImportTable } from "@/lib/csv-import";

export type KidsEnglishFeedback = { status: "success" | "error"; message: string; details?: string[] };
const failed = (error: unknown): KidsEnglishFeedback => ({ status: "error", message: error instanceof Error ? error.message : "操作失败" });

async function session() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录");
  const access = await loadAccessContext(supabase, user.id);
  if (!access) throw new Error("尚未加入学习空间");
  return { supabase, user, access };
}

export async function importKidsEnglishBook(formData: FormData): Promise<KidsEnglishFeedback> {
  try {
    const { supabase, user, access } = await session();
    if (!access.isAdmin) await requireAccountModule(supabase, access, user.id, "kids_english");
    const title = String(formData.get("title") ?? "").trim();
    const learnerId = String(formData.get("learner_id") ?? "") || null;
    if (!title || title.length > 120) throw new Error("请填写 1～120 字的字册名称");
    const text = await readCsvUpload(formData.get("csv_file"), 2_000_000);
    const table = readImportTable(text, "kids_english", 500);
    const issues = new ImportIssues();
    const seenWords = new Map<string, number>();
    const seenSequence = new Map<number, number>();
    const words = table.map((row, index) => {
      const word = row.get("word").normalize("NFKC").trim();
      const phonetic = row.get("phonetic");
      const meaning_zh = row.get("meaning_zh");
      const example_en = row.get("example_en");
      const example_zh = row.get("example_zh");
      const part_of_speech = row.get("part_of_speech");
      const sequence = checkSequence(issues, row, index + 1, seenSequence);
      if (!/^[a-zA-Z][a-zA-Z '-]*$/.test(word)) issues.add(row.line, "单词请使用英文字母、空格、连字符或撇号");
      if (!phonetic || !meaning_zh || !example_en) issues.add(row.line, "音标、中文意思和英文例句不能为空");
      if (!/[a-zA-Z]/.test(example_en)) issues.add(row.line, "英文例句需要包含英文单词");
      for (const [label, value, max] of [["单词",word,100],["音标",phonetic,100],["中文意思",meaning_zh,300],["英文例句",example_en,500],["例句中文",example_zh,500],["词性",part_of_speech,40]] as const) checkLength(issues,row,label,value,max);
      const key = word.toLowerCase();
      if (seenWords.has(key)) issues.add(row.line, `单词“${word}”与第 ${seenWords.get(key)} 行重复`);
      else seenWords.set(key,row.line);
      return { word, phonetic, meaning_zh, example_en, example_zh, part_of_speech, sequence };
    });
    issues.throwIfAny();
    const fingerprint = createHash("sha256").update(JSON.stringify(words.map((word) => [word.word.toLowerCase(),word.phonetic,word.meaning_zh,word.example_en]))).digest("hex");
    const { error } = await supabase.rpc("import_kids_english_book", {
      p_workspace_id: access.workspaceId, p_learner_id: learnerId, p_title: title, p_fingerprint: fingerprint, p_rows: words,
    });
    if (error) throw new Error(error.code === "23505" ? "同一份单词册已经导入，系统没有再次创建。" : error.message);
    revalidatePath("/kids-english/manage");
    revalidatePath("/admin/resources");
    revalidatePath("/admin/assignments");
    return { status: "success", message: `${title} 已导入 ${words.length} 个单词。${access.isAdmin ? learnerId ? "已分配给所选孩子。" : "请到管理中心分配给孩子。" : "请等待管理员审核并分配。"}` };
  } catch (error) { return failed(error); }
}

export async function answerKidsEnglishWord(input: { learnerId: string; wordId: string; result: "known" | "again"; assisted: boolean; requestId: string }) {
  const { supabase, user, access } = await session();
  await requireChildModule(supabase, access, user.id, input.learnerId, "kids_english");
  const { data, error } = await supabase.rpc("answer_kids_english_word", {
    p_learner_id: input.learnerId, p_word_id: input.wordId, p_result: input.result,
    p_assisted: input.assisted, p_request_id: input.requestId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/kids-english");
  revalidatePath("/kids-english/library");
  return data as { passed?: boolean; remaining?: number; idempotent?: boolean };
}

export async function registerKidsEnglishVideo(input: { title: string; objectKey: string; originalName: string; contentType: string; byteSize: number }): Promise<KidsEnglishFeedback> {
  try {
    const { supabase, user, access } = await session();
    if (!access.isAdmin) throw new Error("只有管理员可以维护课堂视频");
    if (!input.objectKey.startsWith(`kids-english/${access.workspaceId}/${user.id}/`) || input.contentType !== "video/mp4" || input.byteSize < 1 || input.byteSize > 200 * 1024 * 1024) throw new Error("视频参数无效");
    const title = input.title.trim().slice(0,120);
    if (!title) throw new Error("请填写视频名称");
    const { error } = await supabase.from("kids_english_videos").insert({ workspace_id: access.workspaceId, title, object_key: input.objectKey, original_name: input.originalName.slice(0,255), content_type: input.contentType, byte_size: input.byteSize, created_by: user.id });
    if (error) throw new Error(error.message);
    revalidatePath("/kids-english/manage");
    return { status: "success", message: `视频“${title}”已保存，可勾选单词关联。` };
  } catch (error) { return failed(error); }
}

export async function linkKidsEnglishVideo(formData: FormData): Promise<KidsEnglishFeedback> {
  try {
    const { supabase, access } = await session();
    if (!access.isAdmin) throw new Error("只有管理员可以关联视频与单词");
    const bookId = String(formData.get("book_id") ?? "");
    const videoId = String(formData.get("video_id") ?? "");
    const wordIds = [...new Set(formData.getAll("word_ids").map(String))];
    if (!bookId || !videoId || !wordIds.length || wordIds.length > 500) throw new Error("请先选择视频和至少一个单词");
    const [{ data: book }, { data: video }, { data: words }] = await Promise.all([
      supabase.from("kids_english_books").select("id").eq("id",bookId).eq("workspace_id",access.workspaceId).maybeSingle(),
      supabase.from("kids_english_videos").select("id").eq("id",videoId).eq("workspace_id",access.workspaceId).maybeSingle(),
      supabase.from("kids_english_words").select("id").eq("book_id",bookId).in("id",wordIds),
    ]);
    if (!book || !video || words?.length !== wordIds.length) throw new Error("视频或单词不在当前学习空间");
    const { error } = await supabase.from("kids_english_word_videos").upsert(wordIds.map((wordId) => ({ word_id: wordId, video_id: videoId })), { onConflict: "word_id,video_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    revalidatePath("/kids-english");
    revalidatePath("/kids-english/manage");
    return { status: "success", message: `已将视频关联到 ${wordIds.length} 个单词；重复关联会自动忽略。` };
  } catch (error) { return failed(error); }
}

export async function updateKidsEnglishWord(formData: FormData): Promise<KidsEnglishFeedback> {
  try {
    const { supabase, access } = await session();
    if (!access.isAdmin) throw new Error("只有管理员可以修正单词");
    const wordId = String(formData.get("word_id") ?? "");
    const bookId = String(formData.get("book_id") ?? "");
    const { data: book } = await supabase.from("kids_english_books").select("id").eq("id",bookId).eq("workspace_id",access.workspaceId).maybeSingle();
    if (!book) throw new Error("找不到这份字册");
    const patch = Object.fromEntries(["word","phonetic","meaning_zh","example_en","example_zh","part_of_speech"].map((key) => [key, String(formData.get(key) ?? "").trim()]));
    if (!patch.word || !patch.phonetic || !patch.meaning_zh || !patch.example_en) throw new Error("单词、音标、中文意思和英文例句不能为空");
    const { error } = await supabase.from("kids_english_words").update(patch).eq("id",wordId).eq("book_id",bookId);
    if (error) throw new Error(error.message);
    revalidatePath("/kids-english/manage");
    revalidatePath("/kids-english/library");
    return { status: "success", message: "单词资料已修正；孩子的学习记录不变。" };
  } catch (error) { return failed(error); }
}
