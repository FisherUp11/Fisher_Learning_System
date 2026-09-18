"use client";
import Link from "next/link";
import { useState } from "react";
import { addDays, datesBack, dayProgress, goalOnDay, UNIT_LABELS, type ExerciseGoal, type GoalVersion } from "@/lib/adult-learning";
import type { PanelProps, RunCommand } from "./adult-hub";
import s from "./adult-growth.module.css";

export function ExercisePanel({ data, tab, run, pending }: PanelProps) {
  const [range, setRange] = useState(30);
  const [page, setPage] = useState(0);
  const profile = data.profile!;
  const goals = data.goals ?? [], versions = data.versions ?? [], logs = data.logs ?? [];
  const today = data.today;
  const progress = dayProgress(goals, versions, logs, today);
  const calendar = datesBack(today, range).map(day => ({ day, ...dayProgress(goals, versions, logs, day) }));
  const scheduledPast = calendar.filter(d => d.day < today && d.scheduled > 0);
  const achievedPast = scheduledPast.filter(d => d.achieved);
  const recorded = logs.filter(l => !l.voided_at).length;
  return <>
    {tab === "today" && <>
      <div className={s.metrics}><div><strong>{progress.completed} / {progress.scheduled}</strong><span>今日项目达标</span></div><div><strong>{calendar.filter(d => d.participated).length}</strong><span>近 30 天运动天数</span></div><div><strong>{recorded}</strong><span>近 30 天有效记录</span></div></div>
      {progress.achieved && <div className={s.banner}>今天的运动目标完成了。谢谢你也为自己留了这段时间。</div>}
      {!goals.length && <section className={`${s.card} ${s.empty}`}><strong>从一个小目标开始</strong><p className={s.muted}>俯卧撑、跑步、快走、腹肌轮……运动名称和单位都可以自定义。</p><Link href="/together/settings" className={`${s.button} ${s.primary}`}>设置第一个目标 →</Link></section>}
      <div className={s.grid}>{goals.map(goal => {
        const v = goalOnDay(goal, versions, today); if (!v?.active) return null;
        const amount = logs.filter(l => l.goal_id === goal.id && l.local_date === today && !l.voided_at).reduce((sum, l) => sum + Number(l.amount), 0);
        const scheduled = v.weekdays.includes(new Date(`${today}T12:00:00Z`).getUTCDay());
        return <section className={s.card} key={goal.id}>
          <div className={s.between}><h2>{goal.name}</h2><span className={s.badge}>{!scheduled ? "今天休息，可自愿记录" : amount >= v.target ? "已达标" : "进行中"}</span></div>
          <div className={s.amount}>{Number(amount.toFixed(2))} <small>/ {v.target} {UNIT_LABELS[goal.unit]}</small></div>
          <div className={s.progress}><div style={{ width: `${Math.min(100, amount / Number(v.target) * 100)}%` }} /></div>
          {(goal.unit === "sets" || goal.unit === "reps") && <button disabled={pending} className={`${s.button} ${s.primary}`} onClick={() => run("exercise", { profile_id: profile.id, goal_id: goal.id, local_date: today, amount: 1 })}>完成一{goal.unit === "sets" ? "组" : "次"}</button>}
          <details className={s.details} open={goal.unit === "minutes" || goal.unit === "km"}><summary>填写本次记录 / 补记</summary><LogForm profileId={profile.id} goal={goal} today={today} pending={pending} run={run} /></details>
        </section>;
      })}</div>
      <p className={s.muted}>休息也属于计划。今天还没结束时，未达标的项目只显示“进行中”。</p>
    </>}
    {tab === "settings" && <>
      <section className={s.card}><h2>添加运动</h2><p className={s.muted}>选择一个主要达标单位；例如跑步以“分钟”为目标，公里数可在打卡时附记。</p><GoalForm profileId={profile.id} run={run} pending={pending} /></section>
      {goals.map(goal => {
        const latest = versions.filter(v => v.goal_id === goal.id).sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];
        return <section className={s.card} key={goal.id}><div className={s.between}><h3>{goal.name}</h3><span className={s.badge}>{latest?.active ? "已启用" : "已暂停/归档"}</span></div><p className={s.muted}>{latest && `${latest.effective_date} 起：${latest.target} ${UNIT_LABELS[goal.unit]}`} · 修改已有目标明天生效，历史保持不变。名称和单位固定；要改类型可暂停旧项目并新增。</p><details className={s.details}><summary>调整目标、计划日期或暂停</summary><GoalForm key={`${goal.id}-${latest?.effective_date}-${latest?.target}-${latest?.active}`} profileId={profile.id} goal={goal} version={latest} run={run} pending={pending} /></details></section>;
      })}
    </>}
    {tab === "records" && <>
      <div className={s.between}><h2>{profile.name}的坚持记录</h2><div className={s.row}>{[7, 30].map(n => <button className={`${s.button} ${range === n ? s.primary : ""}`} key={n} onClick={() => setRange(n)}>近 {n} 天</button>)}</div></div>
      <div className={s.metrics}><div><strong>{calendar.filter(d => d.participated).length}</strong><span>有运动的天数</span></div><div><strong>{calendar.filter(d => d.achieved).length}</strong><span>全部项目达标天数</span></div><div><strong>{scheduledPast.length ? Math.round(achievedPast.length / scheduledPast.length * 100) : "—"}{scheduledPast.length ? "%" : ""}</strong><span>已结束计划日达标率</span></div></div>
      <section className={s.card}><h3>每天的一小步</h3><p className={s.muted}>绿色：全部达标 · 金色：有运动 · 休息日不计入达标率，今天不提前计为失败。</p><div className={s.calendar}>{calendar.map(d => <div key={d.day} title={`${d.day}，${d.completed}/${d.scheduled} 项达标`} className={d.achieved ? s.achieved : d.participated ? s.activeDay : ""}><strong>{d.day.slice(5)}</strong><span>{d.achieved ? "达标" : d.participated ? "动过" : d.scheduled ? d.day === today ? "进行中" : "未记录" : "休息"}</span></div>)}</div></section>
      <FamilyTogether adultDays={data.adultDays ?? []} today={today} />
      <section className={s.card}><h3>逐次记录</h3><p className={s.muted}>保留实际运动日期、登记时间和撤销痕迹；不同计量单位不混加。</p>{!logs.length && <p className={s.muted}>还没有记录，完成第一次打卡后会显示在这里。</p>}
        {logs.slice(page * 15, page * 15 + 15).map(l => { const goal = goals.find(g => g.id === l.goal_id); return <div className={`${s.listItem} ${s.between}`} key={l.id}><div><strong>{goal?.name} · {l.amount} {goal ? UNIT_LABELS[goal.unit] : ""}</strong><div className={s.muted}>{l.local_date}{l.local_date !== new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(l.created_at)) ? " · 补记" : ""}{l.reps != null ? ` · ${l.reps} 次` : ""}{l.minutes != null ? ` · ${l.minutes} 分钟` : ""}{l.km != null ? ` · ${l.km} 公里` : ""}{l.note ? ` · ${l.note}` : ""}</div></div>{l.voided_at ? <span className={s.badge}>已撤销</span> : <button disabled={pending} className={`${s.button} ${s.quiet}`} onClick={() => { if (confirm("撤销这次打卡？原记录会保留更正痕迹。")) void run("undo", { id: l.id }); }}>撤销</button>}</div>; })}
        {logs.length > 15 && <div className={s.row}><button className={s.button} disabled={!page} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page + 1} / {Math.ceil(logs.length / 15)}</span><button className={s.button} disabled={(page + 1) * 15 >= logs.length} onClick={() => setPage(p => p + 1)}>下一页</button></div>}
      </section>
    </>}
  </>;
}

function GoalForm({ profileId, goal, version, run, pending }: { profileId: string; goal?: ExerciseGoal; version?: GoalVersion; run: RunCommand; pending: boolean }) {
  return <form className={s.form} onSubmit={async e => {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    const result = await run("goal", { profile_id: profileId, id: goal?.id, name: goal?.name ?? f.get("name"), unit: goal?.unit ?? f.get("unit"), target: f.get("target"), weekdays: f.getAll("days").map(Number), active: f.get("active") === "on" }); if (result && !goal) form.reset();
  }}>
    {!goal && <div className={s.grid}><label>运动名称<input name="name" list="exercise-ideas" required maxLength={50} placeholder="例如：跑步、快走、腹肌轮" /><datalist id="exercise-ideas">{["俯卧撑", "深蹲", "腹肌轮", "跑步", "快走", "平板支撑"].map(n => <option key={n} value={n} />)}</datalist></label><label>主要记录单位<select name="unit"><option value="sets">组</option><option value="reps">次</option><option value="minutes">分钟</option><option value="km">公里</option></select></label></div>}
    <label>每日目标{goal ? `（${UNIT_LABELS[goal.unit]}）` : ""}<input name="target" type="number" required min="0.01" max="10000" step="0.01" defaultValue={version?.target ?? 3} /></label>
    <fieldset><legend>计划日期</legend><div className={s.days}>{[1, 2, 3, 4, 5, 6, 0].map(d => <label key={d}><input type="checkbox" name="days" value={d} defaultChecked={version ? version.weekdays.includes(d) : true} />{"日一二三四五六"[d]}</label>)}</div></fieldset>
    <label className={s.check}><input name="active" type="checkbox" defaultChecked={version?.active ?? true} />启用此目标（取消勾选即暂停，保留历史）</label>
    <button className={`${s.button} ${s.primary}`} disabled={pending}>{goal ? "保存，明天生效" : "添加运动目标"}</button>
  </form>;
}
function LogForm({ profileId, goal, today, run, pending }: { profileId: string; goal: ExerciseGoal; today: string; run: RunCommand; pending: boolean }) {
  return <form className={s.form} onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); const result = await run("exercise", { profile_id: profileId, goal_id: goal.id, local_date: f.get("date"), amount: f.get("amount"), reps: f.get("reps"), minutes: f.get("minutes"), km: f.get("km"), note: f.get("note") }); if (result) form.reset(); }}>
    <div className={s.grid}><label>本次完成（{UNIT_LABELS[goal.unit]}）<input name="amount" type="number" required min="0.01" max="10000" step="0.01" defaultValue={goal.unit === "sets" ? 1 : undefined} /></label><label>实际运动日期<input name="date" type="date" required defaultValue={today} max={today} min={addDays(today, -30)} /></label></div>
    <div className={s.grid}>{goal.unit !== "reps" && <label>次数（选填）<input name="reps" type="number" min="0" max="10000" /></label>}{goal.unit !== "minutes" && <label>分钟（选填）<input name="minutes" type="number" min="0" max="1440" step="0.01" /></label>}{goal.unit !== "km" && <label>公里（选填）<input name="km" type="number" min="0" max="1000" step="0.01" /></label>}</div>
    <label>备注（选填）<input name="note" maxLength={500} placeholder="按自己的节奏完成" /></label><button disabled={pending} className={`${s.button} ${s.primary}`}>保存这次打卡</button>
  </form>;
}

// Optional child aggregation is loaded separately: it cannot block adult/child saves.
function FamilyTogether({ adultDays, today }: { adultDays: string[]; today: string }) {
  const [days, setDays] = useState<string[] | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <section className={s.card}><h3>我们一起参与的日子</h3><p className={s.muted}>仅汇总当前账号自己孩子的学习日期，不展示会议标题或内容。不要求每个人都全部达标。</p>{days ? <p>近 30 天，有 <strong>{days.filter(d => adultDays.includes(d) && d >= addDays(today, -29)).length}</strong> 天孩子和家长都参与了学习或运动。</p> : <button className={s.button} disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const r = await fetch("/api/adult/family", { cache: "no-store" }); const b = await r.json(); if (!r.ok) throw new Error(b.error); setDays(b.days); } catch { setError("家庭摘要暂时不可用，运动记录不受影响。"); } finally { setBusy(false); } }}>{busy ? "正在汇总…" : "查看家庭同日参与"}</button>}{error && <p role="alert" className={s.muted}>{error}</p>}</section>;
}
