"use client";

import { useState } from "react";
import { FeedbackForm } from "@/components/feedback-form";
import { savePinyinMnemonic } from "@/lib/pinyin-actions";
import { PINYIN_CATEGORIES, PINYIN_CATEGORY_LABELS, type PinyinCategory } from "@/lib/pinyin-catalog";

export type PinyinMnemonicUnit = { code: string; category: PinyinCategory; mnemonic: string; customized: boolean };

export function PinyinMnemonicEditor({ learnerId, units }: { learnerId: string; units: PinyinMnemonicUnit[] }) {
  const [code, setCode] = useState(units.find((unit) => unit.code === "b")?.code ?? units[0]?.code ?? "");
  const unit = units.find((item) => item.code === code);
  return <details className="pinyin-mnemonic-editor">
    <summary>记忆口诀维护 <small>补充或修改，只影响这位孩子</small></summary>
    <FeedbackForm action={savePinyinMnemonic} className="pinyin-mnemonic-form" pendingLabel="正在保存口诀…">
      <input type="hidden" name="learner_id" value={learnerId} />
      <label>选择拼音<select name="unit_code" value={code} onChange={(event) => setCode(event.target.value)}>
        {PINYIN_CATEGORIES.map((category) => <optgroup key={category} label={PINYIN_CATEGORY_LABELS[category]}>
          {units.filter((item) => item.category === category).map((item) => <option key={item.code} value={item.code}>{item.code}{item.mnemonic ? " · 有口诀" : " · 待补充"}</option>)}
        </optgroup>)}
      </select></label>
      <label>记忆口诀<textarea key={`${code}:${unit?.mnemonic ?? ""}`} name="mnemonic" maxLength={160} rows={3} defaultValue={unit?.mnemonic ?? ""} placeholder="例如：像个哨子bbb" /></label>
      <p className="muted">{unit?.customized ? "正在使用这位孩子的自定义口诀。" : "正在使用默认口诀。"} 清空后保存可隐藏口诀；口诀是提示，不是独立认出。</p>
      <div className="pinyin-mnemonic-buttons"><button className="secondary" type="submit" name="intent" value="save">保存口诀</button>
        <button className="text-button" type="submit" name="intent" value="reset">恢复默认</button></div>
    </FeedbackForm>
  </details>;
}
