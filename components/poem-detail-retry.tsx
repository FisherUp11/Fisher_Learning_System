"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function PoemDetailRetry({ message }: { message: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="notice" role="status"><p>{message}</p><button type="button" className="text-button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "正在重试…" : "重新读取"}</button></div>;
}
