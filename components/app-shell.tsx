"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/learn", label: "学一学", icon: "芽" },
  { href: "/library", label: "字库", icon: "册" },
  { href: "/parent", label: "家长", icon: "家" },
];

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/learn" className="brand" aria-label="字芽首页">
          <span className="brand-mark">字</span>
          <span>字芽</span>
        </Link>
        <span className="account">{email}</span>
      </header>
      <section className="page">{children}</section>
      <nav className="bottom-nav" aria-label="主导航">
        {links.map((link) => (
          <Link key={link.href} href={link.href} className={`nav-link ${pathname === link.href ? "active" : ""}`}>
            <span className="nav-icon" aria-hidden="true">{link.icon}</span>
            <span>{link.label}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
