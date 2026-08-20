import { LoginForm } from "@/components/login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string; error?: string }> }) {
  const params = await searchParams;
  const nextPath = params.next?.startsWith("/") && !params.next.startsWith("//") ? params.next : "/learn";
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand"><span className="brand-mark">字</span><span>字芽</span></div>
        <h1>每天认识一点字。</h1>
        <p className="lede">家长登录后，为孩子建立一个能慢慢记住的识字节奏。</p>
        {params.reset === "success" && <p className="success-box auth-page-feedback">密码已经修改成功，请使用新密码登录。</p>}
        {params.error && <p className="form-error auth-page-feedback">登录链接无效或已经过期，请重新操作。</p>}
        <LoginForm nextPath={nextPath} />
      </section>
    </main>
  );
}
