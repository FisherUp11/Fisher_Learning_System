"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { redeemReward } from "@/lib/reward-actions";

type RewardRedeemButtonProps = {
  learnerId: string;
  itemId: string;
  title: string;
  cost: number;
  balance: number;
};

export function RewardRedeemButton({ learnerId, itemId, title, cost, balance }: RewardRedeemButtonProps) {
  const router = useRouter();
  const busy = useRef(false);
  const request = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const affordable = balance >= cost;

  function redeem() {
    if (!affordable || pending || busy.current) return;
    if (!window.confirm(`请爸爸妈妈确认：使用 ${cost} 枚贴纸兑换“${title}”？兑换后还剩 ${balance - cost} 枚。`)) return;
    setMessage("");
    busy.current = true;
    request.current ??= crypto.randomUUID();
    const requestId = request.current;
    startTransition(async () => {
      try {
        const result = await redeemReward({
          learnerId,
          rewardItemId: itemId,
          requestId,
          expectedCost: cost,
        });
        setMessage(result.duplicate ? "这次兑换已经记录过。" : `兑换成功！还剩 ${result.balance ?? balance - cost} 枚贴纸。`);
        request.current = null;
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "兑换没有保存成功");
      } finally { busy.current = false; }
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
