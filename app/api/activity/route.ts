import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let body: { learnerId?: unknown; seconds?: unknown; newVisit?: unknown };
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const learnerId = typeof body.learnerId === "string" && UUID.test(body.learnerId) ? body.learnerId : null;
  const seconds = Math.max(0, Math.min(90, Math.round(Number(body.seconds) || 0)));
  // Usage stats must never break learning; a missing 022 migration is ignored.
  const { error } = await supabase.rpc("record_app_activity", { p_learner_id: learnerId, p_seconds: seconds, p_new_visit: body.newVisit === true });
  if (error) console.warn("record_app_activity_failed", error.code);
  return new NextResponse(null, { status: 204 });
}
