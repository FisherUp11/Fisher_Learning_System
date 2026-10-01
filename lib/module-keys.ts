export const ACCOUNT_MODULES = ["hanzi", "poem", "music", "catechism", "kids_english", "family_maxims", "adult_english", "exercise"] as const;
export const CHILD_MODULES = ["hanzi", "poem", "music", "catechism", "kids_english", "family_maxims"] as const;
export type ModuleKey = (typeof ACCOUNT_MODULES)[number];
export type ChildModuleKey = (typeof CHILD_MODULES)[number];
export const MODULE_LABELS: Record<ModuleKey, string> = {
  hanzi: "汉字学习", poem: "诗词背诵", music: "音乐天地", catechism: "要理问答",
  kids_english: "儿童英语", family_maxims: "家中箴言", adult_english: "父母英语", exercise: "运动打卡",
};
