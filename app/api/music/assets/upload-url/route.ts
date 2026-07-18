import { NextResponse } from "next/server";
import { createR2UploadUrl, safeR2FileName } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const audioTypes = new Set(["audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav"]);
const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const audioAssets = new Set(["audio", "demo_audio"]);
const imageAssets = new Set(["cover", "score", "instrument_image", "rhythm_sheet"]);
const assetsByItemType: Record<string, Set<string>> = {
  song: new Set(["audio", "cover", "score"]),
  instrument: new Set(["audio", "instrument_image"]),
  rhythm: new Set(["demo_audio", "rhythm_sheet"]),
};
const singletonAssets = new Set(["audio", "cover", "instrument_image", "rhythm_sheet", "demo_audio"]);

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const body = await request.json() as { itemId?: string; assetType?: string; fileName?: string; contentType?: string; byteSize?: number };
    const itemId = String(body.itemId ?? "");
    const assetType = String(body.assetType ?? "");
    const fileName = String(body.fileName ?? "").slice(0, 255);
    const contentType = String(body.contentType ?? "").toLowerCase();
    const byteSize = Number(body.byteSize ?? 0);
    if (!itemId || !fileName || (!audioAssets.has(assetType) && !imageAssets.has(assetType))) return NextResponse.json({ error: "上传参数不完整" }, { status: 400 });
    const isAudio = audioAssets.has(assetType);
    if ((isAudio && !audioTypes.has(contentType)) || (!isAudio && !imageTypes.has(contentType))) return NextResponse.json({ error: isAudio ? "请上传 MP3、M4A、AAC 或 WAV 音频" : "请上传 JPG、PNG 或 WebP 图片" }, { status: 400 });
    const maxSize = isAudio ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
    if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > maxSize) return NextResponse.json({ error: isAudio ? "音频请控制在 100MB 内" : "图片请控制在 10MB 内" }, { status: 400 });
    const { data: item, error } = await supabase.from("music_items").select("id,item_type").eq("id", itemId).eq("created_by", user.id).single();
    if (error || !item) return NextResponse.json({ error: "无权管理这条音乐内容" }, { status: 403 });
    if (!assetsByItemType[item.item_type]?.has(assetType)) return NextResponse.json({ error: "这种媒体不属于当前内容类型" }, { status: 400 });
    const { data: existing, error: existingError } = await supabase.from("music_assets").select("asset_type").eq("item_id", itemId);
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
    const sameTypeCount = (existing ?? []).filter((asset) => asset.asset_type === assetType).length;
    if (singletonAssets.has(assetType) && sameTypeCount > 0) return NextResponse.json({ error: "这个位置已有文件，请先删除再上传" }, { status: 409 });
    if (assetType === "score" && sameTypeCount >= 5) return NextResponse.json({ error: "每首歌曲最多维护 5 张琴谱" }, { status: 409 });
    const objectKey = `music/${user.id}/${itemId}/${assetType}/${safeR2FileName(fileName)}`;
    const uploadUrl = await createR2UploadUrl({ objectKey, contentType });
    return NextResponse.json({ uploadUrl, objectKey });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法生成上传地址" }, { status: 500 });
  }
}
