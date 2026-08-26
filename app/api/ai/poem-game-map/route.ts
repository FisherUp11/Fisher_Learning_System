import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PoemMapBlueprint } from "@/lib/poem-game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROMPT_VERSION = "v1";
const allowedWeather = new Set<PoemMapBlueprint["weather"]>(["petals", "stars", "ripples", "dust", "fireflies", "snow"]);

type Input = { learnerId?: string; poemId?: string };
type CachedRow = { blueprint: PoemMapBlueprint; generator: string };

function safeBlueprint(value: unknown): Omit<PoemMapBlueprint, "source"> | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const palette = Array.isArray(row.palette) ? row.palette.map(String) : [];
  const tags = Array.isArray(row.tags) ? row.tags.map(String).filter(Boolean).slice(0, 4) : [];
  const landmarks = Array.isArray(row.landmarks) ? row.landmarks.map(String).filter(Boolean).slice(0, 4) : [];
  const weather = String(row.weather ?? "") as PoemMapBlueprint["weather"];
  if (!String(row.name ?? "").trim() || !String(row.brief ?? "").trim() || tags.length < 2 || landmarks.length < 2) return null;
  if (palette.length !== 4 || palette.some((color) => !/^#[0-9a-f]{6}$/i.test(color)) || !allowedWeather.has(weather)) return null;
  return {
    name: String(row.name).trim().slice(0, 20),
    brief: String(row.brief).trim().slice(0, 100),
    tags: tags.map((tag) => tag.slice(0, 10)),
    palette: palette as [string, string, string, string],
    landmarks: landmarks.map((item) => item.slice(0, 10)),
    weather,
  };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: Input;
  try {
    body = await request.json() as Input;
  } catch {
    return NextResponse.json({ error: "地图请求格式无效" }, { status: 400 });
  }
  const learnerId = body.learnerId?.trim() ?? "";
  const poemId = body.poemId?.trim() ?? "";
  if (!learnerId || !poemId) return NextResponse.json({ error: "缺少孩子或诗词信息" }, { status: 400 });

  const { data: learner } = await supabase.from("learner_profiles").select("id").eq("id", learnerId).maybeSingle();
  if (!learner) return NextResponse.json({ error: "找不到这个孩子档案" }, { status: 403 });
  const { data: links, error: linksError } = await supabase.from("learner_poem_collections").select("collection_id").eq("learner_id", learnerId).eq("assignment_status", "active");
  if (linksError || !links?.length) return NextResponse.json({ error: "孩子还没有诗词册" }, { status: 403 });
  const { data: membership } = await supabase.from("poem_collection_items").select("poem_id").in("collection_id", links.map((item) => item.collection_id)).eq("poem_id", poemId).limit(1);
  if (!membership?.length) return NextResponse.json({ error: "这首诗没有分配给该孩子" }, { status: 403 });

  const { data: poem, error: poemError } = await supabase.from("poems").select("id,title,author,dynasty,content").eq("id", poemId).maybeSingle();
  if (poemError || !poem) return NextResponse.json({ error: "找不到诗词内容" }, { status: 404 });

  const { data: cached } = await supabase.from("poem_game_maps").select("blueprint,generator").eq("poem_id", poemId).eq("prompt_version", PROMPT_VERSION).maybeSingle() as { data: CachedRow | null };
  const cachedBlueprint = safeBlueprint(cached?.blueprint);
  if (cachedBlueprint) return NextResponse.json({ blueprint: { ...cachedBlueprint, source: cached?.generator === "azure_openai" ? "ai" : "procedural" }, cached: true });

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "");
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
  if (!endpoint || !apiKey || !deployment || !apiVersion) {
    return NextResponse.json({ blueprint: null, source: "procedural", reason: "Azure OpenAI 未配置" });
  }

  const prompt = [
    "你是儿童诗词游戏的安全场景设计师。只返回 JSON，不要 Markdown。",
    "根据诗意设计一张温暖、非写实战争、无恐惧元素的二维坦克练习地图。坦克只击散‘遗忘迷雾’，不得出现人物受伤、武器细节或危险指引。",
    "name 8字以内；brief 45字以内；tags 3个；landmarks 3个；palette 必须是4个柔和的六位十六进制色；weather 只能从 petals,stars,ripples,dust,fireflies,snow 中选择。",
    `诗词：${poem.dynasty ? `${poem.dynasty}·` : ""}${poem.author}《${poem.title}》`,
    `正文：${poem.content}`,
    '{"name":"","brief":"","tags":["","",""],"palette":["#000000","#000000","#000000","#000000"],"landmarks":["","",""] ,"weather":"petals"}',
  ].join("\n");
  const response = await fetch(`${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }], temperature: 0.45, max_tokens: 350, response_format: { type: "json_object" } }),
    cache: "no-store",
  });
  if (!response.ok) return NextResponse.json({ blueprint: null, source: "procedural", reason: "AI 地图暂不可用" });
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  let blueprint: Omit<PoemMapBlueprint, "source"> | null = null;
  try {
    blueprint = safeBlueprint(content ? JSON.parse(content) : null);
  } catch {
    blueprint = null;
  }
  if (!blueprint) return NextResponse.json({ blueprint: null, source: "procedural", reason: "AI 地图格式异常" });

  await supabase.from("poem_game_maps").insert({
    poem_id: poemId,
    prompt_version: PROMPT_VERSION,
    blueprint,
    generator: "azure_openai",
    model: deployment,
    created_by: user.id,
  });
  return NextResponse.json({ blueprint: { ...blueprint, source: "ai" }, cached: false });
}

