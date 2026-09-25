"use client";
import Link from "next/link";
import { useState } from "react";
import type { EnglishConcept, MeetingSource } from "@/lib/adult-learning";
import { wordLabel, type ListeningLesson, type ListeningSession, type ListeningAttempt, type Section, type WordState } from "@/lib/english-listening";
import type { PanelProps } from "./adult-hub";
import { SourceForm } from "./adult-english";
import { ListeningStudy } from "./english-listening-study";
import { ListeningEditor } from "./english-listening-editor";
import s from "./adult-growth.module.css";

export type ListeningData = {
 sources: Omit<MeetingSource,"body">[]; sections: Section[]; lessons: ListeningLesson[]; concepts: EnglishConcept[];
 links: {lesson_id:string;concept_id:string}[]; states: WordState[];
 sessions: Pick<ListeningSession,"id"|"lesson_id"|"local_date"|"completed_at"|"assisted">[];
 attempts: ListeningAttempt[]; current:ListeningSession|null;
};
export function ListeningPanel(props:PanelProps) {
 const {data,tab,run,pending}=props; const d=data.listening;
 if(!d) return <section className={s.card}><p>正在准备新版听力学习，请重新加载。首次使用需要运行 020 增量 SQL。</p></section>;
 return <>
  <div className={s.between}><span className={s.badge}>听懂 · 读懂 · 记住词句</span><Link className={s.muted} href="/english/legacy">更多：旧版口语与历史 →</Link></div>
  {tab==="materials"?<Materials {...props} d={d}/>:tab==="progress"?<Progress {...props} d={d}/>:d.current?<ListeningStudy key={d.current.id} session={d.current} attempts={d.attempts.filter(a=>a.session_id===d.current!.id)} run={run} pending={pending}/>:<section className={`${s.card} ${s.form}`}>
   <span className={s.eyebrow}>ONE MEETING · MANY SMALL LESSONS</span><h2>今天，听懂一小节</h2><p className={s.muted}>约 300 词听力 · 3 道选择题 · 4～6 个词句。默认 CET-6 基础，不需要录音。到期词句较多时，系统先安排复习；想学新课也可手动选择。</p>
   <form className={s.form} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run("listen-start",{profile_id:data.profile!.id,lesson_id:f.get("lesson")||undefined,review_only:f.get("review")==="on"});}}>
    <label>今天的课程<select name="lesson"><option value="">系统推荐：未完成 / 重点 / 较久没练</option>{d.lessons.filter(l=>l.status==="published"&&!d.sources.find(x=>x.id===l.source_id)?.archived&&d.lessons.find(x=>x.section_id===l.section_id&&x.status==="published")?.id===l.id).map(l=><option key={l.id} value={l.id}>{d.sources.find(x=>x.id===l.source_id)?.title} · {d.sections.find(x=>x.id===l.section_id)?.title}</option>)}</select></label>
    <label className={s.check}><input type="checkbox" name="review"/>今天只复习到期词句，不开新课</label><button className={`${s.button} ${s.primary}`} disabled={pending}>开始今天的练习</button>
   </form><p className={s.muted}>每天一份计划，暂停、刷新后继续；不强制计时。还没有课程？<Link href="/english/materials">先导入纪要并发布第 1 节 →</Link></p>
  </section>}
 </>;
}
function Materials({data,d,run,pending}:PanelProps&{d:ListeningData}) {
 const [selected,setSelected]=useState(d.sources[0]?.id??""); const [query,setQuery]=useState(""); const [page,setPage]=useState(0); const [detail,setDetail]=useState<{lesson:ListeningLesson;section:Section}|null>(null); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
 const source=d.sources.find(x=>x.id===selected)??d.sources[0];
 const parts=d.sections.filter(x=>x.source_id===source?.id&&`${x.title} ${x.ordinal}`.includes(query));
 const completed=new Set(d.sessions.filter(x=>x.completed_at).map(x=>x.lesson_id));
 async function open(id:string) {setBusy(true);setError("");try{const r=await fetch(`/api/adult/listening?lesson=${id}`,{cache:"no-store"});const b=await r.json();if(!r.ok)throw new Error(b.error);setDetail(b);}catch(e){setError(e instanceof Error?e.message:"加载失败");}finally{setBusy(false);}}
 return <>
  <details className={s.card} open={!d.sources.length}><summary>＋ 导入一份会议纪要</summary><p className={s.muted}>长纪要先保存并按段落/完整句子分节；每节再用 AI 整理主题和听力课，不会一次生成全部音频。请先移除机密和无权发送至 Azure 的资料。</p><SourceForm run={run} pending={pending} today={data.today} action="listen-import"/></details>
  {!!d.sources.length&&<section className={`${s.card} ${s.form}`}><div className={s.grid}><label>我的会议资料<select value={source?.id??""} onChange={e=>{setSelected(e.target.value);setPage(0);setDetail(null);setQuery("");}}>{d.sources.map(x=><option key={x.id} value={x.id}>{x.title}{x.archived?"（归档）":""}</option>)}</select></label><label>搜索小节主题<input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="主题或节数"/></label></div>
   {source&&<><div className={s.between}><div><h2>{source.title}</h2><p className={s.muted}>{source.meeting_date} · 共 {d.sections.filter(x=>x.source_id===source.id).length} 节 · 已完成 {new Set(d.lessons.filter(l=>l.source_id===source.id&&completed.has(l.id)).map(l=>l.section_id)).size} 节 · {source.archived?"已归档":source.priority?"优先学习":"账号私有"}</p></div><div className={s.row}><button className={s.button} disabled={pending} onClick={()=>run("source-status",{id:source.id,archived:source.archived,priority:!source.priority})}>{source.priority?"取消重点":"设为重点"}</button><button className={s.button} disabled={pending} onClick={()=>run("source-status",{id:source.id,archived:!source.archived,priority:source.priority})}>{source.archived?"恢复":"归档"}</button></div></div>
    {!d.sections.some(x=>x.source_id===source.id)&&<div className={s.banner}>这份资料尚未分节（可能是旧资料，或导入后的分节未完成）。<button className={s.button} disabled={pending} onClick={()=>run("listen-split",{source_id:source.id})}>生成分节目录</button></div>}
    <div className={s.list}>{parts.slice(page*8,page*8+8).map(part=>{const versions=d.lessons.filter(l=>l.section_id===part.id);const active=versions.find(l=>["draft","failed","generating"].includes(l.status));const published=versions.find(l=>l.status==="published");return <div className={`${s.sectionRow} ${s.between}`} key={part.id}><div><span className={s.eyebrow}>PART {String(part.ordinal).padStart(2,"0")}</span><h3>{part.title}</h3><span className={s.muted}>原文 {part.word_count} 词 · {active?.status==="draft"?"待审核":active?.status==="failed"?"生成失败，可重试":active?.status==="generating"?"生成中 / 可检查":published?completed.has(published.id)?"已完成练习":"已发布，可学习":"尚未生成"}</span>{active?.error&&<p className={s.error}>{active.error}</p>}</div><div className={s.row}>
     {active?.status==="draft"?<button className={`${s.button} ${s.primary}`} disabled={busy||pending} onClick={()=>void open(active.id)}>预览 / 编辑草稿</button>:<button className={s.button} disabled={pending||source.archived} onClick={async()=>{if(published&&!active&&!confirm("生成本节新版本？旧版本与记录保留，会调用 Azure。"))return;const result=await run("listen-generate",{id:active?.id,section_id:part.id,profile_id:data.profile!.id});if(result?.id)await open(result.id);}}>{active?"检查 / 重试":published?"生成修订版":"生成本节课程"}</button>}
     {published&&<button className={s.button} disabled={busy||pending} onClick={()=>void open(published.id)}>查看已发布版</button>}
    </div></div>;})}</div>
    <Pages page={page} count={parts.length} size={8} onPage={setPage}/>
    <details className={s.details}><summary>永久删除资料</summary><p className={s.muted}>删除原文、全部小节/版本，以及包含这些课程或其复习题的整份每日计划和作答。平时停用请归档；删除前不要在其他窗口生成本资料。</p><button className={`${s.button} ${s.danger}`} disabled={pending} onClick={()=>{if(prompt("不可撤销。请输入“删除”确认：")==="删除")void run("source-delete",{id:source.id,confirm:"删除"});}}>永久删除</button></details>
   </>}
  </section>}
  {busy&&<p role="status">正在打开课程…</p>}{error&&<p role="alert" className={s.error}>{error}</p>}
  {detail&&<ListeningEditor key={`${detail.lesson.id}-${detail.lesson.status}`} lesson={detail.lesson} section={detail.section} run={run} pending={pending} onRefresh={()=>open(detail.lesson.id)} onClose={()=>setDetail(null)}/>}
 </>;
}
function Progress({d,data,run,pending}:PanelProps&{d:ListeningData}) {
 const [query,setQuery]=useState(""),[filter,setFilter]=useState("all"),[source,setSource]=useState(""),[page,setPage]=useState(0),[range,setRange]=useState(30);
 const cutoff=new Date(`${data.today}T12:00:00Z`);cutoff.setUTCDate(cutoff.getUTCDate()-range+1);const recent=d.attempts.filter(a=>a.local_date>=cutoff.toISOString().slice(0,10));
 const first=recent.filter((a,i)=>a.kind==="listening"&&!recent.slice(i+1).some(x=>x.session_id===a.session_id&&x.task_id===a.task_id));const blind=first.filter(a=>!a.assisted);
 const ids=new Set(d.links.filter(l=>d.lessons.some(x=>x.id===l.lesson_id&&(!source||x.source_id===source))).map(l=>l.concept_id));
 const terms=d.concepts.filter(c=>{const st=d.states.find(s=>s.concept_id===c.id);return ids.has(c.id)&&`${c.phrase} ${c.meaning}`.toLowerCase().includes(query.toLowerCase())&&(filter==="all"||filter==="new"&&(!st||st.attempts===0)||filter==="due"&&st&&st.due_date<=data.today||filter==="stable"&&wordLabel(st)==="跨天巩固"||filter==="priority"&&st?.priority);});
 return <><div className={s.row}>{[7,30].map(n=><button className={`${s.button} ${range===n?s.primary:""}`} key={n} onClick={()=>setRange(n)}>近 {n} 天</button>)}</div><div className={s.metrics}><div><strong>{new Set(recent.map(a=>a.local_date)).size}</strong><span>有效学习日</span></div><div><strong>{blind.length?`${Math.round(blind.filter(a=>a.correct).length/blind.length*100)}%`:"—"}</strong><span>首次无原文辅助正确率 · {blind.length} 题</span></div><div><strong>{first.filter(a=>a.assisted).length}</strong><span>首次使用辅助的理解题</span></div></div><p className={s.muted}>选择题是理解练习，不等于口语掌握。重做、看原文后的成绩与首次盲听分开，播放次数不算学习成绩。</p>
  <section className={`${s.card} ${s.form}`}><h2>我的词句积累</h2><div className={s.grid}><label>搜索<input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="英文表达 / 中文意思"/></label><label>状态<select value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}><option value="all">全部</option><option value="new">未练习</option><option value="due">到期复习</option><option value="stable">跨天巩固</option><option value="priority">重点词句</option></select></label><label>来源纪要<select value={source} onChange={e=>{setSource(e.target.value);setPage(0);}}><option value="">全部</option>{d.sources.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label></div>
   {terms.slice(page*12,page*12+12).map(c=>{const st=d.states.find(x=>x.concept_id===c.id);return <div key={c.id} className={s.listItem}><div className={s.between}><h3>{c.phrase}</h3><span className={s.badge}>{wordLabel(st)}</span></div><p>{c.meaning}</p><p className={s.muted}>应用例句：{c.example}</p><p className={s.muted}>练习 {st?.attempts??0} 次 · 阶段 {st?.stage??0}/5 · {st?`${st.due_date} 复习`:"尚未开始"}</p><button className={s.button} disabled={pending} onClick={()=>run("listen-priority",{profile_id:data.profile!.id,concept_id:c.id,priority:!st?.priority})}>{st?.priority?"取消重点":"加入重点复习"}</button></div>;})}
   {!terms.length&&<p className={s.muted}>暂无符合条件的词句。发布课程后会自动积累。</p>}<Pages page={page} count={terms.length} size={12} onPage={setPage}/>
  </section><p className={s.muted}>“跨天巩固”需要多个日期无辅助正确及至少一次 7 天间隔回忆；这是词句识别标签，不是自由表达能力证书。旧版口语历史在“更多”中保留。</p>
 </>;
}
function Pages({page,count,size,onPage}:{page:number;count:number;size:number;onPage:(n:number)=>void}) {return count>size?<div className={s.row}><button className={s.button} disabled={!page} onClick={()=>onPage(page-1)}>上一页</button><span>{page+1} / {Math.ceil(count/size)}</span><button className={s.button} disabled={(page+1)*size>=count} onClick={()=>onPage(page+1)}>下一页</button></div>:null;}
