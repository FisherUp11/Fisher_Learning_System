"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { updateMusicItem, type MusicItemStatus, type MusicItemType, type MusicSaveState } from "@/lib/music-actions";

type MusicItemFormItem = {
  id: string;
  itemType: MusicItemType;
  title: string;
  category: string | null;
  description: string | null;
  lyrics: string | null;
  correctAnswer: string | null;
  instructions: string | null;
  difficulty: number;
  status: MusicItemStatus;
};

type LearnerOption = { id: string; displayName: string };

const initialMusicSaveState: MusicSaveState = { status: "idle", message: "" };

function SaveMusicItemButton() {
  const { pending } = useFormStatus();
  return <button className="primary music-save-button" type="submit" disabled={pending} aria-disabled={pending}>{pending ? "正在保存资料…" : "保存内容资料"}</button>;
}

export function MusicItemForm({ item, learners, assignedLearnerIds }: {
  item: MusicItemFormItem;
  learners: LearnerOption[];
  assignedLearnerIds: string[];
}) {
  const router = useRouter();
  const [saveState, formAction] = useActionState(updateMusicItem, initialMusicSaveState);
  const [selectedStatus, setSelectedStatus] = useState<MusicItemStatus>(item.status);

  useEffect(() => {
    if (saveState.status !== "success") return;
    router.refresh();
  }, [router, saveState.savedAt, saveState.status]);

  return <form action={formAction} className="music-editor-form">
    <input type="hidden" name="item_id" value={item.id} />
    <div className="music-editor-grid"><label>名称<input name="title" required maxLength={100} defaultValue={item.title} /></label><label>分类（可选）<input name="category" maxLength={60} defaultValue={item.category ?? ""} placeholder="例如：古诗新唱、儿歌" /></label><label>难度<select name="difficulty" defaultValue={String(item.difficulty)}><option value="1">1 · 入门</option><option value="2">2 · 简单</option><option value="3">3 · 适中</option><option value="4">4 · 稍难</option><option value="5">5 · 挑战</option></select></label><label>发布状态<select name="status" value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value as MusicItemStatus)}><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option></select></label></div>
    <label>简介（可选）<textarea name="description" maxLength={500} defaultValue={item.description ?? ""} placeholder="给家长看的简短说明" /></label>
    {item.itemType === "song" && <label>歌词（可选）<textarea className="lyrics-editor" name="lyrics" maxLength={12000} defaultValue={item.lyrics ?? ""} placeholder="一行一句，孩子页面会保留换行" /></label>}
    {item.itemType === "instrument" && <><label>正确乐器名称<input name="correct_answer" required maxLength={100} defaultValue={item.correctAnswer ?? ""} placeholder="例如：古筝" /></label><label>辨音提示（可选）<textarea name="instructions" maxLength={2000} defaultValue={item.instructions ?? ""} placeholder="例如：声音清亮，像流水一样" /></label></>}
    {item.itemType === "rhythm" && <label>练习提示（可选）<textarea name="instructions" maxLength={2000} defaultValue={item.instructions ?? ""} placeholder="例如：四拍一组，先慢慢拍" /></label>}
    <fieldset className="learner-assignment"><legend>分配给孩子</legend>{!learners.length ? <p className="library-meta">还没有孩子档案。</p> : learners.map((learner) => <label className="checkbox-label" key={learner.id}><input type="checkbox" name="learner_ids" value={learner.id} defaultChecked={assignedLearnerIds.includes(learner.id)} />{learner.displayName}</label>)}</fieldset>
    <div className="music-save-row"><SaveMusicItemButton /><div className="music-save-feedback" aria-live="polite">{saveState.status === "success" && <p className="success">{saveState.message}，数据库已确认。</p>}{saveState.status === "error" && <p className="error">未保存：{saveState.message}</p>}{saveState.status === "idle" && <p className="field-note">保存后会明确显示最终状态。</p>}</div></div>
  </form>;
}
