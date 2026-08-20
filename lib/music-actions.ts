"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { deleteR2Object } from "@/lib/r2";
import { registerActivityReward } from "@/lib/reward-service";
import { loadAccessContext } from "@/lib/access";

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

function musicFingerprint(input: { itemType: string; title: string; category?: string | null; description?: string | null; lyrics?: string | null; correctAnswer?: string | null; instructions?: string | null; difficulty?: number }) {
  const normalized = [input.itemType, input.title, input.category, input.description, input.lyrics, input.correctAnswer, input.instructions, input.difficulty ?? 1]
    .map((value) => String(value ?? "").trim())
    .join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

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
  const access = await loadAccessContext(supabase, user.id);
  if (!access) throw new Error("当前账号还没有学习空间");
  const { data: item, error } = await supabase.from("music_items").select("id,item_type,title,status,review_status,created_by").eq("id", itemId).eq("workspace_id", access.workspaceId).single();
  if (item && !access.isAdmin && item.created_by !== user.id) throw new Error("只能维护自己提交的音乐内容");
  if (error || !item) throw new Error("找不到这条音乐内容，或当前账号无权管理");
  return { supabase, user, access, item };
}

function assertRootMutable(access: { isAdmin: boolean }, item: { status: string; review_status: string }) {
  if (!access.isAdmin && !(item.status === "draft" && ["draft", "pending_review", "rejected"].includes(item.review_status))) {
    throw new Error("这份内容已由管理员发布，当前只能查看");
  }
}

function assertMediaMutable(access: { isAdmin: boolean }, item: { status: string; review_status: string }) {
  if (!access.isAdmin && !(item.status === "draft" && ["draft", "pending_review"].includes(item.review_status))) {
    throw new Error("请先保存文字资料并重新提交审核，再修改媒体文件");
  }
}

export async function createMusicItem(formData: FormData) {
  const { supabase, user } = await authenticatedMusicClient();
  const access = await loadAccessContext(supabase, user.id);
  if (!access) throw new Error("当前账号还没有学习空间");
  const title = String(formData.get("title") ?? "").trim().slice(0, 100);
  const itemType = musicType(formData.get("item_type"));
  const submittedForLearnerId = String(formData.get("submitted_for_learner_id") ?? "") || null;
  if (!title) throw new Error("请填写内容名称");
  if (!access.isAdmin) {
    if (!submittedForLearnerId) throw new Error("请选择建议分配的孩子");
    const { data: learner, error: learnerError } = await supabase.from("learner_profiles").select("id").eq("id", submittedForLearnerId).single();
    if (learnerError || !learner) throw new Error("找不到这个孩子档案");
  }
  const { data, error } = await supabase.from("music_items").insert({
    created_by: user.id,
    workspace_id: access.workspaceId,
    submitted_for_learner_id: submittedForLearnerId,
    item_type: itemType,
    title,
    fingerprint: musicFingerprint({ itemType, title }),
    status: "draft",
    review_status: access.isAdmin ? "approved" : "pending_review",
    approved_by: access.isAdmin ? user.id : null,
    approved_at: access.isAdmin ? new Date().toISOString() : null,
  }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "创建失败");
  revalidatePath("/music/manage");
  redirect(`/music/manage/${data.id}`);
}

export async function updateMusicItem(_previousState: MusicSaveState, formData: FormData): Promise<MusicSaveState> {
  try {
    const itemId = String(formData.get("item_id") ?? "");
    const { supabase, user, access, item } = await ownedMusicItem(itemId);
    assertRootMutable(access, item);
    const title = String(formData.get("title") ?? "").trim().slice(0, 100);
    const category = String(formData.get("category") ?? "").trim().slice(0, 60) || null;
    const description = String(formData.get("description") ?? "").trim().slice(0, 500) || null;
    const lyrics = String(formData.get("lyrics") ?? "").trim().slice(0, 12000) || null;
    const correctAnswer = String(formData.get("correct_answer") ?? "").trim().slice(0, 100) || null;
    const instructions = String(formData.get("instructions") ?? "").trim().slice(0, 2000) || null;
    const difficulty = Math.max(1, Math.min(5, Number(formData.get("difficulty") ?? 1) || 1));
    const requestedStatusInput = String(formData.get("status") ?? "draft");
    const requestedStatus = access.isAdmin ? requestedStatusInput : "draft";
    if (!title) throw new Error("内容名称不能为空");
    if (!["draft", "published", "archived"].includes(requestedStatusInput)) throw new Error("发布状态不正确");
    if (item.item_type === "instrument" && !correctAnswer) throw new Error("辨声音内容必须填写正确乐器名称");

    const submittedLearnerIds = access.isAdmin ? [...new Set(formData.getAll("learner_ids").map(String).filter(Boolean))] : [];
    const requestedLearnerIds = requestedStatus === "published" ? submittedLearnerIds : [];
    const [{ data: ownedLearners, error: learnerError }, { data: currentAssignments, error: assignmentReadError }] = await Promise.all([
      submittedLearnerIds.length
        ? supabase.from("learner_profiles").select("id").in("id", submittedLearnerIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("learner_music_items").select("learner_id,assignment_status").eq("item_id", itemId),
    ]);
    if (learnerError) throw new Error(learnerError.message);
    if (assignmentReadError) throw new Error(assignmentReadError.message);
    if ((ownedLearners?.length ?? 0) !== submittedLearnerIds.length) throw new Error("孩子分配信息不正确");

    const currentLearnerIds = new Set((currentAssignments ?? []).filter((assignment) => assignment.assignment_status === "active").map((assignment) => assignment.learner_id));
    const requestedLearnerIdSet = new Set(requestedLearnerIds);
    const learnerIdsToAdd = requestedLearnerIds.filter((learnerId) => !currentLearnerIds.has(learnerId));
    const learnerIdsToRemove = [...currentLearnerIds].filter((learnerId) => !requestedLearnerIdSet.has(learnerId));
    const savedAt = new Date().toISOString();
    // 先保存并确认发布状态，再顺序更新分配，避免并发请求读到旧的“草稿”状态。
    const updateResult = await supabase.from("music_items").update({
      title, category, description, lyrics, correct_answer: correctAnswer, instructions, difficulty,
      fingerprint: musicFingerprint({ itemType: item.item_type, title, category, description, lyrics, correctAnswer, instructions, difficulty }),
      status: requestedStatus,
      review_status: access.isAdmin ? "approved" : "pending_review",
      updated_at: savedAt,
    }).eq("id", itemId).select("status,updated_at").single();
    if (updateResult.error || !updateResult.data) throw new Error(updateResult.error?.message ?? "内容资料没有成功写入数据库");
    if (learnerIdsToRemove.length) {
      const { error } = await supabase.from("learner_music_items").update({ assignment_status: "inactive", unassigned_at: savedAt })
        .eq("item_id", itemId).in("learner_id", learnerIdsToRemove);
      if (error) throw new Error(error.message);
    }
    if (learnerIdsToAdd.length) {
      const { error } = await supabase.from("learner_music_items").upsert(learnerIdsToAdd.map((learnerId) => ({
        learner_id: learnerId, item_id: itemId, assigned_by: user.id, assignment_status: "active", unassigned_at: null,
      })));
      if (error) throw new Error(error.message);
    }

    const savedStatus = updateResult.data.status as MusicItemStatus;
    revalidatePath("/music");
    revalidatePath("/music/manage");
    revalidatePath(`/music/manage/${itemId}`);
    return { status: "success", message: access.isAdmin ? `已保存为“${savedStatus === "published" ? "已发布" : savedStatus === "archived" ? "已归档" : "草稿"}”` : "已保存并提交管理员审核", savedStatus, savedAt: updateResult.data.updated_at };
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
  const { supabase, user, access, item } = await ownedMusicItem(input.itemId);
  assertMediaMutable(access, item);
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
  const { supabase, access, item } = await ownedMusicItem(itemId);
  assertMediaMutable(access, item);
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
  const { supabase, access, item } = await ownedMusicItem(itemId);
  assertRootMutable(access, item);
  if (access.isAdmin && !access.isOwner) throw new Error("普通管理员可以归档内容，但只有 owner 可以永久删除");
  const [{ count: assignmentCount }, { count: stateCount }, { count: attemptCount }] = await Promise.all([
    supabase.from("learner_music_items").select("learner_id", { count: "exact", head: true }).eq("item_id", itemId),
    supabase.from("music_learning_states").select("id", { count: "exact", head: true }).eq("item_id", itemId),
    supabase.from("music_practice_attempts").select("id", { count: "exact", head: true }).eq("item_id", itemId),
  ]);
  if ((stateCount ?? 0) > 0 || (attemptCount ?? 0) > 0) throw new Error("这条音乐已有孩子学习历史，只能归档，不能永久删除");
  if ((assignmentCount ?? 0) > 0) throw new Error("这条音乐仍有孩子分配。重复内容请到“管理中心 → 资源”使用安全合并，其他情况请先取消分配");
  const { data: assets, error: assetError } = await supabase.from("music_assets").select("object_key").eq("item_id", itemId);
  if (assetError) throw new Error(assetError.message);
  for (const asset of assets ?? []) await deleteR2Object(asset.object_key);
  const { error } = await supabase.from("music_items").delete().eq("id", itemId);
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
  const { data: attempt, error: attemptError } = await supabase
    .from("music_practice_attempts")
    .select("id")
    .eq("request_id", input.requestId)
    .eq("learner_id", input.learnerId)
    .single();
  const activityType = input.result.startsWith("song_")
    ? "song"
    : input.result.startsWith("instrument_")
      ? "instrument"
      : "rhythm";
  const reward = attemptError || !attempt
    ? null
    : await registerActivityReward(supabase, {
      learnerId: input.learnerId,
      activityType,
      sourceRecordId: attempt.id,
    });
  revalidatePath("/music");
  revalidatePath(`/music/${input.itemId}`);
  revalidatePath("/rewards");
  return {
    ...(data as { next_stage?: number; next_due_at?: string; idempotent?: boolean }),
    reward,
  };
}
