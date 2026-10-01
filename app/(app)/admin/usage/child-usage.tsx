import type { SupabaseClient } from "@supabase/supabase-js";
import { familyNameOf, orderLearners, type LearnerChoice } from "@/components/learner-options";
import { fixedMonthlyUsd, loadCostModel, variableCostUsd, type UsageRow } from "@/lib/usage-cost";
import { loadAuthDirectory } from "@/lib/auth-directory";

type Activity = { user_id: string; learner_id: string | null; active_days: number; active_seconds: number; visits: number; last_seen_at: string | null };
type Learning = { learner_id: string; hanzi_answers: number; poem_records: number; game_sessions: number; game_seconds: number; music_records: number; catechism_records: number };
type Service = UsageRow & { user_id: string; learner_id: string | null };

const yuan = (usd: number, rate: number) => `¥${(usd * rate).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const minutes = (seconds: number) => seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} 小时` : `${Math.round(seconds / 60)} 分钟`;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export async function ChildUsageSection({ db, workspaceId, ownFamilyId, days, from, to }: {
  db: SupabaseClient; workspaceId: string; ownFamilyId: string | null; days: number; from: Date; to: Date;
}) {
  const [learnerResult, activityResult, learningResult, serviceResult] = await Promise.all([
    db.from("learner_profiles").select("id,display_name,family_id,families(name)").order("created_at"),
    db.rpc("workspace_activity_summary", { p_workspace_id: workspaceId, p_from: isoDate(from), p_to: isoDate(to) }),
    db.rpc("workspace_learner_usage", { p_workspace_id: workspaceId, p_from: from.toISOString(), p_to: to.toISOString() }),
    db.rpc("workspace_service_usage_v2", { p_workspace_id: workspaceId, p_from: from.toISOString(), p_to: to.toISOString() }),
  ]);
  if (activityResult.error || learningResult.error || serviceResult.error) {
    return <section className="panel"><h2>孩子使用情况与成本估算</h2><p className="notice" role="alert">需要先在 Supabase 运行 <code>supabase/022_music_folders_activity_and_cost.sql</code>。运行后，使用时长从部署新版起开始累计。</p></section>;
  }
  const model = loadCostModel();
  const learners = orderLearners(learnerResult.data as LearnerChoice[] | null, ownFamilyId);
  const activity = (activityResult.data ?? []) as Activity[];
  const learning = new Map(((learningResult.data ?? []) as Learning[]).map((row) => [row.learner_id, row]));
  const services = (serviceResult.data ?? []) as Service[];

  const fixedPeriodUsd = fixedMonthlyUsd(model) * days / 30;
  const perLearner = learners.map((learner) => {
    const acts = activity.filter((row) => row.learner_id === learner.id);
    const usage = services.filter((row) => row.learner_id === learner.id);
    const learn = learning.get(learner.id);
    const records = learn ? Number(learn.hanzi_answers) + Number(learn.poem_records) + Number(learn.game_sessions) + Number(learn.music_records) + Number(learn.catechism_records) : 0;
    const seconds = acts.reduce((sum, row) => sum + Number(row.active_seconds), 0);
    return {
      learner, learn, records, seconds,
      activeDays: acts.reduce((max, row) => Math.max(max, Number(row.active_days)), 0),
      visits: acts.reduce((sum, row) => sum + Number(row.visits), 0),
      images: usage.filter((row) => row.service === "image").reduce((sum, row) => sum + Number(row.requests), 0),
      ttsChars: usage.filter((row) => row.service === "tts").reduce((sum, row) => sum + Number(row.characters), 0),
      variableUsd: usage.reduce((sum, row) => sum + variableCostUsd(row, model), 0),
    };
  });
  const active = perLearner.filter((row) => row.seconds > 0 || row.records > 0);
  const fixedShareUsd = active.length ? fixedPeriodUsd / active.length : 0;
  const learnerVariableUsd = perLearner.reduce((sum, row) => sum + row.variableUsd, 0);
  const accountIds = [...new Set([...services.filter((row) => !row.learner_id).map((row) => row.user_id), ...activity.filter((row) => !row.learner_id).map((row) => row.user_id)])];
  const accounts = accountIds.map((id) => ({
    id,
    seconds: activity.filter((row) => row.user_id === id && !row.learner_id).reduce((sum, row) => sum + Number(row.active_seconds), 0),
    variableUsd: services.filter((row) => row.user_id === id && !row.learner_id).reduce((sum, row) => sum + variableCostUsd(row, model), 0),
  })).sort((a, b) => b.variableUsd - a.variableUsd);
  const emails = new Map<string, string>();
  try {
    const found = await loadAuthDirectory(accounts.map(({ id }) => id));
    for (const { id } of accounts) if (found.get(id)?.email) emails.set(id, found.get(id)!.email!);
  } catch {}
  const accountLabel = (id: string) => emails.get(id) ?? `账号 ${id.slice(0, 8)}`;
  const accountVariableUsd = accounts.reduce((sum, row) => sum + row.variableUsd, 0);
  const totalUsd = fixedPeriodUsd + learnerVariableUsd + accountVariableUsd;
  const monthly = (usd: number) => usd * 30 / days;
  const avgVariableMonthly = active.length ? monthly(learnerVariableUsd) / active.length : 0;
  const perChildAt = (children: number) => fixedMonthlyUsd(model) / children + avgVariableMonthly + monthly(accountVariableUsd) / Math.max(children, 1);

  return <section className="panel child-usage">
    <div className="section-heading"><div><p className="eyebrow">Per child · estimate</p><h2>孩子使用情况与成本估算</h2><p className="library-meta">最近 {days} 天。时长只统计页面在前台且最近有操作（或正在播放音频）的时间；金额是按下方单价的测算，不是账单。</p></div></div>
    <div className="usage-totals">
      <div><strong>{yuan(totalUsd, model.usdToCny)}</strong><span>本期估算总成本（含固定月费分摊）</span></div>
      <div><strong>{active.length} / {learners.length}</strong><span>本期活跃孩子 / 全部孩子</span></div>
      <div><strong>{active.length ? yuan(monthly(fixedPeriodUsd / active.length) + avgVariableMonthly, model.usdToCny) : "—"}</strong><span>按当前人数，每位活跃孩子每月</span></div>
      <div><strong>{yuan(perChildAt(50), model.usdToCny)}</strong><span>若 50 个孩子，每人每月约</span></div>
    </div>
    {!perLearner.length ? <p className="notice">还没有孩子档案。</p> : <div className="child-usage-table" role="table" aria-label="每个孩子的使用与成本">
      <div className="child-usage-row head" role="row"><span role="columnheader">孩子</span><span role="columnheader">使用</span><span role="columnheader">学习记录</span><span role="columnheader">AI / 语音</span><span role="columnheader">估算成本</span></div>
      {perLearner.map((row) => <div className={`child-usage-row ${row.seconds || row.records ? "" : "idle"}`} role="row" key={row.learner.id}>
        <span role="cell"><strong>{row.learner.display_name}</strong><small>{familyNameOf(row.learner) || "未命名家庭"}</small></span>
        <span role="cell">{row.seconds ? minutes(row.seconds) : "—"}<small>{row.activeDays} 天 · 打开 {row.visits} 次</small></span>
        <span role="cell">{row.records}<small>{row.learn ? `字 ${row.learn.hanzi_answers} · 诗 ${row.learn.poem_records} · 游戏 ${row.learn.game_sessions} · 乐 ${row.learn.music_records} · 问 ${row.learn.catechism_records}` : "—"}</small></span>
        <span role="cell">{row.images} 张图<small>朗读 {row.ttsChars.toLocaleString("zh-CN")} 字</small></span>
        <span role="cell"><strong>{yuan(row.variableUsd + (row.seconds || row.records ? fixedShareUsd : 0), model.usdToCny)}</strong><small>AI {yuan(row.variableUsd, model.usdToCny)} + 固定 {yuan(row.seconds || row.records ? fixedShareUsd : 0, model.usdToCny)}</small></span>
      </div>)}
    </div>}
    {accounts.length > 0 && <details className="details-block"><summary>家长账号自用（会议英语、家长页等，未归到孩子）· {yuan(accountVariableUsd, model.usdToCny)}</summary><ul className="plain-list">{accounts.map((row) => <li key={row.id}>{accountLabel(row.id)}：使用 {minutes(row.seconds)} · AI/语音 {yuan(row.variableUsd, model.usdToCny)}</li>)}</ul></details>}
    <details className="details-block"><summary>测算方法与单价（可在环境变量中修改）</summary>
      <ul className="plain-list">
        <li>固定月费：Vercel Pro ${model.fixedMonthlyUsd.vercelPro} + Supabase Pro ${model.fixedMonthlyUsd.supabasePro} + R2 ${model.fixedMonthlyUsd.r2} + 其他 ${model.fixedMonthlyUsd.other} = ${fixedMonthlyUsd(model)}/月，按天折算后平均分给本期活跃孩子（<code>COST_*_MONTHLY_USD</code>）。</li>
        <li>AI 文本：输入 ${model.textInputPerM} / 缓存输入 ${model.textCachedInputPerM} / 输出 ${model.textOutputPerM} 每百万 Token（<code>COST_TEXT_*</code>）。</li>
        <li>AI 图片：输入 ${model.imageInputPerM} / 输出 ${model.imageOutputPerM} 每百万 Token；未返回 Token 时每张按 ${model.imageFallbackEach}（<code>COST_IMAGE_*</code>）。</li>
        <li>语音朗读 ${model.ttsPerMChars} / 百万字符；语音识别 ${model.sttPerHour} / 小时（<code>COST_TTS_PER_M_CHARS_USD</code>、<code>COST_STT_PER_HOUR_USD</code>）。汇率 {model.usdToCny}（<code>COST_USD_TO_CNY</code>）。</li>
        <li>失败或结果未知的请求也计入，宁可高估。超出 Vercel / Supabase 套餐额度的流量、存储和函数时长未计入；以各平台账单为准。</li>
      </ul>
    </details>
  </section>;
}
