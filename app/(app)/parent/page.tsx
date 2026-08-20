import Link from "next/link";
import { createLearner, importCharacters, importPoems, signOut, updateLearnerSettings } from "@/lib/actions";
import { DeleteLearnerForm } from "@/components/delete-learner-form";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { loadLearnerDashboard } from "@/lib/dashboard";
import { CatechismImportForm } from "@/components/catechism-import-form";

export const dynamic = "force-dynamic";

export default async function ParentPage({ searchParams }: { searchParams: Promise<{ learner?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const access = await loadAccessContext(supabase, user.id);
  if (!access) return null;
  const { data: learners } = await supabase.from("learner_profiles")
    .select("id,parent_user_id,display_name,daily_new_limit,catechism_daily_new_limit,catechism_review_limit,hanzi_review_mode,hanzi_base_review_limit,hanzi_max_review_limit,active_package_id,timezone")
    .order("created_at");
  const hasLearners = Boolean(learners?.length);
  const selectedLearner = learners?.find((learner) => learner.id === params.learner) ?? learners?.[0];
  const dashboard = selectedLearner ? await loadLearnerDashboard(supabase, selectedLearner.id, selectedLearner.timezone) : null;

  return (
    <div>
      <header className="hero"><p className="eyebrow">Parent desk</p><h1>把节奏交给系统。</h1><p className="lede">孩子只要学习；导入、查看进度和调整每日量由家长在这里完成。</p></header>
      {(learners?.length ?? 0) > 1 && <form action="/parent" className="learner-switch"><label>查看哪位孩子？<select name="learner" defaultValue={selectedLearner?.id}>{learners?.map((learner) => <option key={learner.id} value={learner.id}>{learner.display_name}</option>)}</select></label><button className="secondary">切换</button></form>}
      <section className="today-card">
        <p className="eyebrow">{selectedLearner ? `${selectedLearner.display_name} 的学习概览` : "学习概览"}</p>
        {dashboard ? <><div className="today-grid parent-dashboard-grid">
          <div className="metric"><span className="metric-label">今天已完成</span><span className="metric-value">{dashboard.todayAnswered}</span><small>还有 {dashboard.todayRemaining} 个字</small></div>
          <div className="metric"><span className="metric-label">稳定认识</span><span className="metric-value">{dashboard.stable}</span><small>其中熟练 {dashboard.mastered}</small></div>
          <div className="metric"><span className="metric-label">当前到期</span><span className="metric-value">{dashboard.due}</span><small>系统会按能力调整</small></div>
          <div className="metric"><span className="metric-label">7 天独立首答</span><span className="metric-value">{dashboard.firstAttemptRate === null ? "—" : `${dashboard.firstAttemptRate}%`}</span><small>{dashboard.firstAttemptCount} 次有效样本</small></div>
        </div><div className="dashboard-module-strip"><span>汉字册 {dashboard.assignedPackages}</span><span>诗词册 {dashboard.assignedPoemCollections}</span><span>音乐 {dashboard.assignedMusicItems}（到期 {dashboard.musicDue}）</span><span>问答册 {dashboard.assignedCatechismCollections}（到期 {dashboard.catechismDue}）</span></div></> : <p className="notice">创建孩子档案后，这里会显示真实学习概况。</p>}
        <p className="small muted">首答率只统计最近 7 天每个字的第一次独立回答，不把同日反复确认当成成绩，更能反映真实记忆。</p>
      </section>

      <section className="panel">
        <h2>已有孩子 · 学习设置</h2>
        {hasLearners ? <div className="child-settings-list">{learners?.map((learner) => (
          <form action={updateLearnerSettings} className="child-settings" key={learner.id}>
            <input type="hidden" name="learner_id" value={learner.id} />
            <div className="child-settings-head"><span className="child-sprout" aria-hidden="true">🌱</span><span><strong>{learner.display_name}</strong><small>{learner.active_package_id ? "已有学习包" : "尚未导入字册"}</small></span></div>
            <div className="settings-fields">
              <label>孩子昵称<input name="display_name" defaultValue={learner.display_name} required maxLength={24} /></label>
              <label>每天新字数量<select name="daily_new_limit" defaultValue={String(learner.daily_new_limit)}><option value="1">1 个（轻松）</option><option value="3">3 个（慢一点）</option><option value="5">5 个（推荐）</option><option value="8">8 个（快一些）</option><option value="10">10 个（稳定学习）</option><option value="20">20 个（冲刺筛查）</option><option value="30">30 个（冲刺筛查）</option><option value="40">40 个（快速摸底）</option><option value="50">50 个（快速摸底）</option></select><span className="field-note">保存后，今天已经生成的学习卡不变；明天会自动按新数量排入新字。</span></label>
              <label>信仰问答 · 每天新问题<input name="catechism_daily_new_limit" type="number" min="1" max="20" step="1" defaultValue={learner.catechism_daily_new_limit} /><span className="field-note">可填 1–20，默认 3。新的数量立即用于下一次打开“问一问”；已经练过的问题不会重新算作新问题。</span></label>
              <label>信仰问答 · 每天到期复习上限<input name="catechism_review_limit" type="number" min="1" max="50" step="1" defaultValue={learner.catechism_review_limit} /><span className="field-note">可填 1–50，默认 10；优先安排上次还不会、已经到期或阶段较低的问题。</span></label>
              <label>汉字复习节奏<select name="hanzi_review_mode" defaultValue={learner.hanzi_review_mode ?? "adaptive"}><option value="adaptive">智能调整（推荐）</option><option value="fixed">固定上限</option></select><span className="field-note">智能模式会根据到期积压和 7 天首答率调整第二天的复习量与新字量。</span></label>
              <label>基础复习量<input name="hanzi_base_review_limit" type="number" min="5" max="40" defaultValue={learner.hanzi_base_review_limit ?? 15} /></label>
              <label>每日复习安全上限<input name="hanzi_max_review_limit" type="number" min="5" max="50" defaultValue={learner.hanzi_max_review_limit ?? 25} /><span className="field-note">不建议超过 30。超过上限的到期字会按逾期程度和记忆阶段逐日消化。</span></label>
            </div>
            <button className="secondary" type="submit">保存 {learner.display_name} 的设置</button>
            {learner.active_package_id && <a className="text-button" href={`/library?learner=${learner.id}`}>{access.isAdmin ? "查看 / 修正" : "查看 / 标重点"} {learner.display_name} 的字库</a>}
            {learner.parent_user_id === user.id && <DeleteLearnerForm learnerId={learner.id} learnerName={learner.display_name} hasActivePackage={Boolean(learner.active_package_id)} />}
          </form>
        ))}</div> : <p className="notice">还没有孩子档案；请先在下方创建，再导入汉字。</p>}
      </section>

      <section className="panel">
        <h2>创建新的孩子档案</h2>
        <p className="small muted">只有新增孩子时才填写这里；已有孩子请在上方直接调整昵称和每日新字数。20–50 个适合刚开始时快速筛查已认识的字，完成一轮后建议调回 8–10 个。注意：每个新字当天还会有一次强化确认，因此 50 个新字最多可能形成约 100 次卡片回答。</p>
        <form action={createLearner} className="form-grid" style={{ marginTop: 18 }}>
          <label>孩子昵称<input name="display_name" required maxLength={24} placeholder="例如：小满" /></label>
          <label>每天新字数量<select name="daily_new_limit" defaultValue="5"><option value="3">3 个（慢一点）</option><option value="5">5 个（推荐）</option><option value="8">8 个（快一些）</option><option value="10">10 个（稳定学习）</option><option value="20">20 个（冲刺筛查）</option><option value="30">30 个（冲刺筛查）</option><option value="40">40 个（快速摸底）</option><option value="50">50 个（快速摸底）</option></select></label>
          <label>信仰问答 · 每天新问题<input name="catechism_daily_new_limit" type="number" min="1" max="20" step="1" defaultValue="3" /></label>
          <label>信仰问答 · 每天复习上限<input name="catechism_review_limit" type="number" min="1" max="50" step="1" defaultValue="10" /></label>
          <button className="secondary" type="submit">创建孩子档案</button>
        </form>
      </section>

      <section className="panel">
        <h2>导入字册</h2>
        {!access.isAdmin && <p className="notice">家长导入后会先进入“待审核”；管理员检查并分配后，才会进入孩子的学习队列。</p>}
        <p className="notice">CSV 必填列：<code>character,pinyin_marked,meaning</code>。可选列：<code>word_1,word_2,example_sentence,sequence</code>。先用 samples 里的 30 字试跑。</p>
        {hasLearners ? <form action={importCharacters} className="form-grid" style={{ marginTop: 16 }}>
          <label>这份字册导入给哪位孩子<select name="learner_id" required defaultValue={learners?.[0]?.id}>{learners?.map((learner) => <option key={learner.id} value={learner.id}>{learner.display_name} · 每天新字 {learner.daily_new_limit} 个</option>)}</select></label>
          <label>学习包名称<input name="package_title" defaultValue="学前汉字" required /></label>
          <label>CSV 文件<input name="csv_file" type="file" accept=".csv,text/csv" required /></label>
          <p className="small muted">{access.isAdmin ? "导入后会直接分配给所选孩子，并与他已有的字册叠加；其他孩子和原有学习记录不变。" : "导入后先等待审核，管理员会看到你建议分配的孩子；审核前不会进入学习队列。"}</p>
          <button className="primary" type="submit">校验并导入</button>
        </form> : <p className="muted">创建孩子档案后可以导入。</p>}
      </section>

      <section className="panel">
        <h2>导入诗词册</h2>
        {!access.isAdmin && <p className="notice">这份诗词册会提交给管理员审核，不会立即分配。</p>}
        <p className="notice">CSV 必填列：<code>poem_key,title,author,content</code>。可选列：<code>dynasty,sequence</code>。<code>poem_key</code> 是空间内的稳定编号；重复编号会复用已有正文，避免家长导入覆盖公共内容，孩子原有打卡记录始终保留。</p>
        <div className="template-download"><span>先下载模板，填好第一批 28 首后再上传。</span><a className="text-button" href="/samples/poems-template.csv" download>下载诗词 CSV 模板</a></div>
        {hasLearners ? <form action={importPoems} className="form-grid" style={{ marginTop: 16 }}>
          <label>这份诗词册导入给哪位孩子<select name="learner_id" required defaultValue={learners?.[0]?.id}>{learners?.map((learner) => <option key={learner.id} value={learner.id}>{learner.display_name}</option>)}</select></label>
          <label>诗词册名称<input name="poem_collection_title" defaultValue="第一批古诗词（28首）" required maxLength={80} /></label>
          <label>CSV 文件<input name="poem_csv_file" type="file" accept=".csv,text/csv" required /></label>
          <p className="small muted">每次导入都会保留为一份来源诗词册，并叠加显示在“诗词背诵”中；以后新增诗词时，孩子已打卡的诗词不会消失。</p>
          <button className="primary" type="submit">校验并导入诗词</button>
        </form> : <p className="muted">创建孩子档案后可以导入。</p>}
      </section>

      <section className="panel">
        <h2>儿童信仰问答</h2>
        <p className="notice">支持中英文问题与答案、CSV 多批次导入、按孩子分配、答错降级和间隔复习。先运行 <code>supabase/010_catechism_learning_mvp.sql</code>。</p>
        <div className="template-download"><span>下载 UTF-8 模板，准备第一批 145 问。</span><a className="text-button" href="/api/templates/catechism">下载信仰问答 CSV 模板</a></div>
        {access.isAdmin ? <Link className="primary full" style={{ display: "grid", placeItems: "center", marginTop: 16 }} href="/catechism/manage">导入和管理问答册</Link> : hasLearners ? <><p className="notice">导入后会保留建议分配的孩子，并等待管理员审核。</p><CatechismImportForm learners={learners ?? []} /></> : <p className="notice">请先创建孩子档案。</p>}
      </section>

      <section className="panel">
        <h2>小芽贴纸与礼物</h2>
        <p className="notice">完成当天汉字任务会自动得到 1 枚贴纸；诗词和音乐积累成长星。线下数学、礼物清单和兑换由家长在奖励管理页处理。首次使用前请运行 <code>supabase/012_reward_sticker_module.sql</code>。</p>
        <Link className="primary full" style={{ display: "grid", placeItems: "center", marginTop: 16 }} href="/rewards/manage">管理贴纸和礼物</Link>
      </section>

      <section className="panel">
        <h2>下一步</h2>
        <div className="list"><div className="list-row"><span>1. 下载样例 CSV，先导入 30 个字。</span><a className="text-button" href="/samples/characters-sample.csv" download>下载</a></div><div className="list-row"><span>2. 在 iPhone 打开“学一学”，完成一轮真实测试。</span><a className="text-button" href="/learn">开始</a></div><div className="list-row"><span>3. 导入诗词后，每背一次就在“诗词背诵”打一次卡。</span><Link className="text-button" href="/poems">去背诵</Link></div><div className="list-row"><span>4. 创建歌曲、辨音和节奏练习，并上传 MP3 与琴谱。</span><Link className="text-button" href="/music/manage">管理音乐</Link></div><div className="list-row"><span>5. 导入儿童信仰问答，开始中英双语记忆。</span><Link className="text-button" href="/catechism/manage">管理问答</Link></div><div className="list-row"><span>6. 加入第一份礼物，并测试贴纸获得、兑换和撤销。</span><Link className="text-button" href="/rewards/manage">管理奖励</Link></div></div>
        <form action={signOut} style={{ marginTop: 18 }}><button className="text-button danger" type="submit">退出家长账号</button></form>
      </section>
    </div>
  );
}
