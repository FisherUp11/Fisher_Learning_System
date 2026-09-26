import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAccessContext } from "@/lib/access";

export const dynamic = "force-dynamic";
type Usage = {user_id:string;service:string;model:string;requests:number;succeeded:number;failed:number;uncertain:number;input_tokens:number|null;output_tokens:number|null;cached_input_tokens:number|null;token_unknown:number;characters:number;images:number;audio_seconds:number};
const names:Record<string,string> = {text:"AI 文本",image:"AI 图片",tts:"语音朗读",stt:"语音识别"};
const number = (value:number|null) => value === null ? "未返回" : Number(value).toLocaleString("zh-CN",{maximumFractionDigits:1});

export default async function UsagePage({searchParams}:{searchParams:Promise<{days?:string;user?:string}>}) {
  const db = await createClient();
  const {data:{user}} = await db.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(db,user.id);
  if (!access?.isAdmin) redirect("/parent");
  const params = await searchParams;
  const days = [7,30,90].includes(Number(params.days)) ? Number(params.days) : 30;
  const to = new Date();
  const from = new Date(to.getTime()-days*86400000);
  const {data,error} = await db.rpc("workspace_service_usage",{p_workspace_id:access.workspaceId,p_from:from.toISOString(),p_to:to.toISOString()});
  const rows = (data ?? []) as Usage[];
  const ids = [...new Set(rows.map(r=>r.user_id))];
  const labels = new Map<string,string>();
  let labelWarning = false;
  try {
    const admin = createAdminClient();
    await Promise.all(ids.map(async id=>{
      const {data,error} = await admin.auth.admin.getUserById(id);
      labels.set(id,!error && data.user?.email ? data.user.email : `账号 ${id.slice(0,8)}`);
    }));
  } catch { labelWarning=true; }
  const filtered = params.user ? rows.filter(r=>r.user_id===params.user) : rows;
  const sum = (key:"requests"|"failed"|"uncertain") => filtered.reduce((n,r)=>n+Number(r[key]),0);
  return <div>
    <header className="hero"><p className="eyebrow">Service usage</p><h1>AI 与语音用量</h1><p className="lede">按登录账号记录付费服务请求。只显示用量，不展示私人会议、提示词或录音。</p></header>
    <section className="panel">
      <form className="field-grid" action="/admin/usage" method="get">
        <label>统计区间<select name="days" defaultValue={days}><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option></select></label>
        <label>账号<select name="user" defaultValue={params.user ?? ""}><option value="">全部有调用的账号</option>{ids.map(id=><option key={id} value={id}>{labels.get(id) ?? `账号 ${id.slice(0,8)}`}</option>)}</select></label>
        <button className="secondary" type="submit">查看 / 刷新</button>
      </form>
      <p className="helper-text">统计从部署新版后开始；浏览器或 R2 缓存直接播放不产生新的 Azure 调用。账号没有记录不代表历史从未使用。</p>
      {error ? <p className="notice" role="alert">用量表尚未就绪或读取失败。请先运行 supabase/021_invitation_and_service_usage.sql，然后刷新。没有显示数据不代表零用量。</p> : <>
        <div className="usage-totals"><div><strong>{number(sum("requests"))}</strong><span>已发起请求</span></div><div><strong>{number(sum("failed"))}</strong><span>服务返回失败</span></div><div><strong>{number(sum("uncertain"))}</strong><span>处理中 / 结果未知</span></div></div>
        {labelWarning && <p className="notice">无法读取邮箱目录，暂用账号编号。请检查服务端 Supabase Secret key。</p>}
        {!filtered.length && <p className="notice">此区间没有符合条件的记录。完成一次新的 AI 生成或朗读后再刷新。</p>}
        <div className="usage-list">{filtered.sort((a,b)=>a.user_id.localeCompare(b.user_id)||a.service.localeCompare(b.service)).map(row=><article className="usage-card" key={`${row.user_id}:${row.service}:${row.model}`}>
          <header><h2>{labels.get(row.user_id) ?? `账号 ${row.user_id.slice(0,8)}`}</h2><span>{names[row.service]} · {row.model}</span></header>
          <p>请求 {number(row.requests)} · 服务成功 {number(row.succeeded)} · 失败 {number(row.failed)} · 待确认 {number(row.uncertain)}</p>
          {(row.service==="text" || row.service==="image") && <p>输入 Token {number(row.input_tokens)} · 输出 Token {number(row.output_tokens)} · 其中缓存输入 {number(row.cached_input_tokens)}{Number(row.token_unknown)>0 ? ` · ${number(row.token_unknown)} 次用量未完整返回` : ""}</p>}
          {row.service==="tts" && <p>提交朗读文本：{number(row.characters)} 字符</p>}
          {row.service==="image" && <p>成功返回：{number(row.images)} 张图片</p>}
          {row.service==="stt" && <p>提交音频约 {number(row.audio_seconds)} 秒</p>}
        </article>)}</div>
      </>}
    </section>
    <section className="panel"><h2>用量不等于账单</h2><p>Token 来自 Azure 返回值；字符与音频时长是应用侧提交量，失败或超时也可能被云平台计费。“成功”指服务响应成功，不保证生成内容通过后续校验。缺失 Token 不按 0 计算。</p><p>这里暂不折算金额或显示“剩余额度”，因为价格、免费额度、图片尺寸、缓存折扣及其他项目共享用量会影响真实费用。请以 Azure 账单为准；R2、Vercel、Supabase 的存储与流量不在此统计。</p><Link className="text-button" href="/admin">返回管理首页</Link></section>
  </div>;
}
