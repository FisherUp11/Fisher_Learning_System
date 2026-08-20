"use client";

import { useState } from "react";
import { deleteMusicItem } from "@/lib/music-actions";

export function DeleteMusicItemForm({ itemId, title }: { itemId: string; title: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed) return <button className="text-button danger" type="button" onClick={() => setArmed(true)}>删除这条音乐内容</button>;
  return <form action={deleteMusicItem} className="danger-confirm"><input type="hidden" name="item_id" value={itemId} /><p>仅当“{title}”没有孩子分配和学习历史时才能永久删除；已有历史请改用归档。</p><div><button className="text-button" type="button" onClick={() => setArmed(false)}>取消</button><button className="danger" type="submit">确认永久删除未使用内容</button></div></form>;
}
