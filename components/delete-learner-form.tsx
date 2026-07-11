"use client";

import { useState } from "react";
import { deleteLearnerAndCurrentLibrary } from "@/lib/actions";

export function DeleteLearnerForm({ learnerId, learnerName, hasActivePackage }: { learnerId: string; learnerName: string; hasActivePackage: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    const scope = hasActivePackage ? "孩子档案、学习记录和当前字册" : "孩子档案和学习记录";
    if (!window.confirm(`确定删除“${learnerName}”的${scope}吗？此操作无法撤销。`)) return;
    const data = new FormData();
    data.set("learner_id", learnerId);
    setPending(true);
    try {
      setError("");
      await deleteLearnerAndCurrentLibrary(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }
  return <div className="delete-learner"><button className="text-button danger" type="button" disabled={pending} onClick={submit}>{pending ? "删除中…" : `删除 ${learnerName} 的资料${hasActivePackage ? "和当前字册" : ""}`}</button>{error && <p className="error">{error}</p>}</div>;
}
