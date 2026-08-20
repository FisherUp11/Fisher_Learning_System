"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Feedback = {
  kind: "idle" | "success" | "error";
  message: string;
  diagnostic?: string;
};

type RecoveryError = {
  code?: string;
  message: string;
  name?: string;
  status?: number;
};

const idleFeedback: Feedback = { kind: "idle", message: "" };

function recoveryErrorFeedback(error: RecoveryError): Feedback {
  const code = error.code?.trim();
  const isBrowserNetworkError = error.name === "AuthRetryableFetchError" && (!error.status || error.status === 0);
  const inferredCode = code
    || (isBrowserNetworkError ? "network_error" : null)
    || (error.status !== undefined && error.status >= 500 ? "supabase_auth_server_error" : null)
    || "unknown_error";
  const diagnostic = [
    inferredCode,
    error.status ? `HTTP ${error.status}` : null,
  ].filter(Boolean).join(" / ");

  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error.status === 429) {
    return { kind: "error", message: "发送得有些频繁，请等待一分钟后再试。", diagnostic };
  }

  if (code === "email_address_not_authorized") {
    return {
      kind: "error",
      message: "Supabase 仍在使用默认邮件服务，说明 Resend Custom SMTP 没有启用或没有成功保存。请系统 owner 重新保存 SMTP 设置。",
      diagnostic,
    };
  }

  if (code === "email_address_invalid") {
    return { kind: "error", message: "这个邮箱地址不能用于密码恢复，请检查邮箱拼写。", diagnostic };
  }

  if (code === "captcha_failed") {
    return { kind: "error", message: "安全验证没有通过，请刷新页面后重试。", diagnostic };
  }

  if (code === "unexpected_failure" || (error.status !== undefined && error.status >= 500)) {
    return {
      kind: "error",
      message: "Supabase Auth 已收到请求，但服务器处理失败。这不是当前设备断网；密码恢复出现 HTTP 500 时，通常要在 Auth 日志中继续检查 SMTP、邮件模板或数据库依赖。",
      diagnostic,
    };
  }

  if (code === "request_timeout") {
    return {
      kind: "error",
      message: "Supabase Auth 处理请求超时，请稍后再试；若持续发生，请检查 Auth 日志和 Supabase 服务状态。",
      diagnostic,
    };
  }

  if (isBrowserNetworkError || error.status === 0) {
    return {
      kind: "error",
      message: "浏览器没有连接到 Supabase Auth，请检查当前网络、代理或 DNS 后重试。",
      diagnostic,
    };
  }

  return {
    kind: "error",
    message: "密码恢复请求没有完成。请把下面的诊断码发给系统 owner，并检查 Supabase Auth 日志。",
    diagnostic,
  };
}

export function ForgotPasswordForm() {
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(idleFeedback);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || cooldown > 0) return;
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setFeedback({ kind: "error", message: "请填写正确的邮箱地址。" });
      return;
    }

    setLoading(true);
    setFeedback(idleFeedback);
    try {
      const supabase = createClient();
      // The recovery email template deliberately builds its link from
      // Supabase's production Site URL. Do not send the current browser origin
      // as redirectTo: a localhost request would otherwise add an unnecessary
      // redirect_to value even though the template never uses it.
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      if (error) {
        if (process.env.NODE_ENV !== "production") {
          console.error("[password-recovery] Supabase Auth request failed", {
            name: error.name,
            code: error.code,
            status: error.status,
            message: error.message,
          });
        }
        setFeedback(recoveryErrorFeedback(error));
      } else {
        setCooldown(60);
        setFeedback({
          kind: "success",
          message: "如果该邮箱已注册，我们已经发送密码重置邮件。请检查收件箱和垃圾邮件。",
        });
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "production") console.error("[password-recovery] Unexpected client error", error);
      setFeedback({ kind: "error", message: "浏览器没有完成请求，请检查网络后重新尝试。", diagnostic: "client_exception" });
    } finally {
      setLoading(false);
    }
  }

  return <form className="form-grid auth-flow-form" onSubmit={submit}>
    <label>登录邮箱
      <input name="email" type="email" autoComplete="email" inputMode="email" required placeholder="you@example.com" />
    </label>
    <p className="helper-text">为了保护账号隐私，无论邮箱是否存在，页面都会显示相同的发送结果。</p>
    <button className="primary full" type="submit" disabled={loading || cooldown > 0}>
      {loading ? "正在发送…" : cooldown > 0 ? `${cooldown} 秒后可重新发送` : "发送重置邮件"}
    </button>
    {feedback.kind !== "idle" && <p className={feedback.kind === "success" ? "success-box" : "form-error"} role={feedback.kind === "error" ? "alert" : "status"} aria-live="polite">
      <span>{feedback.message}</span>
      {feedback.diagnostic && <small className="auth-diagnostic">诊断码：{feedback.diagnostic}</small>}
    </p>}
  </form>;
}
