import { NextResponse } from "next/server";
import { createR2ReadUrl } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  try {
    const { videoId } = await params;
    const url = new URL(request.url);
    const learnerId = url.searchParams.get("learner") ?? "";
    const wordId = url.searchParams.get("word") ?? "";
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const access = user ? await loadAccessContext(supabase,user.id) : null;
    if (!user || !access) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    await requireChildModule(supabase,access,user.id,learnerId,"kids_english");
    const [{ data: video }, { data: link }, { data: word }] = await Promise.all([
      supabase.from("kids_english_videos").select("object_key").eq("id",videoId).eq("workspace_id",access.workspaceId).maybeSingle(),
      supabase.from("kids_english_word_videos").select("word_id").eq("word_id",wordId).eq("video_id",videoId).maybeSingle(),
      supabase.from("kids_english_words").select("book_id").eq("id",wordId).maybeSingle(),
    ]);
    if (!video || !link || !word) return NextResponse.json({ error: "这段视频未分配给该孩子" }, { status: 403 });
    const [{ data: assignment }, { data: book }] = await Promise.all([
      supabase.from("learner_kids_english_books").select("book_id").eq("learner_id",learnerId).eq("book_id",word.book_id).eq("assignment_status","active").maybeSingle(),
      supabase.from("kids_english_books").select("status,review_status,workspace_id").eq("id",word.book_id).maybeSingle(),
    ]);
    if (!assignment || !book || book.workspace_id !== access.workspaceId || book.status !== "published" || book.review_status !== "approved") return NextResponse.json({ error: "这段视频未分配给该孩子" }, { status: 403 });
    return NextResponse.redirect(await createR2ReadUrl(video.object_key), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "视频暂不可用" }, { status: 403 }); }
}
