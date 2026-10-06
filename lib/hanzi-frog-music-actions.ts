"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";
import { deleteR2Object, headR2Object } from "@/lib/r2";

export type FrogMusicTrack = {
  id: string; title: string; source_type: "url" | "r2";
  audio_url: string | null; original_name: string | null;
};
const trackColumns = "id,title,source_type,audio_url,original_name";
const maxAudioBytes = 30 * 1024 * 1024;

function checkedAudioUrl(value: string) {
  const text = value.trim();
  if (text.length > 2048) throw new Error("音频链接太长，请使用较短的直链");
  let url: URL;
  try { url = new URL(text); } catch { throw new Error("请输入完整的 HTTPS 音频地址"); }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname ||
    url.hostname === "localhost" || url.hostname.endsWith(".local") ||
    /^\d+(?:\.\d+){3}$/.test(url.hostname) || url.hostname.includes(":")) {
    throw new Error("只能使用公开的 HTTPS 音频地址");
  }
  if (/\.(?:html?|php|aspx?)$/i.test(url.pathname)) {
    throw new Error("这是网页地址，不是可循环播放的音频直链；请填写 MP3/M4A 等音频文件地址");
  }
  return url.toString();
}

async function authorizedClient(learnerId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("请先登录");
  await requireChildModule(supabase, await loadAccessContext(supabase, user.id), user.id, learnerId, "hanzi");
  return { supabase, user };
}

export async function saveHanziFrogMusic(input: {
  learnerId: string; id?: string; title: string; audioUrl: string;
}): Promise<FrogMusicTrack> {
  const title = input.title.trim();
  if (!title || title.length > 80) throw new Error("配乐名称需为 1–80 个字");
  const audioUrl = checkedAudioUrl(input.audioUrl);
  const { supabase } = await authorizedClient(input.learnerId);
  const values = { title, audio_url: audioUrl };
  const query = input.id
    ? supabase.from("hanzi_frog_music_tracks").update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", input.id).eq("learner_id", input.learnerId).eq("source_type", "url")
    : supabase.from("hanzi_frog_music_tracks").insert({ ...values, learner_id: input.learnerId, source_type: "url" });
  const { data, error } = await query.select(trackColumns).single();
  if (error) throw new Error(`保存配乐失败：${error.message}`);
  revalidatePath("/learn/frog");
  return data as FrogMusicTrack;
}

export async function registerHanziFrogUpload(input: {
  learnerId: string; title: string; objectKey: string;
  originalName: string; contentType: string; byteSize: number;
}): Promise<FrogMusicTrack> {
  const title = input.title.trim();
  if (!title || title.length > 80) throw new Error("配乐名称需为 1–80 个字");
  const { supabase, user } = await authorizedClient(input.learnerId);
  const prefix = "hanzi-frog/" + input.learnerId + "/" + user.id + "/";
  if (!input.objectKey.startsWith(prefix) || !/^[0-9a-f-]{36}\.(mp3|m4a)$/.test(input.objectKey.slice(prefix.length))) {
    throw new Error("上传文件路径不属于当前孩子和账号");
  }
  const name = input.originalName.trim().slice(0, 255);
  const extension = input.objectKey.endsWith(".mp3") ? "mp3" : "m4a";
  const contentType = input.contentType.toLowerCase();
  if (!name.toLowerCase().endsWith("." + extension) ||
    (extension === "mp3" && contentType !== "audio/mpeg") ||
    (extension === "m4a" && !["audio/mp4", "audio/x-m4a"].includes(contentType)) ||
    !Number.isSafeInteger(input.byteSize) || input.byteSize < 1 || input.byteSize > maxAudioBytes) {
    throw new Error("文件名称、类型或大小不正确");
  }
  const { data: existing, error: existingError } = await supabase.from("hanzi_frog_music_tracks")
    .select(trackColumns).eq("object_key", input.objectKey).eq("learner_id", input.learnerId).maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return existing as FrogMusicTrack;
  const { count, error: countError } = await supabase.from("hanzi_frog_music_tracks")
    .select("id", { head: true, count: "exact" }).eq("learner_id", input.learnerId);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) >= 50) throw new Error("这位孩子的游戏配乐最多保留 50 首，请先移除不用的配乐");
  let metadata: { byteSize: number; contentType: string };
  try { metadata = await headR2Object(input.objectKey); }
  catch { throw new Error("R2 尚未找到这份音频；请确认上传完成后重试保存"); }
  if (metadata.byteSize !== input.byteSize || metadata.contentType.toLowerCase() !== contentType) {
    throw new Error("R2 文件大小或类型与所选文件不一致，请重新上传");
  }
  const { data, error } = await supabase.from("hanzi_frog_music_tracks").insert({
    learner_id: input.learnerId, title, source_type: "r2", audio_url: null,
    object_key: input.objectKey, original_name: name, content_type: contentType, byte_size: input.byteSize,
  }).select(trackColumns).single();
  if (error) throw new Error("保存 R2 配乐失败：" + error.message);
  revalidatePath("/learn/frog");
  return data as FrogMusicTrack;
}

export async function renameHanziFrogMusic(input: { learnerId: string; id: string; title: string }): Promise<FrogMusicTrack> {
  const title = input.title.trim();
  if (!title || title.length > 80) throw new Error("配乐名称需为 1–80 个字");
  const { supabase } = await authorizedClient(input.learnerId);
  const { data, error } = await supabase.from("hanzi_frog_music_tracks")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", input.id).eq("learner_id", input.learnerId).eq("source_type", "r2")
    .select(trackColumns).single();
  if (error) throw new Error("修改名称失败：" + error.message);
  revalidatePath("/learn/frog");
  return data as FrogMusicTrack;
}

export async function deleteHanziFrogMusic(input: { learnerId: string; id: string }) {
  const { supabase } = await authorizedClient(input.learnerId);
  const { data, error } = await supabase.from("hanzi_frog_music_tracks")
    .delete().eq("id", input.id).eq("learner_id", input.learnerId).select("id,source_type,object_key");
  if (error) throw new Error(`删除配乐失败：${error.message}`);
  if (!data?.length) throw new Error("配乐不存在，或你没有删除权限");
  revalidatePath("/learn/frog");
  if (data[0].source_type === "r2" && data[0].object_key?.startsWith("hanzi-frog/" + input.learnerId + "/")) {
    try { await deleteR2Object(data[0].object_key); }
    catch { return { storageCleanupOk: false }; }
  }
  return { storageCleanupOk: true };
}
