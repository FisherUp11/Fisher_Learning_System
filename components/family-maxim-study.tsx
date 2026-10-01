"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordFamilyMaximAttempt } from "@/lib/family-maxims-actions";
import type { DailyMaxim } from "@/lib/family-maxims";
import styles from "./family-maxims.module.css";

function browserSpeak(value:string,language:"zh"|"en") {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance=new SpeechSynthesisUtterance(value);
  utterance.lang=language==="zh"?"zh-CN":"en-US";
  utterance.rate=0.78;
  window.speechSynthesis.speak(utterance);
}

export function FamilyMaximStudy({learnerId,learnerName,language,initialQueue}:{learnerId:string;learnerName:string;language:"zh"|"en";initialQueue:DailyMaxim[]}) {
  const router=useRouter();
  const [index,setIndex]=useState(0);
  const [phase,setPhase]=useState<"read"|"recite"|"check">(initialQueue[0]?.queueKind==="review"?"recite":"read");
  const [helped,setHelped]=useState(false);
  const [error,setError]=useState("");
  const [done,setDone]=useState(0);
  const [speaking,setSpeaking]=useState(false);
  const [pending,startTransition]=useTransition();
  const busy=useRef(false);
  const audioRef=useRef<HTMLAudioElement|null>(null);
  const audioUrl=useRef<string|null>(null);
  const item=initialQueue[index];
  const quote=item?(language==="zh"?item.text_zh:item.text_en):"";
  useEffect(()=>()=>{audioRef.current?.pause();if(audioUrl.current)URL.revokeObjectURL(audioUrl.current);if("speechSynthesis" in window)window.speechSynthesis.cancel();},[]);
  function clearAudio() {audioRef.current?.pause();audioRef.current=null;if(audioUrl.current)URL.revokeObjectURL(audioUrl.current);audioUrl.current=null;if("speechSynthesis" in window)window.speechSynthesis.cancel();setSpeaking(false);}
  async function speak() {
    if (!item) return;
    clearAudio();setSpeaking(true);
    if (phase==="recite") setHelped(true);
    try {
      const response=await fetch("/api/speech",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:quote,lang:language,slow:true,learner:learnerId,module:"family_maxims"})});
      if (!response.ok) throw new Error("speech unavailable");
      const url=URL.createObjectURL(await response.blob());audioUrl.current=url;
      const audio=new Audio(url);audioRef.current=audio;
      audio.onended=()=>{URL.revokeObjectURL(url);audioUrl.current=null;setSpeaking(false);};
      audio.onerror=()=>{URL.revokeObjectURL(url);audioUrl.current=null;browserSpeak(quote,language);setSpeaking(false);};
      await audio.play();
    } catch {browserSpeak(quote,language);setSpeaking(false);}
  }
  function record(result:"read"|"prompted"|"independent"|"again") {
    if (!item || busy.current || pending) return;
    busy.current=true;setError("");clearAudio();
    const assisted=helped || (result==="independent" && phase==="read");
    startTransition(async()=>{
      try {
        await recordFamilyMaximAttempt({learnerId,maximId:item.id,language,result,assisted,requestId:crypto.randomUUID()});
        setDone((count)=>count+1);setIndex((count)=>count+1);setPhase(initialQueue[index+1]?.queueKind==="review"?"recite":"read");setHelped(false);
        if (index+1>=initialQueue.length) router.refresh();
      } catch(caught) {setError(caught instanceof Error?caught.message:"记录失败，请稍后重试");}
      finally {busy.current=false;}
    });
  }
  if (!item) return <section className={`${styles.finished} panel`}><span aria-hidden="true">✦</span><p className="eyebrow">Today, a little closer</p><h2>{done?`${learnerName}，今天认真背完了。`:"今天还没有待背的箴言"}</h2><p>{done?`共练习 ${done} 条。独立背出的内容会隔天再见；需要帮助的内容明天再温柔复习。`:"先在家中册选择适合孩子的箴言，或等到已学的内容到期。"}</p><div className={styles.heroActions}><Link className="primary" href="/maxims">查看家中册</Link><Link className="secondary" href="/maxims/manage">家长录入</Link></div></section>;
  return <div className={styles.study}>
    <div className={styles.progress}><span>{item.queueKind==="new"?"今天的新句":"到期再相遇"} · {language==="zh"?"中文":"English"}</span><span>{index+1} / {initialQueue.length}</span></div>
    <div className={styles.progressTrack}><span style={{width:`${Math.round(index/initialQueue.length*100)}%`}}/></div>
    <article className={styles.studyCard}><div className={styles.studyTop}><span className={styles.cornerMark}>言</span><span>记忆阶段 {item.stage} · 已练习 {item.totalAttempts} 次</span></div>
      {phase==="recite"?<div className={styles.hiddenQuote}><p>请试着自己说出来。</p><small>不用着急。想听提示，也可以听一遍。</small></div>:<div className={styles.studyQuote} lang={language==="en"?"en":"zh"}>{quote}</div>}
      {phase!=="recite"&&<p className={styles.quoteTranslation} lang={language==="zh"?"en":"zh"}>{language==="zh"?item.text_en:item.text_zh}</p>}
      <div className={styles.source}>{[item.source_title,item.source_detail,item.translation_version].filter(Boolean).join(" · ")||"家中珍藏"}</div>
      {phase!=="recite"&&<div className={styles.studyNotes}>{item.child_explanation_zh&&<p><strong>给孩子的解释</strong>{item.child_explanation_zh}</p>}{item.childMessages.map((message,position)=><p key={position}><strong>父母想对你说</strong>{message}</p>)}</div>}
      <div className={styles.studyActions}><button type="button" className="secondary" disabled={speaking||pending} onClick={speak}>{speaking?"正在朗读…":language==="zh"?"▶ 慢慢读中文":"▶ Read slowly"}</button>{phase==="read"&&<button type="button" className="primary" onClick={()=>{clearAudio();setPhase("recite");}}>遮住原句，开始背</button>}{phase==="recite"&&<button type="button" className="primary" onClick={()=>{clearAudio();setPhase("check");}}>背过了，打开核对</button>}</div>
    </article>
    {phase==="check"&&<section className={styles.answerPanel}><p>由家长根据刚才的回答判断。若背诵前听过提示，请勾选；系统不会把它当成独立背出。</p><label className={styles.inlineCheck}><input type="checkbox" checked={helped} onChange={(event)=>setHelped(event.target.checked)}/>背诵时得到过提示或朗读帮助</label><div className={styles.answerActions}><button disabled={pending||helped} className="primary" onClick={()=>record("independent")}>独立背出</button><button disabled={pending} className="secondary" onClick={()=>record("prompted")}>提示后背出</button><button disabled={pending} className="secondary" onClick={()=>record("again")}>还不会</button></div></section>}
    {phase==="read"&&<div className={styles.readActions}><button disabled={pending} className={styles.quietButton} onClick={()=>record("read")}>今天先共读一次，明天再背 →</button></div>}
    {error&&<p className="error" role="alert">{error}</p>}{pending&&<p className={styles.muted} role="status">正在保存本次背诵…</p>}
  </div>;
}
