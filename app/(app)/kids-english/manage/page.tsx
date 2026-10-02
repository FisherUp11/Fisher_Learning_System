import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { isR2Configured } from "@/lib/r2";
import { FeedbackForm } from "@/components/feedback-form";
import { LearnerOptions, orderLearners } from "@/components/learner-options";
import { KidsEnglishVideoUpload } from "@/components/kids-english-video-upload";
import { KidsEnglishWordPicker } from "@/components/kids-english-word-picker";
import { importKidsEnglishBook, saveKidsEnglishDailyLimit, updateKidsEnglishWord } from "@/lib/kids-english-actions";
import { effectiveKidsEnglishDailySettings, localDateForTimeZone } from "@/lib/kids-english-daily";
import styles from "./daily-settings.module.css";

export const dynamic = "force-dynamic";

export default async function KidsEnglishManagePage({ searchParams }: { searchParams: Promise<{ book?: string; learner?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const access = user ? await loadAccessContext(supabase,user.id) : null;
  if (!user || !access) return null;
  const [{ data: books, error: bookError }, { data: rawLearners }, { data: videos }] = await Promise.all([
    supabase.from("kids_english_books").select("id,title,status,review_status,submitted_for_learner_id,created_at").eq("workspace_id",access.workspaceId).order("created_at",{ ascending: false }),
    supabase.from("learner_profiles").select("id,display_name,timezone,family_id,families(name)").order("created_at"),
    supabase.from("kids_english_videos").select("id,title,original_name,created_at").eq("workspace_id",access.workspaceId).order("created_at",{ ascending: false }),
  ]);
  if (bookError) return <section className="panel"><h1>请先运行儿童英语 SQL</h1><p className="error">{bookError.message}</p></section>;
  const learners = orderLearners(rawLearners,access.familyId);
  const selectedBook = (books ?? []).find((book) => book.id === params.book) ?? books?.[0];
  const { data: childGrants } = await supabase.from("learner_module_access")
    .select("learner_id").eq("module_key","kids_english").eq("enabled",true);
  const grantedIds = new Set((childGrants ?? []).map((row) => row.learner_id));
  const settingLearners = learners.filter((learner) => grantedIds.has(learner.id));
  const settingLearner = settingLearners.find((learner) => learner.id === params.learner) ?? settingLearners[0];
  const localToday = settingLearner ? localDateForTimeZone(settingLearner.timezone) : "";
  const [settingsResult, newCountResult] = settingLearner ? await Promise.all([
    supabase.from("kids_english_learning_settings")
      .select("daily_new_limit,pending_daily_new_limit,pending_effective_on")
      .eq("learner_id",settingLearner.id).maybeSingle(),
    supabase.from("kids_english_daily_items")
      .select("word_id",{count:"exact",head:true})
      .eq("learner_id",settingLearner.id).eq("local_date",localToday).eq("queue_kind","new"),
  ]) : [{data:null,error:null},{count:0,error:null}];
  const dailySettings = effectiveKidsEnglishDailySettings(settingsResult.data,localToday);
  const { data: words } = selectedBook ? await supabase.from("kids_english_words").select("id,word,phonetic,meaning_zh,example_en,example_zh,part_of_speech,sequence").eq("book_id",selectedBook.id).order("sequence").limit(500) : { data: [] };
  const { data: links } = words?.length ? await supabase.from("kids_english_word_videos").select("word_id,video_id").in("word_id",words.map((word) => word.id)) : { data: [] };
  return <div><header className="hero kids-hero"><p className="eyebrow">Parent studio</p><h1>儿童英语 · 内容工作台</h1><p className="lede">先导入单词册，再上传课堂视频；一段视频可以同时关联多个单词。孩子忘记时会在单词卡看到视频入口。</p></header>
    <section className={`panel ${styles.settingsPanel}`}>
      <div className="section-heading"><div><p className="eyebrow">Learning pace</p><h2>每天学几个新词？</h2></div><span className={styles.badge}>每个孩子单独设置</span></div>
      {!settingLearner ? <p className="notice">请先让 owner 为孩子开通儿童英语，之后家长就能调整每天的新词数量。</p> : settingsResult.error || newCountResult.error
        ? <p className="notice">学习节奏尚未准备好。请先运行 026 号 SQL；现有单词导入和学习不受影响。</p>
        : <>
          <form action="/kids-english/manage" className={styles.switcher}>
            <input type="hidden" name="book" value={selectedBook?.id ?? ""} />
            <label>设置哪位孩子？<select name="learner" defaultValue={settingLearner.id}><LearnerOptions learners={settingLearners} /></select></label>
            <button className="secondary">切换</button>
          </form>
          <div className={styles.overview}>
            <div><small>今天的目标</small><strong>{dailySettings.todayLimit}<em>个新词</em></strong></div>
            <div><small>今天已安排</small><strong>{newCountResult.count ?? 0}<em>个新词</em></strong></div>
            <div><small>明日起</small><strong>{dailySettings.upcomingLimit ?? dailySettings.todayLimit}<em>个新词</em></strong></div>
          </div>
          {dailySettings.upcomingLimit != null && <p className={styles.pending}>已预约 {dailySettings.upcomingOn} 起改为每天 {dailySettings.upcomingLimit} 个；再次保存可覆盖这项预约。</p>}
          <FeedbackForm action={saveKidsEnglishDailyLimit} className={styles.settingsForm} pendingLabel="正在保存学习节奏…" successTitle="学习节奏已更新">
            <input type="hidden" name="learner_id" value={settingLearner.id} />
            <input type="hidden" name="book_id" value={selectedBook?.id ?? ""} />
            <label className={styles.limitField}>每天新词<select name="daily_new_limit" defaultValue={dailySettings.upcomingLimit ?? dailySettings.todayLimit}>
              {[1,2,3,4,5,6,8,10,12,15,20].map((count)=><option key={count} value={count}>{count} 个</option>)}
            </select></label>
            <div className={styles.actions}>
              <button className="primary" name="effective" value="today">今天立即生效</button>
              <button className="secondary" name="effective" value="tomorrow">明天开始生效</button>
            </div>
          </FeedbackForm>
          <p className={styles.note}>立即调高只补入差额，不重复已学单词；调低也不会移除今天已经安排的卡片。到期复习仍沿用原来的上限和记忆规则。</p>
        </>}
    </section>
    <section className="panel"><div className="section-heading"><div><p className="eyebrow">01 · Words</p><h2>导入单词册</h2></div><a className="text-button" href="/api/templates/kids-english" download>下载 CSV 模板</a></div><p className="small muted">必填：单词、音标、中文意思、英文例句；可选：中文例句、词性和顺序。重复文件不会再次导入。管理员导入可直接分配，家长导入需审核。</p>
      <FeedbackForm action={importKidsEnglishBook} className="form-grid" clearFileOnSuccess pendingLabel="正在校验并导入单词…" confirm={{ title: "确认导入这份单词册？", description: "请核对孩子和 CSV；如完全相同的内容已导入，系统会阻止重复。" }} successTitle="单词册已导入"><label>单词册名称<input name="title" required maxLength={120} placeholder="例如：哈森英语课 · 形状" /></label><label>建议给哪位孩子<select name="learner_id" defaultValue=""><option value="">先不指定，稍后分配</option><LearnerOptions learners={learners} /></select></label><label>CSV 文件<input name="csv_file" type="file" accept=".csv,text/csv" required /></label><button className="primary">校验并导入</button></FeedbackForm>
    </section>
    <section className="panel"><div className="section-heading"><div><p className="eyebrow">02 · Classroom video</p><h2>上传课堂视频</h2></div></div>{access.isAdmin ? <KidsEnglishVideoUpload configured={isR2Configured()} /> : <p className="notice">请让管理员上传课堂视频。家长可以先导入单词册等待审核。</p>}
      {videos?.length ? <div className="kids-video-list">{videos.map((video) => <div key={video.id}><span aria-hidden="true">▶</span><strong>{video.title}</strong><small>{video.original_name}</small></div>)}</div> : <p className="small muted">还没有上传视频；单词仍可正常学习。</p>}
    </section>
    <section className="panel"><div className="section-heading"><div><p className="eyebrow">03 · Link</p><h2>关联视频与单词</h2></div>{access.isAdmin && <Link className="text-button" href="/admin/assignments?module=kids_english">分配给孩子</Link>}</div>
      {books?.length ? <><nav className="kids-book-tabs">{books.map((book) => <Link key={book.id} href={`/kids-english/manage?book=${book.id}`} className={book.id === selectedBook?.id ? "active" : ""}>{book.title}<small>{book.status === "published" ? "已发布" : "待审核"}</small></Link>)}</nav><p className="small muted">{selectedBook?.title} · {words?.length ?? 0} 个单词</p>{access.isAdmin && selectedBook && <KidsEnglishWordPicker bookId={selectedBook.id} words={words ?? []} videos={videos ?? []} />}
        <div className="kids-manage-word-list">{(words ?? []).map((word) => <details key={word.id}><summary><strong lang="en">{word.word}</strong><span>{word.phonetic} · {word.meaning_zh}</span><small>{(links ?? []).filter((link) => link.word_id === word.id).length} 段视频</small></summary><p lang="en">{word.example_en}</p>{access.isAdmin && <FeedbackForm action={updateKidsEnglishWord} className="form-grid compact-form" pendingLabel="正在修正单词…"><input type="hidden" name="word_id" value={word.id} /><input type="hidden" name="book_id" value={selectedBook.id} /><label>单词<input name="word" defaultValue={word.word} required /></label><label>音标<input name="phonetic" defaultValue={word.phonetic} required /></label><label>中文意思<input name="meaning_zh" defaultValue={word.meaning_zh} required /></label><label>英文例句<input name="example_en" defaultValue={word.example_en} required /></label><label>例句中文<input name="example_zh" defaultValue={word.example_zh ?? ""} /></label><label>词性<input name="part_of_speech" defaultValue={word.part_of_speech ?? ""} /></label><button className="secondary">保存修正</button></FeedbackForm>}</details>)}</div></> : <p className="notice">尚无单词册。先下载 CSV 模板并导入几组词试学。</p>}
    </section>
  </div>;
}
