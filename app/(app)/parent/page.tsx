import Link from "next/link";
import { Suspense } from "react";
import { createLearner, importCharacters, importPoems, signOut } from "@/lib/actions";
import { DeleteLearnerForm } from "@/components/delete-learner-form";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { loadLearnerDashboard } from "@/lib/dashboard";
import { CatechismImportForm } from "@/components/catechism-import-form";
import { FeedbackForm } from "@/components/feedback-form";
import { LearnerOptions, orderLearners } from "@/components/learner-options";
import { loadAccountModules } from "@/lib/module-access";
import { CHILD_MODULES } from "@/lib/module-keys";
import { LearnerSettingsEditor } from "@/components/learner-settings-editor";
import { PinyinParentPanel } from "@/components/pinyin-parent-panel";
import { HanziTermStatus } from "@/components/hanzi-term-status";
import { loadHanziTermSnapshot } from "@/lib/hanzi-term-data";

export const dynamic = "force-dynamic";

export default async function ParentPage({ searchParams }: { searchParams: Promise<{ learner?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const access = await loadAccessContext(supabase, user.id);
  if (!access) return null;
  const enabled = new Set(await loadAccountModules(supabase, access, user.id));
  const hasChildModule = CHILD_MODULES.some((key) => enabled.has(key));
  const { data: rawLearners } = await supabase.from("learner_profiles")
    .select("id,parent_user_id,display_name,daily_new_limit,catechism_daily_new_limit,catechism_review_limit,hanzi_review_mode,hanzi_base_review_limit,hanzi_max_review_limit,active_package_id,timezone,family_id,families(name)").eq("family_id", access?.familyId ?? "00000000-0000-0000-0000-000000000000")
    .order("created_at");
  const learners = orderLearners(rawLearners, access.familyId);
  const hasLearners = Boolean(learners?.length);
  const selectedLearner = learners?.find((learner) => learner.id === params.learner) ?? learners?.[0];
  const settingsLearners = learners;
  const [dashboard, termSnapshot] = await Promise.all([
    selectedLearner ? loadLearnerDashboard(supabase, selectedLearner.id) : Promise.resolve(null),
    selectedLearner ? loadHanziTermSnapshot(supabase,selectedLearner.id) : Promise.resolve(null),
  ]);
  const canStudyHanzi = Boolean(termSnapshot && !termSnapshot.error && termSnapshot.canStudy);

  return (
    <div>
      <header className="hero"><p className="eyebrow">Parent desk</p><h1>把节奏交给系统。</h1><p className="lede">孩子只要学习；导入、查看进度和调整每日量由家长在这里完成。</p></header>
      {access.isAdmin && <p className="notice">这里专注你自己的家庭。其他家庭的概况、资源和有效期，请到 <Link href="/admin/families">管理中心 · 家庭与孩子 →</Link></p>}
      {(learners?.length ?? 0) > 1 && <form action="/parent" className="learner-switch"><label>查看哪位孩子？<select name="learner" defaultValue={selectedLearner?.id}><LearnerOptions learners={learners} /></select></label><button className="secondary">切换</button></form>}
      {!hasChildModule && <section className="panel"><h2>暂未开通孩子学习模块</h2><p>请联系 owner 开通所需模块；父母英语或运动打卡可以从上方模块菜单进入。</p></section>}
      {selectedLearner && <HanziTermStatus db={supabase} learnerId={selectedLearner.id} />}
      {selectedLearner && <section className="today-card">
        <p className="eyebrow">{selectedLearner ? `${selectedLearner.display_name} 的学习概览` : "学习概览"}</p>
        {dashboard ? <><div className="today-grid parent-dashboard-grid">
          <div className="metric"><span className="metric-label">今天已完成</span><span className="metric-value">{dashboard.todayAnswered}</span><small>还有 {dashboard.todayRemaining} 个字</small></div>
          <div className="metric"><span className="metric-label">稳定认识</span><span className="metric-value">{dashboard.stable}</span><small>其中熟练 {dashboard.mastered}</small></div>
          <div className="metric"><span className="metric-label">当前到期</span><span className="metric-value">{dashboard.due}</span><small>系统会按能力调整</small></div>
          <div className="metric"><span className="metric-label">7 天独立首答</span><span className="metric-value">{dashboard.firstAttemptRate === null ? "—" : `${dashboard.firstAttemptRate}%`}</span><small>{dashboard.firstAttemptCount} 次有效样本</small></div>
        </div><div className="dashboard-module-strip"><span>汉字册 {dashboard.assignedPackages}</span><span>诗词册 {dashboard.assignedPoemCollections}</span><span>音乐 {dashboard.assignedMusicItems}（到期 {dashboard.musicDue}）</span><span>问答册 {dashboard.assignedCatechismCollections}（到期 {dashboard.catechismDue}）</span></div></> : <p className="notice">创建孩子档案后，这里会显示真实学习概况。</p>}
        <p className="small muted">首答率只统计最近 7 天每个字的第一次独立回答，不把同日反复确认当成成绩，更能反映真实记忆。</p>
      </section>}

      {selectedLearner && <Suspense fallback={<section className="panel"><p className="muted">正在读取拼音学习概况…</p></section>}><PinyinParentPanel supabase={supabase} learnerId={selectedLearner.id} learnerName={selectedLearner.display_name} timezone={selectedLearner.timezone ?? "Asia/Shanghai"} readOnly={!canStudyHanzi} /></Suspense>}

      {hasChildModule && <section className="panel">
        <h2>已有孩子 · 学习设置</h2>
        {hasLearners ? <div className="child-settings-list">{settingsLearners.map((learner) => (
          <article key={learner.id}>
            <LearnerSettingsEditor key={JSON.stringify(learner)} learner={learner} />
            {learner.active_package_id && <Link className="text-button" href={`/library?learner=${learner.id}`}>查看 / 标重点 {learner.display_name} 的字库</Link>}
            {learner.parent_user_id === user.id && <DeleteLearnerForm learnerId={learner.id} learnerName={learner.display_name} hasActivePackage={Boolean(learner.active_package_id)} />}
          </article>
        ))}</div> : <p className="notice">还没有孩子档案；请先在下方创建，再导入汉字。</p>}
      </section>}

      {hasChildModule && <section className="panel">
        <h2>创建新的孩子档案</h2>
        <p className="small muted">只有新增孩子时才填写这里；已有孩子请在上方直接调整昵称和每日新字数。20–50 个适合刚开始时快速筛查已认识的字，完成一轮后建议调回 8–10 个。注意：每个新字当天还会有一次强化确认，因此 50 个新字最多可能形成约 100 次卡片回答。</p>
        <FeedbackForm action={createLearner} className="form-grid" style={{ marginTop: 18 }} resetOnSuccess pendingLabel="正在创建孩子档案…" successMessage="孩子档案已创建，可以在上方查看和调整设置。">
          <label>孩子昵称<input name="display_name" required maxLength={24} placeholder="例如：小满" /></label>
          <label>每天新字数量<select name="daily_new_limit" defaultValue="5"><option value="3">3 个（慢一点）</option><option value="5">5 个（推荐）</option><option value="8">8 个（快一些）</option><option value="10">10 个（稳定学习）</option><option value="20">20 个（冲刺筛查）</option><option value="30">30 个（冲刺筛查）</option><option value="40">40 个（快速摸底）</option><option value="50">50 个（快速摸底）</option></select></label>
          <label>要理问答 · 每天新问题<input name="catechism_daily_new_limit" type="number" min="1" max="20" step="1" defaultValue="3" /></label>
          <label>要理问答 · 每天复习上限<input name="catechism_review_limit" type="number" min="1" max="50" step="1" defaultValue="10" /></label>
          <button className="secondary" type="submit">创建孩子档案</button>
        </FeedbackForm>
      </section>}

      {enabled.has("hanzi") && <section className="panel">
        <h2>导入字册</h2>
        {!access.isAdmin && <p className="notice">家长导入后会先进入“待审核”；管理员检查并分配后，才会进入孩子的学习队列。</p>}
        <p className="notice">必填：汉字、拼音（带声调）、释义；可选：词语1、词语2、例句、顺序。模板里有逐列说明；上传后如有问题会列出具体行号，并且不会导入任何内容。</p>
        <div className="template-download"><span>先下载模板，用 Excel/WPS 填好后另存为 CSV 上传。</span><a className="text-button" href="/api/templates/characters" download>下载汉字导入模板</a></div>
        {hasLearners ? <FeedbackForm action={importCharacters} className="form-grid" style={{ marginTop: 16 }} clearFileOnSuccess pendingLabel="正在校验并导入汉字，请稍候…" confirm={{ title: "确认导入这份字册？", description: access.isAdmin ? "核对文件与孩子后再确认，已有学习记录会保留。" : "确认后将提交给管理员审核。" }}>
          <label>这份字册导入给哪位孩子<select name="learner_id" required defaultValue={learners?.[0]?.id}><LearnerOptions learners={learners} label={(learner) => `${learner.display_name} · 每天新字 ${(learner as { daily_new_limit?: number }).daily_new_limit ?? "-"} 个`} /></select></label>
          <label>学习包名称<input name="package_title" defaultValue="学前汉字" required /></label>
          <label>CSV 文件<input name="csv_file" type="file" accept=".csv,text/csv" required /></label>
          <p className="small muted">{access.isAdmin ? "导入后会直接分配给所选孩子，并与他已有的字册叠加；其他孩子和原有学习记录不变。" : "导入后先等待审核，管理员会看到你建议分配的孩子；审核前不会进入学习队列。"}</p>
          <button className="primary" type="submit">校验并导入</button>
        </FeedbackForm> : <p className="muted">创建孩子档案后可以导入。</p>}
      </section>}

      {enabled.has("poem") && <section className="panel">
        <h2>导入诗词册</h2>
        {!access.isAdmin && <p className="notice">这份诗词册会提交给管理员审核，不会立即分配。</p>}
        <p className="notice">必填：标题、作者、正文；可选：编号、朝代、顺序。编号可以留空，系统会自动生成并识别重复的诗；已有正文不会被覆盖，孩子原有打卡记录始终保留。</p>
        <div className="template-download"><span>正文每句换一行（单元格内 Alt+Enter），或用 \n 分隔。</span><a className="text-button" href="/api/templates/poems" download>下载诗词导入模板</a></div>
        {hasLearners ? <FeedbackForm action={importPoems} className="form-grid" style={{ marginTop: 16 }} clearFileOnSuccess pendingLabel="正在校验并导入诗词，请稍候…" confirm={{ title: "确认导入这份诗词册？", description: access.isAdmin ? "核对文件与孩子后再确认，已有背诵记录会保留。" : "确认后将提交给管理员审核。" }}>
          <label>这份诗词册导入给哪位孩子<select name="learner_id" required defaultValue={learners?.[0]?.id}><LearnerOptions learners={learners} /></select></label>
          <label>诗词册名称<input name="poem_collection_title" defaultValue="第一批古诗词（28首）" required maxLength={80} /></label>
          <label>CSV 文件<input name="poem_csv_file" type="file" accept=".csv,text/csv" required /></label>
          <p className="small muted">新增内容会保留为来源诗词册，并叠加显示在“诗词背诵”中；完全相同的内容会识别为已导入，已有打卡记录保留。</p>
          <button className="primary" type="submit">校验并导入诗词</button>
        </FeedbackForm> : <p className="muted">创建孩子档案后可以导入。</p>}
      </section>}

      {enabled.has("catechism") && <section className="panel">
        <h2>要理问答</h2>
        <p className="notice">支持中英文问题与答案、CSV 多批次导入、按孩子分配、答错降级和间隔复习。先运行 <code>supabase/010_catechism_learning_mvp.sql</code>。</p>
        <div className="template-download"><span>模板里有逐列说明，有错误会列出行号并拒绝导入。</span><a className="text-button" href="/api/templates/catechism" download>下载要理问答导入模板</a></div>
        {access.isAdmin ? <Link className="primary full" style={{ display: "grid", placeItems: "center", marginTop: 16 }} href="/catechism/manage">导入和管理问答册</Link> : hasLearners ? <><p className="notice">导入后会保留建议分配的孩子，并等待管理员审核。</p><CatechismImportForm learners={learners ?? []} /></> : <p className="notice">请先创建孩子档案。</p>}
      </section>}

      {enabled.has("hanzi") && <section className="panel">
        <h2>小芽贴纸与礼物</h2>
        <p className="notice">完成当天汉字任务会自动得到 1 枚贴纸；诗词和音乐积累成长星。线下数学、礼物清单和兑换由家长在奖励管理页处理。首次使用前请运行 <code>supabase/012_reward_sticker_module.sql</code>。</p>
        <Link className="primary full" style={{ display: "grid", placeItems: "center", marginTop: 16 }} href="/rewards/manage">管理贴纸和礼物</Link>
      </section>}

      {hasChildModule && <section className="panel">
        <h2>下一步</h2>
        <div className="list"><div className="list-row"><span>1. 下载汉字模板，先导入少量字试跑。</span><a className="text-button" href="/api/templates/characters" download>下载</a></div><div className="list-row"><span>2. 在 iPhone 打开“学一学”，完成一轮真实测试。</span><a className="text-button" href="/learn">开始</a></div><div className="list-row"><span>3. 导入诗词后，每背一次就在“诗词背诵”打一次卡。</span><Link className="text-button" href="/poems">去背诵</Link></div><div className="list-row"><span>4. 创建歌曲、辨音和节奏练习，并上传 MP3 与琴谱。</span><Link className="text-button" href="/music/manage">管理音乐</Link></div><div className="list-row"><span>5. 导入要理问答，开始中英双语记忆。</span><Link className="text-button" href="/catechism/manage">管理问答</Link></div><div className="list-row"><span>6. 加入第一份礼物，并测试贴纸获得、兑换和撤销。</span><Link className="text-button" href="/rewards/manage">管理奖励</Link></div></div>
        <form action={signOut} style={{ marginTop: 18 }}><button className="text-button danger" type="submit">退出家长账号</button></form>
      </section>}
    </div>
  );
}
