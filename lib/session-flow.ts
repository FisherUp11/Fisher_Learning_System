import { validInvitationToken } from "@/lib/invitation";

export type SessionFlowResult = {
  ok: boolean;
  message: string;
  signedIn?: boolean;
  redirectTo?: string;
  diagnostic?: string;
  retryAfter?: number;
};

export function sessionNextPath(value: unknown) {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || [...value].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return "/";
  try {
    const url = new URL(value, "https://session.invalid");
    return url.origin === "https://session.invalid" ? url.pathname + url.search + url.hash : "/";
  } catch { return "/"; }
}

export function invitationSignupPath(value: unknown) {
  const path = sessionNextPath(value);
  const url = new URL(path, "https://session.invalid");
  return url.pathname === "/join" && validInvitationToken(url.searchParams.get("token")) ? path : null;
}

export async function postSessionFlow(body: Record<string, string>): Promise<SessionFlowResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch("/api/auth/session", {
      method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal,
    });
    if (response.headers.get("content-type")?.includes("application/json")) {
      const result = await response.json() as SessionFlowResult;
      if (typeof result.ok === "boolean" && typeof result.message === "string" && (!result.ok || response.ok)) return result;
    }
    return { ok: false, message: response.status === 404 ? "网站还没有部署新版登录接口，请让管理员更新 Vercel 部署后刷新页面。" : "网站暂未返回有效的登录结果，请稍后重试。", diagnostic: `website_session_response_error / HTTP ${response.status}` };
  } catch {
    return { ok: false, message: controller.signal.aborted ? "登录请求等待超时，请稍后重试。" : "浏览器暂时无法连接本站登录服务，请检查网站连接后重试。", diagnostic: controller.signal.aborted ? "website_session_timeout" : "website_session_network_error" };
  } finally { clearTimeout(timer); }
}
