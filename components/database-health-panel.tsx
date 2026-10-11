import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDatabaseHealth } from "@/lib/database-health";
import { databaseBudget, databaseGrowth, formatDatabaseBytes, type DatabaseHealth } from "@/lib/database-health-values";

const count=(n:number)=>Math.round(n).toLocaleString("zh-CN");
const names:Record<string,string>={"public.characters":"汉字内容","public.learning_attempts":"汉字逐次作答","public.daily_session_items":"汉字每日排队项","public.daily_character_progress":"汉字当日确认","public.learning_states":"汉字记忆状态","public.poems":"诗词内容","public.poem_recitation_attempts":"诗词打卡","public.music_practice_attempts":"音乐练习","public.catechism_attempts":"问答练习","public.kids_english_words":"儿童英语词条","public.service_usage_events":"AI / 语音调用"};

export function DatabaseHealthView({data,plan,budgetMb}:{data:DatabaseHealth;plan?:string;budgetMb?:string}) {
  const budget=databaseBudget(plan,budgetMb);
  const ratio=budget.bytes===null?null:data.clusterDatabaseBytes/budget.bytes*100;
  const stale=data.stale??false;
  const growth7=databaseGrowth(data.history,data.capturedAt,data.clusterDatabaseBytes,7);
  const growth30=databaseGrowth(data.history,data.capturedAt,data.clusterDatabaseBytes,30);
  const growth=(value:ReturnType<typeof databaseGrowth>)=>value?`${value.bytes>=0?"+":"−"}${formatDatabaseBytes(Math.abs(value.bytes))} / ${value.days} 天`:"样本还不足";
  const positiveDaily=growth30&&growth30.bytes>0?growth30.bytes/growth30.days:null;
  const remainingDays=budget.bytes!==null&&positiveDaily?Math.max(0,Math.floor((budget.bytes-data.clusterDatabaseBytes)/positiveDaily)):null;
  const warning=data.readOnly?"数据库当前事务为只读，请立刻检查 Supabase 状态与磁盘 / 套餐额度。":ratio!==null&&ratio>=95?"已达到数据库预警预算的 95%，请尽快核实平台用量并准备扩容，暂缓大批导入。":ratio!==null&&ratio>=85?"已达到数据库预警预算的 85%，建议现在核实 Supabase 用量并评估升级。":ratio!==null&&ratio>=70?"已达到数据库预警预算的 70%，可以开始准备扩容计划。":remainingDays!==null&&remainingDays<=60?"按已有增长样本，预警预算可能在 60 天内达到，请提前核实平台用量。":"数据库大小暂未触及已设置的预警线；容量充足不代表并发性能已验证。";
  const recorded=new Date(new Date(data.capturedAt).getTime()+8*3600000).toISOString().slice(0,16).replace("T"," ");
  const contentTables=["public.characters","public.poems","public.kids_english_words","public.catechism_items","public.learner_profiles"];
  return <section className="panel database-health-panel" aria-label="数据库容量与健康">
    <div className="section-heading"><div><p className="eyebrow">Database health · Owner only</p><h2>数据库容量</h2></div><span className={`database-health-badge ${ratio!==null&&ratio>=70||data.readOnly?"is-warning":""}`}>{ratio===null?"未设置预算":`${Math.round(ratio)}% 参考预算`}</span></div>
    <p className="capacity-context">全项目统计，仅系统 owner 可见 · 采样 {recorded}（北京时间）· 最多缓存 5 分钟</p>
    {(stale||!data.snapshotSaved) && <p className="notice" role="status">{stale?"当前显示较早的采样，不能视为实时用量。":"本次采样未能保存；下方大小仍为实际查询结果。"}</p>}
    <p className={`database-health-signal ${ratio!==null&&ratio>=70||data.readOnly?"is-warning":""}`} role="status">{warning}</p>
    <div className="database-health-metrics"><div><span>数据库总大小</span><strong>{formatDatabaseBytes(data.clusterDatabaseBytes)}</strong><small>同实例所有数据库；不含 WAL / 系统日志</small></div><div><span>业务表与索引</span><strong>{formatDatabaseBytes(data.businessBytes)}</strong><small>public + private · {data.tableCount} 张表</small></div><div><span>其中索引</span><strong>{formatDatabaseBytes(data.indexBytes)}</strong><small>已包含在业务大小内，不要重复相加</small></div><div><span>业务记录（估算）</span><strong>{count(data.estimatedRows)}</strong><small>来自 PostgreSQL 统计，不是逐表精确扫描</small></div></div>
    <div className="database-health-budget"><div><strong>{budget.label}</strong><span>{budget.bytes===null?"未设置":`${formatDatabaseBytes(data.clusterDatabaseBytes)} / ${formatDatabaseBytes(budget.bytes)}`}</span></div>{ratio!==null && <div className={`capacity-bar ${ratio>=70?"database-bar-warning":""}`} role="progressbar" aria-label="数据库参考预算使用比例" aria-valuenow={Math.min(100,Math.max(0,Math.round(ratio)))} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${Math.min(100,Math.max(0,ratio))}%`}} /></div>}<p>套餐标记：{plan?.trim()||"未填写"}。此预算仅供提醒；Pro 包含的磁盘空间不是数据库配额。实际磁盘占用和剩余容量：尚未接入，请到 Supabase 查看。</p></div>
    <div className="database-health-trends"><div><span>近 7 天增长</span><strong>{growth(growth7)}</strong></div><div><span>近 30 天增长</span><strong>{growth(growth30)}</strong></div><div><span>预计触及参考预算</span><strong>{remainingDays===null?"暂不推算":`${remainingDays} 天左右`}</strong></div></div>
    <p className="helper-text">每天首次访问留下样本，当天刷新更新同一条；保留 120 天。没有访问的日期不补造数据，预测只根据实际样本，不是保证或账单。</p>
    <div className="database-health-counts">{contentTables.map(name=>{const table=data.tables.find(row=>row.name===name);return table?<span key={name}>{names[name]??"孩子档案"} <strong>≈ {count(table.estimatedRows)}</strong></span>:null;})}</div>
    <details className="database-health-tables"><summary>查看占用最多的 10 张业务表</summary><div className="database-table-scroll"><table><caption>数据大小含表与 TOAST；总大小另含索引。记录数为统计估算。</caption><thead><tr><th scope="col">数据表</th><th scope="col">估算记录</th><th scope="col">数据</th><th scope="col">索引</th><th scope="col">总大小</th></tr></thead><tbody>{data.tables.slice(0,10).map(table=><tr key={table.name}><th scope="row">{names[table.name]??table.name}<small>{names[table.name]?table.name:""}</small></th><td>≈ {count(table.estimatedRows)}</td><td>{formatDatabaseBytes(table.dataBytes)}</td><td>{formatDatabaseBytes(table.indexBytes)}</td><td>{formatDatabaseBytes(table.totalBytes)}</td></tr>)}</tbody></table></div></details>
    <p className="capacity-context">R2 的 MP3、图片、视频和音频缓存不计入这个数据库大小。当前 postgres 库 {formatDatabaseBytes(data.databaseBytes)}。请核实 <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">Supabase Database Reports / Database Settings ↗</a>；本页不读取系统文件、不自动购买套餐、不自动删学习历史。</p>
  </section>;
}

export async function DatabaseHealthPanel({db,userId}:{db:SupabaseClient;userId:string}) {
  let data:DatabaseHealth|undefined;
  let message="";
  try { data=await loadDatabaseHealth(db,userId); }
  catch(error) {message=error instanceof Error?error.message:"暂时无法读取容量，请稍后再试";}
  if(!data) return <section className="panel database-health-panel"><h2>数据库容量</h2><p className="notice" role="alert">{message}</p><p className="helper-text">读取失败不代表用量为零。学习页面不依赖本容量报表。</p></section>;
  return <DatabaseHealthView data={data} plan={process.env.CAPACITY_SUPABASE_PLAN} budgetMb={process.env.DATABASE_HEALTH_BUDGET_MB} />;
}
