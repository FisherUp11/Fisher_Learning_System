"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExercisePanel } from "./adult-exercise";
import type { AdultProfile, ExerciseGoal, GoalVersion, ExerciseLog, MeetingSource, EnglishLesson, EnglishConcept, ConceptState, DailyPlan, EnglishAttempt } from "@/lib/adult-learning";
import s from "./adult-growth.module.css";
import { rememberWaitDuration, WaitCountdown } from "./wait-countdown";
import type { ListeningData } from "./english-listening-panel";
import type { ListeningAttempt } from "@/lib/english-listening";
const EnglishPanel = dynamic(() => import("./adult-english").then(module => module.EnglishPanel), { loading: () => <div className={s.skeleton}>正在打开英语练习…</div> });
const aiWaits: Record<string, { seconds: number; label: string }> = {
  generate: { seconds: 35, label: "AI 正在生成课程，请勿重复提交" },
  "listen-generate": { seconds: 40, label: "AI 正在整理听力课，请勿重复提交" },
  attempt: { seconds: 8, label: "AI 正在阅读你的回答" },
  "listen-answer": { seconds: 4, label: "正在保存并批改" },
};

export type AdultData = { profiles: AdultProfile[]; profile: AdultProfile | null; today: string; goals?: ExerciseGoal[]; versions?: GoalVersion[]; logs?: ExerciseLog[]; adultDays?: string[]; sources?: MeetingSource[]; lessons?: EnglishLesson[]; concepts?: EnglishConcept[]; links?: { lesson_id: string; concept_id: string }[]; states?: ConceptState[]; plan?: DailyPlan | null; attempts?: EnglishAttempt[]; listening?: ListeningData };
export type CommandResult = { message: string; id?: string; attempt?: Pick<EnglishAttempt, "id" | "task_id" | "result" | "feedback">; listeningAttempt?: ListeningAttempt };
export type RunCommand = (action: string, payload: Record<string, unknown>) => Promise<CommandResult | null>;
export type PanelProps = { data: AdultData; tab: string; run: RunCommand; pending: boolean };

export function AdultHub({ area, tab }: { area: "exercise" | "english"; tab: string }) {
  const [data, setData] = useState<AdultData | null>(null);
  const [selected, setSelected] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const alive = useRef(true);
  const requests = useRef(new Map<string, string>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    let preferred = selected;
    if (!preferred) { try { preferred = localStorage.getItem("adult-profile") ?? ""; } catch { /* private browsing */ } }
    const endpoint=area === "english" && !tab.startsWith("legacy") ? "/api/adult/listening" : "/api/adult";
    fetch(`${endpoint}?area=${area}&profile=${encodeURIComponent(preferred)}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "加载失败");
      if (!controller.signal.aborted) {
        setData(result); setLoading(false);
        if (result.profile) { try { localStorage.setItem("parent-growth-enabled", "yes"); } catch { /* optional */ } }
      }
    }).catch(e => { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "加载失败"); setLoading(false); } });
    return () => controller.abort();
  }, [area, tab, selected, refresh]);
  const run = useCallback<RunCommand>(async (action, payload) => {
    if (submitting.current) return null;
    submitting.current = true; setPending(true); setPendingAction(action); setError(""); setNotice("");
    const startedAt = performance.now();
    const key = JSON.stringify({ action, ...payload });
    const body: Record<string, unknown> = { action, ...payload };
    if (["exercise", "generate", "attempt", "listen-generate", "listen-answer"].includes(action) && !body.id) {
      if (!requests.current.has(key)) requests.current.set(key, crypto.randomUUID());
      body.id = requests.current.get(key);
    }
    try {
      const response = await fetch("/api/adult", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(95000) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "操作未完成");
      requests.current.delete(key);
      rememberWaitDuration(`adult-${action}`, performance.now() - startedAt);
      if (alive.current) { setNotice(result.message); setRefresh(n => n + 1); }
      return result;
    } catch (e) {
      if (alive.current) setError(e instanceof Error && e.name !== "TimeoutError" ? e.message : "请求超时，结果暂未确认。可以重试，同一次请求不会重复记录。");
      return null;
    } finally { submitting.current = false; if (alive.current) setPending(false); }
  }, []);
  function select(id: string) {
    setSelected(id); setLoading(true); setNotice(""); setError("");
    try { localStorage.setItem("adult-profile", id); } catch { /* optional preference */ }
  }
  return <div className={s.root}>
    <header className={s.hero}><div><span className={s.eyebrow}>{area === "exercise" ? "SMALL STEPS · TOGETHER" : "YOUR MEETINGS, YOUR ENGLISH"}</span><h1>{area === "exercise" ? "一起坚持" : "会议英语"}</h1><p>{area === "exercise" ? "孩子在成长，我们也为自己留一点时间。" : "把真实工作中的英文，练成下次开会时的从容。"}</p></div>
      {!!data?.profiles.length && <div className={s.profiles} aria-label="选择成人档案">{data.profiles.filter(p => !p.archived).map(p => <button key={p.id} disabled={pending} className={data.profile?.id === p.id ? s.selected : ""} onClick={() => select(p.id)} aria-pressed={data.profile?.id === p.id}>{p.name}</button>)}</div>}
    </header>
    {area === "english" && <nav className={s.tabs} aria-label="父母英语学习方向"><Link className={`${s.button} ${s.primary}`} href="/english">会议英语</Link><Link className={s.button} href="/english/academic">专业英语 · 生物学等</Link></nav>}
    {pending && <div className={s.banner} role="status">{aiWaits[pendingAction] ? <WaitCountdown key={pendingAction} waitKey={`adult-${pendingAction}`} fallbackSeconds={aiWaits[pendingAction].seconds} label={aiWaits[pendingAction].label} /> : "正在处理，请稍候…"}</div>}
    {error && <div className={`${s.banner} ${s.error}`} role="alert">{error}<div><button className={s.button} disabled={pending} onClick={() => { setError(""); setLoading(true); setRefresh(n => n + 1); }}>重新加载</button></div></div>}
    {notice && <div className={s.banner} role="status">{notice}</div>}
    {loading ? <div className={s.skeleton}>正在准备你的页面…</div> : data && <>
      {!data.profile ? <section className={`${s.card} ${s.empty}`}><strong>先为爸爸或妈妈建一个档案</strong><p className={s.muted}>同一个账号切换参与者，运动和英语分别统计。</p><ProfileForm run={run} pending={pending} /></section> : <>
        {area === "exercise" ? <ExercisePanel key={data.profile.id} data={data} tab={tab} run={run} pending={pending} /> : <EnglishPanel key={data.profile.id} data={data} tab={tab} run={run} pending={pending} />}
        {(tab === "settings" || tab === "progress") && <section className={s.card}><h2>成人档案与英语计划</h2><p className={s.muted}>同账号下可查看彼此的记录；不是两个独立登录账户。</p><ProfileForm key={`${data.profile.id}-${data.profile.name}`} profile={data.profile} run={run} pending={pending} /><details className={s.details}><summary>添加另一位家庭成员</summary><ProfileForm run={run} pending={pending} /></details></section>}
      </>}
    </>}
    <p className={s.muted}>成人模块独立记录，不改变孩子的学习进度或贴纸。<Link href={area === "exercise" ? "/english" : "/together"}>{area === "exercise" ? " 去练会议英语 →" : " 去运动打卡 →"}</Link></p>
  </div>;
}
function ProfileForm({ profile, run, pending }: { profile?: AdultProfile; run: RunCommand; pending: boolean }) {
  return <form className={s.form} onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); const result = await run("profile", { id: profile?.id, name: f.get("name"), daily_new: f.get("daily_new"), daily_review: f.get("daily_review"), level: f.get("level") }); if (result && !profile) form.reset(); }}>
    <label>档案名称<input name="name" required maxLength={30} defaultValue={profile?.name} placeholder="爸爸 / 妈妈" /></label>
    {profile && <><p className={s.muted}>新版固定 CET-6 基础，每节精选 4～6 个词句；到期复习最多 5 个（下方设得更少时尊重较小值）。新表达数量和难度选项仅用于“旧版口语与历史”。今天已开始的计划保持不变。</p><div className={s.grid}><label>旧版每日新表达（0～5）<input name="daily_new" type="number" min={0} max={5} defaultValue={profile.daily_new} required /></label><label>到期复习设置（新版最多 5 个）<input name="daily_review" type="number" min={1} max={20} defaultValue={profile.daily_review} required /></label><label>旧版口语难度<select name="level" defaultValue={profile.level}><option value="supported">需要较多中文帮助</option><option value="practical">大致听懂，开口困难</option><option value="advanced">能交流，想说得更自然</option></select></label></div></>}
    <button className={`${s.button} ${s.primary}`} disabled={pending}>{profile ? "保存设置（下次计划生效）" : "创建成人档案"}</button>
  </form>;
}
