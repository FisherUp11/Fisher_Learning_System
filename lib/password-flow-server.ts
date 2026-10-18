import "server-only";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import type { PasswordFlowResult } from "@/lib/password-flow";

type CookieToSet = { name: string; value: string; options: CookieOptions };
type AuthFailure = { code?: string; name?: string; status?: number };

export function passwordFlowResponse<T extends PasswordFlowResult>(result: T, status = 200, cookies: CookieToSet[] = []) {
  const response = NextResponse.json(result, { status, headers: {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  } });
  if (result.retryAfter) response.headers.set("Retry-After", String(result.retryAfter));
  for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
  return response;
}

export function passwordFlowRequestGuard(request: Request) {
  // Strict same-origin JSON POSTs. No client-supplied redirect URL or CORS access.
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host");
  let expectedOrigin = requestUrl.origin;
  // Next's internal URL may use localhost even when the browser uses an alias.
  // Host is the actual HTTP target; do not trust arbitrary forwarded-host/proto.
  if (host) {
    try {
      if (/[\/\\\s,@?#]/.test(host)) throw new Error("invalid_host");
      expectedOrigin = new URL(`${process.env.VERCEL === "1" ? "https:" : requestUrl.protocol}//${host}`).origin;
    } catch { expectedOrigin = ""; }
  }
  if (origin !== expectedOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
    return passwordFlowResponse({ ok: false, message: "请求来源无效，请从本站页面重新操作。", diagnostic: "invalid_origin" }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return passwordFlowResponse({ ok: false, message: "请求格式无效，请刷新页面后重试。", diagnostic: "invalid_content_type" }, 415);
  }
  return null;
}

export async function readPasswordFlowBody(request: Request): Promise<Record<string, unknown> | null> {
  // Bound streamed bodies too; Content-Length alone can be absent or forged.
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 4096) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch { return null; }
  finally { reader.releaseLock(); }
}

export function normalizedRecoveryEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function validRecoveryPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 256 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

// Best-effort, bounded per-instance throttle, NOT a distributed security boundary.
// Supabase's user/project quotas remain enabled. Vercel Firewall can enforce a
// shared IP limit across instances. No raw emails/IPs are retained or logged.
export function createRecoveryLimiter({ emailLimit = 1, emailWindowMs = 60_000, ipLimit = 6, ipWindowMs = 600_000 } = {}) {
  const buckets = new Map<string, { count: number; expires: number }>();
  const salt = randomBytes(32);
  return (email: string, ip: string, now = Date.now()) => {
    for (const [key, bucket] of buckets) if (bucket.expires <= now) buckets.delete(key);
    const rules = [
      { value: `email:${email}`, limit: emailLimit, window: emailWindowMs },
      { value: `ip:${ip}`, limit: ipLimit, window: ipWindowMs },
    ].map(rule => ({ ...rule, key: createHmac("sha256", salt).update(rule.value).digest("hex") }));
    for (const rule of rules) {
      const bucket = buckets.get(rule.key);
      if (bucket && bucket.count >= rule.limit) return Math.max(1, Math.ceil((bucket.expires - now) / 1000));
    }
    if (buckets.size + rules.filter(rule => !buckets.has(rule.key)).length > 2048) return 60;
    for (const rule of rules) {
      const bucket = buckets.get(rule.key);
      buckets.set(rule.key, { count: (bucket?.count ?? 0) + 1, expires: bucket?.expires ?? now + rule.window });
    }
    return 0;
  };
}

export function recoveryClientAddress(request: Request) {
  // Only trust the platform-overwritten header on Vercel. Local/self-hosted
  // processes use one conservative bucket, not arbitrary forwarded headers.
  const ip = process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : null;
  return ip && isIP(ip) ? ip : "unknown";
}

export function createPasswordFlowClient(request: NextRequest, { anonymous = false } = {}) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("auth_configuration_missing");
  const cookies: CookieToSet[] = [];
  // One bounded budget across this flow. No automatic retries of /recover or
  // /user; preserve PKCE cookies, including older code-based email templates.
  const signal = AbortSignal.timeout(25_000);
  const supabase = createServerClient(url, key, {
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store", signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }) },
    cookies: {
      getAll: () => anonymous ? [] : request.cookies.getAll(),
      setAll: values => { cookies.push(...values); },
    },
  });
  return { supabase, cookies, timedOut: () => signal.aborted };
}

export function passwordProviderFailure(error: AuthFailure, timedOut = false) {
  const code = error.code && /^[a-z_]{1,70}$/.test(error.code) ? error.code : "";
  const upstreamStatus = error.status ?? 0;
  let diagnostic = code || "supabase_auth_error";
  let message = "密码恢复暂时没有完成，请将诊断码发给管理员。";
  let status = 400;
  let retryAfter: number | undefined;
  if (upstreamStatus === 429 || code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
    diagnostic = "auth_rate_limit"; message = "发送得有些频繁，请稍后再试；不要连续点击。"; status = 429; retryAfter = 60;
  } else if (timedOut || code === "request_timeout") {
    diagnostic = "server_supabase_timeout"; message = "网站服务器连接 Supabase Auth 超时。邮件可能已在处理中，请先检查邮箱，至少等待一分钟再试。"; status = 504; retryAfter = 60;
  } else if (upstreamStatus >= 500) {
    diagnostic = "supabase_auth_server_error"; message = "Supabase Auth 已收到请求，但处理失败。请管理员检查 Auth 日志和 Resend SMTP；这不是当前设备断网。"; status = 502; retryAfter = 60;
  } else if (upstreamStatus === 0 && error.name === "AuthRetryableFetchError") {
    diagnostic = "server_supabase_network_error"; message = "网站服务器暂时无法连接 Supabase Auth。请管理员检查 Vercel 服务日志和到 Supabase 的网络；不需要先改 Resend SMTP。"; status = 503; retryAfter = 60;
  } else if (code === "email_address_not_authorized") {
    message = "邮件服务尚未正确启用，请管理员检查 Supabase 的 Resend Custom SMTP 配置。";
  } else if (code === "captcha_failed") {
    message = "安全验证未通过，请联系管理员检查 Supabase 的验证码配置。";
  } else if (code === "email_address_invalid") {
    message = "请检查邮箱地址的拼写。";
  }
  // Never log Auth's raw message/body, credentials, email, token, or password.
  const reference = randomUUID().slice(0, 8);
  console.warn("[password-flow]", { reference, diagnostic, upstreamStatus });
  return { result: { ok: false, message, diagnostic: `${diagnostic}${upstreamStatus ? ` / HTTP ${upstreamStatus}` : ""} / ref ${reference}`, retryAfter }, status };
}

export function passwordFlowUnexpectedFailure() {
  const reference = randomUUID().slice(0, 8);
  console.warn("[password-flow]", { reference, diagnostic: "auth_configuration_or_runtime_error" });
  return passwordFlowResponse({ ok: false, message: "密码服务暂时不可用，请管理员检查 Vercel 中的 Supabase URL、公钥及服务日志。", diagnostic: `auth_configuration_or_runtime_error / ref ${reference}`, retryAfter: 60 }, 503);
}
