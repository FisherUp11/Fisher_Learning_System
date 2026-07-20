"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { importCatechismCollection } from "@/lib/catechism-actions";
import { initialCatechismFormState } from "@/lib/catechism-form-state";

type LearnerChoice = { id: string; display_name: string };

function ImportButton() {
  const { pending } = useFormStatus();
  return <button className="primary full" type="submit" disabled={pending}>{pending ? "正在校验并导入…" : "校验并导入问答册"}</button>;
}

export function CatechismImportForm({ learners }: { learners: LearnerChoice[] }) {
  const [state, action] = useActionState(importCatechismCollection, initialCatechismFormState);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return <form className="catechism-import-form" action={action} ref={formRef}>
    <div className="catechism-form-grid">
      <label>中文问答册名称<input name="collection_title" defaultValue="儿童信仰问答" required maxLength={120} /></label>
      <label>英文名称<input name="english_title" defaultValue="First Catechism: Biblical Truth for God’s Children" maxLength={180} /></label>
      <label>内容来源<input name="source_note" defaultValue="First Catechism: Biblical Truth for God’s Children" maxLength={500} /></label>
      <label>授权说明<input name="license_note" defaultValue="已获得应用内家庭学习使用授权" maxLength={500} /></label>
    </div>
    <fieldset className="learner-assignment">
      <legend>这份问答册导入给哪些孩子？</legend>
      {learners.map((learner, index) => <label className="checkbox-label" key={learner.id}><input type="checkbox" name="learner_ids" value={learner.id} defaultChecked={index === 0} />{learner.display_name}</label>)}
    </fieldset>
    <label>CSV 文件<input name="catechism_csv_file" type="file" accept=".csv,text/csv" required /></label>
    <label className="checkbox-label catechism-publish-check"><input type="checkbox" name="publish_now" defaultChecked />导入后立即发布给所选孩子</label>
    <p className="field-note">每次导入会建立一份独立问答册，不会覆盖以前的问答和练习历史。建议先检查问题编号、中英文标点与授权版本。</p>
    <ImportButton />
    {state.message && <p className={state.status === "success" ? "success catechism-form-message" : "error catechism-form-message"} role="status">{state.message}</p>}
  </form>;
}
