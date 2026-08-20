"use client";

import { useActionState } from "react";
import { consolidateDuplicateResource, type DuplicateCleanupState } from "@/lib/admin-actions";

const initialState: DuplicateCleanupState = { status: "idle", message: "" };

export function DuplicateResourceCleanup({ resourceType, removeId, candidates }: {
  resourceType: "hanzi" | "poem" | "music" | "catechism";
  removeId: string;
  candidates: Array<{ id: string; title: string }>;
}) {
  const [state, action, pending] = useActionState(consolidateDuplicateResource, initialState);
  return <details className="duplicate-cleanup"><summary>清理这份重复内容</summary><form action={action}>
    <input type="hidden" name="resource_type" value={resourceType} /><input type="hidden" name="remove_id" value={removeId} />
    <label>合并并保留<select name="keep_id" defaultValue="" required><option value="" disabled>选择一份已通过并发布的资源</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select></label>
    <p>孩子分配会先迁移。音乐或问答已有练习历史时系统会拒绝永久删除，请改用“归档”。</p>
    <button className="text-button danger" disabled={pending}>{pending ? "正在安全合并…" : "确认合并并删除当前重复项"}</button>
  </form>{state.status !== "idle" && <p className={state.status === "error" ? "form-error" : "success-box"} role="status">{state.message}</p>}</details>;
}
