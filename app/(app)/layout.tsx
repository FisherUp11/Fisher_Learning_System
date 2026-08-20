import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";
import { loadAccessContext } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(supabase, user.id);
  if (!access) redirect("/join");
  const { data: profile } = await supabase.from("workspace_user_profiles").select("must_change_password").eq("user_id", user.id).maybeSingle();
  if (profile?.must_change_password) redirect("/account/change-password");
  return <AppShell email={user.email ?? "家长"} isAdmin={access.isAdmin} isOwner={access.isOwner}>{children}</AppShell>;
}
