import { NextResponse } from "next/server";
import { createR2UploadUrl } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = user ? await loadAccessContext(supabase,user.id) : null;
    if (!user || !access?.isAdmin) return NextResponse.json({ error: "只有管理员可以上传课堂视频" }, { status: 403 });
    const body = await request.json() as { fileName?: string; contentType?: string; byteSize?: number };
    const fileName = String(body.fileName ?? "");
    const size = Number(body.byteSize ?? 0);
    if (!/\.mp4$/i.test(fileName) || body.contentType !== "video/mp4" || !Number.isFinite(size) || size < 1 || size > 200*1024*1024) return NextResponse.json({ error: "请上传不超过 200MB 的 MP4 视频" }, { status: 400 });
    const objectKey = `kids-english/${access.workspaceId}/${user.id}/${crypto.randomUUID()}.mp4`;
    const uploadUrl = await createR2UploadUrl({ objectKey, contentType: "video/mp4" });
    return NextResponse.json({ uploadUrl, objectKey });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "无法生成上传地址" }, { status: 500 }); }
}
