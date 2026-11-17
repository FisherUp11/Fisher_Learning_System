"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FeedbackForm } from "@/components/feedback-form";
import { ownerManageChildAccess } from "@/lib/owner-child-actions";
import { describeChildTerm, previewChildTerm, type ChildAccessModule, type TrialWindow } from "@/lib/child-access";
import { MODULE_LABELS, type ChildModuleKey } from "@/lib/module-keys";

export function OwnerChildAccessManager({ learnerId, learnerName, modules, siblings, standardLearnerId, today, trial, startWithTrial }: {
  learnerId: string; learnerName: string; modules: ChildAccessModule[];
  siblings: Array<{ id: string; display_name: string }>; standardLearnerId: string | null;
  today: string; trial: TrialWindow | null; startWithTrial: boolean;
}) {
  const router = useRouter();
  const [action, setAction] = useState(startWithTrial ? "trial" : "term");
  const [months, setMonths] = useState(3);
  const [selected, setSelected] = useState<ChildModuleKey[]>(["hanzi"]);
  const [standard, setStandard] = useState(standardLearnerId ?? siblings[0]?.id ?? learnerId);
  const [enabled, setEnabled] = useState(() => Object.fromEntries(modules.map(row => [row.key, row.term ? row.enabled : true])));
  // Version belongs to the opened intention, not to later refreshed props.
  // Otherwise a stale switch choice could silently overwrite another owner's pause.
  const [versions, setVersions] = useState(() => Object.fromEntries(modules.map(row => [row.key, row.term?.version ?? 0])));
  const [locked, setLocked] = useState(false);
  const [saved, setSaved] = useState(false);
  const intention = useRef<{ id: string; data: FormData } | null>(null);
  const cents = action === "term" && selected.includes("hanzi") ? (standard === learnerId ? 1000 : 800) * months : 0;
  const hasPermanent = action === "term" && modules.some(row => selected.includes(row.key) && row.term?.mode === "permanent");
  const trialUnavailable = action === "trial" && (trial ? trial.valid_until <= today : modules.some(row => row.term));
  const summary = modules.filter(row => selected.includes(row.key)).map(row => `${MODULE_LABELS[row.key]}：${previewChildTerm(row.term, action, months, today, trial)}，${enabled[row.key] ? "开启" : "暂停"}`).join("；");

  return <FeedbackForm className="term-form" action={async data => {
    intention.current ??= { id: crypto.randomUUID(), data };
    intention.current.data.set("request_id", intention.current.id);
    setLocked(true);
    const result = await ownerManageChildAccess(intention.current.data);
    if (result.status === "success") { setSaved(true); router.refresh(); }
    return result;
  }} confirm={{ title: `确认 ${learnerName} 的学习授权？`, description: `${summary || "尚未选择模块"}。本次 ¥${cents / 100}（手工收款记录，不在线扣款）。未勾选的模块不变；不会恢复已停用的家长账号或家庭。`, confirmLabel: "确认保存" }} pendingLabel="正在保存授权，请勿重复点击…" successTitle="学习授权已更新">
    <input type="hidden" name="learner_id" value={learnerId} /><input type="hidden" name="cents" value={cents} />
    <fieldset disabled={locked} className="child-access-fields">
      <div className="field-grid"><label>本次操作<select name="action" value={action} onChange={e => setAction(e.target.value)}><option value="trial">免费试用 · 一个月</option><option value="term">正式开通 / 续期</option><option value="permanent">长期授权</option><option value="enabled">只暂停 / 恢复（期限不变）</option></select></label>
        {action === "term" && <label>开通时长<select name="months" value={months} onChange={e => setMonths(Number(e.target.value))}><option value={1}>一个月</option><option value={3}>一个季度 · 3 个月</option><option value={6}>半年 · 6 个月</option><option value={12}>一年 · 12 个月</option></select></label>}</div>
      <div className="child-access-modules">{modules.map(row => {
        const chosen = selected.includes(row.key);
        const status = describeChildTerm(row.term, row.enabled, today);
        return <div className={`child-access-module${chosen ? " selected" : ""}`} key={row.key}>
          <label className="term-check"><input name="modules" value={row.key} type="checkbox" checked={chosen} onChange={e => setSelected(old => e.target.checked ? [...old, row.key] : old.filter(key => key !== row.key))} /><span><strong>{MODULE_LABELS[row.key]}{row.key === "hanzi" ? " · 含拼音与青蛙游戏" : row.key === "poem" ? " · 含坦克游戏" : ""}</strong><small>当前：{status.label}{row.term?.valid_until ? ` · ${previewChildTerm(row.term, "enabled", months, today, trial)}` : ""}</small></span></label>
          {chosen && <><input type="hidden" name={`version_${row.key}`} value={versions[row.key]} /><label className="term-check child-access-switch"><input name={`enabled_${row.key}`} type="checkbox" checked={enabled[row.key]} onChange={e => setEnabled(old => ({ ...old, [row.key]: e.target.checked }))} /><span>保存后开启<small>{previewChildTerm(row.term, action, months, today, trial)}</small></span></label></>}
        </div>;
      })}</div>
      {action === "trial" && <p className={trialUnavailable ? "form-error" : "notice"}>{trialUnavailable ? "此孩子已用过试用或已有正式授权，请选择正式开通 / 续期。" : trial ? "仍在首次试用期：新增模块共用原试用截止日，不再赠送一个月。" : "每位新孩子可免费试用一个自然月；不收费、不固定家庭原价孩子。以后补选的模块共用本次截止日。"}</p>}
      {action === "term" && selected.includes("hanzi") && <label>本家庭原价孩子（¥10 / 月；其余孩子 ¥8 / 月）{standardLearnerId ? <><input readOnly value={siblings.find(row => row.id === standard)?.display_name ?? "已指定孩子"} /><input name="standard_learner_id" type="hidden" value={standard} /></> : <select name="standard_learner_id" value={standard} onChange={e => setStandard(e.target.value)}>{siblings.map(row => <option key={row.id} value={row.id}>{row.display_name}</option>)}</select>}<small className="field-note">首次正式开通汉字时固定；附加模块不另收费。只延附加模块不产生汉字收费记录。</small></label>}
      {hasPermanent && <label className="term-check"><input type="checkbox" name="convert_permanent" required /><span>我确认将所选长期授权改为有限期限<small>一般建议取消勾选已有长期授权的模块，以保留原权益。</small></span></label>}
      <label>操作 / 线下收款备注<input name="note" maxLength={500} placeholder="例如：免费体验；微信收款已核对" /></label>
    </fieldset>
    <div className="term-preview" role="status"><strong>{saved ? "本次授权已保存" : `${learnerName} · 本次 ¥${cents / 100}`}</strong><p>{saved ? "请以上方“当前”状态和下方最近授权记录为准；再次调整前先核对，不会自动再延期。" : summary || "请至少选择一个学习模块。"}</p>{!saved && <p>未到期按各自原截止日接续，已到期从今天起算；未勾选的模块保持不变。账号入口和资源分配需另外核对。</p>}</div>
    <button className="primary" disabled={saved || !selected.length || trialUnavailable}>{saved ? "已保存，请核对上方最新期限" : locked ? "按原操作重试（不会重复延期）" : "核对并保存授权"}</button>
    {locked && !saved && <p className="helper-text">为防止网络重试变成第二次续费，本次内容已锁定。如需更改，请先刷新并核对最近授权记录，再新建操作。</p>}
    {saved && <button type="button" className="text-button" onClick={() => {
      intention.current = null;
      setVersions(Object.fromEntries(modules.map(row => [row.key, row.term?.version ?? 0])));
      setEnabled(Object.fromEntries(modules.map(row => [row.key, row.term ? row.enabled : true])));
      setStandard(standardLearnerId ?? siblings[0]?.id ?? learnerId);
      setLocked(false); setSaved(false);
    }}>已核对，再新建一次调整</button>}
  </FeedbackForm>;
}
