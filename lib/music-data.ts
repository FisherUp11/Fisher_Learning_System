import type { SupabaseClient } from "@supabase/supabase-js";
import type { MusicItemType } from "@/lib/music-actions";

export type MusicAsset = { id: string; item_id: string; asset_type: string; object_key: string; original_name: string; content_type: string; byte_size: number; label: string | null; sequence: number };
export type MusicAttempt = { id: string; item_id: string; result: string; guess_note: string | null; previous_stage: number; next_stage: number; next_due_at: string; practiced_local_date: string; practiced_at: string };
export type MusicProgress = {
  id: string;
  itemType: MusicItemType;
  title: string;
  category: string | null;
  description: string | null;
  lyrics: string | null;
  correctAnswer: string | null;
  instructions: string | null;
  difficulty: number;
  assets: MusicAsset[];
  stage: number;
  dueAt: string | null;
  lastResult: string | null;
  consecutiveSuccess: number;
  attemptCount: number;
  lastPracticedAt: string | null;
  attempts: MusicAttempt[];
};

export async function loadMusicProgress(supabase: SupabaseClient, learnerId: string): Promise<MusicProgress[]> {
  const { data: assignments, error: assignmentError } = await supabase.from("learner_music_items").select("item_id").eq("learner_id", learnerId);
  if (assignmentError) throw new Error(assignmentError.message);
  const itemIds = (assignments ?? []).map((assignment) => assignment.item_id);
  if (!itemIds.length) return [];
  const [{ data: items, error: itemError }, { data: assets, error: assetError }, { data: states, error: stateError }, { data: attempts, error: attemptError }] = await Promise.all([
    supabase.from("music_items").select("id,item_type,title,category,description,lyrics,correct_answer,instructions,difficulty").in("id", itemIds).eq("status", "published"),
    supabase.from("music_assets").select("id,item_id,asset_type,object_key,original_name,content_type,byte_size,label,sequence").in("item_id", itemIds).order("sequence"),
    supabase.from("music_learning_states").select("item_id,stage,due_at,last_result,consecutive_success").eq("learner_id", learnerId).in("item_id", itemIds),
    supabase.from("music_practice_attempts").select("id,item_id,result,guess_note,previous_stage,next_stage,next_due_at,practiced_local_date,practiced_at").eq("learner_id", learnerId).in("item_id", itemIds).order("practiced_at", { ascending: false }),
  ]);
  if (itemError) throw new Error(itemError.message);
  if (assetError) throw new Error(assetError.message);
  if (stateError) throw new Error(stateError.message);
  if (attemptError) throw new Error(attemptError.message);
  return (items ?? []).map((item) => {
    const state = (states ?? []).find((row) => row.item_id === item.id);
    const history = (attempts ?? []).filter((attempt) => attempt.item_id === item.id) as MusicAttempt[];
    return {
      id: item.id,
      itemType: item.item_type as MusicItemType,
      title: item.title,
      category: item.category,
      description: item.description,
      lyrics: item.lyrics,
      correctAnswer: item.correct_answer,
      instructions: item.instructions,
      difficulty: item.difficulty,
      assets: (assets ?? []).filter((asset) => asset.item_id === item.id) as MusicAsset[],
      stage: state?.stage ?? 0,
      dueAt: state?.due_at ?? null,
      lastResult: state?.last_result ?? null,
      consecutiveSuccess: state?.consecutive_success ?? 0,
      attemptCount: history.length,
      lastPracticedAt: history[0]?.practiced_at ?? null,
      attempts: history,
    };
  }).sort((left, right) => left.itemType.localeCompare(right.itemType) || left.title.localeCompare(right.title, "zh-CN"));
}
