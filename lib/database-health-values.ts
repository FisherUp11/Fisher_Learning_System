export type DatabaseTableSize = {name:string;totalBytes:number;dataBytes:number;indexBytes:number;estimatedRows:number;lastAnalyze:string|null;lastAutoanalyze:string|null};
export type DatabaseHealth = {capturedAt:string;databaseBytes:number;clusterDatabaseBytes:number;businessBytes:number;indexBytes:number;estimatedRows:number;tableCount:number;tables:DatabaseTableSize[];history:{date:string;bytes:number}[];snapshotSaved:boolean;readOnly:boolean;stale?:boolean;diskUsedBytes:null;diskLimitBytes:null};

export function formatDatabaseBytes(bytes:number) {
  const units=["B","KB","MB","GB","TB"];
  const index=bytes>0?Math.min(4,Math.floor(Math.log(bytes)/Math.log(1000))):0;
  return `${(bytes/1000**index).toLocaleString("zh-CN",{maximumFractionDigits:index>=2?1:0})} ${units[index]}`;
}

export function databaseBudget(plan:string|undefined, manualMb:string|undefined) {
  const mb=Number(manualMb);
  if(manualMb?.trim() && Number.isFinite(mb) && mb>0 && mb<=1000000) return {bytes:mb*1000000,label:"自定义数据库预警预算"};
  if(!plan?.trim() || /\bfree\b|免费/i.test(plan)) return {bytes:500000000,label:plan?.trim()?"Free 数据库参考线":"Free 参考线（未核实套餐）"};
  return {bytes:null,label:"尚未设置数据库预警预算"};
}

/** Only infer a full-window change if an actual sample exists at/before its start. */
export function databaseGrowth(history:DatabaseHealth["history"], capturedAt:string, currentBytes:number, days:7|30) {
  const today=new Date(new Date(capturedAt).getTime()+8*3600000).toISOString().slice(0,10);
  const cutoff=new Date(`${today}T00:00:00Z`);cutoff.setUTCDate(cutoff.getUTCDate()-days);
  const date=cutoff.toISOString().slice(0,10);
  const anchor=history.filter(row=>row.date<=date).sort((a,b)=>b.date.localeCompare(a.date))[0];
  if(!anchor) return null;
  const span=Math.round((Date.parse(`${today}T00:00:00Z`)-Date.parse(`${anchor.date}T00:00:00Z`))/86400000);
  return {bytes:currentBytes-anchor.bytes,days:span};
}
