"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const hanziLinks = [
  { href: "/learn", label: "学一学", icon: "芽" },
  { href: "/library", label: "字库", icon: "册" },
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
  { href: "/catechism", label: "儿童信仰问答", description: "中英双语，一问一答记真理", mark: "问" },
  { href: "/rewards", label: "小芽贴纸册", description: "认真完成，积累贴纸兑换礼物", mark: "贴" },
];

export function AppShell({ email, isAdmin, isOwner, children }: { email: string; isAdmin: boolean; isOwner: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigationLinks = useMemo(() => pathname.startsWith("/admin")
    ? adminLinks.filter((link) => !link.ownerOnly || isOwner)
    : pathname.startsWith("/catechism")
      ? (isAdmin ? catechismLinks : familyCatechismLinks)
      : pathname.startsWith("/rewards")
        ? rewardLinks
        : hanziLinks, [isAdmin, isOwner, pathname]);
  const availableModules = useMemo(() => isAdmin
    ? [...moduleLinks, { href: "/admin", label: "管理中心", description: "家庭、内容审核和孩子分配", mark: "管" }]
    : moduleLinks, [isAdmin]);

  // 这三个页面是家庭内的高频切换页。进入应用后轻量预取一次，iPhone 上点“芽/册/家”时无需再等路由代码和首个 RSC 请求开始。
  useEffect(() => {
    for (const link of [...navigationLinks, ...availableModules]) {
      if (link.href !== pathname) router.prefetch(link.href);
    }
  }, [availableModules, navigationLinks, pathname, router]);

  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/learn" className="brand" aria-label="字芽首页">
          <span className="brand-mark">字</span>
          <span>字芽</span>
        </Link>
        <div className="module-picker">
          <button className="module-trigger" type="button" aria-expanded={menuOpen} aria-controls="learning-modules" onClick={() => setMenuOpen((open) => !open)}>学习模块 <span aria-hidden="true">{menuOpen ? "⌃" : "⌄"}</span></button>
          {menuOpen && <div className="module-menu" id="learning-modules">
            <p>选择学习内容</p>
            {availableModules.map((link) => <Link key={link.href} href={link.href} className={pathname.startsWith(link.href) ? "active" : ""} onClick={() => setMenuOpen(false)}><span>{link.mark}</span><strong>{link.label}<small>{link.description}</small></strong></Link>)}
          </div>}
        </div>
        <span className="account">{email}</span>
      </header>
      <section className="page">{children}</section>
      <nav className="bottom-nav" aria-label="主导航">
        {navigationLinks.map((link) => (
          <Link key={link.href} href={link.href} prefetch className={`nav-link ${pathname === link.href || (link.href.endsWith("/manage") && pathname.startsWith(`${link.href}/`)) ? "active" : ""}`}>
            <span className="nav-icon" aria-hidden="true">{link.icon}</span>
            <span>{link.label}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
