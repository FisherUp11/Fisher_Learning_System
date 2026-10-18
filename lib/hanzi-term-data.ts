import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HanziTerm } from "@/lib/hanzi-terms";

// Per-render deduplication only. Never persist a paid permission across requests.
export const loadHanziTermSnapshot = cache(async (db: SupabaseClient, learnerId: string) => {
  const [term, access, permission] = await Promise.all([
    db.from("learner_hanzi_terms").select("learner_id,mode,starts_on,valid_until,version").eq("learner_id", learnerId).maybeSingle(),
    db.from("learner_module_access").select("enabled").eq("learner_id", learnerId).eq("module_key", "hanzi").maybeSingle(),
    db.rpc("can_study_child_module", { p_learner_id: learnerId, p_module_key: "hanzi" }),
  ]);
  return { term: term.data as HanziTerm | null, enabled: Boolean(access.data?.enabled), canStudy: permission.data === true, error: term.error ?? access.error ?? permission.error };
});
