"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { FeedbackForm } from "@/components/feedback-form";
import { ownerCreateChild } from "@/lib/owner-child-actions";

export function OwnerChildCreateForm({ familyId, parents, selectedParent }: {
  familyId: string; parents: Array<{ id: string; name: string }>; selectedParent: string;
}) {
  const request = useRef<string | null>(null);
  const [learnerId, setLearnerId] = useState<string | null>(null);
  return <>
    <FeedbackForm className="admin-user-form" action={async data => {
      // The same submitted intention survives a lost network response.
      request.current ??= crypto.randomUUID();
      data.set("request_id", request.current);
      const result = await ownerCreateChild(data);
      if (result.status === "success" && result.learnerId) setLearnerId(result.learnerId);
      // Never change the request ID on an uncertain result. If edited after a
      // committed request, the database rejects conflicting content, not duplicate children.
      return result;
    }} confirm={{ title: "确认代建孩子档案？", description: "孩子将属于下方所选家长的家庭，不属于管理员的家庭。这里只建立档案，不自动试用、收款或开启模块。", confirmLabel: "确认创建" }} pendingLabel="正在创建档案，请勿重复提交…" successTitle="孩子档案已创建">
      <input type="hidden" name="family_id" value={familyId} />
      <label>孩子所属家长<select name="parent_user_id" defaultValue={selectedParent} required>{parents.map(parent => <option key={parent.id} value={parent.id}>{parent.name}</option>)}</select></label>
      <div className="field-grid"><label>孩子昵称<input name="display_name" required maxLength={24} placeholder="例如：小满" /></label><label>每天新字数量<select name="daily_new_limit" defaultValue={5}>{[3, 5, 8, 10, 15, 20, 30, 40, 50].map(n => <option value={n} key={n}>{n} 个{n === 5 ? "（推荐）" : ""}</option>)}</select></label></div>
      <label className="term-check"><input type="checkbox" name="allow_same_name" /><span>这个家庭如已有同名档案，我确认这是另一个孩子<small>一般无需勾选。请先查看现有档案，避免重复创建。</small></span></label>
      <button className="primary" disabled={Boolean(learnerId)}>{learnerId ? "已创建，请继续开通学习" : "创建孩子档案"}</button>
    </FeedbackForm>
    {learnerId && <div className="success-box child-access-links"><strong>下一步</strong><Link className="primary compact" href={`/admin/learners/${learnerId}/access?mode=trial`}>免费试用 / 开通学习</Link><Link className="secondary compact" href={`/admin/assignments?learner=${learnerId}`}>分配字册与课程</Link></div>}
  </>;
}
