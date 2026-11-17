import type { HanziTerm } from "@/lib/hanzi-terms";
import { addCalendarMonths, describeHanziTerm, lastUsableDate } from "@/lib/hanzi-terms";
import type { ChildModuleKey } from "@/lib/module-keys";

export type ChildTerm = HanziTerm & { grant_kind?: "paid" | "trial" };
export type ChildAccessModule = { key: ChildModuleKey; enabled: boolean; term: ChildTerm | null };
export type TrialWindow = { starts_on: string; valid_until: string };

export function describeChildTerm(term: ChildTerm | null, enabled: boolean, today: string) {
  const status = describeHanziTerm(term, enabled, today);
  return { ...status, label: status.active && term?.mode === "term" && term.grant_kind === "trial" ? "免费试用中" : status.label };
}

export function previewChildTerm(term: ChildTerm | null, action: string, months: number, today: string, trial: TrialWindow | null) {
  if (action === "permanent") return "长期授权";
  if (action === "enabled") return term?.mode === "permanent" ? "保留长期授权" : term?.valid_until ? `保留至 ${lastUsableDate(term.valid_until)}` : "请先设置有效期";
  const end = action === "trial" ? trial?.valid_until ?? addCalendarMonths(today, 1)
    : addCalendarMonths(term?.mode === "term" && term.valid_until && term.valid_until > today ? term.valid_until : today, months);
  return `可用至 ${lastUsableDate(end)}（含当天）`;
}
