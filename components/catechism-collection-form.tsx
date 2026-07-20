"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateCatechismCollection } from "@/lib/catechism-actions";
import { initialCatechismFormState } from "@/lib/catechism-form-state";

type CollectionEdit = { id: string; title: string; english_title: string | null; source_note: string | null; license_note: string | null; status: "draft" | "published" | "archived" };

function SaveCollectionButton() {
  const { pending } = useFormStatus();
  return <button className="secondary" type="submit" disabled={pending}>{pending ? "保存中…" : "保存问答册设置"}</button>;
}

export function CatechismCollectionForm({ collection, learners, assignedLearnerIds }: { collection: CollectionEdit; learners: Array<{ id: string; display_name: string }>; assignedLearnerIds: string[] }) {
  const [state, action] = useActionState(updateCatechismCollection, initialCatechismFormState);
  return <form className="catechism-collection-form" action={action}>
    <input type="hidden" name="collection_id" value={collection.id} />
    <label>中文名称<input name="title" defaultValue={collection.title} required maxLength={120} /></label>
    <label>英文名称<input name="english_title" defaultValue={collection.english_title ?? ""} maxLength={180} /></label>
    <label>内容来源<input name="source_note" defaultValue={collection.source_note ?? ""} maxLength={500} /></label>
    <label>授权说明<input name="license_note" defaultValue={collection.license_note ?? ""} maxLength={500} /></label>
    <label>发布状态<select name="status" defaultValue={collection.status}><option value="published">已发布</option><option value="draft">草稿</option><option value="archived">归档（保留历史）</option></select></label>
    <fieldset className="learner-assignment"><legend>分配给哪些孩子？</legend>{learners.map((learner) => <label className="checkbox-label" key={learner.id}><input type="checkbox" name="learner_ids" value={learner.id} defaultChecked={assignedLearnerIds.includes(learner.id)} />{learner.display_name}</label>)}</fieldset>
    <SaveCollectionButton />
    {state.message && <p className={state.status === "success" ? "success" : "error"} role="status">{state.message}</p>}
  </form>;
}
