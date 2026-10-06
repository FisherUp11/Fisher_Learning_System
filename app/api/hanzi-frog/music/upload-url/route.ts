import { NextResponse } from "next/server";
import { createR2UploadUrl, isR2Configured, safeR2FileName } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";

export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxBytes = 30 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const body = await request.json() as { learnerId?: string; fileName?: string; contentType?: string; byteSize?: number };
    const learnerId = String(body.learnerId ?? "");
    const fileName = String(body.fileName ?? "").slice(0, 255);
    const contentType = String(body.contentType ?? "").toLowerCase();
    const byteSize = Number(body.byteSize ?? 0);
    if (!uuid.test(learnerId)) return NextResponse.json({ error: "孩子档案无效" }, { status: 400 });
    const extension = fileName.toLowerCase().match(/\.(mp3|m4a)$/)?.[1];
    if (!extension || (extension === "mp3" && contentType !== "audio/mpeg") ||
      (extension === "m4a" && !["audio/mp4", "audio/x-m4a"].includes(contentType))) {
      return NextResponse.json({ error: "请上传 MP3 或 M4A 音频文件" }, { status: 400 });
    }
    if (!Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > maxBytes) {
      return NextResponse.json({ error: "音频文件请控制在 30MB 内" }, { status: 400 });
    }
    await requireChildModule(supabase, await loadAccessContext(supabase, user.id), user.id, learnerId, "hanzi");
    const { data: learner, error } = await supabase.from("learner_profiles").select("id").eq("id", learnerId).maybeSingle();
    if (error || !learner) return NextResponse.json({ error: "无权给这位孩子上传配乐" }, { status: 403 });
    if (!isR2Configured()) return NextResponse.json({ error: "R2 尚未配置，请检查服务器环境变量" }, { status: 503 });
    const objectKey = `hanzi-frog/${learnerId}/${user.id}/${safeR2FileName(fileName)}`;
    const uploadUrl = await createR2UploadUrl({ objectKey, contentType });
    return NextResponse.json({ uploadUrl, objectKey }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法生成上传地址" }, { status: 500 });
  }
}
