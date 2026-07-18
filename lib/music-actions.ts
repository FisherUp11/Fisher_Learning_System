"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteR2Object } from "@/lib/r2";

export type MusicItemType = "song" | "instrument" | "rhythm";
export type MusicItemStatus = "draft" | "published" | "archived";
export type MusicPracticeResult =
  | "song_listened" | "song_sang_along" | "song_prompted" | "song_independent"
  | "instrument_known" | "instrument_again" | "rhythm_known" | "rhythm_again";

export type MusicSaveState = {
  status: "idle" | "success" | "error";
  message: string;
  savedStatus?: MusicItemStatus;
  savedAt?: string;
};

async function authenticatedMusicClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录家长账号");
  return { supabase, user };
}

function musicType(value: FormDataEntryValue | null): MusicItemType {
  const type = String(value ?? "");
  if (!(["song", "instrument", "rhythm"] as string[]).includes(type)) throw new Error("请选择正确的音乐内容类型");
  return type as MusicItemType;
}

async function ownedMusicItem(itemId: string) {
  const { supabase, user } = await authenticatedMusicClient();
  const { data: item, error } = await supabase.from("music_items").select("id,item_type,title,status").eq("id", itemId).eq("created_by", user.id).single();
  if (error || !item) throw new Error("找不到这条音乐内容，或当前账号无权管理");
  return { supabase, user, item };
}

export async function createMusicItem(formData: FormData) {
  const { supabase, user } = await authenticatedMusicClient();
  const title = String(formData.get("title") ?? "").trim().slice(0, 100);
  const itemType = musicType(formData.get("item_type"));
  if (!title) throw new Error("请填写内容名称");
  const { data, error } = await supabase.from("music_items").insert({ created_by: user.id, item_type: itemType, title, status: "draft" }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "创建失败");
  revalidatePath("/music/manage");
  redirect(`/music/manage/${data.id}`);
}

export async function updateMusicItem(_previousState: MusicSaveState, formData: FormData): Promise<MusicSaveState> {
  try {
    const itemId = String(formData.get("item_id") ?? "");
    const { supabase, user, item } = await ownedMusicItem(itemId);
    const title = String(formData.get("title") ?? "").trim().slice(0, 100);
    const category = String(formData.get("category") ?? "").trim().slice(0, 60) || null;
    const description = String(formData.get("description") ?? "").trim().slice(0, 500) || null;
    const lyrics = String(formData.get("lyrics") ?? "").trim().slice(0, 12000) || null;
    const correctAnswer = String(formData.get("correct_answer") ?? "").trim().slice(0, 100) || null;
    const instructions = String(formData.get("instructions") ?? "").trim().slice(0, 2000) || null;
    const difficulty = Math.max(1, Math.min(5, Number(formData.get("difficulty") ?? 1) || 1));
    const requestedStatus = String(formData.get("status") ?? "draft");
    if (!title) throw new Error("内容名称不能为空");
    if (!["draft", "published", "archived"].includes(requestedStatus)) throw new Error("发布状态不正确");
    if (item.item_type === "instrument" && !correctAnswer) throw new Error("辨声音内容必须填写正确乐器名称");

    const requestedLearnerIds = [...new Set(formData.getAll("learner_ids").map(String).filter(Boolean))];
    const [{ data: ownedLearners, error: learnerError }, { data: currentAssignments, error: assignmentReadError }] = await Promise.all([
      requestedLearnerIds.length
        ? supabase.from("learner_profiles").select("id").eq("parent_user_id", user.id).in("id", requestedLearnerIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("learner_music_items").select("learner_id").eq("item_id", itemId),
    ]);
    if (learnerError) throw new Error(learnerError.message);
    if (assignmentReadError) throw new Error(assignmentReadError.message);
    if ((ownedLearners?.length ?? 0) !== requestedLearnerIds.length) throw new Error("孩子分配信息不正确");

    const currentLearnerIds = new Set((currentAssignments ?? []).map((assignment) => assignment.learner_id));
    const requestedLearnerIdSet = new Set(requestedLearnerIds);
    const learnerIdsToAdd = requestedLearnerIds.filter((learnerId) => !currentLearnerIds.has(learnerId));
    const learnerIdsToRemove = [...currentLearnerIds].filter((learnerId) => !requestedLearnerIdSet.has(learnerId));
    const savedAt = new Date().toISOString();
    const [updateResult, removeResult, addResult] = await Promise.all([
      supabase.from("music_items").update({
        title, category, description, lyrics, correct_answer: correctAnswer, instructions, difficulty, status: requestedStatus, updated_at: savedAt,
      }).eq("id", itemId).eq("created_by", user.id).select("status,updated_at").single(),
      learnerIdsToRemove.length
        ? supabase.from("learner_music_items").delete().eq("item_id", itemId).in("learner_id", learnerIdsToRemove)
        : Promise.resolve({ error: null }),
      learnerIdsToAdd.length
        ? supabase.from("learner_music_items").insert(learnerIdsToAdd.map((learnerId) => ({ learner_id: learnerId, item_id: itemId })))
        : Promise.resolve({ error: null }),
    ]);
    if (updateResult.error || !updateResult.data) throw new Error(updateResult.error?.message ?? "内容资料没有成功写入数据库");
    if (removeResult.error) throw new Error(removeResult.error.message);
    if (addResult.error) throw new Error(addResult.error.message);

    const savedStatus = updateResult.data.status as MusicItemStatus;
    revalidatePath("/music");
    revalidatePath("/music/manage");
    revalidatePath(`/music/manage/${itemId}`);
    return { status: "success", message: `已保存为“${savedStatus === "published" ? "已发布" : savedStatus === "archived" ? "已归档" : "草稿"}”`, savedStatus, savedAt: updateResult.data.updated_at };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "保存失败，请稍后再试" };
  }
}

export async function registerMusicAsset(input: {
  itemId: string;
  assetType: string;
  objectKey: string;
  originalName: string;
  contentType: string;
  byteSize: number;
  label?: string;
}) {
  const { supabase, user, item } = await ownedMusicItem(input.itemId);
  const allowedAssets = ["audio", "cover", "score", "instrument_image", "rhythm_sheet", "demo_audio"];
  if (!allowedAssets.includes(input.assetType)) throw new Error("媒体类型不正确");
  const allowedForItem: Record<MusicItemType, string[]> = {
    song: ["audio", "cover", "score"],
    instrument: ["audio", "instrument_image"],
    rhythm: ["demo_audio", "rhythm_sheet"],
  };
  if (!allowedForItem[item.item_type as MusicItemType].includes(input.assetType)) throw new Error("这种媒体不属于当前内容类型");
  if (!input.objectKey.startsWith(`music/${user.id}/${input.itemId}/`)) throw new Error("媒体文件路径不属于当前内容");
  if (!Number.isFinite(input.byteSize) || input.byteSize <= 0 || input.byteSize > 104_857_600) throw new Error("文件大小不正确");
  const { data: existing, error: existingError } = await supabase.from("music_assets").select("id,asset_type,sequence").eq("item_id", input.itemId).order("sequence", { ascending: false });
  if (existingError) throw new Error(existingError.message);
  if (input.assetType === "score" && (existing ?? []).filter((asset) => asset.asset_type === "score").length >= 5) throw new Error("每首歌曲最多维护 5 张琴谱");
  if (["audio", "cover", "instrument_image", "rhythm_sheet", "demo_audio"].includes(input.assetType) && (existing ?? []).some((asset) => asset.asset_type === input.assetType)) throw new Error("这个位置已有文件，请先删除再上传新文件");
  const nextSequence = Math.max(0, ...(existing ?? []).filter((asset) => asset.asset_type === input.assetType).map((asset) => asset.sequence)) + 1;
  const { error } = await supabase.from("music_assets").insert({
    item_id: input.itemId,
    asset_type: input.assetType,
    object_key: input.objectKey,
    original_name: input.originalName.slice(0, 255),
    content_type: input.contentType.slice(0, 100),
    byte_size: Math.floor(input.byteSize),
    label: input.label?.trim().slice(0, 60) || null,
    sequence: nextSequence,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/music/manage/${input.itemId}`);
  revalidatePath(`/music/${input.itemId}`);
}

export async function deleteMusicAsset(formData: FormData) {
  const assetId = String(formData.get("asset_id") ?? "");
  const itemId = String(formData.get("item_id") ?? "");
  const { supabase } = await ownedMusicItem(itemId);
  const { data: asset, error: assetError } = await supabase.from("music_assets").select("id,object_key").eq("id", assetId).eq("item_id", itemId).single();
  if (assetError || !asset) throw new Error("找不到要删除的媒体文件");
  await deleteR2Object(asset.object_key);
  const { error } = await supabase.from("music_assets").delete().eq("id", assetId).eq("item_id", itemId);
  if (error) throw new Error(error.message);
  revalidatePath(`/music/manage/${itemId}`);
  revalidatePath(`/music/${itemId}`);
}

export async function deleteMusicItem(formData: FormData) {
  const itemId = String(formData.get("item_id") ?? "");
  const { supabase, user } = await ownedMusicItem(itemId);
  const { data: assets, error: assetError } = await supabase.from("music_assets").select("object_key").eq("item_id", itemId);
  if (assetError) throw new Error(assetError.message);
  for (const asset of assets ?? []) await deleteR2Object(asset.object_key);
  const { error } = await supabase.from("music_items").delete().eq("id", itemId).eq("created_by", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/music");
  revalidatePath("/music/manage");
  redirect("/music/manage");
}

export async function recordMusicPractice(input: { learnerId: string; itemId: string; result: MusicPracticeResult; guessNote?: string; requestId: string }) {
  const { supabase } = await authenticatedMusicClient();
  const { data, error } = await supabase.rpc("record_music_practice", {
    p_learner_id: input.learnerId,
    p_item_id: input.itemId,
    p_result: input.result,
    p_guess_note: input.guessNote?.trim().slice(0, 300) || null,
    p_request_id: input.requestId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/music");
  revalidatePath(`/music/${input.itemId}`);
  return data as { next_stage?: number; next_due_at?: string; idempotent?: boolean };
}
