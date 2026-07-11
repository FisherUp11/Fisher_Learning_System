import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "字芽 · 汉字学习",
  description: "亲子汉字识认与间隔复习",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "字芽" },
  // iOS 会自动把邮箱、电话和地址改写成链接；这会改变服务端 HTML，进而触发 hydration 报错。
  formatDetection: { email: false, telephone: false, address: false },
};

export const viewport: Viewport = {
  themeColor: "#355d45",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
