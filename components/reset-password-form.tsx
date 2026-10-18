"use client";

import { FormEvent, useRef, useState } from "react";
import { postPasswordFlow } from "@/lib/password-flow";

function validPassword(value: string) {
  return value.length >= 12 && value.length <= 256 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

export function ResetPasswordForm() {
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const submitting = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("password_confirmation") ?? "");
    if (!validPassword(password)) {
      setMessage("新密码至少 12 位，并同时包含字母和数字。");
      return;
    }
    if (password !== confirmation) {
      setMessage("两次输入的新密码不一致。");
      return;
    }

    submitting.current = true;
    setLoading(true);
    setMessage("");
    try {
      const result = await postPasswordFlow("/api/auth/password-reset", { password, confirmation });
      if (!result.ok) {
        setMessage(`${result.message}${result.diagnostic ? `（诊断码：${result.diagnostic}）` : ""}`);
        return;
      }
      // Full navigation after the server writes/deletes auth cookies.
      window.location.replace(result.sessionsRevoked ? "/login?reset=success" : "/login?reset=success&sessions=check");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return <form className="form-grid auth-flow-form" onSubmit={submit}>
    <label>新密码
      <input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={256} required placeholder="至少 12 位" />
    </label>
    <label>再次输入新密码
      <input name="password_confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} maxLength={256} required placeholder="再输入一次" />
    </label>
    <label className="password-visibility"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />显示密码</label>
    <p className="helper-text">至少 12 位，同时包含字母和数字。修改完成后，其他设备上的旧会话也会退出。</p>
    <button className="primary full" type="submit" disabled={loading}>{loading ? "正在保存新密码…" : "保存新密码"}</button>
    {message && <p className="form-error" role="alert">{message}</p>}
  </form>;
}
