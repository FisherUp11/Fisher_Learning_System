import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Input = { learnerId?: string; characterId?: string };

type AzureImageResponse = {
  data?: Array<{ b64_json?: string; url?: string }>;
};

function memoryPrompt(hanzi: string, pinyin: string, meaning: string) {
  return [
    "Create one calm, child-safe visual mnemonic for a Chinese preschool child.",
    `The child is learning the Chinese character “${hanzi}” (pinyin: ${pinyin}). Its kid-friendly meaning is: ${meaning}.`,
    "Show one clear, concrete scene or object that helps the child connect the character with its meaning. This is a memory association, not a historical etymology claim.",
    "Style: warm Chinese children's picture-book illustration, gentle gouache and pencil texture, simple composition, one large central subject, soft cream background, friendly and non-scary.",
    "Do not include any words, Chinese characters, pinyin, letters, numbers, captions, watermarks, logos, or brand marks.",
  ].join("\n");
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: Input;
  try {
    body = (await request.json()) as Input;
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const learnerId = body.learnerId?.trim() ?? "";
  const characterId = body.characterId?.trim() ?? "";
  if (!learnerId || !characterId) return NextResponse.json({ error: "缺少孩子或汉字信息" }, { status: 400 });

  // 只允许为当前家长、当前孩子字库中的汉字生成图片，避免此受保护接口被当作任意图片生成器。
  const { data: learner, error: learnerError } = await supabase
    .from("learner_profiles")
    .select("id")
    .eq("id", learnerId)
    .eq("parent_user_id", user.id)
    .maybeSingle();
  if (learnerError || !learner) return NextResponse.json({ error: "找不到这个孩子档案" }, { status: 403 });

  const { data: packageLinks, error: packageLinksError } = await supabase
    .from("learner_content_packages")
    .select("package_id")
    .eq("learner_id", learnerId);
  const packageIds = (packageLinks ?? []).map((item) => item.package_id);
  if (packageLinksError || packageIds.length === 0) {
    return NextResponse.json({ error: "找不到孩子的字库归属，请先运行 006 数据库脚本" }, { status: 400 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("package_characters")
    .select("character_id")
    .in("package_id", packageIds)
    .eq("character_id", characterId)
    .limit(1);
  if (membershipError || !membership?.length) return NextResponse.json({ error: "这个字不在该孩子的字库中" }, { status: 403 });

  const { data: character, error: characterError } = await supabase
    .from("characters")
    .select("character,pinyin_marked,meaning")
    .eq("id", characterId)
    .eq("created_by", user.id)
    .maybeSingle();
  if (characterError || !character) return NextResponse.json({ error: "找不到汉字内容" }, { status: 404 });

  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, "");
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_IMAGE_DEPLOYMENT;
  const apiVersion = process.env.AZURE_IMAGE_API_VERSION;
  if (!endpoint || !apiKey || !deployment || !apiVersion) {
    return NextResponse.json({ error: "联想图服务尚未配置。请检查 Azure 的图片模型部署和环境变量。" }, { status: 503 });
  }

  const response = await fetch(`${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/images/generations?api-version=${encodeURIComponent(apiVersion)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      prompt: memoryPrompt(character.character, character.pinyin_marked, character.meaning),
      n: 1,
      size: "1024x1024",
      quality: "low",
      output_format: "png",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json({ error: "联想图服务暂时不可用，请稍后再试。" }, { status: 502 });
  }
  const payload = await response.json() as AzureImageResponse;
  const image = payload.data?.[0];
  if (image?.b64_json) {
    return NextResponse.json({ image: `data:image/png;base64,${image.b64_json}` }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (image?.url) {
    return NextResponse.json({ image: image.url }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return NextResponse.json({ error: "联想图未返回可显示的图片" }, { status: 502 });
}
