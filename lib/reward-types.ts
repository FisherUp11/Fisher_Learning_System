export type RewardOutcome = {
  eligible: boolean;
  awarded: boolean;
  credited: boolean;
  duplicate: boolean;
  dailyLimitReached: boolean;
  reason: string;
  amount: number;
  balance: number;
  progress: number;
  needed: number;
  goal: number;
  stickerCode: string | null;
  title: string | null;
  systemError: string | null;
};

export type RewardLedgerRow = {
  id: string;
  event_type: string;
  amount: number;
  title: string;
  note: string | null;
  sticker_code: string | null;
  local_date: string;
  reference_id: string | null;
  created_at: string;
};

export type RewardCatalogItem = {
  id: string;
  title: string;
  sticker_cost: number;
  icon: string;
  note: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type RewardRedemption = {
  id: string;
  learner_id: string;
  reward_item_id: string | null;
  title_snapshot: string;
  sticker_cost: number;
  note: string | null;
  status: "completed" | "reversed";
  redeemed_at: string;
  local_date: string;
  reversed_at: string | null;
  reversal_note: string | null;
};

export type RewardDashboard = {
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  stickerGoal: number;
  growthPoints: number;
  growthPointsPerSticker: number;
  dailyGrowthLimit: number;
  ledger: RewardLedgerRow[];
  catalogItems: RewardCatalogItem[];
  redemptions: RewardRedemption[];
};

export const stickerPictures = {
  sprout: { emoji: "🌱", label: "小芽" },
  sun: { emoji: "☀️", label: "太阳" },
  rabbit: { emoji: "🐰", label: "小兔" },
  whale: { emoji: "🐳", label: "鲸鱼" },
  star: { emoji: "⭐", label: "星星" },
  flower: { emoji: "🌼", label: "小花" },
  rocket: { emoji: "🚀", label: "火箭" },
  rainbow: { emoji: "🌈", label: "彩虹" },
  bear: { emoji: "🐻", label: "小熊" },
  moon: { emoji: "🌙", label: "月亮" },
} as const;

export type StickerCode = keyof typeof stickerPictures;

export function stickerPicture(code: string | null | undefined) {
  return stickerPictures[(code ?? "sprout") as StickerCode] ?? stickerPictures.sprout;
}

export function rewardProgressMessage(outcome: RewardOutcome) {
  if (outcome.systemError) return "学习记录已经保存，贴纸进度暂时没有同步，请稍后在贴纸册查看。";
  if (outcome.awarded) return `三颗成长小星星集齐啦！一枚“${outcome.title ?? "勇敢探索"}”贴纸已经放进贴纸册。`;
  if (outcome.reason === "listen_only") return "这次听歌已经记下；下次跟着唱一唱，就能点亮成长小星星。";
  if (outcome.reason === "same_item_today") return "今天这项练习已经获得过小星星啦，但每一次练习都在让你更厉害。";
  if (outcome.dailyLimitReached) return "今天已经点亮两颗成长小星星啦，明天再继续积累。";
  if (outcome.credited) return `点亮了第 ${outcome.progress} 颗成长小星星！再完成 ${outcome.needed} 次小挑战，就能得到新贴纸。`;
  return "这次练习已经认真记下。";
}
