export const PINYIN_CATEGORIES = ["final", "initial", "compound", "front_nasal", "back_nasal", "whole"] as const;
export type PinyinCategory = typeof PINYIN_CATEGORIES[number];
export type PinyinNewOrder = "sequential" | "random";

export const PINYIN_CATEGORY_LABELS: Record<PinyinCategory, string> = {
  final: "单韵母", initial: "声母", compound: "复韵母", front_nasal: "前鼻韵母", back_nasal: "后鼻韵母", whole: "整体认读音节",
};

export const PINYIN_CATEGORY_COUNTS: Record<PinyinCategory, string> = {
  final: "6 个", initial: "23 个", compound: "8 个 + 特殊韵母 er", front_nasal: "5 个", back_nasal: "4 个", whole: "16 个",
};

export function pinyinCategoryLabel(category: PinyinCategory, code?: string) {
  return code === "er" ? "特殊韵母" : PINYIN_CATEGORY_LABELS[category];
}

export function legacyPinyinCategories(mode: string): PinyinCategory[] {
  return mode === "both" ? ["final", "initial"] : mode === "finals" ? ["final"] : mode === "initials" ? ["initial"] : [];
}

export function pinyinSettingsPayload(form: FormData) {
  const raw = form.getAll("categories");
  if (raw.some((value) => typeof value !== "string" || !PINYIN_CATEGORIES.includes(value as PinyinCategory))) {
    throw new Error("请选择有效的拼音类别");
  }
  const categories = PINYIN_CATEGORIES.filter((category) => raw.includes(category));
  const dailyLimit = Number(form.get("daily_limit") ?? 4);
  const newOrder = String(form.get("new_order") ?? "sequential");
  if (![3, 4, 5].includes(dailyLimit)) throw new Error("每天请选择 3–5 个拼音");
  if (!["sequential", "random"].includes(newOrder)) throw new Error("请选择顺序或随机加入");
  // Retain the original column for old clients; the new planner reads categories.
  const mode = !categories.length ? "off" : categories.length === 1 && categories[0] === "final" ? "finals"
    : categories.length === 1 && categories[0] === "initial" ? "initials" : "both";
  return { mode, enabled_categories: categories, daily_limit: dailyLimit, new_order: newOrder as PinyinNewOrder };
}
