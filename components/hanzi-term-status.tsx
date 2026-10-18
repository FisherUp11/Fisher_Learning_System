import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeHanziTerm } from "@/lib/hanzi-terms";
import { loadHanziTermSnapshot } from "@/lib/hanzi-term-data";

export async function HanziTermStatus({ db, learnerId }: { db: SupabaseClient; learnerId: string }) {
  const snapshot = await loadHanziTermSnapshot(db,learnerId);
  if (snapshot.error) return <p className="notice">学习有效期暂未读取成功，请重试；尚未升级时请联系 owner 运行 038 SQL。</p>;
  const status = describeHanziTerm(snapshot.term, snapshot.enabled);
  const available = status.active && snapshot.canStudy;
  const label = status.active && !snapshot.canStudy ? "授权保留，账号或家庭入口暂停" : status.label;
  return <aside className={`term-status ${available ? "" : "term-status-locked"}`} aria-label="汉字学习有效期"><div><strong>汉字学习 · {label}</strong><p>{status.detail}</p>{!available && <p>可以继续查看字库和学习概况；恢复授权或入口后沿用原来的记忆进度。</p>}</div><Link className="text-button" href={`/library?learner=${learnerId}`}>查看学习记录 →</Link></aside>;
}
