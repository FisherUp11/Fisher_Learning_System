import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceGuardLimits } from "@/lib/service-guard";
import type { ServiceKind } from "@/lib/service-usage-values";

type Snapshot = { service: ServiceKind; minute_calls: number; day_calls: number; day_characters: number; day_audio_seconds: number; day_denials: number; day_provider_429: number; last_denied_at: string | null; last_provider_429_at: string | null; day_peak_minute_calls: number };
const names: Record<ServiceKind, string> = { text: "AI 文本", image: "AI 图片", tts: "Azure 朗读", stt: "语音识别" };
const kinds: ServiceKind[] = ["text", "image", "tts", "stt"];

/** Server component: one capacity snapshot per admin page load, never a live billing claim. */
export async function AdminCapacityPanel({ db, workspaceId }: { db: SupabaseClient; workspaceId: string }) {
  const [children, snapshot] = await Promise.all([
    db.from("learner_profiles").select("id,families!inner(workspace_id)", { count: "exact", head: true }).eq("families.workspace_id", workspaceId),
    db.rpc("workspace_capacity_snapshot", { p_workspace_id: workspaceId }),
  ]);
  if (children.error || snapshot.error || !Array.isArray(snapshot.data) || snapshot.data.length !== kinds.length) return <section className="panel capacity-panel"><h2>容量与 Azure 保护</h2><p className="notice" role="alert">容量报表尚未就绪。请先运行 <code>supabase/023_capacity_guard_50_learners.sql</code>；若已经运行，请检查权限和数据库日志。本页不会把读取失败显示为“零用量”。</p></section>;

  const childCount = children.count ?? 0;
  const rows = (snapshot.data ?? []) as Snapshot[];
  const byKind = new Map(rows.map((row) => [row.service, row]));
  const atCapacity = childCount >= 50;
  const nearingCapacity = childCount >= 40;
  const supabasePlan = process.env.CAPACITY_SUPABASE_PLAN?.trim() || "未填写";
  const vercelPlan = process.env.CAPACITY_VERCEL_PLAN?.trim() || "未填写";
  const starterPlan = /\bfree\b|免费|nano/i.test(supabasePlan) || /\bhobby\b|爱好/i.test(vercelPlan);
  const problemKinds = kinds.filter((kind) => {
    const row = byKind.get(kind);
    const limits = serviceGuardLimits(kind);
    return row && (Number(row.day_peak_minute_calls) >= limits.workspaceMinute * .8 || Number(row.minute_calls) >= limits.workspaceMinute * .8 || Number(row.day_calls) >= limits.workspaceDay * .8 || Number(row.day_denials) > 0 || Number(row.day_provider_429) > 0 || (limits.workspaceUnitsDay !== null && Number(kind === "tts" ? row.day_characters : row.day_audio_seconds) >= limits.workspaceUnitsDay * .8));
  });
  const signals = [
    atCapacity ? "已到 50 个孩子：数据库会拒绝继续创建孩子，请先评估容量。" : childCount >= 45 ? "孩子人数已接近上限；现在检查 Supabase、Vercel 套餐及 Azure 配额。" : nearingCapacity ? "孩子人数达到 40：建议开始检查平台用量和高峰响应时间。" : "孩子人数仍在预设的 50 人范围内。",
    nearingCapacity && starterPlan ? "当前标记为免费 / Hobby 档位：请核实实际套餐，按平台用量与使用资格评估 Supabase/Vercel Pro 或更高计算规格。" : null,
    ...problemKinds.map((kind) => `${names[kind]}今日接近保护线、曾被保护拦截，或 Azure 返回过 429；请查看下面的数字。`),
  ].filter((signal): signal is string => Boolean(signal));

  return <section className="panel capacity-panel" aria-label="容量与 Azure 使用保护">
    <div className="section-heading"><div><p className="eyebrow">Capacity watch</p><h2>容量与 Azure 使用保护</h2></div><span className={`capacity-count ${nearingCapacity ? "capacity-count-warn" : ""}`}>{childCount} / 50 孩子</span></div>
    <p className="capacity-context">管理员提醒基于应用数据库记录；Supabase、Vercel、Azure 的真实套餐余额仍需到各平台查看。今天按北京时间计算。</p>
    <div className="capacity-signals" role="status">{signals.map((signal) => <p key={signal} className={signal.includes("请") || signal.includes("接近") || signal.includes("拦截") ? "capacity-signal-warn" : ""}>{signal}</p>)}</div>
    <div className="capacity-grid">{kinds.map((kind) => {
      const row = byKind.get(kind);
      const limits = serviceGuardLimits(kind);
      const daily = Number(row?.day_calls ?? 0);
      const units = kind === "tts" ? Number(row?.day_characters ?? 0) : Number(row?.day_audio_seconds ?? 0);
      const unitRatio = limits.workspaceUnitsDay === null ? 0 : units / limits.workspaceUnitsDay * 100;
      const ratio = Math.min(100, Math.round(Math.max(daily / limits.workspaceDay * 100, unitRatio)));
      const warn = ratio >= 80 || Number(row?.day_peak_minute_calls ?? 0) >= limits.workspaceMinute * .8 || Number(row?.minute_calls ?? 0) >= limits.workspaceMinute * .8 || Number(row?.day_denials ?? 0) > 0 || Number(row?.day_provider_429 ?? 0) > 0;
      return <article className={`capacity-service ${warn ? "capacity-service-warn" : ""}`} key={kind}>
        <div className="capacity-service-head"><strong>{names[kind]}</strong><span>{ratio}%</span></div>
        <div className="capacity-bar" role="progressbar" aria-valuenow={daily} aria-valuemin={0} aria-valuemax={limits.workspaceDay} aria-label={`${names[kind]}今日空间调用`}><span style={{ width: `${ratio}%` }} /></div>
        <p>今日 {daily} / {limits.workspaceDay} 次 · 近一分钟 {Number(row?.minute_calls ?? 0)} / {limits.workspaceMinute}</p>
        <small>今天最高单分钟 {Number(row?.day_peak_minute_calls ?? 0)} 次</small>
        {limits.workspaceUnitsDay !== null && <small>今日{kind === "tts" ? "朗读字符" : "转写音频"} {Math.round(units).toLocaleString("zh-CN")} / {limits.workspaceUnitsDay.toLocaleString("zh-CN")} {kind === "tts" ? "字" : "秒"}</small>}
        <small>今日保护拦截 {Number(row?.day_denials ?? 0)} · Azure 429 {Number(row?.day_provider_429 ?? 0)} · 每账号上限 {limits.accountDay} 次/日</small>
      </article>;
    })}</div>
    <p className="capacity-context">当前设置：Supabase {supabasePlan} · Vercel {vercelPlan}。保护阈值可在 Vercel 环境变量中调整；接近 50 人时先看 <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">Supabase 项目用量</a>、<a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer">Vercel Usage</a> 和 <a href="https://ai.azure.com" target="_blank" rel="noopener noreferrer">Azure 配额/监控</a>，再决定是否升级。报表不自动读取或承诺第三方套餐额度。</p>
  </section>;
}
