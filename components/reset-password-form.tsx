"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function validPassword(value: string) {
  return value.length >= 12 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function passwordErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("session") || normalized.includes("token") || normalized.includes("expired")) {
    return "这个密码恢复链接已经失效，请重新发送一封邮件。";
  }
  if (normalized.includes("same") || normalized.includes("different")) {
    return "新密码不能与原密码相同，请换一个密码。";
  }
  return "新密码暂时没有保存成功，请稍后再试。";
}

export function ResetPasswordForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
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

    setLoading(true);
    setMessage("");
    const supabase = createClient();
    const { data: { user }, error: sessionError } = await supabase.auth.getUser();
    if (sessionError || !user) {
      setLoading(false);
      setMessage("这个密码恢复链接已经失效，请重新发送一封邮件。");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setLoading(false);
      setMessage(passwordErrorMessage(error.message));
      return;
    }

    // 如果这是 owner 创建的临时密码账号，邮件恢复成功后也应解除首次改密标记。
    // 老数据库没有该 RPC 时不阻断密码恢复，登录后的首次改密页仍可安全兜底。
    await supabase.rpc("complete_initial_password_change");
    const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
    if (signOutError) await supabase.auth.signOut({ scope: "local" });
    router.replace("/login?reset=success");
    router.refresh();
  }

  return <form className="form-grid auth-flow-form" onSubmit={submit}>
    <label>新密码
      <input name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} required placeholder="至少 12 位" />
    </label>
    <label>再次输入新密码
      <input name="password_confirmation" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={12} required placeholder="再输入一次" />
    </label>
    <label className="password-visibility"><input type="checkbox" checked={showPassword} onChange={(event) => setShowPassword(event.target.checked)} />显示密码</label>
    <p className="helper-text">至少 12 位，同时包含字母和数字。修改完成后，其他设备上的旧会话也会退出。</p>
    <button className="primary full" type="submit" disabled={loading}>{loading ? "正在保存新密码…" : "保存新密码"}</button>
    {message && <p className="form-error" role="alert">{message}</p>}
  </form>;
}
