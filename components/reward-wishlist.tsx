import Link from "next/link";
import { RewardRedeemButton } from "@/components/reward-redeem-button";
import { rewardWishProgress, type RewardDashboard } from "@/lib/reward-types";
import { formatRewardDate } from "@/lib/rewards";

export function RewardWishlist({ dashboard, learnerId, learnerName }: { dashboard: RewardDashboard; learnerId: string; learnerName: string }) {
  const personal = dashboard.catalogItems.filter(item => item.learner_id === learnerId);
  const pending = personal.filter(item => ["ready","saving"].includes(rewardWishProgress(item,dashboard.balance,dashboard.redemptions).state));
  const fulfilled = personal.filter(item => rewardWishProgress(item,dashboard.balance,dashboard.redemptions).state === "fulfilled");
  const legacy = dashboard.catalogItems.filter(item => item.learner_id === null && item.status === "active");
  return <section className="panel reward-gifts reward-wishlist">
    <div className="section-heading"><div><p className="eyebrow">LITTLE WISHES</p><h2>{learnerName} 的愿望清单</h2></div><Link className="text-button" href={`/rewards/manage?learner=${learnerId}#wishes`}>爸爸妈妈管理 →</Link></div>
    <p className="library-meta">{pending.length} 个小期待 · {fulfilled.length} 个愿望已实现。慢慢积累，每一次努力都算数。</p>
    {pending.length === 0 ? <div className="reward-wish-empty"><span aria-hidden="true">🎁</span><h3>{fulfilled.length ? "已经实现了小愿望" : "把小小的期待放进来"}</h3><p>和爸爸妈妈聊一聊：下一份想要的小礼物是什么？</p></div> : <div className="reward-gift-grid">{pending.map(item => {
      const progress = rewardWishProgress(item,dashboard.balance,dashboard.redemptions);
      return <article className={`reward-gift-card reward-wish-card ${progress.state === "ready" ? "is-ready" : ""}`} key={item.id}>
        <span className="reward-gift-icon" aria-hidden="true">{item.icon}</span><div><span className="reward-wish-state">{progress.state === "ready" ? "愿望可以实现啦" : "正在为它攒贴纸"}</span><h3>{item.title}</h3>{item.note && <p>{item.note}</p>}<strong>{item.sticker_cost} 枚贴纸</strong></div>
        <div className="reward-wish-progress"><div><span>{progress.state === "ready" ? "已经攒够" : `再攒 ${progress.remaining} 枚`}</span><strong>{Math.min(dashboard.balance,item.sticker_cost)} / {item.sticker_cost}</strong></div><progress max={item.sticker_cost} value={Math.min(Math.max(0,dashboard.balance),item.sticker_cost)} aria-label={`${item.title} 的贴纸进度`} /></div>
        <RewardRedeemButton learnerId={learnerId} itemId={item.id} title={item.title} cost={item.sticker_cost} balance={dashboard.balance} />
      </article>;
    })}</div>}
    {pending.length > 1 && <p className="helper-text">所有愿望共用当前的 {dashboard.balance} 枚贴纸；兑换一份后，其他愿望的进度会一起更新。</p>}
    {fulfilled.length > 0 && <details className="reward-fulfilled" open><summary>已经实现的愿望 <span>{fulfilled.length}</span></summary><div>{fulfilled.map(item => {
      const { completed } = rewardWishProgress(item,dashboard.balance,dashboard.redemptions);
      return <article key={item.id}><span aria-hidden="true">{item.icon}</span><div><strong>{completed!.title_snapshot}</strong><small>{formatRewardDate(completed!.local_date)} · 用 {completed!.sticker_cost} 枚贴纸实现</small></div><span className="reward-wish-done">✓ 已实现</span></article>;
    })}</div></details>}
    {legacy.length > 0 && <details className="reward-fulfilled reward-legacy"><summary>以前的共用礼物 <span>{legacy.length}</span></summary><p className="helper-text">原有礼物保留原来的规则，可以多次兑换；新添加的愿望只属于当前孩子。</p><div className="reward-gift-grid">{legacy.map(item => <article className="reward-gift-card" key={item.id}><span className="reward-gift-icon" aria-hidden="true">{item.icon}</span><div><h3>{item.title}</h3><strong>{item.sticker_cost} 枚贴纸</strong></div><RewardRedeemButton learnerId={learnerId} itemId={item.id} title={item.title} cost={item.sticker_cost} balance={dashboard.balance} /></article>)}</div></details>}
  </section>;
}
