"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FeedbackForm } from "@/components/feedback-form";
import { manageHanziTerm } from "@/lib/hanzi-term-actions";
import { addCalendarMonths, lastUsableDate, type HanziTerm } from "@/lib/hanzi-terms";

export function OwnerHanziTermManager({ learnerId, learnerName, term, enabled, siblings, standardLearnerId, today }: {
  learnerId: string; learnerName: string; term: HanziTerm | null; enabled: boolean;
  siblings: Array<{ id: string; display_name: string }>; standardLearnerId: string | null; today: string;
}) {
  const router = useRouter();
  const [action, setAction] = useState("term");
  const [months, setMonths] = useState(3);
  const [standard, setStandard] = useState(standardLearnerId ?? siblings[0]?.id ?? learnerId);
  const [isEnabled, setEnabled] = useState(enabled);
  // Created on submission only: no random values in server/client initial HTML.
  const request = useRef<string | null>(null);
  const [saved, setSaved] = useState(false);
  const cents = action === "term" ? (standard === learnerId ? 1000 : 800) * months : 0;
  const base = term?.mode === "term" && term.valid_until && term.valid_until > today ? term.valid_until : today;
  const end = addCalendarMonths(base, months);
  const preview = action === "term" ? `${learnerName}：${months} 个月，¥${cents / 100}；可用至 ${lastUsableDate(end)}（含当天）` : action === "permanent" ? `${learnerName}：改为长期授权，不记录收费` : `${learnerName}：仅调整暂停/恢复，不改变原到期日`;

  return <FeedbackForm action={async (data) => {
    // Keep the same intention ID even after an uncertain response or refreshed props.
    // A changed version must never silently turn a retry into another paid renewal.
    request.current ??= crypto.randomUUID();
    data.set("request_id", request.current);
    const result = await manageHanziTerm(data);
    if (result.status === "success") { setSaved(true); router.refresh(); }
    return result;
  }} className="term-form" pendingLabel="正在保存授权，请勿重复点击…" successTitle="授权已更新"
    confirm={{ title: "确认这次授权调整？", description: `${preview}。孩子开关：${isEnabled ? "开启" : "暂停"}。不会修改家长账号、家庭状态或学习记录。`, confirmLabel: "确认保存" }}>
    <input type="hidden" name="learner_id" value={learnerId} /><input type="hidden" name="version" value={term?.version ?? 0} /><input type="hidden" name="cents" value={cents} />
    <div className="field-grid"><label>本次操作<select name="action" value={action} onChange={e => setAction(e.target.value)}><option value="term">开通 / 续期</option><option value="permanent">长期授权（如自己的孩子）</option>{term && <option value="enabled">只暂停 / 恢复</option>}</select></label>
      {action === "term" && <label>开通时长<select name="months" value={months} onChange={e => setMonths(Number(e.target.value))}><option value={3}>一个季度 · 3 个月</option><option value={6}>半年 · 6 个月</option><option value={12}>一年 · 12 个月</option></select></label>}
    </div>
    {action === "term" && <label>本家庭原价孩子（¥10 / 月，其余 ¥8 / 月）{standardLearnerId ? <><input value={siblings.find(child => child.id === standard)?.display_name ?? "已指定孩子"} readOnly /><input name="standard_learner_id" type="hidden" value={standard} /></> : <select name="standard_learner_id" value={standard} onChange={e => setStandard(e.target.value)}>{siblings.map(child => <option value={child.id} key={child.id}>{child.display_name}</option>)}</select>}<small className="field-note">首次收费时固定原价孩子；后续不因排序或选择而自动改价。长期授权不计费。</small></label>}
    <label className="term-check"><input type="checkbox" name="enabled" checked={isEnabled} onChange={e => setEnabled(e.target.checked)} /><span>开启这位孩子的汉字学习开关<small>续期默认沿用原开关。到期不会删除记录；恢复开关也不能绕过到期日。</small></span></label>
    <div className="term-preview" role="status"><strong>{preview}</strong><p>{action === "term" ? "金额为手工收款确认记录，不会在线扣款。未到期接续原截止日，已到期从今天起算。" : "原有汉字、拼音和游戏记录保持不变。"}</p></div>
    <label>操作 / 线下收款备注<input name="note" maxLength={500} placeholder="例如：微信已收款；家长续一年" /></label>
    <button className="primary" disabled={saved} type="submit">{saved ? "已保存，请查看更新后的授权" : "核对并保存授权"}</button>
    {saved && <button className="text-button" type="button" onClick={() => { request.current = null; setSaved(false); }}>已核对记录，再新建一次调整</button>}
  </FeedbackForm>;
}
