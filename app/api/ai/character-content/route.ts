import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Input = { character?: string; pinyin?: string; meaning?: string };

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await request.json()) as Input;
  const character = body.character?.trim() ?? "";
  const pinyin = body.pinyin?.trim() ?? "";
  const meaning = body.meaning?.trim() ?? "";
  if (!/^[\u3400-\u9fff]$/u.test(character) || !pinyin || !meaning) {
    return NextResponse.json({ error: "请提供一个汉字、拼音和基础释义" }, { status: 400 });
  }

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "");
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
  if (!endpoint || !apiKey || !deployment || !apiVersion) {
    return NextResponse.json({ error: "Azure OpenAI 未配置" }, { status: 503 });
  }

  const prompt = [
    "你是一位中国学前儿童识字内容编辑。只返回 JSON，不要 Markdown。",
    "基于给定的规范资料，生成一条自然、积极、适龄、20 个汉字以内的例句和一条 18 字以内的联想提示。",
    "不得编造拼音、字义、古诗出处，不得包含危险、成人、恐惧、商业或歧视内容。",
    `汉字：${character}；拼音：${pinyin}；基础释义：${meaning}`,
    'JSON 格式：{"example_sentence":"", "association_tip":""}',
  ].join("\n");

  const response = await fetch(`${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }], temperature: 0.35, max_tokens: 180, response_format: { type: "json_object" } }),
  });
  if (!response.ok) return NextResponse.json({ error: "AI 内容服务暂不可用" }, { status: 502 });
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return NextResponse.json({ error: "AI 未返回可用内容" }, { status: 502 });
  try {
    return NextResponse.json(JSON.parse(content));
  } catch {
    return NextResponse.json({ error: "AI 返回格式异常" }, { status: 502 });
  }
}
