import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeXml(value: string) {
  return value.replace(/[<>&'\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char] ?? char);
}

async function synthesize(text: string, slow: boolean, language: "zh" | "en") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!text || text.length > 6000) return NextResponse.json({ error: "朗读文本无效" }, { status: 400 });
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) return NextResponse.json({ error: "Azure Speech 未配置" }, { status: 503 });

  const locale = language === "en" ? "en-US" : "zh-CN";
  const voice = language === "en"
    ? process.env.AZURE_SPEECH_EN_VOICE || "en-US-JennyNeural"
    : process.env.AZURE_SPEECH_ZH_VOICE || "zh-CN-XiaoxiaoNeural";
  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3", "User-Agent": "ziya-hanzi-learning" },
    body: `<speak version="1.0" xml:lang="${locale}"><voice xml:lang="${locale}" name="${escapeXml(voice)}">${slow ? `<prosody rate="-22%">${escapeXml(text)}</prosody>` : escapeXml(text)}</voice></speak>`,
  });
  if (!response.ok) return NextResponse.json({ error: "语音服务暂不可用" }, { status: 502 });
  return new Response(await response.arrayBuffer(), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return synthesize(url.searchParams.get("text")?.trim() ?? "", url.searchParams.get("slow") === "1", url.searchParams.get("lang") === "en" ? "en" : "zh");
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { text?: unknown; slow?: unknown; lang?: unknown };
    return synthesize(typeof body.text === "string" ? body.text.trim() : "", body.slow === true, body.lang === "en" ? "en" : "zh");
  } catch {
    return NextResponse.json({ error: "朗读请求格式无效" }, { status: 400 });
  }
}
