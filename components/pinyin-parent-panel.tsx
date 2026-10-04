import type { SupabaseClient } from "@supabase/supabase-js";
import { FeedbackForm } from "@/components/feedback-form";
import { PinyinProgressList, type PinyinProgressRow } from "@/components/pinyin-progress-list";
import { savePinyinSettings } from "@/lib/pinyin-actions";

export async function PinyinParentPanel({ supabase, learnerId, learnerName, timezone }: {
  supabase: SupabaseClient; learnerId: string; learnerName: string; timezone: string;
}) {
  const [{ data: settings, error: settingsError }, { data: catalog, error: catalogError }, { data: states, error: statesError }] = await Promise.all([
    supabase.from("pinyin_settings").select("mode,daily_limit").eq("learner_id", learnerId).maybeSingle(),
    supabase.from("pinyin_units").select("code,category,sort_order,example_hanzi,example_pinyin").order("sort_order"),
    supabase.from("pinyin_states").select("unit_code,stage,due_at,total_attempts,known_count,again_count,helped_count").eq("learner_id", learnerId),
  ]);
  if (settingsError || catalogError || statesError) return <section className="panel pinyin-parent-panel"><h2>拼音随字学</h2><p className="notice">启用前请先在 Supabase SQL Editor 运行 <code>supabase/029_pinyin_learning.sql</code>。原有汉字学习不受影响。</p></section>;
  const stateByCode = new Map((states ?? []).map((state) => [state.unit_code, state]));
  const rows: PinyinProgressRow[] = (catalog ?? []).map((unit) => {
    const state = stateByCode.get(unit.code);
    return { code: unit.code, category: unit.category as "final" | "initial", example: `${unit.example_hanzi} ${unit.example_pinyin}`,
      stage: state?.stage ?? null, attempts: state?.total_attempts ?? 0, known: state?.known_count ?? 0,
      again: state?.again_count ?? 0, helped: state?.helped_count ?? 0, dueAt: state?.due_at ?? null };
  });
  const started = rows.filter((row) => row.stage !== null).length;
  const due = rows.filter((row) => row.dueAt && row.dueAt <= new Date().toISOString()).length;
  const mastered = rows.filter((row) => row.stage === 7).length;
  return <section className="panel pinyin-parent-panel">
    <p className="eyebrow">与汉字一起，单独记进度</p>
    <h2>{learnerName} 的拼音小练习</h2>
    <p className="muted">先完成汉字，再用一小段时间认拼音。关闭时不会排入新卡，既有学习记录保留。</p>
    <FeedbackForm action={savePinyinSettings} className="pinyin-settings-form" pendingLabel="正在保存拼音设置…">
      <input type="hidden" name="learner_id" value={learnerId} />
      <label>加入哪些拼音<select name="mode" defaultValue={settings?.mode ?? "off"}>
        <option value="off">暂不开启</option><option value="finals">只学单韵母</option>
        <option value="initials">只学声母</option><option value="both">声母和单韵母</option>
      </select></label>
      <label>每天几个<select name="daily_limit" defaultValue={String(settings?.daily_limit ?? 4)}>
        <option value="3">3 个（轻松）</option><option value="4">4 个（推荐）</option><option value="5">5 个（稍快）</option>
      </select></label>
      <button className="secondary" type="submit">保存拼音设置</button>
    </FeedbackForm>
    <div className="pinyin-summary"><span>已学 <strong>{started}</strong> / {rows.length}</span><span>到期 <strong>{due}</strong></span><span>第 7 阶段 <strong>{mastered}</strong></span></div>
    <PinyinProgressList rows={rows} now={new Date().toISOString()} timezone={timezone} />
  </section>;
}
