"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  removeCharacterFromCurrentPackage,
  updateCharacterContent,
  updateCharacterPriorities,
} from "@/lib/actions";

export type LibraryRowView = {
  character_id: string;
  hanzi: string;
  pinyin_marked: string;
  meaning: string;
  word_one: string | null;
  word_two: string | null;
  example_sentence: string | null;
  source_package_ids: string[];
  source_package_titles: string;
  attempt_count: number;
  known_count: number;
  again_count: number;
  stage: number;
  due_at: string | null;
  consecutive_known: number;
  last_answered_at: string | null;
  needs_review: boolean;
  is_priority: boolean;
};

const stageNames = ["初次接触", "第 1 阶段", "第 2 阶段", "第 3 阶段", "第 4 阶段", "稳定认识", "长期记忆", "熟练掌握"];

function formatDate(value: string | null) {
  if (!value) return "尚未安排";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function statusFor(row: LibraryRowView) {
  if (row.attempt_count === 0) return { key: "unstarted", label: "还没学" };
  if (row.needs_review) return { key: "due", label: "现在复习" };
  if (row.stage >= 7) return { key: "mastered", label: "熟练掌握" };
  if (row.stage >= 5) return { key: "stable", label: "稳定认识" };
  return { key: "learning", label: "复习中" };
}

export function LibraryPriorityManager({
  rows,
  learnerId,
  selectedPackage,
  totalPriorityCount,
}: {
  rows: LibraryRowView[];
  learnerId: string;
  selectedPackage?: { id: string; title: string };
  totalPriorityCount: number;
}) {
  const router = useRouter();
  const pageIds = rows.map((row) => row.character_id);
  const initialIds = rows.filter((row) => row.is_priority).map((row) => row.character_id);
  const [baseline, setBaseline] = useState(() => new Set(initialIds));
  const [selected, setSelected] = useState(() => new Set(initialIds));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, startSaving] = useTransition();

  const changed = pageIds.some((id) => selected.has(id) !== baseline.has(id));
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
  const allSelected = rows.length > 0 && selectedOnPage === rows.length;

  function setCharacterPriority(characterId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(characterId);
      else next.delete(characterId);
      return next;
    });
    setMessage("");
    setError("");
  }

  function selectWholePage(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    setMessage("");
    setError("");
  }

  function save() {
    if (!changed || isSaving) return;
    const nextPagePriorities = pageIds.filter((id) => selected.has(id));
    setError("");
    setMessage("");
    startSaving(async () => {
      try {
        const result = await updateCharacterPriorities({
          learnerId,
          scopeCharacterIds: pageIds,
          priorityCharacterIds: nextPagePriorities,
        });
        setBaseline(new Set(nextPagePriorities));
        setMessage(`已保存。这个孩子现在共有 ${result.priorityCount} 个重点字。`);
        window.setTimeout(() => router.refresh(), 900);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "重点字保存失败，请重试");
      }
    });
  }

  return (
    <>
      <div className="priority-manager" aria-label="本页重点字管理">
        <div className="priority-manager-copy">
          <span className="priority-mark" aria-hidden="true">★</span>
          <div>
            <strong>重点字 · 本页已选 {selectedOnPage} 个</strong>
            <small>当前查看范围有 {totalPriorityCount} 个。重点字到期后优先复习，未学重点字优先占用每天新字名额。</small>
          </div>
        </div>
        <div className="priority-manager-actions">
          <button className="text-button" type="button" onClick={() => selectWholePage(!allSelected)}>
            {allSelected ? "取消本页" : "本页全选"}
          </button>
          {changed && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setSelected(new Set(baseline));
                setMessage("");
                setError("");
              }}
            >
              撤销更改
            </button>
          )}
          <button className="priority-save" type="button" disabled={!changed || isSaving} onClick={save}>
            {isSaving ? "保存中…" : changed ? "保存本页重点字" : "本页已保存"}
          </button>
        </div>
        {(message || error) && (
          <p className={error ? "priority-feedback error" : "priority-feedback"} aria-live="polite">
            {error || message}
          </p>
        )}
      </div>

      <div className="character-library">
        {rows.map((item) => {
          const itemStatus = statusFor(item);
          const isPriority = selected.has(item.character_id);
          return (
            <details className={`library-row${isPriority ? " priority" : ""}`} key={item.character_id}>
              <summary>
                <label
                  className={`priority-selector${isPriority ? " selected" : ""}`}
                  title={isPriority ? `取消“${item.hanzi}”的重点标记` : `把“${item.hanzi}”设为重点`}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={isPriority}
                    onChange={(event) => setCharacterPriority(item.character_id, event.target.checked)}
                    aria-label={`${isPriority ? "取消" : "设为"}重点字：${item.hanzi}`}
                  />
                  <span>{isPriority ? "重点" : "优先学"}</span>
                </label>
                <span className="library-character" aria-hidden="true">{item.hanzi}</span>
                <span className="library-row-title">
                  <strong>{item.pinyin_marked}</strong>
                  <span>{item.meaning}{item.word_one ? ` · ${item.word_one}` : ""}</span>
                  <span className="library-source">来源：{item.source_package_titles}</span>
                </span>
                <span className="library-quick-progress" aria-label={`${item.hanzi} 的学习概况`}>
                  <strong>学 {item.attempt_count} 次</strong>
                  <span>{item.attempt_count ? `${stageNames[item.stage]} · ${item.needs_review ? "现在复习" : `下次 ${formatDate(item.due_at)}`}` : "尚未开始"}</span>
                </span>
                <span className={`library-status ${itemStatus.key}`}>{itemStatus.label}</span>
              </summary>
              <div className="character-edit">
                {isPriority && (
                  <p className="priority-explanation">
                    <span aria-hidden="true">★</span>
                    这是重点字：未到复习日不会提前打扰；到期后会优先进入复习队列。
                  </p>
                )}
                <p className="library-meta">
                  来源字册：{item.source_package_titles}
                  {item.source_package_ids.length > 1 ? "（此字在多份字册中出现，学习记录与重点标记均合并计算）" : ""}
                </p>
                <div className="learning-record" aria-label={`${item.hanzi} 的学习记录`}>
                  <div><span>回答</span><strong>{item.attempt_count} 次</strong></div>
                  <div><span>认识 / 再学</span><strong>{item.attempt_count ? `${item.known_count} / ${item.again_count}` : "—"}</strong></div>
                  <div><span>记忆阶段</span><strong>{item.attempt_count ? `${stageNames[item.stage]}（${item.stage} / 7）` : "尚未开始"}</strong></div>
                  <div><span>下一次复习</span><strong>{item.attempt_count ? (item.needs_review ? "现在就可以复习" : formatDate(item.due_at)) : "学完后安排"}</strong></div>
                </div>
                {item.attempt_count > 0 && (
                  <p className="library-meta">
                    {item.last_answered_at ? `上次回答：${formatDate(item.last_answered_at)}；` : ""}
                    {item.consecutive_known > 0 ? `连续认识 ${item.consecutive_known} 次。` : "最近一次选择了“再学一次”。"}
                  </p>
                )}
                <form action={updateCharacterContent} className="form-grid">
                  <input type="hidden" name="learner_id" value={learnerId} />
                  <input type="hidden" name="character_id" value={item.character_id} />
                  <label>拼音<input name="pinyin_marked" defaultValue={item.pinyin_marked} required maxLength={40} /></label>
                  <label>释义<input name="meaning" defaultValue={item.meaning} required maxLength={100} /></label>
                  <label>词语 1<input name="word_one" defaultValue={item.word_one ?? ""} maxLength={100} /></label>
                  <label>词语 2<input name="word_two" defaultValue={item.word_two ?? ""} maxLength={100} /></label>
                  <label>例句<input name="example_sentence" defaultValue={item.example_sentence ?? ""} maxLength={300} /></label>
                  <div className="character-edit-actions"><button className="secondary" type="submit">保存这个字</button></div>
                </form>
                {selectedPackage ? (
                  <form action={removeCharacterFromCurrentPackage} className="remove-form">
                    <input type="hidden" name="learner_id" value={learnerId} />
                    <input type="hidden" name="character_id" value={item.character_id} />
                    <input type="hidden" name="package_id" value={selectedPackage.id} />
                    <button className="text-button danger" type="submit">从“{selectedPackage.title}”移除“{item.hanzi}”</button>
                  </form>
                ) : (
                  <p className="library-meta">如需从字册移除这个字，请先在“来源字册”筛选中选择具体字册。</p>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
