import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";
import { prepareFrogAudio } from "@/lib/hanzi-frog-speech-server";
import type { FrogWord } from "@/lib/hanzi-frog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  const started = performance.now();
  try {
    const body = await request.json().catch(() => null) as { learnerId?: unknown; characterIds?: unknown; allowGenerate?: unknown } | null;
    if (!body || typeof body.learnerId !== "string" || !uuid.test(body.learnerId) || !Array.isArray(body.characterIds)
      || (body.allowGenerate !== undefined && typeof body.allowGenerate !== "boolean")
      || body.characterIds.length < 1 || body.characterIds.length > 3
      || body.characterIds.some((id) => typeof id !== "string" || !uuid.test(id))) {
      return NextResponse.json({ error: "朗读参数无效，每次最多准备 3 个字" }, { status: 400, headers });
    }
    const learnerId = body.learnerId;
    const ids = [...new Set(body.characterIds as string[])];
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401, headers });
    const access = await loadAccessContext(supabase, user.id);
    try { await requireChildModule(supabase, access, user.id, learnerId, "hanzi"); }
    catch { return NextResponse.json({ error: "无权使用这位孩子的汉字游戏" }, { status: 403, headers }); }
    if (!access) return NextResponse.json({ error: "尚未加入学习空间" }, { status: 403, headers });
    // Accept IDs only, never arbitrary user text. The existing RPC checks active
    // assignments, published/approved books, and real prior learning states.
    const { data, error } = await supabase.rpc("get_hanzi_frog_pool", { p_learner_id: learnerId });
    if (error) return NextResponse.json({ error: "暂时无法确认游戏字库" }, { status: 503, headers });
    const pool = new Map(((data ?? []) as FrogWord[]).map((word) => [word.character_id, word]));
    if (ids.some((id) => !pool.has(id))) return NextResponse.json({ error: "有汉字已不在这位孩子的有效游戏字库中" }, { status: 403, headers });
    const authorizedAt = performance.now();
    // At most 3 independent lookups, with atomic metering on every actual miss.
    // Cache hits do not wait behind each other or touch the paid boundary.
    const items = await Promise.all(ids.map(async (id) => {
      try {
        const audio = await prepareFrogAudio(access.workspaceId, learnerId, pool.get(id)!, body.allowGenerate !== false);
        return { characterId: id, ...audio };
      } catch (error) {
        const message = error instanceof Error ? error.message : "朗读暂时不可用；现在可用设备慢读";
        return { characterId: id, error: message, retryAfterSeconds: 60 };
      }
    }));
    const finished = performance.now();
    console.info("hanzi_frog_speech_prepare", {
      count: ids.length, hits: items.filter((item) => "cache" in item && item.cache === "hit").length,
      unavailable: items.filter((item) => "error" in item).length,
      authorizationMs: Math.round(authorizedAt - started), totalMs: Math.round(finished - started),
    });
    return NextResponse.json({ items }, { headers: { ...headers,
      "Server-Timing": `auth;dur=${Math.round(authorizedAt - started)},prepare;dur=${Math.round(finished - authorizedAt)}`,
    } });
  } catch { return NextResponse.json({ error: "朗读准备暂时失败；可以先用设备慢读" }, { status: 503, headers }); }
}
