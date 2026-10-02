"use client";

export function PrintAction({ className }: { className?: string }) {
  return <button className={className} type="button" onClick={() => window.print()}>打印这张字表</button>;
}
