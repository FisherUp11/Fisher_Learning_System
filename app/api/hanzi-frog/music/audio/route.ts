import { NextResponse } from "next/server";
import { createR2ReadUrl, isR2Configured } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store" };
function fail(error: string, status: number) { return NextResponse.json({ error }, { status, headers }); }

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const learnerId = params.get("learner") ?? "";
    const trackId = params.get("track") ?? "";
    if (!uuid.test(learnerId) || !uuid.test(trackId)) return fail("播放参数不完整", 400);
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail("请先登录后播放", 401);
    await requireChildModule(supabase, await loadAccessContext(supabase, user.id), user.id, learnerId, "hanzi");
    const { data: track, error } = await supabase.from("hanzi_frog_music_tracks")
      .select("object_key").eq("id", trackId).eq("learner_id", learnerId).eq("source_type", "r2").maybeSingle();
    if (error) return fail("暂时无法读取配乐", 503);
    if (!track?.object_key || !track.object_key.startsWith(`hanzi-frog/${learnerId}/`)) return fail("配乐不存在或无权播放", 404);
    if (!isR2Configured()) return fail("音频服务尚未配置", 503);
    return NextResponse.redirect(await createR2ReadUrl(track.object_key), { status: 307, headers });
  } catch { return fail("暂时无法播放配乐", 503); }
}
