import { createLearner, importCharacters, signOut, updateLearnerSettings } from "@/lib/actions";
import { DeleteLearnerForm } from "@/components/delete-learner-form";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ParentPage() {
  const supabase = await createClient();
  const [{ data: learners }, { data: states }, { data: attempts }] = await Promise.all([
    supabase.from("learner_profiles").select("id,display_name,daily_new_limit,active_package_id").order("created_at"),
    supabase.from("learning_states").select("learner_id,stage,due_at"),
    supabase.from("learning_attempts").select("learner_id,result,answered_at").order("answered_at", { ascending: false }).limit(60),
  ]);
  const hasLearners = Boolean(learners?.length);
  const known = states?.filter((state) => state.stage >= 5).length ?? 0;
  const unstable = states?.filter((state) => state.stage <= 2).length ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  const todayAttempts = attempts?.filter((attempt) => attempt.answered_at.startsWith(today)).length ?? 0;

  return (
    <div>
      <header className="hero"><p className="eyebrow">Parent desk</p><h1>把节奏交给系统。</h1><p className="lede">孩子只要学习；导入、查看进度和调整每日量由家长在这里完成。</p></header>
      <section className="today-card">
        <p className="eyebrow">学习概览</p>
        <div className="today-grid">
          <div className="metric"><span className="metric-label">今天已回答</span><span className="metric-value">{todayAttempts}</span></div>
          <div className="metric"><span className="metric-label">稳定认识</span><span className="metric-value">{known}</span></div>
          <div className="metric"><span className="metric-label">需要多见面</span><span className="metric-value">{unstable}</span></div>
        </div>
        <p className="small muted">“需要多见面”是阶段 0–2 的字；这不是成绩，只是明天应优先安排的提示。</p>
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
            </div>
            <button className="secondary" type="submit">保存 {learner.display_name} 的设置</button>
            {learner.active_package_id && <a className="text-button" href={`/library?learner=${learner.id}`}>查看 / 修正 {learner.display_name} 的字库</a>}
            <DeleteLearnerForm learnerId={learner.id} learnerName={learner.display_name} hasActivePackage={Boolean(learner.active_package_id)} />
          </form>
        ))}</div> : <p className="notice">还没有孩子档案；请先在下方创建，再导入汉字。</p>}
      </section>

      <section className="panel">
        <h2>创建新的孩子档案</h2>
        <p className="small muted">只有新增孩子时才填写这里；已有孩子请在上方直接调整昵称和每日新字数。20–50 个适合刚开始时快速筛查已认识的字，完成一轮后建议调回 8–10 个。注意：每个新字当天还会有一次强化确认，因此 50 个新字最多可能形成约 100 次卡片回答。</p>
        <form action={createLearner} className="form-grid" style={{ marginTop: 18 }}>
          <label>孩子昵称<input name="display_name" required maxLength={24} placeholder="例如：小满" /></label>
          <label>每天新字数量<select name="daily_new_limit" defaultValue="5"><option value="3">3 个（慢一点）</option><option value="5">5 个（推荐）</option><option value="8">8 个（快一些）</option><option value="10">10 个（稳定学习）</option><option value="20">20 个（冲刺筛查）</option><option value="30">30 个（冲刺筛查）</option><option value="40">40 个（快速摸底）</option><option value="50">50 个（快速摸底）</option></select></label>
          <button className="secondary" type="submit">创建孩子档案</button>
        </form>
      </section>

      <section className="panel">
        <h2>导入字册</h2>
        <p className="notice">CSV 必填列：<code>character,pinyin_marked,meaning</code>。可选列：<code>word_1,word_2,example_sentence,sequence</code>。先用 samples 里的 30 字试跑。</p>
        {hasLearners ? <form action={importCharacters} className="form-grid" style={{ marginTop: 16 }}>
          <label>这份字册导入给哪位孩子<select name="learner_id" required defaultValue={learners?.[0]?.id}>{learners?.map((learner) => <option key={learner.id} value={learner.id}>{learner.display_name} · 每天新字 {learner.daily_new_limit} 个</option>)}</select></label>
          <label>学习包名称<input name="package_title" defaultValue="学前汉字" required /></label>
          <label>CSV 文件<input name="csv_file" type="file" accept=".csv,text/csv" required /></label>
          <p className="small muted">导入完成后，只会切换所选孩子的当前字册；其他孩子的字册和学习记录不会改变。</p>
          <button className="primary" type="submit">校验并导入</button>
        </form> : <p className="muted">创建孩子档案后可以导入。</p>}
      </section>

      <section className="panel">
        <h2>下一步</h2>
        <div className="list"><div className="list-row"><span>1. 下载样例 CSV，先导入 30 个字。</span><a className="text-button" href="/samples/characters-sample.csv" download>下载</a></div><div className="list-row"><span>2. 在 iPhone 打开“学一学”，完成一轮真实测试。</span><a className="text-button" href="/learn">开始</a></div></div>
        <form action={signOut} style={{ marginTop: 18 }}><button className="text-button danger" type="submit">退出家长账号</button></form>
      </section>
    </div>
  );
}
