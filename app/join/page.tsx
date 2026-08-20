import Link from "next/link";
import { acceptWorkspaceInvitation } from "@/lib/admin-actions";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const nextPath = `/join?token=${encodeURIComponent(token)}`;

  return <main className="login-page">
    <section className="login-card join-card">
      <div className="login-brand"><span className="brand-mark">字</span><span>字芽</span></div>
      <p className="eyebrow">Family invitation</p>
      <h1>加入孩子的学习空间</h1>
      {!token ? <>
        <p className="notice">这个页面需要完整的邀请链接。请让管理员重新发送。</p>
        <Link className="secondary full" href="/login">返回登录</Link>
      </> : !user ? <>
        <p className="lede">请用收到邀请的邮箱登录；没有账号可在登录页直接创建。</p>
        <Link className="primary full" href={`/login?next=${encodeURIComponent(nextPath)}`}>登录或创建家长账号</Link>
      </> : <form action={acceptWorkspaceInvitation} className="form-grid">
        <input type="hidden" name="token" value={token} />
        <p className="notice">当前账号：<strong>{user.email}</strong><br />确认后，只能看到自己家庭的孩子详情；管理员负责分配公共学习资源。</p>
        <button className="primary full" type="submit">确认加入</button>
        <Link className="text-button" href="/login">换一个账号</Link>
      </form>}
    </section>
  </main>;
}
