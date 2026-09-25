import { adultContext } from "@/lib/adult-server";
import { lessonDetail, listeningData } from "@/lib/english-listening-server";
export const dynamic = "force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(request:Request) {
  try { const url=new URL(request.url),ctx=await adultContext(); return Response.json(url.searchParams.has("lesson")?await lessonDetail(ctx,url.searchParams.get("lesson")!):await listeningData(ctx,url.searchParams.get("profile")),{headers}); }
  catch(e) { const message=e instanceof Error?e.message:"加载失败"; return Response.json({error:message.includes("019_parent_growth")||message.includes("format_version")?"请先运行 019，再运行 supabase/020_english_listening_courses.sql，刷新后重试。":message},{status:400,headers}); }
}
