import Link from "next/link";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="login-page">
    <section className="login-card auth-flow-card">
      <div className="login-brand"><span className="brand-mark">字</span><span>字芽</span></div>
      <div className="auth-flow-mark" aria-hidden="true">信</div>
      <p className="eyebrow">Password recovery</p>
      <h1>找回密码</h1>
      <p className="lede">输入登录邮箱，我们会发一封只能使用一次的密码重置邮件。</p>
      {error && <p className="form-error auth-page-feedback">链接无效、已经使用或已经过期，请重新发送一封邮件。</p>}
      <ForgotPasswordForm />
      <Link className="auth-back-link" href="/login">← 返回登录</Link>
    </section>
  </main>;
}
