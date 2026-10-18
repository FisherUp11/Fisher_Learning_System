"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { invitationSignupPath, postSessionFlow, sessionNextPath } from "@/lib/session-flow";

export function LoginForm({ nextPath = "/" }: { nextPath?: string }) {
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [diagnostic, setDiagnostic] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [success, setSuccess] = useState(false);
  const submitting = useRef(false);
  const canSignup = Boolean(invitationSignupPath(nextPath));
  const isCoolingDown = cooldown > 0;

  useEffect(() => {
    if (!isCoolingDown) return;
    const timer = window.setInterval(() => setCooldown(seconds => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [isCoolingDown]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || cooldown > 0) return;
    submitting.current = true;
    setLoading(true);
    setMessage("");
    setDiagnostic("");
    setSuccess(false);
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (isSignup && (password.length < 12 || password.length > 256 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) {
      submitting.current = false;
      setLoading(false);
      setMessage("注册密码至少 12 位，并同时包含字母和数字。");
      return;
    }
    let navigating = false;
    try {
      const result = await postSessionFlow({ intent: isSignup ? "signup" : "signin", email, password, next: sessionNextPath(nextPath) });
      setMessage(result.message);
      setDiagnostic(result.diagnostic ?? "");
      setSuccess(result.ok);
      setCooldown(result.retryAfter ?? 0);
      if (result.ok && result.signedIn) {
        // The same-origin response writes SSR cookies before full navigation;
        // no browser Supabase client or competing refresh request is needed.
        navigating = true;
        window.location.replace(sessionNextPath(result.redirectTo));
      }
    } finally {
      if (!navigating) {
        submitting.current = false;
        setLoading(false);
      }
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      {canSignup ? <div className="auth-mode" role="tablist" aria-label="登录方式">
        <button type="button" disabled={loading} className={!isSignup ? "active" : ""} onClick={() => setIsSignup(false)}>登录</button>
        <button type="button" disabled={loading} className={isSignup ? "active" : ""} onClick={() => setIsSignup(true)}>接受邀请并注册</button>
      </div> : <p className="helper-text">新账号由学习空间 owner 创建。收到临时密码后，直接在这里登录。</p>}
      <label>邮箱<input name="email" type="email" autoComplete="email" maxLength={254} required placeholder="you@example.com" /></label>
      <label>密码<input name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} minLength={isSignup ? 12 : 6} maxLength={isSignup ? 256 : 1024} required placeholder={isSignup ? "至少 12 位" : "输入登录密码"} /></label>
      {!isSignup && <div className="login-assistance"><Link href="/forgot-password">忘记密码？</Link></div>}
      <button className="primary full" disabled={loading || isCoolingDown}>{loading ? "请稍候…" : isCoolingDown ? `${cooldown} 秒后可重试` : isSignup ? "创建账号" : "登录"}</button>
      {message && <p role={success ? "status" : "alert"} aria-live="polite" className={success ? "success" : "error"}>{message}{diagnostic && <small className="auth-diagnostic">诊断码：{diagnostic}</small>}</p>}
    </form>
  );
}
