import { NextResponse } from "next/server";
import { createR2ReadUrl, isR2Configured } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const privateHeaders = { "Cache-Control": "private, no-store" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: privateHeaders });
}

// Redirect the media element directly, so playback starts in the original user
// gesture. A fresh request per track/loop renews the private R2 read URL.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const learnerId = params.get("learner") ?? "";
    const itemId = params.get("item") ?? "";
    if (!uuid.test(learnerId) || !uuid.test(itemId)) return fail("播放参数不完整", 400);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail("请先登录后播放", 401);

    // All reads retain the caller's RLS context; an arbitrary learner or asset
    // cannot be used to obtain another family's private file URL.
    const [learner, assignment, item, asset] = await Promise.all([
      supabase.from("learner_profiles").select("id").eq("id", learnerId).maybeSingle(),
      supabase.from("learner_music_items").select("item_id").eq("learner_id", learnerId).eq("item_id", itemId).eq("assignment_status", "active").maybeSingle(),
      supabase.from("music_items").select("id").eq("id", itemId).eq("item_type", "song").eq("status", "published").eq("review_status", "approved").maybeSingle(),
      supabase.from("music_assets").select("object_key").eq("item_id", itemId).eq("asset_type", "audio").order("sequence").limit(1).maybeSingle(),
    ]);
    if ([learner, assignment, item, asset].some((result) => result.error)) return fail("暂时无法读取歌曲，请稍后重试", 503);
    if (!learner.data || !assignment.data || !item.data || !asset.data) return fail("歌曲已下架、尚未上传音频，或未分配给这个孩子", 404);
    if (!isR2Configured()) return fail("音频服务尚未配置", 503);
    return NextResponse.redirect(await createR2ReadUrl(asset.data.object_key), { status: 307, headers: privateHeaders });
  } catch {
    return fail("暂时无法播放歌曲，请稍后重试", 503);
  }
}
