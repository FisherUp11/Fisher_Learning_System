import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RewardSticker } from "@/components/reward-sticker";
import { RewardRedeemButton } from "@/components/reward-redeem-button";
import { formatRewardDate, loadRewardDashboard } from "@/lib/rewards";

export const dynamic = "force-dynamic";

const boardStickerCodes = [
  "sprout", "sun", "rabbit", "whale", "star",
  "flower", "rocket", "rainbow", "bear", "moon",
] as const;

export default async function RewardsPage({ searchParams }: { searchParams: Promise<{ learner?: string }> }) {
  const supabase = await createClient();
  const query = await searchParams;
  const { data: learners, error: learnerError } = await supabase
    .from("learner_profiles")
    .select("id,display_name,timezone")
    .order("created_at");

  if (learnerError) return <section className="panel"><h1>贴纸册还没准备好</h1><p className="error">{learnerError.message}</p></section>;
  const learner = learners?.find((item) => item.id === query.learner) ?? learners?.[0];
  if (!learner) {
    return <section className="empty panel"><span className="empty-mark">🌱</span><h1>先创建孩子档案</h1><Link className="primary" href="/parent">去家长页</Link></section>;
  }

  let dashboard;
  try {
    dashboard = await loadRewardDashboard(supabase, learner.id);
  } catch (error) {
    return <section className="panel reward-setup-needed"><p className="eyebrow">REWARD SETUP</p><h1>贴纸乐园还差一步</h1><p className="lede">请先在 Supabase SQL Editor 整段运行奖励模块脚本。</p><code>supabase/012_reward_sticker_module.sql</code><p className="error">{error instanceof Error ? error.message : "无法读取奖励数据"}</p></section>;
  }

  const filledSlots = Math.min(dashboard.stickerGoal, dashboard.balance);
  const redeemableCount = Math.floor(dashboard.balance / dashboard.stickerGoal);
  const activeGifts = dashboard.catalogItems.filter((item) => item.status === "active");
  const remaining = Math.max(0, dashboard.stickerGoal - dashboard.balance);

  return (
    <div className="reward-page">
      <header className="hero reward-hero">
        <span className="reward-hero-mark" aria-hidden="true">贴</span>
        <div>
          <p className="eyebrow">LITTLE SPROUT REWARDS</p>
          <h1>{learner.display_name} 的小芽贴纸册</h1>
          <p className="lede">每一枚贴纸，都记着一次认真完成和勇敢尝试。</p>
        </div>
      </header>

      {(learners?.length ?? 0) > 1 && <form action="/rewards" className="learner-switch reward-switch">
        <label>查看谁的贴纸册？
          <select name="learner" defaultValue={learner.id}>{learners?.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select>
        </label>
        <button className="secondary" type="submit">切换</button>
      </form>}

      <section className="reward-wallet" aria-label={`${learner.display_name} 当前有 ${dashboard.balance} 枚贴纸`}>
        <div className="reward-wallet-copy">
          <p className="eyebrow">我的贴纸</p>
          <strong>{dashboard.balance}<small>枚</small></strong>
          <p>{redeemableCount > 0 ? `礼物盒已经亮起来啦，可以兑换 ${redeemableCount} 份十枚礼物。` : `再得到 ${remaining} 枚，就能打开礼物盒。`}</p>
        </div>
        <div className={`reward-gift-box ${redeemableCount > 0 ? "ready" : ""}`} aria-hidden="true">
          <span>{redeemableCount > 0 ? "🎁" : "🎀"}</span>
          <small>{redeemableCount > 0 ? "可以兑换" : "继续加油"}</small>
        </div>
      </section>

      <section className="reward-board panel">
        <div className="reward-board-heading">
          <div><p className="eyebrow">STICKER GARDEN</p><h2>十枚贴纸，开一份礼物</h2></div>
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

      <section className="panel reward-gifts">
        <div className="section-heading">
          <div><p className="eyebrow">礼物愿望</p><h2>{activeGifts.length ? "想兑换哪一份？" : "还没有加入礼物"}</h2></div>
          <Link className="text-button" href={`/rewards/manage?learner=${learner.id}`}>爸爸妈妈管理</Link>
        </div>
        {activeGifts.length === 0
          ? <p className="notice">请爸爸妈妈先到奖励管理页加入第一份小礼物。</p>
          : <div className="reward-gift-grid">{activeGifts.map((item) => <article className="reward-gift-card" key={item.id}>
            <span className="reward-gift-icon" aria-hidden="true">{item.icon}</span>
            <div><h3>{item.title}</h3>{item.note && <p>{item.note}</p>}<strong>{item.sticker_cost} 枚贴纸</strong></div>
            <RewardRedeemButton learnerId={learner.id} itemId={item.id} title={item.title} cost={item.sticker_cost} balance={dashboard.balance} />
          </article>)}</div>}
      </section>

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
