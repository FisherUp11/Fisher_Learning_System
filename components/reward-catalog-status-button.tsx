"use client";

import { useState, useTransition } from "react";
import { setRewardCatalogItemStatus } from "@/lib/reward-actions";

type RewardCatalogStatusButtonProps = {
  itemId: string;
  status: "active" | "archived";
};

export function RewardCatalogStatusButton({ itemId, status }: RewardCatalogStatusButtonProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const nextStatus = status === "active" ? "archived" : "active";

  function update() {
    setError("");
    startTransition(async () => {
      try {
        await setRewardCatalogItemStatus({ itemId, status: nextStatus });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "礼物状态没有保存成功");
      }
    });
  }

  return (
    <div>
      <button className="text-button" type="button" disabled={pending} onClick={update}>
        {pending ? "保存中…" : status === "active" ? "暂时下架" : "重新启用"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
