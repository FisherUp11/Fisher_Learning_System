"use client";

import { useState } from "react";
import { deleteMusicItem } from "@/lib/music-actions";

export function DeleteMusicItemForm({ itemId, title }: { itemId: string; title: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed) return <button className="text-button danger" type="button" onClick={() => setArmed(true)}>删除这条音乐内容</button>;
  return <form action={deleteMusicItem} className="danger-confirm"><input type="hidden" name="item_id" value={itemId} /><p>将同时删除“{title}”的练习状态、历史记录和 R2 媒体，无法恢复。</p><div><button className="text-button" type="button" onClick={() => setArmed(false)}>取消</button><button className="danger" type="submit">确认永久删除</button></div></form>;
}
