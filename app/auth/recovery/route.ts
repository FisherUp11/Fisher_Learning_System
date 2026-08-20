import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

function failureRedirect(origin: string) {
  return NextResponse.redirect(new URL("/forgot-password?error=invalid_or_expired", origin));
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url.searchParams.has("error") || !projectUrl || !key) return failureRedirect(url.origin);
  if (!code && !(tokenHash && type === "recovery")) return failureRedirect(url.origin);

  const response = NextResponse.redirect(new URL("/reset-password", url.origin));
  response.headers.set("Cache-Control", "private, no-store");
  const supabase = createServerClient(projectUrl, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { error } = tokenHash
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })
    : await supabase.auth.exchangeCodeForSession(code as string);

  if (error) return failureRedirect(url.origin);
  return response;
}
