"use client";

import { useState, useTransition } from "react";
import { setRewardCatalogItemStatus } from "@/lib/reward-actions";
import { useRouter } from "next/navigation";

type RewardCatalogStatusButtonProps = {
  learnerId: string;
  itemId: string;
  status: "active" | "archived";
};

export function RewardCatalogStatusButton({ learnerId, itemId, status }: RewardCatalogStatusButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const nextStatus = status === "active" ? "archived" : "active";

  function update() {
    if (pending) return;
    if (status === "active" && !window.confirm("暂时移出这个愿望？不会删除已经发生的兑换记录，之后也可以恢复。")) return;
    setError("");
    startTransition(async () => {
      try {
        await setRewardCatalogItemStatus({ learnerId, itemId, status: nextStatus });
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "礼物状态没有保存成功");
      }
    });
  }

  return (
    <div>
      <button className="text-button" type="button" disabled={pending} onClick={update}>
        {pending ? "保存中…" : status === "active" ? "暂时移出" : "恢复愿望"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
