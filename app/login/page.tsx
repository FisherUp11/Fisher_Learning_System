import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand"><span className="brand-mark">字</span><span>字芽</span></div>
        <h1>每天认识一点字。</h1>
        <p className="lede">家长登录后，为孩子建立一个能慢慢记住的识字节奏。</p>
        <LoginForm />
      </section>
    </main>
  );
}
