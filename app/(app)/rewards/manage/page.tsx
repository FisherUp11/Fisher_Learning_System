import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { RewardManualForm } from "@/components/reward-manual-form";
import { RewardGiftForm } from "@/components/reward-gift-form";
import { RewardCatalogStatusButton } from "@/components/reward-catalog-status-button";
import { RewardRedeemButton } from "@/components/reward-redeem-button";
import { RewardReversalButton } from "@/components/reward-reversal-button";
import { formatRewardDate, loadRewardDashboard } from "@/lib/rewards";

export const dynamic = "force-dynamic";

function todayInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export default async function RewardManagePage({ searchParams }: { searchParams: Promise<{ learner?: string }> }) {
  const supabase = await createClient();
  const query = await searchParams;
  const { data: learners, error: learnerError } = await supabase
    .from("learner_profiles")
    .select("id,display_name,timezone")
    .order("created_at");

  if (learnerError) return <section className="panel"><h1>奖励管理还没准备好</h1><p className="error">{learnerError.message}</p></section>;
  const learner = learners?.find((item) => item.id === query.learner) ?? learners?.[0];
  if (!learner) return <section className="empty panel"><h1>请先创建孩子档案</h1><Link className="primary" href="/parent">去家长页</Link></section>;

  let dashboard;
  try {
    dashboard = await loadRewardDashboard(supabase, learner.id);
  } catch (error) {
    return <section className="panel reward-setup-needed"><h1>请先运行奖励模块 SQL</h1><code>supabase/012_reward_sticker_module.sql</code><p className="error">{error instanceof Error ? error.message : "无法读取奖励数据"}</p></section>;
  }

  return (
    <div className="reward-manage-page">
      <header className="hero reward-manage-hero">
        <p className="eyebrow">PARENT · REWARDS</p>
        <h1>奖励与礼物管理</h1>
        <p className="lede">线下数学在这里补贴纸；礼物兑换会保留完整记录，误操作也可以撤销返还。</p>
      </header>

      <section className="today-card reward-admin-overview">
        <div className="section-heading"><div><p className="eyebrow">{learner.display_name}</p><h2>当前奖励概况</h2></div><Link className="text-button" href={`/rewards?learner=${learner.id}`}>查看孩子贴纸册</Link></div>
        <div className="today-grid">
          <div className="metric"><span className="metric-label">可用贴纸</span><span className="metric-value">{dashboard.balance}</span><small>枚</small></div>
          <div className="metric"><span className="metric-label">成长星进度</span><span className="metric-value">{dashboard.growthPoints}/{dashboard.growthPointsPerSticker}</span><small>每天最多 {dashboard.dailyGrowthLimit} 颗</small></div>
          <div className="metric"><span className="metric-label">累计兑换</span><span className="metric-value">{dashboard.redemptions.filter((item) => item.status === "completed").length}</span><small>份礼物</small></div>
        </div>
        {(learners?.length ?? 0) > 1 && <form action="/rewards/manage" className="learner-switch">
          <label>调整哪位孩子？
            <select name="learner" defaultValue={learner.id}>{learners?.map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select>
          </label>
          <button className="secondary" type="submit">切换</button>
        </form>}
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">手工贴纸</p><h2>记录线下努力</h2></div></div>
        <p className="library-meta">数学作业同一天只加一次；特别表扬、线下初始贴纸和修正都会留下原因与时间。</p>
        <RewardManualForm learnerId={learner.id} learnerName={learner.display_name} today={todayInTimezone(learner.timezone)} />
      </section>

      <section className="panel reward-catalog-admin">
        <div><p className="eyebrow">礼物清单</p><h2>加入一份值得期待的小礼物</h2><p className="library-meta">默认10枚贴纸兑换，也可以为不同礼物设置不同数量。</p></div>
        <RewardGiftForm />
        <div className="reward-admin-gifts">
          {dashboard.catalogItems.length === 0
            ? <p className="notice">还没有礼物。可以先加入“一本新绘本”或“周末小活动”。</p>
            : dashboard.catalogItems.map((item) => <article className={item.status === "archived" ? "archived" : ""} key={item.id}>
              <span aria-hidden="true">{item.icon}</span>
              <div><strong>{item.title}</strong><small>{item.sticker_cost} 枚{item.note ? ` · ${item.note}` : ""}</small></div>
              <em>{item.status === "active" ? "可兑换" : "已下架"}</em>
              <RewardCatalogStatusButton itemId={item.id} status={item.status} />
              {item.status === "active" && <RewardRedeemButton learnerId={learner.id} itemId={item.id} title={item.title} cost={item.sticker_cost} balance={dashboard.balance} />}
            </article>)}
        </div>
      </section>

      <section className="panel reward-redemption-history">
        <div><p className="eyebrow">兑换记录</p><h2>每一次礼物都有来处</h2></div>
        {dashboard.redemptions.length === 0
          ? <p className="notice">还没有兑换过礼物。贴纸达到需要数量后再来这里确认。</p>
          : <div>{dashboard.redemptions.map((redemption) => <article key={redemption.id}>
            <span aria-hidden="true">🎁</span>
            <div><strong>{redemption.title_snapshot}</strong><small>{formatRewardDate(redemption.local_date)} · 使用 {redemption.sticker_cost} 枚贴纸</small>{redemption.note && <p>{redemption.note}</p>}</div>
            <em className={redemption.status}>{redemption.status === "completed" ? "已兑换" : "已撤销"}</em>
            {redemption.status === "completed" && <RewardReversalButton redemptionId={redemption.id} title={redemption.title_snapshot} amount={redemption.sticker_cost} />}
          </article>)}</div>}
      </section>
    </div>
  );
}
