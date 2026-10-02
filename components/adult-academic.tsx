"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PrivateAudio } from "./adult-english-study";
import { EnglishSourcePreview } from "./english-source-preview";
import { prepareEnglishSource } from "@/lib/english-source";
import { normalizeText, type EnglishConcept } from "@/lib/adult-learning";
import type { AcademicCandidate, AcademicChunk, AcademicCourse, AcademicItem, AcademicLink, AcademicSettings, AcademicSource } from "@/lib/adult-academic";
import s from "./adult-academic.module.css";

type Profile = {id:string;name:string;archived:boolean};
type State = {concept_id:string;stage:number;attempts:number;due_date:string;priority:boolean;independent_days:number;spaced_success:boolean};
type Data = {profiles:Profile[];profile:Profile|null;today:string;courses:AcademicCourse[];sources:AcademicSource[];chunks:AcademicChunk[];links:AcademicLink[];terms:{canonical_key:string;concept_id:string;category:"word"|"phrase"|"sentence"}[];concepts:EnglishConcept[];settings:AcademicSettings|null;states:State[];items:AcademicItem[]};
type Result = {message:string;id?:string;answer?:{stage:number;completed:boolean;remaining:number}};
type Choice = "skip"|"add"|"reuse"|"new-sense";
const headers={"Content-Type":"application/json"};

export function AdultAcademic() {
  const [data,setData]=useState<Data|null>(null),[profileId,setProfileId]=useState(""),[sourceId,setSourceId]=useState("");
  const [tab,setTab]=useState<"today"|"sources"|"library">("today");
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [progress,setProgress]=useState(""),[refresh,setRefresh]=useState(0),[choice,setChoice]=useState<Record<string,Choice>>({});
  const [revealed,setRevealed]=useState(false),[query,setQuery]=useState(""),[filter,setFilter]=useState("all"),[libraryCourse,setLibraryCourse]=useState(""),[page,setPage]=useState(0);
  const [courseTitle,setCourseTitle]=useState(""),[newTitle,setNewTitle]=useState(""),[newBody,setNewBody]=useState(""),[newCourse,setNewCourse]=useState("");
  const [dailyNew,setDailyNew]=useState(6),[dailyReview,setDailyReview]=useState(12),[focusCourse,setFocusCourse]=useState("");
  const answerRequests=useRef(new Map<string,string>());
  useEffect(()=>{
    const controller=new AbortController();
    let remembered="";try{if(typeof window!=="undefined")remembered=localStorage.getItem("adult-profile")??"";}catch{/* private browsing */}
    const profile=profileId || remembered;
    const params=new URLSearchParams(); if(profile)params.set("profile",profile); if(sourceId)params.set("source",sourceId);
    fetch(`/api/adult/academic?${params}`,{cache:"no-store",signal:controller.signal}).then(async response=>{
      const body=await response.json();if(!response.ok)throw new Error(body.error??"加载失败");return body as Data;
    }).then(body=>{
      if(controller.signal.aborted)return;
      setData(body);setLoading(false);
      setDailyNew(body.settings?.daily_new??6);setDailyReview(body.settings?.daily_review??12);setFocusCourse(body.settings?.focus_course_id??"");
      setNewCourse(current=>current||body.courses[0]?.id||"");
      setSourceId(current=>current||body.sources[0]?.id||"");
    }).catch(e=>{if(!controller.signal.aborted){setError(e instanceof Error?e.message:"加载失败");setLoading(false);}});
    return()=>controller.abort();
  },[profileId,sourceId,refresh]);
  async function post(action:string,payload:Record<string,unknown>,timeout=95000):Promise<Result>{
    const response=await fetch("/api/adult/academic",{method:"POST",headers,body:JSON.stringify({action,...payload}),signal:AbortSignal.timeout(timeout)});
    const result=await response.json();if(!response.ok)throw new Error(result.error??"操作未完成");return result;
  }
  async function perform(action:string,payload:Record<string,unknown>,after?:(result:Result)=>void){
    if(busy)return;setBusy(true);setError("");setNotice("");
    try{const result=await post(action,payload);setNotice(result.message);after?.(result);setRefresh(n=>n+1);}
    catch(e){setError(e instanceof Error?e.message:"操作失败，请重试");}
    finally{setBusy(false);}
  }
  function answer(conceptId:string,result:"known"|"again"){
    const key=`${data?.today}:${data?.profile?.id}:${conceptId}:${result}`;
    if(!answerRequests.current.has(key))answerRequests.current.set(key,crypto.randomUUID());
    const id=answerRequests.current.get(key)!;
    void perform("academic-answer",{id,profile_id:data!.profile!.id,concept_id:conceptId,result},()=>{answerRequests.current.delete(key);setRevealed(false);});
  }
  function changeProfile(id:string){setProfileId(id);setLoading(true);setRevealed(false);try{localStorage.setItem("adult-profile",id);}catch{/* optional */}}
  function changeSource(id:string){setSourceId(id);setChoice({});setLoading(true);}
  async function generateAll(){
    if(!data||!sourceId||busy)return;
    const pending=data.chunks.filter(c=>c.status!=="complete");if(!pending.length)return;
    if(!confirm(`这份讲义还需提取 ${pending.length} 段，将逐段调用 Azure AI。开始后可以离开页面，稍后继续；已完成的段落不会重复计费。`))return;
    setBusy(true);setError("");setNotice("");
    try{
      for(let i=0;i<pending.length;i++){
        setProgress(`正在提取第 ${i+1} / ${pending.length} 段。已完成段落会保存，离开页面也不会丢失。`);
        await post("academic-generate",{chunk_id:pending[i].id});
      }
      setNotice(`全部 ${pending.length} 段处理完成。请检查候选词，再确认加入词库。`);setRefresh(n=>n+1);
    }catch(e){setError(`${e instanceof Error?e.message:"提取中断"}。已完成段落保留，可点“继续提取”重试。`);setRefresh(n=>n+1);}
    finally{setBusy(false);setProgress("");}
  }
  const selectedSource=data?.sources.find(x=>x.id===sourceId);
  const pendingChunks=data?.chunks.filter(c=>c.status!=="complete")??[];
  const candidateRows=useMemo(()=>{
    const rows:{chunk:AcademicChunk;index:number;item:AcademicCandidate;key:string;defaultChoice:Choice;matched?:EnglishConcept;conflict:boolean}[]=[];
    const seen=new Set<string>();
    for(const chunk of data?.chunks??[]) for(let i=0;i<chunk.candidates.length;i++){
      const item=chunk.candidates[i],base=normalizeText(item.phrase),key=`${chunk.id}:${i}`;
      const academic=data?.terms.find(t=>t.canonical_key===base);
      const matches=(data?.concepts??[]).filter(c=>normalizeText(c.phrase)===base);
      const matched=academic?matches.find(c=>c.id===academic.concept_id):matches.find(c=>normalizeText(c.meaning)===normalizeText(item.meaning))??matches[0];
      const conflict=!!matched&&normalizeText(matched.meaning)!==normalizeText(item.meaning);
      const defaultChoice:Choice=seen.has(base)?"skip":conflict?"skip":matched?"reuse":"add";
      seen.add(base);rows.push({chunk,index:i,item,key,defaultChoice,matched,conflict});
    }
    return rows;
  },[data]);
  const todayItems=(data?.items??[]).filter(x=>!x.completed_at).sort((a,b)=>{
    const ax=a.last_answered_at??"",bx=b.last_answered_at??"";
    return ax.localeCompare(bx)||a.attempt_count-b.attempt_count;
  });
  const current=todayItems[0],currentConcept=data?.concepts.find(x=>x.id===current?.concept_id);
  const currentSource=data?.links.find(x=>x.concept_id===current?.concept_id&&data.sources.find(src=>src.id===x.source_id)?.course_id===data.settings?.focus_course_id)
    ??data?.links.find(x=>x.concept_id===current?.concept_id);
  const library=useMemo(()=>{
    const ids=new Set(data?.links.filter(l=>data.sources.some(src=>src.id===l.source_id&&(!libraryCourse||src.course_id===libraryCourse))).map(l=>l.concept_id));
    return (data?.concepts??[]).filter(c=>{
      if(!ids.has(c.id)||!`${c.phrase} ${c.meaning}`.toLowerCase().includes(query.toLowerCase()))return false;
      const st=data?.states.find(x=>x.concept_id===c.id);
      return filter==="all"||filter==="new"&&!st||filter==="due"&&!!st&&st.due_date<=data!.today||filter==="stable"&&!!st&&st.stage>=4;
    });
  },[data,query,filter,libraryCourse]);

  return <div className={s.root}>
    <header className={s.hero}><div><span className={s.kicker}>PARENT ENGLISH · ACADEMIC READING</span><h1>专业英语</h1><p>从正在读的生物学讲义里，每天带走几个真正用得上的词句。</p></div><div className={s.heroMark} aria-hidden="true">Aa<span>→</span>∑</div></header>
    <nav className={s.topNav} aria-label="父母英语方向"><Link href="/english">会议英语</Link><span aria-current="page">专业英语</span></nav>
    {!!data?.profiles.length&&<div className={s.profileRow}><span>学习档案</span>{data.profiles.filter(p=>!p.archived).map(p=><button key={p.id} className={data.profile?.id===p.id?s.activeProfile:""} onClick={()=>changeProfile(p.id)}>{p.name}</button>)}</div>}
    {error&&<div className={s.error} role="alert">{error}<button onClick={()=>{setError("");setLoading(true);setRefresh(n=>n+1);}}>重新加载</button></div>}
    {notice&&<div className={s.notice} role="status">{notice}</div>}
    {progress&&<div className={s.notice} role="status">{progress}</div>}
    {loading?<div className={s.loading}>正在整理你的课程与词卡…</div>:data&&!data.profile?<section className={s.panel}><h2>先创建爸爸或妈妈的学习档案</h2><p>专业英语与会议英语共用成人档案。请先到会议英语页面创建。</p><Link href="/english/progress">创建成人档案 →</Link></section>:data&&<>
      <nav className={s.tabs} aria-label="专业英语页面">{([["today","今日学习"],["sources","课程与导入"],["library","我的词库"]] as const).map(([id,label])=><button key={id} className={tab===id?s.activeTab:""} onClick={()=>{setTab(id);setPage(0);}}>{label}</button>)}</nav>
      {tab==="today"&&<>
        <div className={s.statRow}><div><strong>{data.links.length}</strong><span>讲义关联词句</span></div><div><strong>{data.items.filter(x=>x.completed_at).length}<small> / {data.items.length}</small></strong><span>今天完成</span></div><div><strong>{data.states.filter(st=>st.due_date<=data.today&&data.links.some(l=>l.concept_id===st.concept_id)).length}</strong><span>当前到期词句</span></div></div>
        {!data.items.length?<section className={s.panel}><span className={s.kicker}>A SMALL DAILY PRACTICE</span><h2>今天，从一张词卡开始</h2><p>先复习到期内容，再加入少量新词。新词当天会隔开再次确认；会议听力的今日计划不受影响。</p>{data.links.length?<button className={s.primary} disabled={busy} onClick={()=>void perform("academic-start",{profile_id:data.profile!.id})}>安排今天的专业英语</button>:<button className={s.primary} onClick={()=>setTab("sources")}>先导入一讲</button>}</section>:current&&currentConcept?<section className={s.studyCard} key={current.concept_id}>
          <div className={s.cardTop}><span className={s.kicker}>{current.queue_kind==="new"?"NEW EXPRESSION":"SPACED REVIEW"}</span><span>{data.items.length-todayItems.length+1} / {data.items.length}</span></div>
          <h2>{currentConcept.phrase}</h2><p className={s.cardHint}>先回想它在原文中的意思，再揭示卡片。听音和看答案只是帮助学习，不自动算“记得”。</p>
          <PrivateAudio label="朗读词句 · 慢速跟读" body={{concept_id:current.concept_id}}/>
          {!revealed?<button className={s.reveal} onClick={()=>setRevealed(true)}>看意思与原文例句 ↓</button>:<div className={s.answer}>
            <strong>{currentConcept.meaning}</strong><p>{currentSource?.source_quote??currentConcept.example}</p>
            {currentSource?.translation&&<p className={s.translation}>{currentSource.translation}</p>}
            <PrivateAudio label="朗读英文例句" body={currentSource?{concept_id:current.concept_id,academic_source_id:currentSource.source_id,field:"source_quote"}:{concept_id:current.concept_id,field:"example"}}/>
            <p className={s.origin}>来源：{data.sources.find(x=>x.id===currentSource?.source_id)?.title??"专业英语词库"} · 练习 {data.states.find(x=>x.concept_id===current.concept_id)?.attempts??0} 次</p>
            <div className={s.answerButtons}><button disabled={busy} className={s.primary} onClick={()=>answer(current.concept_id,"known")}>我记得</button><button disabled={busy} className={s.secondary} onClick={()=>answer(current.concept_id,"again")}>再学一次</button></div>
            {current.confirmations>0&&<p className={s.origin}>这张卡今天还需独立认出一次；稍后会回来。</p>}
          </div>}
        </section>:<section className={s.panel}><span className={s.kicker}>TODAY COMPLETE</span><h2>今天的词句练完了</h2><p>跨天复习会按日期回来。想读新讲义，可去“课程与导入”。</p><button className={s.secondary} onClick={()=>setTab("sources")}>查看课程</button></section>}
        <details className={s.settings}><summary>调整每日节奏</summary><div className={s.settingsGrid}><label>每日新词<input type="number" min={0} max={20} value={dailyNew} onChange={e=>setDailyNew(Number(e.target.value))}/></label><label>最多到期复习<input type="number" min={1} max={50} value={dailyReview} onChange={e=>setDailyReview(Number(e.target.value))}/></label><label>优先课程<select value={focusCourse} onChange={e=>setFocusCourse(e.target.value)}><option value="">按导入顺序</option>{data.courses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label></div><button disabled={busy} className={s.secondary} onClick={()=>void perform("academic-settings",{profile_id:data.profile!.id,daily_new:dailyNew,daily_review:dailyReview,focus_course_id:focusCourse||null})}>保存设置 · 次日生效</button></details>
      </>}
      {tab==="sources"&&<>
        <section className={s.panel}><span className={s.kicker}>BUILD YOUR SHELF</span><h2>课程与讲义</h2><p>先建课程，再按一讲一讲粘贴。英文为学习主体，紧随的中文译文只作参考。原文仅供此账号使用，调用 AI 前请移除敏感资料。</p><div className={s.courseForm}><input value={courseTitle} onChange={e=>setCourseTitle(e.target.value)} maxLength={100} placeholder="新课程，例如：基础生物学" aria-label="新课程名称"/><button className={s.secondary} disabled={busy||!courseTitle.trim()} onClick={()=>void perform("academic-course",{title:courseTitle},r=>{setCourseTitle("");if(r.id)setNewCourse(r.id);})}>创建课程</button></div>
          {!!data.courses.length&&<form className={s.importForm} onSubmit={e=>{e.preventDefault();if(!confirm("确认保存这篇讲义？保存后可逐段调用 Azure AI 提取，候选词会先供你审核。"))return;void perform("academic-import",{course_id:newCourse||data.courses[0].id,title:newTitle,body:newBody},r=>{if(r.id){setSourceId(r.id);setNewBody("");setNewTitle("");}});}}><div className={s.twoCols}><label>所属课程<select value={newCourse||data.courses[0].id} onChange={e=>setNewCourse(e.target.value)}>{data.courses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label><label>讲义名称<input value={newTitle} onChange={e=>setNewTitle(e.target.value)} required maxLength={120} placeholder="例如：第 1 讲 · 课程导论"/></label></div><label>粘贴整篇文章（支持中英相邻段落）<textarea rows={9} value={newBody} onChange={e=>setNewBody(e.target.value)} required maxLength={150000} placeholder="粘贴一讲的英文原文；如果有逐段中文译文，也可一并粘贴。"/></label><p className={s.muted}>{prepareEnglishSource(newBody).englishWords.toLocaleString()} / 15,000 英文词 · {newBody.length.toLocaleString()} / 150,000 字符</p>{newBody&&<EnglishSourcePreview text={newBody}/>}<button disabled={busy||prepareEnglishSource(newBody).englishWords<80||prepareEnglishSource(newBody).englishWords>15000} className={s.primary}>保存讲义 · 不立即写入词库</button></form>}
        </section>
        {!!data.sources.length&&<section className={s.panel}><div className={s.sectionTitle}><h2>我的讲义</h2><span>{data.sources.length} 篇</span></div><div className={s.twoCols}><label>选择讲义<select value={selectedSource?.id??""} onChange={e=>changeSource(e.target.value)}><option value="">请选择</option>{data.sources.map(src=><option key={src.id} value={src.id}>{data.courses.find(c=>c.id===src.course_id)?.title} · {src.title}</option>)}</select></label></div>
          {selectedSource&&<><div className={s.sourceHead}><div><h3>{selectedSource.title}</h3><p>{data.courses.find(c=>c.id===selectedSource.course_id)?.title} · {data.chunks.length} 段 · {selectedSource.published_at?"已加入词库":"待确认候选"}</p></div><button className={s.secondary} disabled={busy} onClick={()=>void perform("academic-archive",{source_id:selectedSource.id,archived:!selectedSource.archived})}>{selectedSource.archived?"恢复讲义":"归档讲义"}</button></div>
            {!selectedSource.published_at&&<><div className={s.extractBar}><div><strong>{data.chunks.length-pendingChunks.length} / {data.chunks.length} 段已提取</strong><p>逐段保存，失败可续跑；已有段落不会重复调用 AI。</p></div><button className={s.primary} disabled={busy||!pendingChunks.length||selectedSource.archived} onClick={()=>void generateAll()}>{pendingChunks.length?"继续提取候选词":"提取完成"}</button></div>
              {data.chunks.some(c=>c.status==="failed")&&<p className={s.error}>部分段落失败：{data.chunks.filter(c=>c.status==="failed").map(c=>`第 ${c.ordinal} 段 ${c.error??""}`).join("；")}</p>}
              {!!candidateRows.length&&<div className={s.review}><div className={s.sectionTitle}><h3>候选词审核</h3><span>{candidateRows.length} 条 · 可逐条跳过</span></div><p className={s.muted}>AI 候选不是自动入库。相同英文词条会复用原有记忆进度；遇到同形异义，请手动选择“新义项”。</p>{candidateRows.map(row=>{
                const mode=choice[row.key]??row.defaultChoice;
                return <div className={s.candidate} key={row.key}><div><strong>{row.item.phrase}</strong><span className={s.tag}>{row.item.category==="word"?"术语":row.item.category==="phrase"?"短语":"句式"}</span></div><p>{row.item.meaning}</p><blockquote>{row.item.source_quote}</blockquote><p className={s.translation}>{row.item.translation}</p>{row.matched&&<p className={s.origin}>词库已有：{row.matched.meaning}{row.conflict?" · 中文释义不同，请核对词义":" · 可复用"}</p>}<label>处理方式<select value={mode} onChange={e=>setChoice(c=>({...c,[row.key]:e.target.value as Choice}))}><option value="skip">跳过本条</option><option value="reuse" disabled={!row.matched}>复用已有词条</option><option value="add" disabled={!!row.matched}>新增词条</option><option value="new-sense">作为新义项</option></select></label></div>;
              })}<button className={s.primary} disabled={busy||pendingChunks.length>0} onClick={()=>{
                const selected=candidateRows.flatMap(row=>{const mode=choice[row.key]??row.defaultChoice;return mode==="skip"?[]:[{chunk_id:row.chunk.id,index:row.index,match_id:mode==="reuse"?row.matched?.id:null,new_sense:mode==="new-sense"}];});
                if(!selected.length){setError("请至少选择一条候选词");return;}
                if(confirm(`确认把 ${selected.length} 条候选词关联到专业英语词库？重复词条不会重置掌握进度。`))void perform("academic-publish",{source_id:selectedSource.id,selected});
              }}>确认加入词库</button></div>}
            </>}
            {selectedSource.published_at&&<p className={s.notice}>本讲已关联 {data.links.filter(x=>x.source_id===selectedSource.id).length} 条词句。可在“我的词库”筛选查看，原有学习进度保留。</p>}
          </>}
        </section>}
      </>}
      {tab==="library"&&<section className={s.panel}>
        <div className={s.sectionTitle}><div><span className={s.kicker}>A GROWING VOCABULARY</span><h2>我的专业词库</h2></div><span>{library.length} 条</span></div>
        <div className={s.twoCols}>
          <label>查找词句<input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="英文或中文释义"/></label>
          <label>掌握状态<select value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);}}><option value="all">全部</option><option value="new">尚未学习</option><option value="due">到期复习</option><option value="stable">阶段 4～5</option></select></label>
          <label>所属课程<select value={libraryCourse} onChange={e=>{setLibraryCourse(e.target.value);setPage(0);}}><option value="">全部课程</option>{data.courses.map(course=><option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
        </div>
        {library.slice(page*12,page*12+12).map(c=>{
          const st=data.states.find(x=>x.concept_id===c.id),related=data.links.filter(x=>x.concept_id===c.id),first=related[0];
          const category=data.terms.find(x=>x.concept_id===c.id)?.category;
          return <article className={s.libraryItem} key={c.id}>
            <div className={s.sectionTitle}><h3>{c.phrase}</h3><span className={s.tag}>{category==="word"?"术语":category==="phrase"?"短语":category==="sentence"?"句式":"词句"} · {st?`阶段 ${st.stage}/5 · ${st.attempts} 次`:"未学"}</span></div>
            <p>{c.meaning}</p><p className={s.example}>{first?.source_quote??c.example}</p>
            <p className={s.origin}>来源：{[...new Set(related.map(l=>data.sources.find(x=>x.id===l.source_id)?.title).filter(Boolean))].join("、")} · {st?`${st.due_date} 复习`:"待进入每日计划"}</p>
            <details><summary>朗读与跟读</summary><PrivateAudio body={{concept_id:c.id}} label="朗读词句"/><PrivateAudio body={first?{concept_id:c.id,academic_source_id:first.source_id,field:"source_quote"}:{concept_id:c.id,field:"example"}} label="朗读原文例句"/></details>
          </article>;
        })}
        {!library.length&&<p className={s.muted}>暂无符合条件的词句。请先到“课程与导入”提取并确认候选。</p>}
        {library.length>12&&<div className={s.pages}><button disabled={page===0} onClick={()=>setPage(page-1)}>上一页</button><span>{page+1} / {Math.ceil(library.length/12)}</span><button disabled={(page+1)*12>=library.length} onClick={()=>setPage(page+1)}>下一页</button></div>}
      </section>}
    </>}
  </div>;
}
