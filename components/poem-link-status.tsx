"use client";

import { useLinkStatus } from "next/link";

/** 位于 Link 内，只提示当前点击的卡片；不预取整页列表的所有详情。 */
export function PoemLinkStatus() {
  const { pending } = useLinkStatus();
  return pending ? <span className="poem-opening-hint" role="status">正在打开…</span> : null;
}
