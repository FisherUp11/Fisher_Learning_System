"use client";

import { useState, useTransition, type FormEvent } from "react";
import { grantManualReward } from "@/lib/reward-actions";

type RewardManualFormProps = {
  learnerId: string;
  learnerName: string;
  today: string;
};

export function RewardManualForm({ learnerId, learnerName, today }: RewardManualFormProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<"bonus" | "initial" | "correction">("bonus");
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");

  function addMathSticker() {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await grantManualReward({
          learnerId,
          kind: "math",
          amount: 1,
          note: "线下数学作业完成",
          localDate: today,
          requestId: crypto.randomUUID(),
        });
        setMessage(result.duplicate
          ? `今天已经给 ${learnerName} 记录过数学贴纸了。`
          : `数学作业完成，已给 ${learnerName} 加 1 枚贴纸。现在共有 ${result.balance} 枚。`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "数学贴纸没有保存成功");
      }
    });
  }

  function submitCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    startTransition(async () => {
      try {
        const parsedAmount = Math.trunc(Number(amount));
        const result = await grantManualReward({
          learnerId,
          kind,
          amount: parsedAmount,
          note,
          localDate: today,
          requestId: crypto.randomUUID(),
        });
        if (result.duplicate) {
          setMessage(kind === "initial" ? "线下初始贴纸已经带入过；如需调整，请使用“修正贴纸”。" : "这次操作已经记录过。");
          return;
        }
        setMessage(`已保存：${result.title ?? "家长奖励"} ${result.amount > 0 ? "+" : ""}${result.amount} 枚。当前余额 ${result.balance} 枚。`);
        setNote("");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "贴纸调整没有保存成功");
      }
    });
  }

  return (
    <section className="reward-manual-grid">
      <article className="reward-parent-card math">
        <span className="reward-parent-icon" aria-hidden="true">＋</span>
        <div>
          <p className="eyebrow">线下任务</p>
          <h3>数学作业完成</h3>
          <p>每天默认奖励一次，重复点击不会多加。</p>
        </div>
        <button className="primary" type="button" disabled={pending} onClick={addMathSticker}>
          {pending ? "保存中…" : "完成数学作业 +1"}
        </button>
      </article>

      <form className="reward-parent-card custom" onSubmit={submitCustom}>
        <div>
          <p className="eyebrow">家长调整</p>
          <h3>特别表扬与线下带入</h3>
        </div>
        <div className="reward-custom-fields">
          <label>操作类型
            <select value={kind} onChange={(event) => {
              const nextKind = event.target.value as "bonus" | "initial" | "correction";
              setKind(nextKind);
              setAmount(nextKind === "correction" ? "-1" : "1");
            }}>
              <option value="bonus">特别表扬</option>
              <option value="initial">带入现有线下贴纸（仅一次）</option>
              <option value="correction">修正贴纸数量</option>
            </select>
          </label>
          <label>贴纸数量
            <input
              type="number"
              min={kind === "correction" ? -20 : 1}
              max={kind === "initial" ? 100 : 20}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          <label>原因或备注
            <input
              maxLength={300}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={kind === "initial" ? "例如：从A4贴纸纸带入" : "例如：今天主动整理玩具"}
              required={kind === "correction"}
            />
          </label>
        </div>
        <button className="secondary" type="submit" disabled={pending}>{pending ? "保存中…" : "保存贴纸调整"}</button>
      </form>

      {message && <p className={message.includes("没有") || message.includes("不正确") || message.includes("不足") ? "error reward-admin-message" : "success reward-admin-message"} aria-live="polite">{message}</p>}
    </section>
  );
}
