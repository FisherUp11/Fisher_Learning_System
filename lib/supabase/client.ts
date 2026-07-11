import { createBrowserClient } from "@supabase/ssr";

function getPublicKey() {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!key) throw new Error("缺少 NEXT_PUBLIC_SUPABASE_ANON_KEY 或 PUBLISHABLE_KEY");
  return key;
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL");
  return createBrowserClient(url, getPublicKey());
}
