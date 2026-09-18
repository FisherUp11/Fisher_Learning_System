"use client";
import Link from "next/link";
import { useState } from "react";
import { masteryLabel, type EnglishLesson, type LessonContent, type MeetingSource } from "@/lib/adult-learning";
import type { PanelProps, RunCommand } from "./adult-hub";
import { EnglishStudy } from "./adult-english-study";
import s from "./adult-growth.module.css";

const statusLabels = { generating: "生成中", failed: "生成失败，可重试", draft: "待预览草稿", published: "已加入学习", archived: "已归档" };
export function EnglishPanel(props: PanelProps) {
  const { data, tab, run, pending } = props;
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState("all"); const [sourceFilter, setSourceFilter] = useState(""); const [page, setPage] = useState(0);
  const attempts = data.attempts ?? [], states = data.states ?? [];
  const sources = data.sources ?? [], lessons = data.lessons ?? [];
  if (tab === "today") return data.plan ? <EnglishStudy data={data} run={run} pending={pending} /> : <section className={s.card}>
    <span className={s.eyebrow}>A LITTLE PRACTICE, EVERY DAY</span><h2 style={{ marginTop: 14 }}>今天，给英语留一小段时间</h2><p className={s.muted}>到期表达优先，接着听懂、开口、再小测。不设强制倒计时，可以暂停后继续。</p>
    {lessons.some(l => l.status === "published" && !sources.find(s => s.id === l.source_id)?.archived) ? <form className={s.form} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void run("plan", { profile_id: data.profile!.id, mode: f.get("mode"), lesson_id: f.get("lesson") }); }}><div className={s.grid}><label>今天的练习量<select name="mode"><option value="standard">标准短课 · 10～15 分钟</option><option value="short">精简练习 · 约 5 分钟</option><option value="weekly">情境小测 · 约 5～8 分钟</option></select></label><label>会议主题<select name="lesson"><option value="">系统推荐：重点 / 较少练习</option>{lessons.filter(l => l.status === "published" && !sources.find(s => s.id === l.source_id)?.archived).map(l => <option key={l.id} value={l.id}>{sources.find(s => s.id === l.source_id)?.title} · {l.created_at.slice(0, 10)} · {l.level}</option>)}</select></label></div><button disabled={pending} className={`${s.button} ${s.primary}`}>开始今天的练习</button><p className={s.muted}>计划开始后保留当天快照。设置修改用于下一天，不覆盖今天的作答。</p></form> : <div className={s.empty}><strong>用一份真实纪要，开始第一课</strong><p className={s.muted}>先导入材料，再预览并发布课程。AI 生成不会自动算作你已经学习。</p><Link className={`${s.button} ${s.primary}`} href="/english/materials">导入会议资料 →</Link></div>}
  </section>;
  if (tab === "materials") return <>
    <section className={s.card}><h2>导入会议资料</h2><p className={s.muted}>资料只在当前账号的成人档案内使用。请先删除客户隐私、账号、密钥及无权提交的内容；点击生成时，所选纪要将发送至你配置的 Azure 服务。</p><SourceForm run={run} pending={pending} today={data.today} /></section>
    <div className={s.between}><h2>我的会议资料</h2><span className={s.badge}>{sources.length} 份 · 当前账号私有</span></div>
    <label className={s.form}>检索资料<input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="搜索标题或纪要内容" /></label>
    {sources.filter(m => `${m.title} ${m.body}`.toLowerCase().includes(query.toLowerCase())).slice(page * 10, page * 10 + 10).map(source => <SourceCard key={source.id} source={source} lessons={lessons.filter(l => l.source_id === source.id)} profileId={data.profile!.id} run={run} pending={pending} />)}
    <Pagination page={page} count={sources.filter(m => `${m.title} ${m.body}`.toLowerCase().includes(query.toLowerCase())).length} size={10} setPage={setPage} />
  </>;
  const concepts = (data.concepts ?? []).filter(c => {
    const related = states.filter(st => st.concept_id === c.id);
    return `${c.phrase} ${c.meaning}`.toLowerCase().includes(query.toLowerCase()) && (!sourceFilter || (data.links ?? []).some(l => l.concept_id === c.id && lessons.find(x => x.id === l.lesson_id)?.source_id === sourceFilter)) && (filter === "all" || filter === "new" && !related.length || filter === "due" && related.some(st => st.due_date <= data.today) || filter === "stable" && related.some(st => masteryLabel(st) === "稳定掌握"));
  });
  const firstAttempts = attempts.filter((a, i) => !attempts.slice(i + 1).some(x => x.plan_id === a.plan_id && x.task_id === a.task_id));
  const independent = firstAttempts.filter(a => a.evaluator === "ai" && !a.hinted && (a.mode === "speech" || a.mode === "text"));
  return <>
    <div className={s.metrics}><div><strong>{new Set(attempts.map(a => a.local_date)).size}</strong><span>近 30 天有效练习日</span></div><div><strong>{attempts.length}</strong><span>近 30 天有结果的作答</span></div><div><strong>{independent.length ? Math.round(independent.filter(a => a.result === "correct").length / independent.length * 100) + "%" : "—"}</strong><span>首次无提示 AI 内容通过率 · {independent.length} 次</span></div></div>
    <p className={s.muted}>此通过率包含文字与语音内容练习，不代表发音成绩。不同难度、题型之间不宜直接比较。播放音频不计为有效练习日。</p>
    <section className={s.card}><h2>我的表达积累</h2><div className={s.grid}><label>搜索表达<input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="英文、中文意思" /></label><label>练习状态<select value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}><option value="all">全部</option><option value="due">到期需复习</option><option value="new">还没练习</option><option value="stable">至少一个维度稳定掌握</option></select></label><label>来源会议<select value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setPage(0); }}><option value="">全部会议</option>{sources.map(source => <option key={source.id} value={source.id}>{source.title}</option>)}</select></label></div>
      {!concepts.length && <p className={s.muted}>暂无符合条件的表达。课程发布后，表达会出现在这里。</p>}
      {concepts.slice(page * 12, page * 12 + 12).map(c => <div className={s.listItem} key={c.id}><h3>{c.phrase}</h3><p>{c.meaning}</p><p className={s.muted}>{c.example}</p><div className={s.row}>{(["listening", "speaking"] as const).map(skill => { const st = states.find(st => st.concept_id === c.id && st.skill === skill); return <span key={skill} className={s.badge}>{skill === "listening" ? "听懂" : "独立开口"}：{masteryLabel(st)} · {st?.attempts ?? 0} 次{st ? ` · 阶段 ${st.stage}/5 · ${st.due_date <= data.today ? "需复习" : st.due_date + " 复习"}` : ""}</span>; })}</div><p className={s.muted}>来源：{[...new Set((data.links ?? []).filter(l => l.concept_id === c.id).map(l => sources.find(source => source.id === lessons.find(x => x.id === l.lesson_id)?.source_id)?.title).filter(Boolean))].join("、")}</p></div>)}
      <Pagination page={page} count={concepts.length} size={12} setPage={setPage} />
    </section>
    <section className={s.card}><h2>最近练习</h2><p className={s.muted}>稳定掌握需要跨天独立正确，且至少经历一次 7 天间隔。自评、人工修正转写、提示后答对不会直接变成独立掌握。</p>{attempts.slice(0, 20).map(a => <details className={s.details} key={a.id}><summary>{a.local_date} · {a.result === "correct" ? "内容通过" : a.result === "partial" ? "还可完善" : "需要再练"} · {a.evaluator === "self" ? "自评" : "AI 内容反馈"}{a.hinted ? " · 用过提示" : ""}{a.mode === "corrected" ? " · 转写已修正" : ""}</summary><p>{a.response}</p><p className={s.muted}>{a.feedback}</p></details>)}</section>
  </>;
}
function Pagination({ page, count, size, setPage }: { page: number; count: number; size: number; setPage: (n: number) => void }) {
  if (count <= size) return null;
  return <div className={s.row}><button className={s.button} disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / {Math.ceil(count / size)}</span><button className={s.button} disabled={(page + 1) * size >= count} onClick={() => setPage(page + 1)}>下一页</button></div>;
}
function SourceForm({ run, pending, today }: { run: RunCommand; pending: boolean; today: string }) {
  const [body, setBody] = useState(""); const [fileError, setFileError] = useState("");
  return <form className={s.form} onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); if (!confirm("保存这份纪要到当前账号的私有资料库？相同正文会自动检查重复。")) return; const result = await run("source", { title: f.get("title"), body, meeting_date: f.get("date"), priority: f.get("priority") === "on" }); if (result) { setBody(""); form.reset(); } }}>
    <div className={s.grid}><label>会议标题<input name="title" required maxLength={120} placeholder="例如：本周项目进度讨论" /></label><label>会议日期<input name="date" type="date" defaultValue={today} required /></label></div>
    <label>上传 UTF-8 TXT（也可以直接粘贴）<input type="file" accept=".txt,text/plain" disabled={pending} onChange={async e => { setFileError(""); const f = e.target.files?.[0]; if (!f) return; try { if (f.size > 120000) throw new Error("文件过大，请先截取一段纪要"); setBody(new TextDecoder("utf-8", { fatal: true }).decode(await f.arrayBuffer()).replace(/^\uFEFF/, "")); } catch (e) { setFileError(e instanceof Error ? e.message : "请使用 UTF-8 TXT 文件"); } }} /></label>
    <label>英文纪要（20～30,000 字符，最多约 3,000 个英文词）<textarea rows={8} required minLength={20} maxLength={30000} value={body} onChange={e => setBody(e.target.value)} placeholder="粘贴你有权使用的会议片段。先去掉敏感信息；长会议可以按主题分成几份资料。" /></label>
    <label className={s.check}><input type="checkbox" name="priority" />近期会议要用到，优先练习</label>{fileError && <p role="alert" className={s.error}>{fileError}</p>}<button disabled={pending} className={`${s.button} ${s.primary}`}>确认并保存资料</button>
  </form>;
}
function SourceCard({ source, lessons, profileId, run, pending }: { source: MeetingSource; lessons: EnglishLesson[]; profileId: string; run: RunCommand; pending: boolean }) {
  return <section className={s.card}><div className={s.between}><div><h3>{source.title}</h3><span className={s.muted}>{source.meeting_date} · {lessons.filter(l => l.status === "published").length} 版已发布课程</span></div><span className={s.badge}>{source.archived ? "已归档" : source.priority ? "优先练习" : "私有资料"}</span></div>
    <details className={s.details}><summary>查看原文</summary><div className={s.document}>{source.body}</div></details>
    <div className={s.row}><button disabled={pending || source.archived} className={`${s.button} ${s.primary}`} onClick={() => { if (!lessons.length || confirm("生成新的课程版本？旧版本和练习历史不会被覆盖；会调用 Azure AI。")) void run("generate", { source_id: source.id, profile_id: profileId }); }}>{lessons.length ? "生成新版本" : "生成课程草稿"}</button><button disabled={pending} className={s.button} onClick={() => run("source-status", { id: source.id, archived: source.archived, priority: !source.priority })}>{source.priority ? "取消重点" : "设为重点"}</button><button disabled={pending} className={`${s.button} ${s.quiet}`} onClick={() => run("source-status", { id: source.id, archived: !source.archived, priority: source.priority })}>{source.archived ? "恢复资料" : "归档"}</button></div>
    {lessons.map(lesson => <details className={s.details} key={`${lesson.id}-${lesson.status}`} open={lesson.status === "draft" || lesson.status === "failed"}><summary>{statusLabels[lesson.status]} · {lesson.created_at.slice(0, 10)} · {lesson.level}</summary>{lesson.error && <p role="alert" className={s.muted}>{lesson.error}</p>}{(lesson.status === "failed" || lesson.status === "generating") && <button disabled={pending} className={s.button} onClick={() => run("generate", { id: lesson.id, source_id: source.id, profile_id: profileId })}>检查 / 重试本次生成</button>}{lesson.content && (lesson.status === "draft" ? <LessonEditor lesson={lesson} run={run} pending={pending} /> : <div><div className={s.document}>{lesson.content.summary}{"\n\n"}{lesson.content.translation}</div><p className={s.muted}>这是根据纪要生成的合成听力稿，不是真实会议录音。已发布版本保留原样；修订请生成新版本。</p></div>)}</details>)}
    <details className={s.details}><summary>删除资料</summary><p className={s.muted}>这会删除原文、派生课程，以及含此课程的整份每日计划和作答历史（包括该计划中的其他题目）。共享到其他会议的表达会保留。仅想暂时停用，请选择“归档”。</p><button disabled={pending} className={`${s.button} ${s.danger}`} onClick={() => { const confirmText = prompt("此操作不可撤销。请输入“删除”确认删除这份资料及相关练习历史："); if (confirmText === "删除") void run("source-delete", { id: source.id, confirm: confirmText }); }}>永久删除资料及关联记录</button></details>
  </section>;
}
function LessonEditor({ lesson, run, pending }: { lesson: EnglishLesson; run: RunCommand; pending: boolean }) {
  const [content, setContent] = useState<LessonContent>(lesson.content!);
  return <div className={`${s.lessonEditor} ${s.form}`}><p className={s.muted}>请核对事实、数字与人名。下面的口语与小测属于 AI 模拟场景；来源引文必须保留为原文摘录。</p>
    <label>英文听力稿<textarea rows={6} value={content.summary} maxLength={3000} onChange={e => setContent({ ...content, summary: e.target.value })} /></label><label>中文辅助理解<textarea rows={4} value={content.translation} maxLength={3000} onChange={e => setContent({ ...content, translation: e.target.value })} /></label>
    {(["questions", "speaking", "quiz"] as const).map(key => <details key={key} className={s.details}><summary>{{ questions: "听力理解", speaking: "模拟会议口语", quiz: "新情境小测" }[key]} · {content[key].length} 题</summary>{content[key].map((q, i) => <div className={s.form} key={i}><label>题目 {i + 1}<textarea rows={2} value={q.prompt} onChange={e => setContent({ ...content, [key]: content[key].map((x, j) => j === i ? { ...x, prompt: e.target.value } : x) })} /></label><label>参考答案<textarea rows={2} value={q.answer} onChange={e => setContent({ ...content, [key]: content[key].map((x, j) => j === i ? { ...x, answer: e.target.value } : x) })} /></label></div>)}</details>)}
    <details className={s.details}><summary>重点表达与原文来源 · {content.expressions.length} 项</summary>{content.expressions.map((item, i) => <div className={s.listItem} key={i}>{(["phrase", "meaning", "example", "source_quote"] as const).map(key => <label key={key}>{{ phrase: "英文表达", meaning: "中文意思", example: "模拟例句", source_quote: "原文引文" }[key]}<textarea rows={2} value={item[key]} onChange={e => setContent({ ...content, expressions: content.expressions.map((x, j) => j === i ? { ...x, [key]: e.target.value } : x) })} /></label>)}</div>)}</details>
    <div className={s.row}><button disabled={pending} className={s.button} onClick={() => run("draft", { id: lesson.id, content })}>保存草稿</button><button disabled={pending} className={`${s.button} ${s.primary}`} onClick={() => { if (confirm("已核对课程内容，确认加入学习？发布后不能覆盖，修订需生成新版本。")) void run("publish", { id: lesson.id, content }); }}>确认内容，加入学习</button></div>
  </div>;
}
