import { RewardGiftForm } from "@/components/reward-gift-form";
import { RewardCatalogStatusButton } from "@/components/reward-catalog-status-button";
import { RewardRedeemButton } from "@/components/reward-redeem-button";
import { rewardWishProgress, type RewardDashboard } from "@/lib/reward-types";

export function RewardWishManager({ dashboard, learnerId, learnerName }: { dashboard: RewardDashboard; learnerId: string; learnerName: string }) {
  return <section className="panel reward-catalog-admin" id="wishes">
    <div><p className="eyebrow">给孩子的小期待</p><h2>{learnerName} 的愿望清单</h2><p className="library-meta">和孩子一起约定礼物与所需贴纸。每份新愿望只属于这个孩子，实现后会留在愿望足迹中。</p></div>
    <RewardGiftForm key={learnerId} learnerId={learnerId} learnerName={learnerName} />
    <div className="reward-admin-gifts">
      {dashboard.catalogItems.length === 0 ? <p className="notice">先加一个小愿望吧，例如 10 枚贴纸的小汽车，或 30 枚贴纸的钓鱼竿。</p> : dashboard.catalogItems.map(item => {
        const progress = rewardWishProgress(item,dashboard.balance,dashboard.redemptions);
        const label = progress.state === "fulfilled" ? "愿望已实现" : progress.state === "archived" ? "已移出" : progress.state === "ready" ? "已攒够" : `还差 ${progress.remaining} 枚`;
        return <article className={`reward-wish-admin-row ${item.status === "archived" ? "archived" : ""}`} key={item.id}>
          <span aria-hidden="true">{item.icon}</span><div><strong>{item.title}</strong><small>{item.sticker_cost} 枚贴纸 · {item.learner_id ? `${learnerName} 专属` : "旧版共用礼物"}{item.note ? ` · ${item.note}` : ""}</small></div><em>{label}</em>
          <div className="reward-wish-admin-actions"><RewardCatalogStatusButton learnerId={learnerId} itemId={item.id} status={item.status} />{["ready","saving"].includes(progress.state) && <RewardRedeemButton learnerId={learnerId} itemId={item.id} title={item.title} cost={item.sticker_cost} balance={dashboard.balance} />}</div>
          <details className="reward-wish-edit"><summary>修改名称、贴纸数与备注</summary><RewardGiftForm key={`${learnerId}:${item.id}`} learnerId={learnerId} learnerName={learnerName} item={item} /></details>
        </article>;
      })}
    </div>
    <p className="helper-text">“暂时移出”不会删除历史；误兑换请在下方撤销，贴纸会返还，愿望也会重新变为可积累。旧礼物保留原先可重复兑换的规则。</p>
  </section>;
}
