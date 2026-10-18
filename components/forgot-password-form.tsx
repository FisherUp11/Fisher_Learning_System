"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { postPasswordFlow } from "@/lib/password-flow";

type Feedback = {
  kind: "idle" | "success" | "error";
  message: string;
  diagnostic?: string;
};

const idleFeedback: Feedback = { kind: "idle", message: "" };

export function ForgotPasswordForm() {
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(idleFeedback);
  const submitting = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || cooldown > 0) return;
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setFeedback({ kind: "error", message: "请填写正确的邮箱地址。" });
      return;
    }

    submitting.current = true;
    setLoading(true);
    setFeedback(idleFeedback);
    try {
      const result = await postPasswordFlow("/api/auth/password-recovery", { email });
      setCooldown(result.retryAfter ?? 0);
      setFeedback({ kind: result.ok ? "success" : "error", message: result.message, diagnostic: result.diagnostic });
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return <form className="form-grid auth-flow-form" onSubmit={submit}>
    <label>登录邮箱
      <input name="email" type="email" autoComplete="email" inputMode="email" maxLength={254} required placeholder="you@example.com" />
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
