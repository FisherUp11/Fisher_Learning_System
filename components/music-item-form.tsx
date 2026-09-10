"use client";

import { useState } from "react";
import { FeedbackForm } from "@/components/feedback-form";
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

export function MusicItemForm({ item, learners, assignedLearnerIds, isAdmin }: {
  item: MusicItemFormItem;
  learners: LearnerOption[];
  assignedLearnerIds: string[];
  isAdmin: boolean;
}) {
  const [selectedStatus, setSelectedStatus] = useState<MusicItemStatus>(item.status);

  async function save(data: FormData) {
    const result = await updateMusicItem(initialMusicSaveState, data);
    if (result.status === "success" && result.savedStatus) setSelectedStatus(result.savedStatus);
    return result;
  }

  return <FeedbackForm action={save} className="music-editor-form" pendingLabel="正在保存内容资料…">
    <input type="hidden" name="item_id" value={item.id} />
    <div className="music-editor-grid"><label>名称<input name="title" required maxLength={100} defaultValue={item.title} /></label><label>分类（可选）<input name="category" maxLength={60} defaultValue={item.category ?? ""} placeholder="例如：古诗新唱、儿歌" /></label><label>难度<select name="difficulty" defaultValue={String(item.difficulty)}><option value="1">1 · 入门</option><option value="2">2 · 简单</option><option value="3">3 · 适中</option><option value="4">4 · 稍难</option><option value="5">5 · 挑战</option></select></label>{isAdmin ? <label>发布状态<select name="status" value={selectedStatus} onChange={(event) => setSelectedStatus(event.target.value as MusicItemStatus)}><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option></select></label> : <input type="hidden" name="status" value="draft" />}</div>
    <label>简介（可选）<textarea name="description" maxLength={500} defaultValue={item.description ?? ""} placeholder="给家长看的简短说明" /></label>
    {item.itemType === "song" && <label>歌词（可选）<textarea className="lyrics-editor" name="lyrics" maxLength={12000} defaultValue={item.lyrics ?? ""} placeholder="一行一句，孩子页面会保留换行" /></label>}
    {item.itemType === "instrument" && <><label>正确乐器名称<input name="correct_answer" required maxLength={100} defaultValue={item.correctAnswer ?? ""} placeholder="例如：古筝" /></label><label>辨音提示（可选）<textarea name="instructions" maxLength={2000} defaultValue={item.instructions ?? ""} placeholder="例如：声音清亮，像流水一样" /></label></>}
    {item.itemType === "rhythm" && <label>练习提示（可选）<textarea name="instructions" maxLength={2000} defaultValue={item.instructions ?? ""} placeholder="例如：四拍一组，先慢慢拍" /></label>}
    {isAdmin ? <fieldset className="learner-assignment"><legend>分配给孩子</legend>{!learners.length ? <p className="library-meta">还没有孩子档案。</p> : learners.map((learner) => <label className="checkbox-label" key={learner.id}><input type="checkbox" name="learner_ids" value={learner.id} defaultChecked={assignedLearnerIds.includes(learner.id)} />{learner.displayName}</label>)}</fieldset> : <p className="notice">保存后会提交管理员审核；只有管理员能发布和分配给孩子。</p>}
    <div className="music-save-row"><button className="primary music-save-button" type="submit">保存内容资料</button><p className="field-note">保存后会弹出结果；失败时保留已填写的内容。</p></div>
  </FeedbackForm>;
}
