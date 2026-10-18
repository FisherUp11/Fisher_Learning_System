import type { NextRequest } from "next/server";
import { createPasswordFlowClient, createRecoveryLimiter, normalizedRecoveryEmail, passwordFlowRequestGuard, passwordFlowResponse, passwordFlowUnexpectedFailure, passwordProviderFailure, readPasswordFlowBody, recoveryClientAddress } from "@/lib/password-flow-server";

export const runtime = "nodejs";
export const maxDuration = 30;
const limitRecovery = createRecoveryLimiter();

export async function POST(request: NextRequest) {
  const rejected = passwordFlowRequestGuard(request);
  if (rejected) return rejected;
  const body = await readPasswordFlowBody(request);
  const email = normalizedRecoveryEmail(body?.email);
  if (!email) return passwordFlowResponse({ ok: false, message: "请填写正确的邮箱地址。", diagnostic: "invalid_email" }, 400);
  const retryAfter = limitRecovery(email, recoveryClientAddress(request));
  if (retryAfter) return passwordFlowResponse({ ok: false, message: "请求有些频繁，请等待后再试。", diagnostic: "recovery_cooldown", retryAfter }, 429);

  try {
    const flow = createPasswordFlowClient(request, { anonymous: true });
    // Public Auth API only. Do not use admin.generateLink or a service key here.
    // The existing email template uses SiteURL + TokenHash; no untrusted redirectTo.
    const { error } = await flow.supabase.auth.resetPasswordForEmail(email);
    if (error && error.code !== "user_not_found" && error.code !== "user_banned") {
      const failure = passwordProviderFailure(error, flow.timedOut());
      return passwordFlowResponse(failure.result, failure.status);
    }
    return passwordFlowResponse({ ok: true, message: "如果该邮箱已注册，我们已提交密码重置邮件请求。请检查收件箱和垃圾邮件。", retryAfter: 60 }, 200, flow.cookies);
  } catch {
    return passwordFlowUnexpectedFailure();
  }
}
