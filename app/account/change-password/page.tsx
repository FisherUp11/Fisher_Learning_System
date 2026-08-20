import { redirect } from "next/navigation";
import { InitialPasswordForm } from "@/components/owner-user-manager";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ChangeInitialPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/account/change-password");
  const { data: profile } = await supabase.from("workspace_user_profiles")
    .select("must_change_password,display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.must_change_password) redirect("/learn");
  return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">First sign-in</p><h1>先设置你的新密码</h1><p className="lede">{profile.display_name}，这是你第一次使用临时密码登录。设置只有你知道的新密码后，就可以进入孩子的学习空间。</p><InitialPasswordForm /></section></main>;
}
