import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { safeNextPath } from "@/lib/invitation";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  // Backward compatibility for recovery templates that still point to
  // /auth/callback?token_hash=...&type=recovery. Keep the actual verification
  // in the dedicated recovery route so both template formats share one flow.
  if (tokenHash && type === "recovery" && !url.searchParams.has("error")) {
    const recoveryUrl = new URL("/auth/recovery", url.origin);
    recoveryUrl.searchParams.set("token_hash", tokenHash);
    recoveryUrl.searchParams.set("type", "recovery");
    const recoveryResponse = NextResponse.redirect(recoveryUrl);
    recoveryResponse.headers.set("Cache-Control", "private, no-store");
    return recoveryResponse;
  }

  const requestedNext = url.searchParams.get("next") ?? "/learn";
  const next = safeNextPath(requestedNext);
  const response = NextResponse.redirect(new URL(next, url.origin));
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const failedUrl = new URL(`/login?error=invalid_link&next=${encodeURIComponent(next)}`, url.origin);
  if (!projectUrl || !key || !code || url.searchParams.has("error")) return NextResponse.redirect(failedUrl);

  const supabase = createServerClient(projectUrl, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(failedUrl);
  return response;
}
