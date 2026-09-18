"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
/** Local opt-in only. No new database dependency in the child's completion flow. */
export function ParentGrowthInvitation() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { try { setVisible(localStorage.getItem("parent-growth-enabled") === "yes" && localStorage.getItem("parent-growth-dismissed") !== "yes"); } catch { /* optional */ } });
    return () => cancelAnimationFrame(frame);
  }, []);
  if (!visible) return null;
  return <aside style={{ marginTop: 24, padding: 16, background: "var(--leaf-soft)", borderRadius: 16 }}><p>你完成了，爸爸妈妈也来为自己打卡吧。</p><Link href="/together" className="text-button">一起坚持 →</Link><button className="text-button" style={{ marginLeft: 18 }} onClick={() => { setVisible(false); try { localStorage.setItem("parent-growth-dismissed", "yes"); } catch { /* optional */ } }}>不再显示</button></aside>;
}
