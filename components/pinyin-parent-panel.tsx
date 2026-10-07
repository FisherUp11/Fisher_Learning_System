import type { SupabaseClient } from "@supabase/supabase-js";
import { FeedbackForm } from "@/components/feedback-form";
import { PinyinProgressList, type PinyinProgressRow } from "@/components/pinyin-progress-list";
import { savePinyinSettings } from "@/lib/pinyin-actions";
import { PINYIN_CATEGORIES, PINYIN_CATEGORY_LABELS, PINYIN_CATEGORY_COUNTS, type PinyinCategory } from "@/lib/pinyin-catalog";
import { PinyinMnemonicEditor } from "@/components/pinyin-mnemonic-editor";

export async function PinyinParentPanel({ supabase, learnerId, learnerName, timezone }: {
  supabase: SupabaseClient; learnerId: string; learnerName: string; timezone: string;
}) {
  const [{ data: settings, error: settingsError }, { data: catalog, error: catalogError }, { data: states, error: statesError },
    { data: introductions, error: introductionsError }, { data: mnemonics, error: mnemonicsError }] = await Promise.all([
    supabase.from("pinyin_settings").select("mode,daily_limit,enabled_categories,new_order").eq("learner_id", learnerId).maybeSingle(),
    supabase.from("pinyin_units").select("code,category,sort_order,example_hanzi,example_pinyin,mnemonic").order("sort_order"),
    supabase.from("pinyin_states").select("unit_code,stage,due_at,total_attempts,known_count,again_count,helped_count").eq("learner_id", learnerId),
    supabase.from("pinyin_introductions").select("unit_code").eq("learner_id", learnerId),
    supabase.from("pinyin_mnemonics").select("unit_code,mnemonic").eq("learner_id", learnerId),
  ]);
  if (settingsError || catalogError || statesError || introductionsError || mnemonicsError) return <section className="panel pinyin-parent-panel"><h2>拼音随字学</h2><p className="notice">请先运行基础 029 SQL，再依次运行 <code>034_pinyin_categories_and_random.sql</code>、<code>035_pinyin_nasal_finals.sql</code>。原有汉字学习不受影响。</p></section>;
  const categories = (settings?.mode === "off" ? [] : settings?.enabled_categories ?? []) as PinyinCategory[];
  const introduced = new Set((introductions ?? []).map((row) => row.unit_code));
  const mnemonicByCode = new Map((mnemonics ?? []).map((row) => [row.unit_code, row.mnemonic]));
  const now = new Date().toISOString();
  const stateByCode = new Map((states ?? []).map((state) => [state.unit_code, state]));
  const rows: PinyinProgressRow[] = (catalog ?? []).map((unit) => {
    const state = stateByCode.get(unit.code);
    return { code: unit.code, category: unit.category as PinyinCategory, example: `${unit.example_hanzi} ${unit.example_pinyin}`,
      introduced: introduced.has(unit.code), enabled: categories.includes(unit.category as PinyinCategory),
      stage: state?.stage ?? null, attempts: state?.total_attempts ?? 0, known: state?.known_count ?? 0,
      again: state?.again_count ?? 0, helped: state?.helped_count ?? 0, dueAt: state?.due_at ?? null };
  });
  const started = rows.filter((row) => row.stage !== null).length;
  const due = rows.filter((row) => row.enabled && ((row.dueAt && row.dueAt <= now) || (row.introduced && row.stage === null))).length;
  const mastered = rows.filter((row) => row.stage === 7).length;
  return <section className="panel pinyin-parent-panel">
    <p className="eyebrow">与汉字一起，单独记进度</p>
    <h2>{learnerName} 的拼音小练习</h2>
    <p className="muted">先完成汉字，再认一小组拼音。只安排勾选的类别；取消勾选会暂停这一类，学习记录保留。全部不勾选即关闭。</p>
    <FeedbackForm key={learnerId} action={savePinyinSettings} className="pinyin-settings-form" pendingLabel="正在保存拼音设置…">
      <input type="hidden" name="learner_id" value={learnerId} />
      <fieldset className="pinyin-category-options"><legend>加入哪些拼音</legend>{PINYIN_CATEGORIES.map((category) => <label key={category}>
        <input type="checkbox" name="categories" value={category} defaultChecked={categories.includes(category)} />
        <span>{PINYIN_CATEGORY_LABELS[category]}<small>{PINYIN_CATEGORY_COUNTS[category]}</small></span>
      </label>)}</fieldset>
      <label>每天最多几个（含复习）<select name="daily_limit" defaultValue={String(settings?.daily_limit ?? 4)}>
        <option value="3">3 个（轻松）</option><option value="4">4 个（推荐）</option><option value="5">5 个（稍快）</option>
      </select></label>
      <label>新拼音加入方式<select name="new_order" defaultValue={settings?.new_order ?? "sequential"}><option value="sequential">按题库顺序</option><option value="random">随机，不重复首次加入</option></select></label>
      <button className="secondary" type="submit">保存拼音设置</button>
      <p className="pinyin-settings-note">到期复习优先，剩余位置才加入新拼音；未完成的继续练，不会再次当作新拼音。已生成的当天数量与顺序不重排，下一天采用新设置。</p>
    </FeedbackForm>
    <div className="pinyin-summary"><span>已练 <strong>{started}</strong> / {rows.length}</span><span>已加入 <strong>{introduced.size}</strong></span><span>当前待复习／续学 <strong>{due}</strong></span><span>第 7 阶段 <strong>{mastered}</strong></span></div>
    <PinyinProgressList key={learnerId} rows={rows} now={now} timezone={timezone} />
    <PinyinMnemonicEditor key={learnerId} learnerId={learnerId} units={(catalog ?? []).map((unit) => ({ code: unit.code, category: unit.category as PinyinCategory,
      mnemonic: mnemonicByCode.get(unit.code) ?? unit.mnemonic, customized: mnemonicByCode.has(unit.code) }))} />
  </section>;
}
