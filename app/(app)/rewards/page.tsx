import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { LearnerOptions, orderLearners } from "@/components/learner-options";
import { RewardSticker } from "@/components/reward-sticker";
import { RewardWishlist } from "@/components/reward-wishlist";
import { rewardWishProgress } from "@/lib/reward-types";
import { formatRewardDate, loadRewardDashboard } from "@/lib/rewards";

export const dynamic = "force-dynamic";

const boardStickerCodes = [
  "sprout", "sun", "rabbit", "whale", "star",
  "flower", "rocket", "rainbow", "bear", "moon",
] as const;

export default async function RewardsPage({ searchParams }: { searchParams: Promise<{ learner?: string }> }) {
  const supabase = await createClient();
  const query = await searchParams;
  const { data: { user } } = await supabase.auth.getUser();
  const access = user ? await loadAccessContext(supabase, user.id) : null;
  const { data: rawLearners, error: learnerError } = await supabase
    .from("learner_profiles")
    .select("id,display_name,timezone,family_id,parent_user_id,families(name)").eq("family_id",access?.familyId ?? "00000000-0000-0000-0000-000000000000")
    .order("created_at");
  const ownLearners = (rawLearners ?? []).filter(row => row.parent_user_id === user?.id || (access?.familyId && row.family_id === access.familyId));
  const learners = orderLearners(ownLearners, access?.familyId);

  if (learnerError) return <section className="panel"><h1>贴纸册还没准备好</h1><p className="error">{learnerError.message}</p></section>;
  const learner = learners?.find((item) => item.id === query.learner) ?? learners?.[0];
  if (!learner) {
    return <section className="empty panel"><span className="empty-mark">🌱</span><h1>先创建孩子档案</h1><Link className="primary" href="/parent">去家长页</Link></section>;
  }

  let dashboard;
  try {
    dashboard = await loadRewardDashboard(supabase, learner.id);
  } catch (error) {
    return <section className="panel reward-setup-needed"><p className="eyebrow">REWARD SETUP</p><h1>贴纸与愿望暂时没有读到</h1><p className="lede">现有奖励项目请先运行本次升级脚本；如果已运行，请稍后刷新，不能将读取失败当作零枚贴纸。</p><code>supabase/037_child_reward_wishlist.sql</code><p className="error">{error instanceof Error ? error.message : "无法读取奖励数据"}</p></section>;
  }

  const filledSlots = Math.min(dashboard.stickerGoal, dashboard.balance);
  const activeGifts = dashboard.catalogItems.filter(item => ["ready","saving"].includes(rewardWishProgress(item,dashboard.balance,dashboard.redemptions).state));
  const personalGoals = activeGifts.filter(item => item.learner_id === learner.id);
  const featuredGoals = personalGoals.length ? personalGoals : activeGifts;
  const readyCount = featuredGoals.filter(item => dashboard.balance >= item.sticker_cost).length;
  const closest = [...featuredGoals].sort((a,b) => a.sticker_cost-b.sticker_cost)[0];
  const remaining = closest ? Math.max(0,closest.sticker_cost-dashboard.balance) : 0;

  return (
    <div className="reward-page">
      <header className="hero reward-hero">
        <span hidden data-current-learner={learner.id} />
        <span className="reward-hero-mark" aria-hidden="true">贴</span>
        <div>
          <p className="eyebrow">LITTLE SPROUT REWARDS</p>
          <h1>{learner.display_name} 的小芽贴纸册</h1>
          <p className="lede">每一枚贴纸，都记着一次认真完成和勇敢尝试。</p>
        </div>
      </header>

      {(learners?.length ?? 0) > 1 && <form action="/rewards" className="learner-switch reward-switch">
        <label>查看谁的贴纸册？
          <select name="learner" defaultValue={learner.id}><LearnerOptions learners={learners} /></select>
        </label>
        <button className="secondary" type="submit">切换</button>
      </form>}

      <section className="reward-wallet" aria-label={`${learner.display_name} 当前有 ${dashboard.balance} 枚贴纸`}>
        <div className="reward-wallet-copy">
          <p className="eyebrow">我的贴纸</p>
          <strong>{dashboard.balance}<small>枚</small></strong>
          <p>{readyCount > 0 ? `有 ${readyCount} 份小期待已经攒够贴纸，和爸爸妈妈选一份实现吧。` : closest ? `再攒 ${remaining} 枚，就能实现“${closest.title}”的小愿望啦。` : "把心里的小期待加入愿望清单，和爸爸妈妈一起慢慢实现。"}</p>
        </div>
        <div className={`reward-gift-box ${readyCount > 0 ? "ready" : ""}`} aria-hidden="true">
          <span>{readyCount > 0 ? "🎁" : "🎀"}</span>
          <small>{readyCount > 0 ? "可以兑换" : "继续加油"}</small>
        </div>
      </section>

      <section className="reward-board panel">
        <div className="reward-board-heading">
          <div><p className="eyebrow">STICKER GARDEN</p><h2>每一枚，都是小小的进步</h2><p className="small muted">这是贴纸花园；每份愿望需要几枚，看下面的小约定。</p></div>
          <span>{filledSlots} / {dashboard.stickerGoal}</span>
        </div>
        <div className="reward-vine" aria-hidden="true" />
        <div className="reward-sticker-grid">
          {Array.from({ length: dashboard.stickerGoal }, (_, slot) => {
            const filled = slot < filledSlots;
            const code = boardStickerCodes[slot % boardStickerCodes.length];
            return <RewardSticker key={`reward-slot-${slot + 1}`} code={code} empty={!filled} label={`第 ${slot + 1} 枚贴纸`} />;
          })}
        </div>
      </section>

      <section className="reward-growth-card">
        <div>
          <p className="eyebrow">成长小星星</p>
          <h2>诗词和音乐的小小积累</h2>
          <p>背一首诗、认真跟唱、辨一次声音或练一次节奏，都能点亮星星。每天最多两颗。</p>
        </div>
        <div className="reward-growth-stars" aria-label={`已经点亮 ${dashboard.growthPoints} 颗，共需 ${dashboard.growthPointsPerSticker} 颗`}>
          {Array.from({ length: dashboard.growthPointsPerSticker }, (_, star) => <span className={star < dashboard.growthPoints ? "lit" : ""} key={`growth-star-${star + 1}`}>★</span>)}
          <strong>{dashboard.growthPoints} / {dashboard.growthPointsPerSticker}</strong>
        </div>
      </section>

      <RewardWishlist dashboard={dashboard} learnerId={learner.id} learnerName={learner.display_name} />

      <section className="panel reward-history">
        <div className="section-heading"><div><p className="eyebrow">成长足迹</p><h2>最近的贴纸故事</h2></div><span>累计得到 {dashboard.lifetimeEarned} 枚</span></div>
        {dashboard.ledger.length === 0
          ? <p className="notice">完成今天的汉字学习后，第一枚贴纸就会出现在这里。</p>
          : <div className="reward-history-list">{dashboard.ledger.slice(0, 20).map((entry) => <article key={entry.id}>
            {entry.amount > 0 ? <RewardSticker code={entry.sticker_code} /> : <span className="reward-history-spent" aria-hidden="true">🎁</span>}
            <div><strong>{entry.title}</strong><small>{formatRewardDate(entry.local_date)}{entry.note ? ` · ${entry.note}` : ""}</small></div>
            <em className={entry.amount > 0 ? "earned" : "spent"}>{entry.amount > 0 ? "+" : ""}{entry.amount}</em>
          </article>)}</div>}
      </section>
    </div>
  );
}
