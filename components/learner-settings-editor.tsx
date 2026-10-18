import { FeedbackForm } from "@/components/feedback-form";
import { updateLearnerSettings } from "@/lib/actions";

export type EditableLearnerSettings = {
  id: string; display_name: string; daily_new_limit: number; catechism_daily_new_limit: number; catechism_review_limit: number;
  hanzi_review_mode: string | null; hanzi_base_review_limit: number | null; hanzi_max_review_limit: number | null;
};

/** Shared by the own-family parent desk and the explicit admin child detail. Never records answers. */
export function LearnerSettingsEditor({ learner }: { learner: EditableLearnerSettings }) {
  return <FeedbackForm action={updateLearnerSettings} className="child-settings" pendingLabel="正在保存孩子的设置…" successMessage={`${learner.display_name} 的设置已保存。汉字每日量将在明天生成任务时采用新设置。`}>
    <input type="hidden" name="learner_id" value={learner.id} />
    <div className="child-settings-head"><span className="child-sprout" aria-hidden="true">🌱</span><strong>{learner.display_name}</strong></div>
    <div className="settings-fields">
      <label>孩子昵称<input name="display_name" defaultValue={learner.display_name} required maxLength={24} /></label>
      <label>每天新字数量<select name="daily_new_limit" defaultValue={String(learner.daily_new_limit)}>{[1,3,5,8,10,20,30,40,50].map(n => <option key={n} value={n}>{n} 个{n===5 ? "（推荐）" : n>=20 ? "（快速摸底）" : ""}</option>)}</select><span className="field-note">今天已有任务不变，明天生成队列时采用新数量。</span></label>
      <label>要理问答 · 每天新问题<input name="catechism_daily_new_limit" type="number" min="1" max="20" step="1" defaultValue={learner.catechism_daily_new_limit} /></label>
      <label>要理问答 · 每天到期复习上限<input name="catechism_review_limit" type="number" min="1" max="50" step="1" defaultValue={learner.catechism_review_limit} /></label>
      <label>汉字复习节奏<select name="hanzi_review_mode" defaultValue={learner.hanzi_review_mode ?? "adaptive"}><option value="adaptive">智能调整（推荐）</option><option value="fixed">固定上限</option></select><span className="field-note">根据到期积压和 7 天首答率，有界调整第二天任务。</span></label>
      <label>基础复习量<input name="hanzi_base_review_limit" type="number" min="5" max="40" defaultValue={learner.hanzi_base_review_limit ?? 15} /></label>
      <label>每日复习安全上限<input name="hanzi_max_review_limit" type="number" min="5" max="50" defaultValue={learner.hanzi_max_review_limit ?? 25} /><span className="field-note">超过上限的到期字逐日消化；不因续期一次性塞入全部积压。</span></label>
    </div>
    <button className="secondary" type="submit">保存 {learner.display_name} 的设置</button>
  </FeedbackForm>;
}
