"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const links = [
  { href: "/learn", label: "学一学", icon: "芽" },
  { href: "/library", label: "字库", icon: "册" },
  { href: "/parent", label: "家长", icon: "家" },
];

const moduleLinks = [
  { href: "/learn", label: "汉字学习", description: "一字一字，建立认读记忆", mark: "字" },
  { href: "/poems", label: "诗词背诵", description: "记录背诵次数与掌握评分", mark: "诗" },
];

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  // 这三个页面是家庭内的高频切换页。进入应用后轻量预取一次，iPhone 上点“芽/册/家”时无需再等路由代码和首个 RSC 请求开始。
  useEffect(() => {
    for (const link of [...links, ...moduleLinks]) {
      if (link.href !== pathname) router.prefetch(link.href);
    }
  }, [pathname, router]);

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
            {moduleLinks.map((link) => <Link key={link.href} href={link.href} className={pathname.startsWith(link.href) ? "active" : ""} onClick={() => setMenuOpen(false)}><span>{link.mark}</span><strong>{link.label}<small>{link.description}</small></strong></Link>)}
            <div className="module-menu-soon"><span>乐</span><strong>音乐诗歌<small>以后开放</small></strong></div>
          </div>}
        </div>
        <span className="account">{email}</span>
      </header>
      <section className="page">{children}</section>
      <nav className="bottom-nav" aria-label="主导航">
        {links.map((link) => (
          <Link key={link.href} href={link.href} prefetch className={`nav-link ${pathname === link.href ? "active" : ""}`}>
            <span className="nav-icon" aria-hidden="true">{link.icon}</span>
            <span>{link.label}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
