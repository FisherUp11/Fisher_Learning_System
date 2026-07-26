"use client";

import { useState, useTransition } from "react";
import { reverseRewardRedemption } from "@/lib/reward-actions";

type RewardReversalButtonProps = {
  redemptionId: string;
  title: string;
  amount: number;
};

export function RewardReversalButton({ redemptionId, title, amount }: RewardReversalButtonProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  function reverse() {
    if (!window.confirm(`确认撤销“${title}”的兑换并返还 ${amount} 枚贴纸吗？历史记录会保留。`)) return;
    setMessage("");
    startTransition(async () => {
      try {
        const result = await reverseRewardRedemption({
          redemptionId,
          note: "家长撤销误兑换",
          requestId: crypto.randomUUID(),
        });
        setMessage(result.duplicate ? "这条兑换已经撤销过。" : `已返还 ${result.amount ?? amount} 枚贴纸。`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "撤销没有保存成功");
      }
    });
  }

  return (
    <div className="reward-reversal">
      <button className="text-button danger" type="button" onClick={reverse} disabled={pending}>{pending ? "撤销中…" : "撤销并返还"}</button>
      {message && <p className={message.startsWith("已") ? "success" : "error"}>{message}</p>}
    </div>
  );
}
