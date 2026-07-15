"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPoemRecitation } from "@/lib/actions";

export function PoemRecitationForm({ learnerId, poemId }: { learnerId: string; poemId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function submit(formData: FormData) {
    setMessage("");
    startTransition(async () => {
      try {
        await recordPoemRecitation(formData);
        setMessage("已记下一次背诵。今天再背一次，仍可以再点一次。");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "记录失败，请稍后再试");
      }
    });
  }

  return <form className="recitation-form" action={submit}>
    <input type="hidden" name="learner_id" value={learnerId} />
    <input type="hidden" name="poem_id" value={poemId} />
    <div className="recitation-form-head"><div><h2>今天背过一次</h2><p>每点一次都会新增一条独立记录；同一天背两遍，就记两次。</p></div></div>
    <div className="recitation-fields">
      <label>这次掌握程度（可先不评）<select name="score" defaultValue=""><option value="">暂不评分，只打卡</option>{Array.from({ length: 10 }, (_, index) => index + 1).map((score) => <option key={score} value={score}>{score} 分{score >= 9 ? " · 很熟" : score >= 7 ? " · 基本会背" : score >= 5 ? " · 还需练习" : " · 需要多背"}</option>)}</select></label>
      <label>家长备注（可选）<input name="note" maxLength={300} placeholder="例如：中间停顿了一次" /></label>
    </div>
    <button className="primary" type="submit" disabled={isPending}>{isPending ? "记录中…" : "✓ 今天背过一次"}</button>
    {message && <p className={message.startsWith("已") ? "success" : "error"}>{message}</p>}
  </form>;
}
