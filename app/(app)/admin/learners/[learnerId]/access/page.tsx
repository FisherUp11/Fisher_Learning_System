import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OwnerChildAccessManager } from "@/components/owner-child-access-manager";
import { loadAccessContext } from "@/lib/access";
import { beijingDate } from "@/lib/hanzi-terms";
import { CHILD_MODULES, MODULE_LABELS, type ChildModuleKey } from "@/lib/module-keys";
import type { ChildTerm } from "@/lib/child-access";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OwnerChildAccessPage({ params, searchParams }: { params: Promise<{ learnerId: string }>; searchParams: Promise<{ mode?: string }> }) {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(db, user.id);
  if (!access?.isOwner) redirect(access?.isAdmin ? "/admin" : "/parent");
  const { learnerId } = await params;
  if (!/^[\da-f-]{36}$/i.test(learnerId)) notFound();
  const { data: learner, error } = await db.from("learner_profiles").select("id,display_name,family_id,families!inner(name,status,workspace_id)").eq("id", learnerId).eq("families.workspace_id", access.workspaceId).maybeSingle();
  if (error || !learner) notFound();
  const family = Array.isArray(learner.families) ? learner.families[0] : learner.families;
  const [hanzi, extra, flags, trial, siblings, billing, events, parents] = await Promise.all([
    db.from("learner_hanzi_terms").select("learner_id,mode,starts_on,valid_until,version,grant_kind").eq("learner_id", learnerId).maybeSingle(),
    db.from("learner_module_terms").select("learner_id,module_key,mode,starts_on,valid_until,version,grant_kind").eq("learner_id", learnerId),
    db.from("learner_module_access").select("module_key,enabled").eq("learner_id", learnerId),
    db.from("learner_trial_windows").select("starts_on,valid_until").eq("learner_id", learnerId).maybeSingle(),
    db.from("learner_profiles").select("id,display_name").eq("family_id", learner.family_id).order("created_at").order("id"),
    db.from("family_hanzi_billing").select("standard_learner_id").eq("family_id", learner.family_id).maybeSingle(),
    db.from("hanzi_term_events").select("id,action,months,amount_cents,after_state,created_at,note").eq("learner_id", learnerId).order("created_at", { ascending: false }).limit(10),
    db.from("family_members").select("user_id").eq("family_id", learner.family_id).eq("status", "active"),
  ]);
  const failed = [hanzi, extra, flags, trial, siblings, billing, events, parents].some(result => result.error);
  const parentIds = (parents.data ?? []).map(row => row.user_id);
  const accountFlags = parentIds.length ? await db.from("account_module_access").select("module_key,enabled,workspace_members!inner(status)").eq("workspace_id", access.workspaceId).in("user_id", parentIds).eq("workspace_members.status", "active").eq("enabled", true) : { data: [], error: null };
  const enabledAccounts = new Set((accountFlags.data ?? []).map(row => row.module_key));
  const modules = CHILD_MODULES.map(key => ({ key, enabled: Boolean(flags.data?.find(row => row.module_key === key)?.enabled), term: (key === "hanzi" ? hanzi.data : extra.data?.find(row => row.module_key === key)) as ChildTerm | null ?? null }));
  const query = await searchParams;
  return <div><Link className="back-link" href="/admin/families">← 家庭与孩子</Link>
    <header className="hero"><p className="eyebrow">Owner · Learning access</p><h1>{learner.display_name} · 开通 / 续期</h1><p className="lede">{family?.name}。默认只调整汉字；勾选附加模块可一起延期，不改动未勾选模块。</p></header>
    {family?.status !== "active" && <p className="notice">这个家庭已停用。保存授权不会恢复家庭访问。</p>}
    {accountFlags.error ? <p className="notice">家长入口状态暂时读取失败，请到用户管理核对。</p> : <p className="notice">家庭正常账号已开启的入口：{CHILD_MODULES.filter(key => enabledAccounts.has(key)).map(key => MODULE_LABELS[key]).join("、") || "暂无"}。孩子授权不会自动打开家长账号入口，必要时到 <Link href="/admin/users">用户管理</Link> 开启。</p>}
    <section className="panel">{failed ? <p className="form-error">授权资料尚未完整加载。请先整段执行 <code>supabase/040_owner_children_and_module_terms.sql</code>，再刷新；资料不完整时禁止提交，避免覆盖原权益。</p> : <OwnerChildAccessManager learnerId={learnerId} learnerName={learner.display_name} modules={modules} siblings={siblings.data ?? []} standardLearnerId={billing.data?.standard_learner_id ?? null} today={beijingDate()} trial={trial.data} startWithTrial={query.mode === "trial"} />}</section>
    <div className="child-access-links"><Link className="secondary compact" href={`/admin/assignments?learner=${learnerId}`}>分配字册与课程</Link><Link className="text-button" href={`/admin/learners/${learnerId}`}>学习详情与全部授权记录 →</Link></div>
    <section className="panel"><h2>最近授权记录</h2><p className="helper-text">按北京时间到期；免费试用不收费。以下是人工授权记录，不代表在线支付凭证。</p>{events.data?.map(event => {
      const keys = Object.keys(event.after_state?.modules ?? { hanzi: {} }).filter(key => CHILD_MODULES.includes(key as ChildModuleKey));
      return <article className="list-row" key={event.id}><div><strong>{event.action === "trial" ? "免费试用" : event.action === "term" ? `开通 / 续期 ${event.months} 个月` : event.action === "permanent" ? "长期授权" : "暂停 / 恢复"} · ¥{event.amount_cents / 100}</strong><p className="small muted">{keys.map(key => MODULE_LABELS[key as ChildModuleKey]).join("、")} · {new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(new Date(event.created_at))}{event.note ? ` · ${event.note}` : ""}</p></div></article>;
    })}{!events.data?.length && <p className="muted">暂无人工授权记录。</p>}</section>
  </div>;
}
