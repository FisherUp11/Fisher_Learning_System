"use server";

import { revalidatePath } from "next/cache";
import { loadAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

function normalizeVideoUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2000) throw new Error("视频链接太长，请使用小鹅通分享链接。");
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error("请填写完整的 https:// 小鹅通视频链接。"); }
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.h5\.xiaoeknow\.com$/i.test(url.hostname) || !url.pathname.startsWith("/p/course/video/")) {
    throw new Error("目前仅支持小鹅通 H5 视频课程链接；请从视频页复制分享地址。");
  }
  return url.toString();
}

export async function savePoemVideoLink(formData: FormData) {
  try {
    const poemId = String(formData.get("poem_id") ?? "");
    const rawUrl = String(formData.get("music_video_url") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(poemId)) throw new Error("诗词编号无效。");
    const musicVideoUrl = normalizeVideoUrl(rawUrl);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("请先登录家长账号。");
    const access = await loadAccessContext(supabase, user.id);
    if (!access?.isAdmin) throw new Error("只有学习空间管理员可以维护诗词视频链接。");

    const { data: poem, error: lookupError } = await supabase.from("poems")
      .select("id,title").eq("id", poemId).eq("workspace_id", access.workspaceId).maybeSingle();
    if (lookupError || !poem) throw new Error("找不到当前学习空间的这首诗。");
    const { data: saved, error: saveError } = await supabase.from("poems")
      .update({ music_video_url: musicVideoUrl, updated_at: new Date().toISOString() })
      .eq("id", poemId).eq("workspace_id", access.workspaceId).select("id").maybeSingle();
    if (saveError) throw new Error(saveError.message.includes("music_video_url") ? "请先在 Supabase 运行 033_poem_music_video_links.sql。" : saveError.message);
    if (!saved) throw new Error("链接没有保存成功，请检查诗词管理权限后重试。");
    revalidatePath(`/poems/${poemId}`);
    return { status: "success", message: musicVideoUrl ? `《${poem.title}》的音乐视频入口已保存。` : `已移除《${poem.title}》的视频入口。` };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "保存视频链接失败。" };
  }
}
