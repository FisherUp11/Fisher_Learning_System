"use client";

import { importCatechismCollection } from "@/lib/catechism-actions";
import { initialCatechismFormState } from "@/lib/catechism-form-state";
import { FeedbackForm } from "@/components/feedback-form";

type LearnerChoice = { id: string; display_name: string };

export function CatechismImportForm({ learners, isAdmin = false }: { learners: LearnerChoice[]; isAdmin?: boolean }) {
  return <FeedbackForm className="catechism-import-form" action={(data) => importCatechismCollection(initialCatechismFormState, data)} clearFileOnSuccess pendingLabel="正在校验并导入问答，请稍候…" confirm={{ title: "确认导入这份问答册？", description: isAdmin ? "请确认文件、孩子与发布选项。已有问答和学习记录会保留。" : "确认后将提交给管理员审核。" }}>
    <div className="catechism-form-grid">
      <label>中文问答册名称<input name="collection_title" defaultValue="要理问答" required maxLength={120} /></label>
      <label>英文名称<input name="english_title" defaultValue="First Catechism: Biblical Truth for God’s Children" maxLength={180} /></label>
      <label>内容来源<input name="source_note" defaultValue="First Catechism: Biblical Truth for God’s Children" maxLength={500} /></label>
      <label>授权说明<input name="license_note" defaultValue="已获得应用内家庭学习使用授权" maxLength={500} /></label>
    </div>
    <fieldset className="learner-assignment">
      <legend>{isAdmin ? "这份问答册导入给哪些孩子？" : "建议管理员审核后分配给哪位孩子？"}</legend>
      {learners.map((learner, index) => <label className="checkbox-label" key={learner.id}><input type={isAdmin ? "checkbox" : "radio"} name="learner_ids" value={learner.id} defaultChecked={index === 0} />{learner.display_name}</label>)}
    </fieldset>
    <label>CSV 文件<input name="catechism_csv_file" type="file" accept=".csv,text/csv" required /></label>
    {isAdmin && <label className="checkbox-label catechism-publish-check"><input type="checkbox" name="publish_now" defaultChecked />导入后立即发布给所选孩子</label>}
    <p className="field-note">新内容会建立独立问答册，相同内容会识别为已导入。建议先检查问题编号、中英文标点与授权版本。</p>
    <button className="primary full" type="submit">校验并导入问答册</button>
  </FeedbackForm>;
}
