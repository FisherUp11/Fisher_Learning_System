import Link from "next/link";
import { AcceptInvitationForm } from "@/components/accept-invitation-form";
import { validInvitationToken } from "@/lib/invitation";
import { loadAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const access = user ? await loadAccessContext(supabase, user.id) : null;
  const nextPath = `/join?token=${encodeURIComponent(token)}`;

  return <main className="login-page">
    <section className="login-card join-card">
      <div className="login-brand"><span className="brand-mark">字</span><span>字芽</span></div>
      <p className="eyebrow">Family invitation</p>
      <h1>加入孩子的学习空间</h1>
      {!validInvitationToken(token) ? <>
        <p className="notice">{access ? "你已加入学习空间，可以直接进入。" : "尚未加入学习空间。请打开管理员发送的完整邀请链接；也可以让 owner 创建邮箱账号及临时密码后直接登录。"}</p>
        <Link className="secondary full" href={access ? "/parent" : "/login"}>{access ? "进入学习空间" : "返回登录"}</Link>
      </> : !user ? <>
        <p className="lede">请用收到邀请的邮箱登录；没有账号可在登录页直接创建。</p>
        <Link className="primary full" href={`/login?next=${encodeURIComponent(nextPath)}`}>登录或创建家长账号</Link>
      </> : <AcceptInvitationForm token={token} email={user.email ?? "当前账号"} />}
    </section>
  </main>;
}
