import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Bulk Auth lookup for an owner/admin page; avoids one network call per family. */
export async function loadAuthDirectory(ids: string[]) {
  const wanted = new Set(ids);
  const found = new Map<string, { email: string | null; lastSignInAt: string | null }>();
  if (!wanted.size) return found;
  const admin = createAdminClient();
  for (let page = 1; page <= 10 && found.size < wanted.size; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    for (const user of data.users) if (wanted.has(user.id)) {
      found.set(user.id, { email: user.email ?? null, lastSignInAt: user.last_sign_in_at ?? null });
    }
    if (data.users.length < 1000) break;
  }
  return found;
}
