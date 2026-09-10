import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

function getPublicKey() {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!key) throw new Error("缺少 Supabase 浏览器公钥");
  return key;
}

// React cache 仅在当前服务端渲染请求内复用，不能跨请求/跨账号共享带 Cookie 的客户端。
export const createClient = cache(async function createClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL");

  return createServerClient(url, getPublicKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies. proxy.ts refreshes the session instead.
        }
      },
    },
  });
});
