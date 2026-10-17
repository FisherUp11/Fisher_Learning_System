import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// 仅供 Server Components 使用：React cache 只在一次服务端渲染内去重。
// 不把带 Cookie 的客户端或用户信息存进跨请求缓存；Action / Route 仍用 createClient。
export const createPageClient = cache(createClient);
export const getPageUser = cache(async () => {
  const supabase = await createPageClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
