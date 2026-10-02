import { academicCommand, academicData } from "@/lib/adult-academic-server";
import { adultContext } from "@/lib/adult-server";
import { loadAccessContext } from "@/lib/access";
import { requireAccountModule } from "@/lib/module-access";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
const headers = { "Cache-Control": "private, no-store" };
function message(error: unknown) {
  const raw=error instanceof Error?error.message:"操作未完成，请重试";
  return /成人模块尚未升级完成|could not find the table.*adult_academic_|relation .*adult_academic_.* does not exist|function .*adult_academic_.* does not exist/i.test(raw)
    ? "专业英语数据库尚未升级完成：请先在同一 Supabase 项目完整运行 supabase/028_adult_academic_english.sql，再刷新页面。"
    : raw;
}

async function authorizedContext() {
  const ctx = await adultContext();
  await requireAccountModule(ctx.db, await loadAccessContext(ctx.db, ctx.user.id), ctx.user.id, "adult_english");
  return ctx;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return Response.json(await academicData(await authorizedContext(),url.searchParams.get("profile"),url.searchParams.get("source")),{headers});
  } catch(e) { return Response.json({error:message(e)},{status:400,headers}); }
}

export async function POST(request: Request) {
  try {
    const origin=request.headers.get("origin");
    if(origin && new URL(origin).host!==request.headers.get("host")) return Response.json({error:"请求来源无效"},{status:403,headers});
    const raw=await request.text(); if(raw.length>350000) throw new Error("正文过长，请按课拆分导入");
    const b=JSON.parse(raw);
    return Response.json(await academicCommand(await authorizedContext(),String(b.action),b),{headers});
  } catch(e) { return Response.json({error:message(e)},{status:400,headers}); }
}
