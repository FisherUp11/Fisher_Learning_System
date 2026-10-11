"use client";

import { useRef, useState } from "react";
import { fetchPracticeHistory } from "@/lib/practice-history-actions";
import type { PracticeHistoryPage, PracticeKind } from "@/lib/practice-history-values";
import { practiceResultLabels } from "@/lib/music";

export function PracticeHistory({kind,learnerId,itemId,initialPage}:{kind:PracticeKind;learnerId:string;itemId:string;initialPage?:PracticeHistoryPage}) {
  const [data,setData]=useState(initialPage);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  const busy=useRef(false);
  async function load(page:number) {
    if(busy.current) return;
    busy.current=true;setPending(true);setError("");
    try {
      const result=await fetchPracticeHistory(kind,learnerId,itemId,page);
      if(result.data) setData(result.data);
      else setError(result.error??"暂时无法读取记录");
    } catch { setError("网络请求未完成，请重试；原来的记录仍然保留"); }
    finally {busy.current=false;setPending(false);}
  }
  const content=<div className="practice-history-content" aria-busy={pending}>
    <p className="helper-text">每次打卡分别保留 · 每页 20 条{data?` · 共 ${data.total} 次`:""}</p>
    {error && <p className="error" role="alert">{error} <button className="text-button" disabled={pending} onClick={()=>load(data?.page??1)}>重试</button></p>}
    {pending && <p className="helper-text" role="status">正在读取记录…</p>}
    {data?.total===0 && <p className="notice">还没有练习记录。完成一次练习后再来查看。</p>}
    {data && <div className="history-list">{data.rows.map(row=> {
      const musicLabels=practiceResultLabels as Record<string,string>;
      const label=kind==="poem"?(row.score===null?"暂未评分":`${row.score} / 10 分`):kind==="catechism"?(row.result==="recited"?"背出来了":"还要再背"):(musicLabels[row.result??""]??row.result);
      // 使用固定的北京时间字符串，避免服务端和浏览器地区格式差异。
      const recorded=new Date(new Date(row.at).getTime()+8*3600000).toISOString().slice(0,16).replace("T"," ");
      return <div className="history-row" key={row.id}><div><strong>{row.localDate}</strong><span>{recorded.slice(11)}（北京时间）{row.stageBefore!==null?` · 阶段 ${row.stageBefore} → ${row.stageAfter}`:""}</span></div><span className={`history-score ${kind==="poem"&&row.score===null?"unscored":""}`}>{label}</span>{row.note && <p>{kind==="music"?"当时备注：":""}{row.note}</p>}</div>;
    })}</div>}
    {data && data.pages>1 && <nav className="library-pagination" aria-label="练习记录分页"><button className="secondary" disabled={pending||data.page<=1} onClick={()=>load(data.page-1)}>上一页</button><span>{data.page} / {data.pages}</span><button className="secondary" disabled={pending||data.page>=data.pages} onClick={()=>load(data.page+1)}>下一页</button></nav>}
  </div>;
  return initialPage?<section className="panel recitation-history"><h2>{kind==="poem"?"背诵记录":"练习记录"}</h2>{content}</section>:<details className="catechism-attempt-history" onToggle={event=>{if(event.currentTarget.open&&!data&&!busy.current) void load(1);}}><summary>查看练习记录</summary>{content}</details>;
}
