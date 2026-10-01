import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { loadAccountModules } from "@/lib/module-access";
import { MODULE_LABELS, type ModuleKey } from "@/lib/module-keys";

export async function ModuleGate({ moduleKey, children }: { moduleKey: ModuleKey; children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const access = user ? await loadAccessContext(supabase, user.id) : null;
  const enabled = user && access ? await loadAccountModules(supabase, access, user.id) : [];
  if (!enabled.includes(moduleKey)) return <section className="panel module-locked"><span aria-hidden="true">✦</span><h1>{MODULE_LABELS[moduleKey]}尚未开通</h1><p>学习记录仍安全保留。请联系空间 owner 在“用户与家庭”中开通后再来。</p></section>;
  return children;
}
