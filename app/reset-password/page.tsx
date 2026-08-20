import Link from "next/link";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return <main className="login-page">
    <section className="login-card auth-flow-card">
      <div className="login-brand"><span className="brand-mark">字</span><span>字芽</span></div>
      <div className="auth-flow-mark" aria-hidden="true">钥</div>
      <p className="eyebrow">New password</p>
      <h1>{user ? "设置新密码" : "链接已经失效"}</h1>
      {user ? <>
        <p className="lede">正在为 <strong className="auth-email">{user.email}</strong> 设置新密码。</p>
        <ResetPasswordForm />
      </> : <>
        <p className="lede">密码恢复链接只能使用一次，并会在一段时间后失效。请重新发送一封邮件。</p>
        <Link className="primary full auth-primary-link" href="/forgot-password">重新发送密码邮件</Link>
      </>}
      <Link className="auth-back-link" href="/login">← 返回登录</Link>
    </section>
  </main>;
}
