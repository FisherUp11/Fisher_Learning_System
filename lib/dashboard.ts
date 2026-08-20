import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type LearnerDashboard = {
  started: number;
  stable: number;
  mastered: number;
  due: number;
  firstAttemptRate: number | null;
  firstAttemptCount: number;
  todayAnswered: number;
  todayRemaining: number;
  assignedPackages: number;
  assignedPoemCollections: number;
  assignedMusicItems: number;
  assignedCatechismCollections: number;
  musicDue: number;
  catechismDue: number;
};

export async function loadLearnerDashboard(
  supabase: SupabaseClient,
  learnerId: string,
  timezone = "Asia/Shanghai",
): Promise<LearnerDashboard> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const localDateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const localPart = (type: string) => localDateParts.find((part) => part.type === type)?.value;
  const localDate = `${localPart("year")}-${localPart("month")}-${localPart("day")}`;
  const [states, firstAttempts, todayProgress, packages, poems, music, catechism, musicStates, catechismStates] = await Promise.all([
    supabase.from("learning_states").select("character_id,stage,due_at").eq("learner_id", learnerId),
    supabase.from("learning_attempts").select("character_id,result,assisted").eq("learner_id", learnerId).eq("attempt_number", 1).gte("answered_at", sevenDaysAgo),
    supabase.from("daily_sessions").select("id,daily_character_progress(passed_at)").eq("learner_id", learnerId).eq("date_local", localDate).maybeSingle(),
    supabase.from("learner_content_packages").select("package_id,content_packages!inner(status,review_status)").eq("learner_id", learnerId).eq("assignment_status", "active").eq("content_packages.status", "published").eq("content_packages.review_status", "approved"),
    supabase.from("learner_poem_collections").select("collection_id,poem_collections!inner(status,review_status)").eq("learner_id", learnerId).eq("assignment_status", "active").eq("poem_collections.status", "published").eq("poem_collections.review_status", "approved"),
    supabase.from("learner_music_items").select("item_id,music_items!inner(status,review_status)").eq("learner_id", learnerId).eq("assignment_status", "active").eq("music_items.status", "published").eq("music_items.review_status", "approved"),
    supabase.from("learner_catechism_collections").select("collection_id,catechism_collections!inner(status,review_status)").eq("learner_id", learnerId).eq("assignment_status", "active").eq("catechism_collections.status", "published").eq("catechism_collections.review_status", "approved"),
    supabase.from("music_learning_states").select("item_id,due_at").eq("learner_id", learnerId),
    supabase.from("catechism_learning_states").select("item_id,next_review_date").eq("learner_id", learnerId),
  ]);

  const failed = [states, firstAttempts, todayProgress, packages, poems, music, catechism, musicStates, catechismStates].find((result) => result.error);
  if (failed?.error) throw new Error(`无法读取孩子学习概况：${failed.error.message}`);
  const packageIds = (packages.data ?? []).map((assignment) => assignment.package_id);
  const catechismCollectionIds = (catechism.data ?? []).map((assignment) => assignment.collection_id);
  const [packageCharacters, catechismItems] = await Promise.all([
    packageIds.length
      ? supabase.from("package_characters").select("character_id").in("package_id", packageIds)
      : Promise.resolve({ data: [], error: null }),
    catechismCollectionIds.length
      ? supabase.from("catechism_items").select("id").in("collection_id", catechismCollectionIds).eq("status", "active")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (packageCharacters.error || catechismItems.error) {
    throw new Error(`无法读取已分配内容：${packageCharacters.error?.message ?? catechismItems.error?.message}`);
  }
  const activeCharacterIds = new Set((packageCharacters.data ?? []).map((item) => item.character_id));
  const activeMusicIds = new Set((music.data ?? []).map((assignment) => assignment.item_id));
  const activeCatechismItemIds = new Set((catechismItems.data ?? []).map((item) => item.id));
  const firstRows = (firstAttempts.data ?? []).filter((attempt) => activeCharacterIds.has(attempt.character_id));
  const cleanKnown = firstRows.filter((attempt) => attempt.result === "known" && !attempt.assisted).length;
  const progress = ((todayProgress.data as { daily_character_progress?: Array<{ passed_at: string | null }> } | null)?.daily_character_progress ?? []);
  const stateRows = (states.data ?? []).filter((state) => activeCharacterIds.has(state.character_id));

  return {
    started: stateRows.length,
    stable: stateRows.filter((state) => state.stage >= 5).length,
    mastered: stateRows.filter((state) => state.stage >= 7).length,
    due: stateRows.filter((state) => Boolean(state.due_at && new Date(state.due_at) <= new Date())).length,
    firstAttemptRate: firstRows.length ? Math.round((cleanKnown / firstRows.length) * 100) : null,
    firstAttemptCount: firstRows.length,
    todayAnswered: progress.filter((item) => item.passed_at).length,
    todayRemaining: progress.filter((item) => !item.passed_at).length,
    assignedPackages: packageIds.length,
    assignedPoemCollections: poems.data?.length ?? 0,
    assignedMusicItems: activeMusicIds.size,
    assignedCatechismCollections: catechismCollectionIds.length,
    musicDue: (musicStates.data ?? []).filter((state) => activeMusicIds.has(state.item_id) && state.due_at && new Date(state.due_at) <= new Date()).length,
    catechismDue: (catechismStates.data ?? []).filter((state) => activeCatechismItemIds.has(state.item_id) && state.next_review_date && state.next_review_date <= localDate).length,
  };
}
