"use client";

import { useState, useTransition, type FormEvent } from "react";
import { createRewardCatalogItem } from "@/lib/reward-actions";

export function RewardGiftForm() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [cost, setCost] = useState("10");
  const [icon, setIcon] = useState("🎁");
  const [note, setNote] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    startTransition(async () => {
      try {
        const result = await createRewardCatalogItem({
          title,
          stickerCost: Number(cost),
          icon,
          note,
        });
        setMessage(result.message);
        setTitle("");
        setNote("");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "礼物没有保存成功");
      }
    });
  }

  return (
    <form className="reward-gift-form" onSubmit={submit}>
      <label>礼物名称
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="例如：一本新绘本" required />
      </label>
      <label>需要贴纸
        <input type="number" min={1} max={100} value={cost} onChange={(event) => setCost(event.target.value)} required />
      </label>
      <label>礼物图标
        <input value={icon} onChange={(event) => setIcon(event.target.value)} maxLength={12} aria-label="礼物图标" />
      </label>
      <label>备注（可选）
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="例如：周末一起去挑选" />
      </label>
      <button className="primary" type="submit" disabled={pending}>{pending ? "正在加入…" : "加入礼物清单"}</button>
      {message && <p className={message.startsWith("已") ? "success" : "error"} aria-live="polite">{message}</p>}
    </form>
  );
}
