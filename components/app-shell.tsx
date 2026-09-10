"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "./app-shell.module.css";

const hanziLinks = [
  { href: "/learn", label: "学一学", icon: "芽" },
  { href: "/library", label: "字库", icon: "册" },
  { href: "/parent", label: "家长", icon: "家" },
];

const poemLinks = [
  { href: "/poems/game", label: "诗境", icon: "战" },
  { href: "/poems", label: "诗词册", icon: "诗" },
  { href: "/parent", label: "家长", icon: "家" },
];

const catechismLinks = [
  { href: "/catechism/study", label: "问一问", icon: "问" },
  { href: "/catechism", label: "问答册", icon: "册" },
  { href: "/catechism/manage", label: "家长", icon: "家" },
];

const familyCatechismLinks = [
  { href: "/catechism/study", label: "问一问", icon: "问" },
  { href: "/catechism", label: "问答册", icon: "册" },
  { href: "/parent", label: "家长", icon: "家" },
];

const rewardLinks = [
  { href: "/rewards", label: "贴纸册", icon: "贴" },
  { href: "/rewards/manage", label: "奖励管理", icon: "礼" },
  { href: "/parent", label: "家长", icon: "家" },
];

const adminLinks = [
  { href: "/admin", label: "概览", icon: "总" },
  { href: "/admin/resources", label: "资源", icon: "库" },
  { href: "/admin/assignments", label: "分配", icon: "配" },
  { href: "/admin/members", label: "邀请", icon: "邀", ownerOnly: true },
  { href: "/admin/users", label: "用户", icon: "人", ownerOnly: true },
];

const moduleLinks = [
  { href: "/learn", label: "汉字学习", description: "一字一字，建立认读记忆", mark: "字" },
  { href: "/poems", label: "诗词背诵", description: "记录背诵次数与掌握评分", mark: "诗" },
  { href: "/music", label: "音乐天地", description: "听、唱、辨音与节奏练习", mark: "乐" },
  { href: "/catechism", label: "要理问答", description: "中英双语，一问一答记真理", mark: "问" },
  { href: "/rewards", label: "小芽贴纸册", description: "认真完成，积累贴纸兑换礼物", mark: "贴" },
];

export function AppShell({ email, isAdmin, isOwner, children }: { email: string; isAdmin: boolean; isOwner: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isNavigating, startNavigation] = useTransition();
  const [navigationTarget, setNavigationTarget] = useState({ href: "", label: "" });
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const prefetchedAt = useRef(new Map<string, number>());
  const navigationLinks = useMemo(() => pathname.startsWith("/admin")
    ? adminLinks.filter((link) => !link.ownerOnly || isOwner)
      : pathname.startsWith("/catechism")
        ? (isAdmin ? catechismLinks : familyCatechismLinks)
      : pathname.startsWith("/poems")
        ? poemLinks
      : pathname.startsWith("/rewards")
        ? rewardLinks
        : hanziLinks, [isAdmin, isOwner, pathname]);
  const availableModules = useMemo(() => isAdmin
    ? [...moduleLinks, { href: "/admin", label: "管理中心", description: "家庭、内容审核和孩子分配", mark: "管" }]
    : moduleLinks, [isAdmin]);

  // 只预取用户即将访问的目标，避免同时读取所有模块，挤占当前页面的数据库请求。
  function prefetchTarget(href: string) {
    if (href === pathname) return;
    const now = Date.now();
    if (now - (prefetchedAt.current.get(href) ?? 0) < 30000) return;
    prefetchedAt.current.set(href, now);
    router.prefetch(href);
  }

  function navigateTo(href: string, label: string, event: { preventDefault(): void }) {
    event.preventDefault();
    if (isNavigating && navigationTarget.href === href) return;
    setMenuOpen(false);
    setNavigationTarget({ href, label });
    startNavigation(() => router.push(href));
  }

  useEffect(() => {
    if (!menuOpen) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [menuOpen]);

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/learn" prefetch={false} className={`brand ${styles.control}`} aria-label="字芽首页" onPointerEnter={() => prefetchTarget("/learn")} onFocus={() => prefetchTarget("/learn")} onTouchStart={() => prefetchTarget("/learn")} onNavigate={(event) => navigateTo("/learn", "学一学", event)}>
          <span className="brand-mark">字</span>
          <span>字芽</span>
        </Link>
        <div className="module-picker" ref={menuRef}>
          <button ref={menuTriggerRef} className={`module-trigger ${styles.control}`} type="button" aria-expanded={menuOpen} aria-controls="learning-modules" onClick={() => setMenuOpen((open) => !open)}>学习模块 <span aria-hidden="true">{menuOpen ? "⌃" : "⌄"}</span></button>
          {menuOpen && <div className="module-menu" id="learning-modules">
            <p>选择学习内容</p>
            {availableModules.map((link) => <Link key={link.href} href={link.href} prefetch={false} className={`${styles.control} ${pathname.startsWith(link.href) ? "active" : ""}`} aria-current={pathname.startsWith(link.href) ? "page" : undefined} onPointerEnter={() => prefetchTarget(link.href)} onFocus={() => prefetchTarget(link.href)} onTouchStart={() => prefetchTarget(link.href)} onNavigate={(event) => navigateTo(link.href, link.label, event)}><span>{link.mark}</span><strong>{link.label}<small>{link.description}</small></strong></Link>)}
          </div>}
        </div>
        <span className="account">{email}</span>
      </header>
      <div className={styles.navigationStatus} role="status" aria-live="polite" aria-atomic="true">
        {isNavigating && <span><i className={styles.spinner} aria-hidden="true" />正在打开{navigationTarget.label}…</span>}
      </div>
      <section className="page">{children}</section>
      <nav className="bottom-nav" aria-label="主导航">
        {navigationLinks.map((link) => (
          <Link key={link.href} href={link.href} prefetch={false} className={`nav-link ${styles.control} ${pathname === link.href || (link.href.endsWith("/manage") && pathname.startsWith(`${link.href}/`)) ? "active" : ""} ${isNavigating && navigationTarget.href === link.href ? styles.pending : ""}`} aria-current={pathname === link.href ? "page" : undefined} aria-busy={isNavigating && navigationTarget.href === link.href} onPointerEnter={() => prefetchTarget(link.href)} onFocus={() => prefetchTarget(link.href)} onTouchStart={() => prefetchTarget(link.href)} onNavigate={(event) => navigateTo(link.href, link.label, event)}>
            <span className="nav-icon" aria-hidden="true">{isNavigating && navigationTarget.href === link.href ? <i className={styles.spinner} /> : link.icon}</span>
            <span>{isNavigating && navigationTarget.href === link.href ? "打开中…" : link.label}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
