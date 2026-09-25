"use client";
import { useDeferredValue, useMemo } from "react";
import { prepareEnglishSource } from "@/lib/english-source";
import s from "./adult-growth.module.css";

export function EnglishSourcePreview({ text }: { text: string }) {
  const deferred = useDeferredValue(text);
  const prepared = useMemo(() => prepareEnglishSource(deferred), [deferred]);
  if (!text.trim()) return null;
  return <div className={s.sourcePreview} aria-busy={deferred !== text}>
    <div className={s.between}><strong>{prepared.bilingual ? "已识别中英资料" : "英文学习内容预览"}</strong><span className={s.badge}>{prepared.englishWords} 英文词 · {prepared.pairs.length} 组对照</span></div>
    <p className={s.muted}>英文用于听力与词句学习，中文作为理解参考。{prepared.removedLines > 0 ? `已识别 ${prepared.removedLines} 行字幕编号 / 时间信息，生成时会忽略。` : "支持先英文后中文，也支持先中文后英文。"} 原稿完整保留。</p>
    {prepared.warnings.map(w => <p key={w} className={s.muted}>提示：{w}</p>)}
    <details><summary>核对识别结果（节选）</summary>
      {prepared.pairs.length ? prepared.pairs.slice(0, 3).map((pair, i) => <div className={s.sourcePair} key={i}><p lang="en">{pair.english}</p><p lang="zh-CN" className={s.muted}>{pair.chinese}</p></div>) : <p lang="en" className={s.document}>{prepared.english.slice(0, 1200) || "未识别到独立英文行"}</p>}
      <p className={s.muted}>自动识别不等于翻译校对。若不对应，请将每组英文及译文放在相邻行，组与组之间空一行；同一行不要混排两种语言。</p>
    </details>
  </div>;
}
