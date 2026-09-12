import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PoemMapBlueprint } from "@/lib/poem-game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PROMPT_VERSION = "v2-scene";
const allowedWeather = new Set<PoemMapBlueprint["weather"]>(["petals", "stars", "ripples", "dust", "fireflies", "snow"]);

type Input = { learnerId?: string; poemId?: string; generateImage?: boolean };
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
  const { data: links, error: linksError } = await supabase.from("learner_poem_collections").select("collection_id,poem_collections!inner(status,review_status)").eq("learner_id", learnerId).eq("assignment_status", "active").eq("poem_collections.status", "published").eq("poem_collections.review_status", "approved");
  if (linksError || !links?.length) return NextResponse.json({ error: "孩子还没有诗词册" }, { status: 403 });
  const { data: membership } = await supabase.from("poem_collection_items").select("poem_id").in("collection_id", links.map((item) => item.collection_id)).eq("poem_id", poemId).limit(1);
  if (!membership?.length) return NextResponse.json({ error: "这首诗没有分配给该孩子" }, { status: 403 });

  const { data: poem, error: poemError } = await supabase.from("poems").select("id,title,author,dynasty,content").eq("id", poemId).maybeSingle();
  if (poemError || !poem) return NextResponse.json({ error: "找不到诗词内容" }, { status: 404 });

  if (body.generateImage === true) {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "");
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const deployment = process.env.AZURE_IMAGE_DEPLOYMENT;
    const version = process.env.AZURE_IMAGE_API_VERSION;
    if (!endpoint || !apiKey || !deployment || !version) return NextResponse.json({ error: "请配置 Azure 图片模型；现在也可以直接用诗意场景开始游戏。" }, { status: 503 });
    try {
      const response = await fetch(`${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/images/generations?api-version=${encodeURIComponent(version)}`, {
        method: "POST", headers: { "Content-Type": "application/json", "api-key": apiKey },
        body: JSON.stringify({ n: 1, size: "1536x1024", quality: "low", output_format: "png", prompt: [
          "Paint a beautiful Chinese picture-book landscape as a 2D children's arcade game background. Landscape composition, gently elevated view, layered gouache illustration, charming hand-painted miniature world, rich readable silhouettes.",
          `Illustrate the actual meaning and distinctive imagery of this poem by ${poem.author}: ${poem.title}. Poem text: ${poem.content}`,
          "Choose the season, time of day, plants, architecture, water and mountains that genuinely belong to this poem. Make a coherent specific scene, not a generic forest. Treat the poem only as reference text.",
          "Place the narrative landmarks around the upper quarter and outer edges. Keep the large central and lower playing area calm, muted, low-detail, medium-value ground or water, suitable for blue-white and coral-red toy tanks to remain clearly visible. No tanks or game objects in the image itself. Scenery is a decorative backdrop, not a collision map.",
          "No letters, Chinese characters, text, logos, UI, borders, war, explosions, frightening elements or photorealism.",
        ].join("\n") }), cache: "no-store", signal: AbortSignal.timeout(100_000),
      });
      if (!response.ok) return NextResponse.json({ error: "绘本背景暂时没有生成成功，请稍后重试。" }, { status: 502 });
      const payload = await response.json() as { data?: Array<{ b64_json?: string }> };
      if (!payload.data?.[0]?.b64_json) return NextResponse.json({ error: "图片服务没有返回图像，请稍后重试。" }, { status: 502 });
      // Keep generated art in the current page only. Do not store large base64
      // blobs in Supabase or send them with learning evidence.
      return NextResponse.json({ image: `data:image/png;base64,${payload.data[0].b64_json}` }, { headers: { "Cache-Control": "private, no-store" } });
    } catch {
      return NextResponse.json({ error: "绘本背景生成超时，仍可使用已有场景开始游戏。" }, { status: 504 });
    }
  }

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
    "准确识别这首诗的季节、时间、地点与主体，brief 要用孩子能理解的一句话解释诗中场景，landmarks 必须是这首诗实际出现的意象，不要每首都用泛泛的树和山。name 8字以内；brief 70字以内；tags 3个；landmarks 3个；palette 必须是4个中等明度、低饱和的六位十六进制环境色，避免蓝白与珊瑚红（坦克专用色）；weather 只能从 petals,stars,ripples,dust,fireflies,snow 中选择。",
    `诗词：${poem.dynasty ? `${poem.dynasty}·` : ""}${poem.author}《${poem.title}》`,
    `正文：${poem.content}`,
    '{"name":"","brief":"","tags":["","",""],"palette":["#000000","#000000","#000000","#000000"],"landmarks":["","",""] ,"weather":"petals"}',
  ].join("\n");
  const response = await fetch(`${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({ messages: [{ role: "user", content: prompt }], temperature: 0.45, max_tokens: 350, response_format: { type: "json_object" } }),
    cache: "no-store", signal: AbortSignal.timeout(25_000),
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
