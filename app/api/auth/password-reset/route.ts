import type { NextRequest } from "next/server";
import { createPasswordFlowClient, passwordFlowRequestGuard, passwordFlowResponse, passwordFlowUnexpectedFailure, passwordProviderFailure, readPasswordFlowBody, validRecoveryPassword } from "@/lib/password-flow-server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const rejected = passwordFlowRequestGuard(request);
  if (rejected) return rejected;
  const body = await readPasswordFlowBody(request);
  if (!validRecoveryPassword(body?.password) || body.password !== body.confirmation) {
    return passwordFlowResponse({ ok: false, message: "请填写两次相同的新密码：12～256 位，并同时包含字母和数字。", diagnostic: "invalid_password" }, 400);
  }
  try {
    const flow = createPasswordFlowClient(request);
    const { data: { user }, error: sessionError } = await flow.supabase.auth.getUser();
    if (sessionError && (sessionError.status === 0 || (sessionError.status ?? 0) >= 500)) {
      const failure = passwordProviderFailure(sessionError, flow.timedOut());
      return passwordFlowResponse(failure.result, failure.status, flow.cookies);
    }
    if (sessionError || !user) return passwordFlowResponse({ ok: false, message: "恢复会话已经失效，请重新发送密码邮件。", diagnostic: "recovery_session_expired" }, 401, flow.cookies);
    const { error } = await flow.supabase.auth.updateUser({ password: body.password });
    if (error) {
      if (error.code === "same_password") return passwordFlowResponse({ ok: false, message: "新密码不能与原密码相同，请换一个密码。", diagnostic: "same_password" }, 400, flow.cookies);
      const failure = passwordProviderFailure(error, flow.timedOut());
      failure.result.message = "新密码保存结果尚未确认。请先尝试使用新密码登录；若失败，再重新申请恢复链接。";
      return passwordFlowResponse(failure.result, failure.status, flow.cookies);
    }
    // Password is now committed. Later cleanup failures must not turn into
    // 'password failed' and encourage a duplicate mutation.
    let sessionsRevoked = false;
    try {
      await flow.supabase.rpc("complete_initial_password_change");
    } catch { /* Old schema or a transient failure keeps the first-login gate. */ }
    try {
      const { error: signOutError } = await flow.supabase.auth.signOut({ scope: "global" });
      sessionsRevoked = !signOutError;
    } catch { /* Report cleanup separately from the successful password change. */ }
    return passwordFlowResponse({ ok: true, message: "密码已经修改成功，请使用新密码登录。", sessionsRevoked }, 200, flow.cookies);
  } catch {
    return passwordFlowUnexpectedFailure();
  }
}
