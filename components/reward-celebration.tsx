"use client";

import { useState } from "react";
import Link from "next/link";
import { RewardSticker } from "@/components/reward-sticker";
import type { RewardOutcome } from "@/lib/reward-types";

type RewardCelebrationProps = {
  learnerId: string;
  reward: RewardOutcome;
  message?: string;
};

export function RewardCelebration({ learnerId, reward, message }: RewardCelebrationProps) {
  const [open, setOpen] = useState(true);
  if (!open || !reward.awarded) return null;

  return (
    <div className="reward-celebration-backdrop" role="presentation">
      <section
        className="reward-celebration"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reward-celebration-title"
      >
        <div className="reward-sparkles" aria-hidden="true">
          <span>✦</span><span>●</span><span>✦</span><span>●</span>
        </div>
        <p className="eyebrow">NEW STICKER</p>
        <RewardSticker code={reward.stickerCode} size="large" label={`${reward.title ?? "成长"}贴纸`} />
        <h2 id="reward-celebration-title">太棒啦，拿到新贴纸！</h2>
        <p>{message ?? `一枚“${reward.title ?? "成长"}”贴纸已经住进小芽贴纸册。`}</p>
        <strong>现在共有 {reward.balance} 枚</strong>
        <div className="reward-celebration-actions">
          <button className="primary" type="button" onClick={() => setOpen(false)}>开心收下</button>
          <Link className="secondary" href={`/rewards?learner=${encodeURIComponent(learnerId)}`}>看看贴纸册</Link>
        </div>
      </section>
    </div>
  );
}
