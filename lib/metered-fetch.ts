import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccessContext } from "@/lib/access";
import { usageValues, type ServiceKind } from "./service-usage-values";
import { guardDenialMessage, serviceGuardLimits } from "./service-guard";

type Meter = { service: ServiceKind; feature: string; model: string; characters?: number; audioSeconds?: number; learnerId?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Server-only Azure boundary. Never store prompts, text, audio, credentials or provider errors. */
export async function meteredFetch(url: string, init: RequestInit, meter: Meter): Promise<Response> {
  const db = await createClient();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError || !user) throw new Error("请先登录再使用 AI / 语音");
  const access = await loadAccessContext(db, user.id);
  if (!access) throw new Error("账号尚未加入学习空间或已被停用");
  const [{ data: workspace }, { data: profile, error: profileError }, { data: learner }] = await Promise.all([
    db.from("learning_workspaces").select("status").eq("id",access.workspaceId).single(),
    db.from("workspace_user_profiles").select("must_change_password").eq("user_id",user.id).single(),
    // RLS only returns learners this account may access, so the id cannot be spoofed.
    meter.learnerId && UUID.test(meter.learnerId) ? db.from("learner_profiles").select("id").eq("id",meter.learnerId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (profileError || !profile || workspace?.status !== "active") throw new Error("无法确认账号权限，请联系 owner");
  if (profile.must_change_password) throw new Error("请先修改临时密码，再使用 AI / 语音功能");
  const admin = createAdminClient();
  const id = randomUUID();
  const limits = serviceGuardLimits(meter.service);
  const { data: reservation, error } = await admin.rpc("reserve_metered_service_call", {
    p_id: id,
    p_workspace_id: access.workspaceId,
    p_user_id: user.id,
    p_learner_id: learner?.id ?? null,
    p_feature: meter.feature,
    p_service: meter.service,
    p_model: meter.model.slice(0, 160),
    p_characters: meter.characters ?? 0,
    p_audio_seconds: meter.audioSeconds ?? 0,
    p_workspace_minute_limit: limits.workspaceMinute,
    p_account_minute_limit: limits.accountMinute,
    p_workspace_day_limit: limits.workspaceDay,
    p_account_day_limit: limits.accountDay,
    p_workspace_unit_day_limit: limits.workspaceUnitsDay,
    p_account_unit_day_limit: limits.accountUnitsDay,
  });
  // Fail closed before touching a paid provider if the migration or accounting is unavailable.
  if (error) throw new Error("AI / 语音保护服务尚未就绪：请让 owner 先运行 supabase/023 SQL，检查服务端 Supabase Secret key；本次未调用 Azure。");
  if (!reservation || !["allowed", "workspace_minute", "account_minute", "workspace_day", "account_day", "workspace_units_day", "account_units_day"].includes(String(reservation))) {
    throw new Error("AI / 语音保护服务返回了未知状态；本次未调用 Azure，请联系管理员检查数据库日志。");
  }
  if (reservation !== "allowed") throw new Error(guardDenialMessage(String(reservation)));
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
