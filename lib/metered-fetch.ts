import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccessContext } from "@/lib/access";
import { usageValues, type ServiceKind } from "./service-usage-values";

type Meter = { service: ServiceKind; feature: string; model: string; characters?: number; audioSeconds?: number };

/** Server-only Azure boundary. Never store prompts, text, audio, credentials or provider errors. */
export async function meteredFetch(url: string, init: RequestInit, meter: Meter): Promise<Response> {
  const db = await createClient();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user) throw new Error("请先登录再使用 AI / 语音");
  const access = await loadAccessContext(db, user.id);
  if (!access) throw new Error("账号尚未加入学习空间或已被停用");
  const [{ data: workspace }, { data: profile, error: profileError }] = await Promise.all([
    db.from("learning_workspaces").select("status").eq("id",access.workspaceId).single(),
    db.from("workspace_user_profiles").select("must_change_password").eq("user_id",user.id).single(),
  ]);
  if (profileError || !profile || workspace?.status !== "active") throw new Error("无法确认账号权限，请联系 owner");
  if (profile.must_change_password) throw new Error("请先修改临时密码，再使用 AI / 语音功能");
  const admin = createAdminClient();
  const id = randomUUID();
  const { error } = await admin.from("service_usage_events").insert({
    id, workspace_id: access.workspaceId, user_id: user.id, feature: meter.feature,
    service: meter.service, model: meter.model.slice(0,160),
    characters: meter.characters ?? 0, audio_seconds: meter.audioSeconds ?? 0,
  });
  // Fail before calling the paid provider if bookkeeping is unavailable.
  if (error) throw new Error("用量记录服务尚未就绪，请让 owner 运行 021 SQL 并检查服务端 Supabase 密钥；本次未调用 Azure。");
  async function finish(values: Record<string, unknown>) {
    const { error: finishError } = await admin.from("service_usage_events").update({ ...values, completed_at: new Date().toISOString() }).eq("id",id);
    if (finishError) console.warn("service_usage_finalize_failed", id, finishError.code);
    // Initial row remains 'started': visible as uncertain, never silently zero.
  }
  let response: Response;
  try { response = await fetch(url,{ ...init, signal: init.signal ?? AbortSignal.timeout(60000) }); }
  catch (error) { await finish({status:"unknown"}); throw error; }
  let values = {};
  if (response.ok && (meter.service === "text" || meter.service === "image")) {
    try { values = usageValues(await response.clone().json(),meter.service); }
    catch { await finish({status:"unknown",http_status:response.status}); return response; }
  }
  await finish({status:response.ok ? "success" : "error",http_status:response.status,...values});
  return response;
}
