export type PasswordFlowResult = {
  ok: boolean;
  message: string;
  diagnostic?: string;
  retryAfter?: number;
  sessionsRevoked?: boolean;
};

// Never automatically retry an email or password mutation: a lost response does
// not prove that Supabase did not process it.
export async function postPasswordFlow(path: string, body: Record<string, string>): Promise<PasswordFlowResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (response.headers.get("Content-Type")?.includes("application/json")) {
      const result = await response.json() as PasswordFlowResult;
      if (typeof result.ok === "boolean" && typeof result.message === "string") return result;
    }
    return {
      ok: false,
      message: response.status === 404
        ? "网站还没有部署新版密码恢复接口，请让管理员更新 Vercel 部署后重试。"
        : "网站暂时没有返回有效结果，请稍后再试。",
      diagnostic: `website_response_error / HTTP ${response.status}`,
      retryAfter: 60,
    };
  } catch {
    return {
      ok: false,
      message: "暂时无法确认网站是否完成请求。请先检查邮箱；若在保存新密码，请尝试用新密码登录。不要连续重复提交。",
      diagnostic: controller.signal.aborted ? "website_request_timeout" : "website_network_error",
      retryAfter: 60,
    };
  } finally {
    clearTimeout(timer);
  }
}
