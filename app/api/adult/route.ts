import { adultCommand, adultContext, loadAdultData } from "@/lib/adult-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return Response.json(await loadAdultData(await adultContext(), url.searchParams.get("area") ?? "exercise", url.searchParams.get("profile")), { headers });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "暂时无法加载，请重试" }, { status: 400, headers }); }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host")) return Response.json({ error: "请求来源无效" }, { status: 403, headers });
    const raw = await request.text();
    if (raw.length > 350000) throw new Error("请求内容太大，请分段导入");
    const body = JSON.parse(raw);
    return Response.json(await adultCommand(await adultContext(), String(body.action), body), { headers });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "操作未完成，请重试" }, { status: 400, headers }); }
}
