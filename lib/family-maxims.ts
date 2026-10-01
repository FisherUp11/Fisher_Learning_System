export type Maxim = {
  id:string; text_zh:string; text_en:string; source_title:string; source_detail:string;
  translation_version:string; explanation_zh:string; child_explanation_zh:string;
  tags:string; archived_at:string|null; created_at:string;
};
export type MaximState = { maxim_id:string; language:"zh"|"en"; stage:number; due_on:string|null; total_attempts:number; independent_days:number; last_result:string|null };
export type MaximAttempt = { maxim_id:string; language:"zh"|"en"; stage_before:number; practiced_local_date:string };
export type DailyMaxim = Maxim & { queueKind:"new"|"review"; stage:number; totalAttempts:number; dueOn:string|null; childMessages:string[] };

export function localDay(timezone:string) {
  let parts:Intl.DateTimeFormatPart[];
  try { parts=new Intl.DateTimeFormat("en-US",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()); }
  catch { parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()); }
  const get=(type:string)=>parts.find((part)=>part.type===type)?.value??"00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function makeDailyMaximQueue(items:Maxim[],states:MaximState[],attempts:MaximAttempt[],language:"zh"|"en",today:string,newLimit:number,reviewLimit:number,childMessages:Map<string,string[]>):DailyMaxim[] {
  const current=new Map(states.filter((s)=>s.language===language).map((s)=>[s.maxim_id,s]));
  const newToday=new Set(attempts.filter((a)=>a.language===language && a.practiced_local_date===today && a.stage_before===0).map((a)=>a.maxim_id));
  const review:DailyMaxim[]=[],fresh:DailyMaxim[]=[];
  for (const item of items) {
    const state=current.get(item.id);
    const entry={...item,stage:state?.stage??0,totalAttempts:state?.total_attempts??0,dueOn:state?.due_on??null,childMessages:childMessages.get(item.id)??[]};
    if (state?.total_attempts) {
      if (state.due_on && state.due_on<=today) review.push({...entry,queueKind:"review"});
    } else fresh.push({...entry,queueKind:"new"});
  }
  review.sort((a,b)=>(a.dueOn??"").localeCompare(b.dueOn??"") || a.created_at.localeCompare(b.created_at));
  return [...review.slice(0,reviewLimit),...fresh.slice(0,Math.max(0,newLimit-newToday.size))];
}
