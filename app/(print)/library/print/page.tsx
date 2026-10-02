import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintAction } from "@/components/print-action";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";
import { createClient } from "@/lib/supabase/server";
import styles from "./print.module.css";

export const dynamic = "force-dynamic";

type PrintMode = "all" | "recent30" | "recent60" | "ongoing";
type PrintRow = { id: string; hanzi: string; stage: number; attempt_count: number; due: boolean };
type PrintSheet = {
  printed_on: string; learned_total: number; selected_total: number;
  stable_total: number; mastered_total: number; due_total: number; rows: PrintRow[];
};

const PAGE_SIZE = 176;
const LABELS: Record<PrintMode, string> = {
  all: "全部学过", recent30: "最近 30 天练过",
  recent60: "最近 60 天练过", ongoing: "所有尚未熟练",
};

function stageLabel(stage: number, due: boolean) {
  if (due) return "到期复习";
  if (stage === 7) return "熟练掌握";
  if (stage >= 5) return "稳定认识";
  if (stage >= 1) return "正在巩固";
  return "刚开始学";
}

export default async function HanziPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ learner?: string; mode?: string; unmastered?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(supabase, user.id);
  if (!access) redirect("/join");
  const learnerId = params.learner ?? "";
  const { data: learner, error: learnerError } = await supabase
    .from("learner_profiles").select("id,display_name").eq("id", learnerId).maybeSingle();
  if (learnerError || !learner) notFound();
  try {
    await requireChildModule(supabase, access, user.id, learner.id, "hanzi");
  } catch {
    notFound();
  }

  const mode: PrintMode = params.mode === "recent30" || params.mode === "recent60" || params.mode === "ongoing"
    ? params.mode : "all";
  const onlyUnmastered = params.unmastered === "1";
  const { data, error } = await supabase.rpc("get_hanzi_print_sheet", {
    p_learner_id: learner.id, p_mode: mode, p_only_unmastered: onlyUnmastered,
  });
  if (error || !data) return <main className={styles.errorPage}>
    <h1>暂时无法生成学习表</h1>
    <p>{error?.message ?? "没有取得学习记录"}</p>
    <p>请确认已在 Supabase 执行 026 号 SQL，并确认这位孩子已开通汉字模块。</p>
    <Link href="/library">返回字库</Link>
  </main>;
  const sheet = data as PrintSheet;
  const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
  const pages = Array.from({ length: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)) }, (_, index) =>
    rows.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE));
  const rangeLabel = LABELS[mode] + (onlyUnmastered && mode !== "ongoing" ? " · 尚未熟练" : "");

  return <main className={styles.page}>
    <div className={styles.toolbar}>
      <div className={styles.toolbarTitle}>
        <span className={styles.mark}>字</span>
        <div><strong>汉字学习表</strong><small>浏览器预览 · A4 竖版 · 不改变学习记录</small></div>
      </div>
      <form action="/library/print" className={styles.filterForm}>
        <input type="hidden" name="learner" value={learner.id} />
        <label>打印范围<select name="mode" defaultValue={mode}>
          <option value="all">全部学过</option>
          <option value="recent30">最近 30 天练过</option>
          <option value="recent60">最近 60 天练过</option>
          <option value="ongoing">所有尚未熟练</option>
        </select></label>
        <label className={styles.checkbox}><input type="checkbox" name="unmastered" value="1" defaultChecked={onlyUnmastered} />只看尚未到阶段 7</label>
        <button type="submit" className={styles.filterButton}>更新预览</button>
      </form>
      <PrintAction className={styles.printButton} />
      <Link href={`/library?learner=${learner.id}`} className={styles.back}>返回字库</Link>
    </div>
    <p className={styles.screenNote}>同一个字跨字册只印一次。纸上的勾选供线下复核，不会自动改变系统阶段；阶段 7 仍会定期复习。</p>
    <div className={styles.sheets}>
      {pages.map((pageRows, pageIndex) => <section className={styles.sheet} key={pageIndex} aria-label={`第 ${pageIndex + 1} 页`}>
        <header className={styles.sheetHead}>
          <div><p className={styles.kicker}>字芽 · 学习足迹</p><h1>{learner.display_name} 的汉字学习表</h1><p>{rangeLabel} · {sheet.printed_on}</p></div>
          <div className={styles.summary}><strong>{sheet.selected_total}</strong><span>本次打印</span></div>
        </header>
        <div className={styles.metrics}>
          <span>累计学过 <b>{sheet.learned_total}</b></span>
          <span>阶段 5–6 <b>{sheet.stable_total}</b></span>
          <span>阶段 7 <b>{sheet.mastered_total}</b></span>
          <span>已到期 <b>{sheet.due_total}</b></span>
        </div>
        {pageRows.length ? <div className={styles.grid}>
          {pageRows.map((row) => <div className={styles.cell} key={row.id} title={`${row.hanzi}：${stageLabel(row.stage, row.due)}，练习 ${row.attempt_count} 次`}>
            <span className={styles.hanzi}>{row.hanzi}</span>
            <span className={styles.cellMeta}>阶 {row.stage} · {row.attempt_count} 次{row.due ? " · 复" : ""}</span>
            <span className={styles.check} aria-hidden="true" />
          </div>)}
        </div> : <div className={styles.empty}>这个范围内暂时没有学过的字。试试“全部学过”或放宽日期范围。</div>}
        <footer className={styles.sheetFooter}><span>阶段 0–4：正在记忆　/　5–6：稳定认识　/　7：熟练掌握　/　复：到期复习</span><span>{pageIndex + 1} / {pages.length}</span></footer>
      </section>)}
    </div>
  </main>;
}
