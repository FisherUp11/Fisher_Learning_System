import { adultContext, checked } from "@/lib/adult-server";
import { addDays, localDay } from "@/lib/adult-learning";
export const dynamic = "force-dynamic";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const { db, user } = await adultContext();
    // Never use admin-visible learners here: aggregate only this account's own children.
    const children = checked(await db.from("learner_profiles").select("id").eq("parent_user_id", user.id));
    if (!children.length) return Response.json({ days: [] }, { headers });
    const ids = children.map(c => c.id); const start = `${addDays(localDay(), -30)}T00:00:00+08:00`;
    const tables = [["learning_attempts", "answered_at"], ["poem_recitation_attempts", "recited_at"], ["music_practice_attempts", "practiced_at"], ["catechism_attempts", "practiced_at"]];
    const rows = await Promise.all(tables.map(async ([table, column]) => {
      const result: string[] = [];
      for (let offset = 0; offset < 100000; offset += 1000) {
        const data = checked(await db.from(table).select(column).in("learner_id", ids).gte(column, start).order(column).range(offset, offset + 999));
        for (const row of data) { const value = (row as unknown as Record<string, string>)[column]; if (value) result.push(localDay(new Date(value))); }
        if (data.length < 1000) break;
      }
      return result;
    }));
    return Response.json({ days: [...new Set(rows.flat())] }, { headers });
  } catch { return Response.json({ error: "家庭摘要暂不可用" }, { status: 503, headers }); }
}
