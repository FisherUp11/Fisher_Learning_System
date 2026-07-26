"use client";

import { useState, useTransition } from "react";
import { redeemReward } from "@/lib/reward-actions";

type RewardRedeemButtonProps = {
  learnerId: string;
  itemId: string;
  title: string;
  cost: number;
  balance: number;
};

export function RewardRedeemButton({ learnerId, itemId, title, cost, balance }: RewardRedeemButtonProps) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const affordable = balance >= cost;

  function redeem() {
    if (!affordable || pending) return;
    if (!window.confirm(`请爸爸妈妈确认：使用 ${cost} 枚贴纸兑换“${title}”？兑换后还剩 ${balance - cost} 枚。`)) return;
    setMessage("");
    startTransition(async () => {
      try {
        const result = await redeemReward({
          learnerId,
          rewardItemId: itemId,
          requestId: crypto.randomUUID(),
        });
        setMessage(result.duplicate ? "这次兑换已经记录过。" : `兑换成功！还剩 ${result.balance ?? balance - cost} 枚贴纸。`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "兑换没有保存成功");
      }
    });
  }

  return (
    <div className="reward-redeem-area">
      <button className={affordable ? "primary" : "secondary"} type="button" onClick={redeem} disabled={!affordable || pending}>
        {pending ? "兑换中…" : affordable ? "请爸爸妈妈兑换" : `还差 ${cost - balance} 枚`}
      </button>
      {message && <p className={message.startsWith("兑换成功") ? "success" : "error"} aria-live="polite">{message}</p>}
    </div>
  );
}
