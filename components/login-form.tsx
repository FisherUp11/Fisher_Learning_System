"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const password = String(data.get("password") ?? "");
    const supabase = createClient();

    const result = isSignup
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
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
    router.replace("/learn");
    router.refresh();
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <div className="auth-mode" role="tablist" aria-label="登录方式">
        <button type="button" className={!isSignup ? "active" : ""} onClick={() => setIsSignup(false)}>登录</button>
        <button type="button" className={isSignup ? "active" : ""} onClick={() => setIsSignup(true)}>创建家长账号</button>
      </div>
      <label>邮箱<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></label>
      <label>密码<input name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} minLength={6} required placeholder="至少 6 位" /></label>
      <button className="primary full" disabled={loading}>{loading ? "请稍候…" : isSignup ? "创建账号" : "登录"}</button>
      {message && <p className={message.includes("成功") ? "success" : "error"}>{message}</p>}
    </form>
  );
}
