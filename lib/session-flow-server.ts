import "server-only";
import { randomUUID } from "node:crypto";
import type { SessionFlowResult } from "@/lib/session-flow";

export function sessionProviderFailure(error: { status?: number; code?: string; name?: string } | null, timedOut = false) {
  const upstreamStatus = error?.status ?? 0;
  const code = error?.code;
  let diagnostic = "login_failed";
  let message = "邮箱或密码不正确，或账号暂时不可用。请核对登录信息；刚注册的账号请先完成邮件确认。";
  let status = 401;
  let retryAfter: number | undefined;
  if (timedOut || code === "request_timeout") {
    diagnostic = "server_auth_timeout"; message = "网站服务器等待 Supabase 登录超时，请稍后再试。"; status = 504;
  } else if (!error || error.name === "AuthInvalidTokenResponseError") {
    diagnostic = "login_session_missing"; message = "登录服务没有建立有效会话，请稍后重试。"; status = 502;
  } else if (upstreamStatus === 429 || code === "over_request_rate_limit" || code === "over_email_send_rate_limit") {
    diagnostic = "auth_rate_limit"; message = "登录或注册请求过于频繁，请稍后重试。"; status = 429; retryAfter = 60;
  } else if (upstreamStatus >= 500) {
    diagnostic = "supabase_auth_server_error"; message = "Supabase 登录服务暂时异常，请稍后重试或联系管理员检查 Auth 日志。"; status = 502;
  } else if (upstreamStatus === 0 && error?.name === "AuthRetryableFetchError") {
    diagnostic = "server_auth_network_error"; message = "网站服务器暂时无法连接 Supabase 登录服务，请管理员检查 Vercel 日志；这不是密码错误。"; status = 503;
  } else if (code === "captcha_failed") {
    diagnostic = "captcha_failed"; message = "安全验证未通过，请管理员检查验证码配置，不要关闭安全保护。"; status = 400;
  } else if (code === "weak_password") {
    diagnostic = "weak_password"; message = "注册密码不符合安全要求，请使用更长且包含字母和数字的密码。"; status = 400;
  }
  // Never log raw provider errors, credentials, email, tokens, or request bodies.
  const reference = randomUUID().slice(0, 8);
  console.warn("[session-flow]", { reference, diagnostic, upstreamStatus });
  const result: SessionFlowResult = { ok: false, message, diagnostic: `${diagnostic}${upstreamStatus ? ` / HTTP ${upstreamStatus}` : ""} / ref ${reference}`, retryAfter };
  return { result, status };
}

export function sessionUnexpectedFailure() {
  const reference = randomUUID().slice(0, 8);
  console.warn("[session-flow]", { reference, diagnostic: "session_configuration_or_runtime_error" });
  return { ok: false, message: "本站登录服务暂时不可用，请管理员检查 Vercel 的 Supabase URL、公钥及服务日志。", diagnostic: `session_configuration_or_runtime_error / ref ${reference}` } satisfies SessionFlowResult;
}
