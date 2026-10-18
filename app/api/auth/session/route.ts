import type { NextRequest } from "next/server";
import { createPasswordFlowClient, createRecoveryLimiter, normalizedRecoveryEmail, passwordFlowRequestGuard, passwordFlowResponse, readPasswordFlowBody, recoveryClientAddress, validRecoveryPassword } from "@/lib/password-flow-server";
import { invitationSignupPath, sessionNextPath } from "@/lib/session-flow";
import { sessionProviderFailure, sessionUnexpectedFailure } from "@/lib/session-flow-server";

export const runtime = "nodejs";
export const maxDuration = 30;
const limitLogin = createRecoveryLimiter({ emailLimit: 8, emailWindowMs: 300_000, ipLimit: 30, ipWindowMs: 300_000 });
const limitSignup = createRecoveryLimiter({ emailLimit: 3, emailWindowMs: 3_600_000, ipLimit: 6, ipWindowMs: 3_600_000 });

export async function POST(request: NextRequest) {
  const rejected = passwordFlowRequestGuard(request);
  if (rejected) return rejected;
  const body = await readPasswordFlowBody(request);
  if (!body || typeof body.intent !== "string" || !["signin", "signup", "signout"].includes(body.intent)) return passwordFlowResponse({ ok: false, message: "登录请求格式无效，请刷新页面后重试。", diagnostic: "invalid_session_request" }, 400);
  const next = sessionNextPath(body.next);

  try {
    if (body.intent === "signout") {
      const flow = createPasswordFlowClient(request);
      // Keep cookie deletions even on errors, but do not claim the switch is
      // complete if a stale-session refresh prevented the SDK from signing out.
      const { error } = await flow.supabase.auth.signOut({ scope: "local" });
      if (error) {
        const failure = sessionProviderFailure(error, flow.timedOut());
        return passwordFlowResponse(failure.result, failure.status, flow.cookies);
      }
      return passwordFlowResponse({ ok: true, message: "当前浏览器已退出，请重新登录。", signedIn: false }, 200, flow.cookies);
    }

    const email = normalizedRecoveryEmail(body.email);
    const password = body.password;
    if (!email || typeof password !== "string" || !password.length || password.length > 1024) return passwordFlowResponse({ ok: false, message: "请填写正确的邮箱和密码。", diagnostic: "invalid_credentials_input" }, 400);
    const signingUp = body.intent === "signup";
    if (signingUp && (!invitationSignupPath(body.next) || !validRecoveryPassword(password))) {
      return passwordFlowResponse({ ok: false, message: "请使用完整邀请链接注册；密码需为 12～256 位，并包含字母和数字。", diagnostic: "invalid_signup_request" }, 400);
    }
    const retryAfter = (signingUp ? limitSignup : limitLogin)(email, recoveryClientAddress(request));
    if (retryAfter) return passwordFlowResponse({ ok: false, message: "请求有些频繁，请等待后再试。", diagnostic: "session_cooldown", retryAfter }, 429);

    // SSR skipAutoInitialize avoids an old-session refresh before this explicit
    // sign-in. Read old cookie names so the adapter can remove stale chunks.
    // Public key only: no admin key, manual JWT, or role assignment here.
    const flow = createPasswordFlowClient(request);
    const callback = new URL("/auth/callback", request.headers.get("origin")!);
    callback.searchParams.set("next", next);
    const { data, error } = signingUp
      ? await flow.supabase.auth.signUp({ email, password, options: { emailRedirectTo: callback.toString() } })
      : await flow.supabase.auth.signInWithPassword({ email, password });
    if (signingUp && (error?.code === "user_already_exists" || error?.code === "email_exists")) {
      return passwordFlowResponse({ ok: true, signedIn: false, message: "如果该邮箱可注册，我们已提交确认邮件请求。请检查邮箱，或切换到登录；加入空间仍需验证邀请。", retryAfter: 60 });
    }
    if (error || (!signingUp && !data.session)) {
      const failure = sessionProviderFailure(error, flow.timedOut());
      return passwordFlowResponse(failure.result, failure.status);
    }
    if (!data.session) return passwordFlowResponse({ ok: true, signedIn: false, message: "如果该邮箱可注册，我们已提交确认邮件请求。请检查邮箱，或切换到登录；加入空间仍需验证邀请。", retryAfter: 60 }, 200, flow.cookies);
    return passwordFlowResponse({ ok: true, signedIn: true, message: "登录成功，正在进入…", redirectTo: next }, 200, flow.cookies);
  } catch {
    return passwordFlowResponse(sessionUnexpectedFailure(), 503);
  }
}
