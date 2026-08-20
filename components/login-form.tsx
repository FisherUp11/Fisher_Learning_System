"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ nextPath = "/learn" }: { nextPath?: string }) {
  const router = useRouter();
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const canSignup = nextPath.startsWith("/join");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    if (isSignup && (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) {
      setLoading(false);
      setMessage("注册密码至少 12 位，并同时包含字母和数字。");
      return;
    }
    const supabase = createClient();

    const result = isSignup
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}` } })
      : await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    if (isSignup && !result.data.session) {
      setMessage("注册成功，请到邮箱确认后再回来登录。 ");
      return;
    }
    router.replace(nextPath);
    router.refresh();
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      {canSignup ? <div className="auth-mode" role="tablist" aria-label="登录方式">
        <button type="button" className={!isSignup ? "active" : ""} onClick={() => setIsSignup(false)}>登录</button>
        <button type="button" className={isSignup ? "active" : ""} onClick={() => setIsSignup(true)}>接受邀请并注册</button>
      </div> : <p className="helper-text">新账号由学习空间 owner 创建。收到临时密码后，直接在这里登录。</p>}
      <label>邮箱<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>
      <label>密码<input name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} minLength={isSignup ? 12 : 6} required placeholder={isSignup ? "至少 12 位" : "输入登录密码"} /></label>
      {!isSignup && <div className="login-assistance"><Link href="/forgot-password">忘记密码？</Link></div>}
      <button className="primary full" disabled={loading}>{loading ? "请稍候…" : isSignup ? "创建账号" : "登录"}</button>
      {message && <p className={message.includes("成功") ? "success" : "error"}>{message}</p>}
    </form>
  );
}
