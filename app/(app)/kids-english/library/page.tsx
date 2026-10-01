import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";
import { LearnerOptions, orderLearners } from "@/components/learner-options";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 24;
function currentTimestamp() { return Date.now(); }

export default async function KidsEnglishLibraryPage({ searchParams }: { searchParams: Promise<{ learner?: string; book?: string; q?: string; filter?: string; page?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const access = user ? await loadAccessContext(supabase,user.id) : null;
  if (!user || !access) return null;
  const { data: rawLearners } = await supabase.from("learner_profiles").select("id,display_name,family_id,families(name)").order("created_at");
  const { data: grants } = await supabase.from("learner_module_access").select("learner_id").eq("module_key","kids_english").eq("enabled",true);
  const allowed = new Set((grants ?? []).map((row) => row.learner_id));
  const learners = orderLearners((rawLearners ?? []).filter((row) => allowed.has(row.id)),access.familyId);
  const learner = learners.find((row) => row.id === params.learner) ?? learners[0];
  if (!learner) return <section className="panel"><h1>还没有开通儿童英语的孩子</h1></section>;
  const loaded = await (async () => {
    await requireChildModule(supabase,access,user.id,learner.id,"kids_english");
    const { data: assignments,error: assignmentError } = await supabase.from("learner_kids_english_books").select("book_id,kids_english_books!inner(id,title,status,review_status)").eq("learner_id",learner.id).eq("assignment_status","active").eq("kids_english_books.status","published").eq("kids_english_books.review_status","approved");
    if (assignmentError) throw new Error(assignmentError.message);
    const books = (assignments ?? []).map((item) => Array.isArray(item.kids_english_books) ? item.kids_english_books[0] : item.kids_english_books).filter((book): book is { id: string; title: string; status: string; review_status: string } => Boolean(book));
    const book = books.find((item) => item.id === params.book) ?? books[0];
    const [{ data: words,error: wordError }, { data: states,error: stateError }] = book ? await Promise.all([
      supabase.from("kids_english_words").select("id,word,phonetic,meaning_zh,example_en,sequence").eq("book_id",book.id).order("sequence").limit(500),
      supabase.from("kids_english_states").select("word_id,stage,total_attempts,known_count,again_count,due_at,last_result").eq("learner_id",learner.id),
    ]) : [{ data: [],error: null },{ data: [],error: null }];
    if (wordError || stateError) throw new Error(wordError?.message ?? stateError?.message);
    const stateByWord = new Map((states ?? []).map((state) => [state.word_id,state]));
    const query = (params.q ?? "").trim().toLowerCase().slice(0,80);
    const filter = ["all","new","learning","due","mastered"].includes(params.filter ?? "") ? params.filter! : "all";
    const now = currentTimestamp();
    const matched = (words ?? []).filter((word) => {
      const state = stateByWord.get(word.id);
      if (query && !`${word.word} ${word.meaning_zh} ${word.phonetic}`.toLowerCase().includes(query)) return false;
      if (filter === "new") return !state;
      if (filter === "learning") return Boolean(state && state.stage < 7);
      if (filter === "due") return Boolean(state?.due_at && new Date(state.due_at).getTime() <= now);
      if (filter === "mastered") return Boolean(state?.stage === 7);
      return true;
    });
    const pageCount = Math.max(1,Math.ceil(matched.length/PAGE_SIZE));
    const page = Math.min(pageCount,Math.max(1,Number.parseInt(params.page ?? "1") || 1));
    const rows = matched.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
    return { books, book, words, stateByWord, query, filter, now, matched, pageCount, page, rows };
  })().then((value) => ({ value, error: "" }), (error: unknown) => ({ value: null, error: error instanceof Error ? error.message : "读取失败" }));
  if (loaded.error || !loaded.value) return <section className="panel"><h1>单词册暂时打不开</h1><p className="error">{loaded.error}</p></section>;
  const { books, book, words, stateByWord, query, filter, now, matched, pageCount, page, rows } = loaded.value;
  function href(next: { page?: number; book?: string } = {}) { const search = new URLSearchParams({ learner: learner.id,book: next.book ?? book?.id ?? "",filter,q: query }); if (next.page && next.page>1) search.set("page",String(next.page)); return `/kids-english/library?${search}`; }
  return <div><header className="hero kids-hero"><p className="eyebrow">Word garden</p><h1>{learner.display_name} 的单词册</h1><p className="lede">每个词的练习次数、记忆阶段和复习时间都留在这里。视频是辅助记忆，认出来仍以孩子独立回答为准。</p></header>
      {learners.length>1 && <form action="/kids-english/library" className="learner-switch"><label>查看哪位孩子？<select name="learner" defaultValue={learner.id}><LearnerOptions learners={learners} /></select></label><button className="secondary">切换</button></form>}
      {!book ? <section className="panel"><h2>还没有分配单词册</h2><p>管理员审核并分配后，单词会出现在这里。</p>{access.isAdmin && <Link className="primary" href="/admin/assignments?module=kids_english">去分配</Link>}</section> : <section className="panel"><div className="library-header"><div><h2>{book.title}</h2><p className="library-meta">共 {words?.length ?? 0} 个词 · 当前筛选 {matched.length} 个 · 每页 {PAGE_SIZE} 个</p></div><Link className="text-button" href={`/kids-english?learner=${learner.id}`}>开始学习 →</Link></div>
        <nav className="kids-book-tabs">{books.map((item) => <Link key={item.id} href={href({ book: item.id })} className={item.id===book.id?"active":""}>{item.title}</Link>)}</nav>
        <form className="kids-library-filters" action="/kids-english/library"><input type="hidden" name="learner" value={learner.id}/><input type="hidden" name="book" value={book.id}/><label>搜索单词<input name="q" defaultValue={query} placeholder="英文、音标或中文" /></label><label>学习状态<select name="filter" defaultValue={filter}><option value="all">全部</option><option value="new">还没学</option><option value="learning">学习中</option><option value="due">已到期</option><option value="mastered">稳定掌握</option></select></label><button className="secondary">筛选</button></form>
        <div className="kids-library-list">{rows.map((word) => { const state=stateByWord.get(word.id);return <article key={word.id}><div><strong lang="en">{word.word}</strong><small lang="en">{word.phonetic}</small></div><p>{word.meaning_zh}</p><span className="kids-stage">{!state ? "未开始" : state.stage===7 ? "稳定掌握" : state.due_at && new Date(state.due_at).getTime()<=now ? "待复习" : `阶段 ${state.stage}`}</span><small>练习 {state?.total_attempts ?? 0} 次 · 认出 {state?.known_count ?? 0} · 再学 {state?.again_count ?? 0}</small></article>; })}</div>
        {!rows.length && <p className="notice">当前条件下没有单词。</p>}
        <nav className="library-pagination" aria-label="单词册分页"><Link className="secondary" aria-disabled={page===1} href={href({ page: Math.max(1,page-1) })}>上一页</Link><span>第 {page} / {pageCount} 页</span><Link className="secondary" aria-disabled={page===pageCount} href={href({ page: Math.min(pageCount,page+1) })}>下一页</Link></nav>
      </section>}
    </div>;
}
