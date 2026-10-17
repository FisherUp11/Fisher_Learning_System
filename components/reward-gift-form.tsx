"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createRewardCatalogItem, updateRewardCatalogItem } from "@/lib/reward-actions";
import type { RewardCatalogItem } from "@/lib/reward-types";

export function RewardGiftForm({ learnerId, learnerName, item }: { learnerId: string; learnerName: string; item?: RewardCatalogItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState(item?.title ?? "");
  const [cost, setCost] = useState(String(item?.sticker_cost ?? 10));
  const [icon, setIcon] = useState(item?.icon ?? "🎁");
  const [note, setNote] = useState(item?.note ?? "");
  const busy = useRef(false);
  const request = useRef<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setMessage("");
    request.current ??= crypto.randomUUID();
    const input = { learnerId, requestId: request.current, title, stickerCost: Number(cost), icon, note };
    startTransition(async () => {
      try {
        const result = item ? await updateRewardCatalogItem({ ...input, itemId: item.id }) : await createRewardCatalogItem(input);
        setMessage(result.message);
        request.current = null;
        if (!item) { setTitle(""); setNote(""); }
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "愿望没有保存成功，请重试");
      } finally { busy.current = false; }
    });
  }

  return <form className="reward-gift-form" onSubmit={submit} aria-busy={pending}>
    <p className="reward-wish-owner">{item?.learner_id === null ? "旧版共用礼物：修改会影响本账号下使用它的孩子。" : `这份愿望属于 ${learnerName}，不会加入其他孩子的清单。`}</p>
    <label>愿望礼物<input value={title} onChange={event => setTitle(event.target.value)} maxLength={80} placeholder="例如：玩具小汽车、钓鱼竿" required disabled={pending} /></label>
    <label>需要贴纸<input type="number" min={1} max={100} step={1} value={cost} onChange={event => setCost(event.target.value)} required disabled={pending} /></label>
    <label>礼物图标<select value={icon} onChange={event => setIcon(event.target.value)} disabled={pending}><option value="🎁">🎁 礼物</option><option value="🚗">🚗 小汽车</option><option value="🎣">🎣 钓鱼竿</option><option value="📚">📚 绘本</option><option value="🧸">🧸 玩偶</option><option value="🧩">🧩 拼图</option><option value="🚲">🚲 自行车</option><option value="🏕️">🏕️ 亲子活动</option>{item && !["🎁","🚗","🎣","📚","🧸","🧩","🚲","🏕️"].includes(item.icon) && <option value={item.icon}>{item.icon} 原图标</option>}</select></label>
    <label>约定与备注（可选）<input value={note} onChange={event => setNote(event.target.value)} maxLength={300} placeholder="例如：攒够后，周末一起去挑选" disabled={pending} /></label>
    <button className="primary" type="submit" disabled={pending}>{pending ? "正在保存…" : item ? "保存修改" : "加入愿望清单"}</button>
    {message && <p className={message.startsWith("已") ? "success" : "error"} role="status">{message}</p>}
  </form>;
}
