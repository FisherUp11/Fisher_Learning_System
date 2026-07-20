"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateCatechismItem } from "@/lib/catechism-actions";
import { initialCatechismFormState } from "@/lib/catechism-form-state";

type EditableItem = {
  id: string;
  item_key: string;
  sort_order: number;
  section_title: string | null;
  question_zh: string;
  question_en: string | null;
  answer_zh: string;
  answer_en: string | null;
  scripture_reference: string | null;
  parent_note: string | null;
  status: "active" | "archived";
};

function SaveButton() {
  const { pending } = useFormStatus();
  return <button className="primary catechism-save-button" type="submit" disabled={pending}>{pending ? "保存中…" : "保存问答内容"}</button>;
}

export function CatechismItemForm({ item }: { item: EditableItem }) {
  const [state, action] = useActionState(updateCatechismItem, initialCatechismFormState);
  return <form className="catechism-editor-form" action={action}>
    <input type="hidden" name="item_id" value={item.id} />
    <div className="catechism-editor-meta">
      <label>稳定编号<input name="item_key" defaultValue={item.item_key} required maxLength={100} /></label>
      <label>显示顺序<input name="sort_order" type="number" min="1" defaultValue={item.sort_order} required /></label>
      <label>章节<input name="section_title" defaultValue={item.section_title ?? ""} maxLength={120} /></label>
      <label>状态<select name="status" defaultValue={item.status}><option value="active">正常学习</option><option value="archived">归档（保留记录）</option></select></label>
    </div>
    <div className="catechism-editor-languages">
      <section><p className="eyebrow">中文</p><label>中文问题<textarea name="question_zh" defaultValue={item.question_zh} required maxLength={2000} /></label><label>中文答案<textarea name="answer_zh" defaultValue={item.answer_zh} required maxLength={4000} /></label></section>
      <section lang="en"><p className="eyebrow">English</p><label>English question<textarea name="question_en" defaultValue={item.question_en ?? ""} required maxLength={3000} /></label><label>English answer<textarea name="answer_en" defaultValue={item.answer_en ?? ""} required maxLength={6000} /></label></section>
    </div>
    <div className="catechism-editor-meta">
      <label>经文出处<textarea name="scripture_reference" defaultValue={item.scripture_reference ?? ""} maxLength={1000} /></label>
      <label>家长备注<textarea name="parent_note" defaultValue={item.parent_note ?? ""} maxLength={1000} /></label>
    </div>
    <div className="music-save-row"><SaveButton /><div className="music-save-feedback">{state.message && <p className={state.status === "success" ? "success" : "error"} role="status">{state.message}</p>}</div></div>
  </form>;
}
