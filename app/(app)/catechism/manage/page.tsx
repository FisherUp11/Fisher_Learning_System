import Link from "next/link";
import { CatechismCollectionForm } from "@/components/catechism-collection-form";
import { CatechismImportForm } from "@/components/catechism-import-form";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type SearchParams = Promise<{ collection?: string; q?: string; page?: string }>;
const PAGE_SIZE = 30;

function safePage(value: string | undefined) {
  const page = Number(value ?? 1);
  return Number.isInteger(page) ? Math.max(1, Math.min(100000, page)) : 1;
}

function manageHref(collectionId: string | undefined, query: string, page = 1) {
  const params = new URLSearchParams();
  if (collectionId) params.set("collection", collectionId);
  if (query) params.set("q", query);
  if (page > 1) params.set("page", String(page));
  return `/catechism/manage${params.size ? `?${params.toString()}` : ""}`;
}

export default async function CatechismManagePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const [{ data: learners }, { data: collections, error: collectionError }, { data: items, error: itemError }, { data: links }] = await Promise.all([
    supabase.from("learner_profiles").select("id,display_name").order("created_at"),
    supabase.from("catechism_collections").select("id,title,english_title,source_note,license_note,status,created_at").order("created_at", { ascending: false }),
    supabase.from("catechism_items").select("id,collection_id,item_key,sort_order,question_zh,question_en,status").order("sort_order"),
    supabase.from("learner_catechism_collections").select("learner_id,collection_id"),
  ]);
  if (collectionError || itemError) return <section className="panel"><h1>管理页还差数据库脚本</h1><p className="lede">请在 Supabase SQL Editor 整段运行下面的文件，然后刷新。</p><p className="notice"><code>supabase/010_catechism_learning_mvp.sql</code></p><p className="error">{collectionError?.message ?? itemError?.message}</p></section>;
  const collectionRows = collections ?? [];
  const itemRows = items ?? [];
  const selectedCollection = collectionRows.find((row) => row.id === params.collection);
  const query = (params.q ?? "").trim().slice(0, 100);
  const filtered = itemRows.filter((item) => (!selectedCollection || item.collection_id === selectedCollection.id) && (!query || `${item.sort_order} ${item.item_key} ${item.question_zh} ${item.question_en ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(safePage(params.page), pageCount);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const learnerNameById = new Map((learners ?? []).map((learner) => [learner.id, learner.display_name]));

  return <div>
    <header className="hero catechism-manage-hero"><p className="eyebrow">Parent · Catechism</p><h1>导入和管理问答册</h1><p className="lede">内容与学习记录彼此独立。修正中英文文字不会清除孩子的练习次数；暂时不用的问题请归档。</p></header>
    <section className="panel catechism-import-panel">
      <div className="section-heading"><div><h2>导入新的问答册</h2><p className="library-meta">第一批可导入 145 问；以后每次导入都会建立新的来源问答册。</p></div><a className="secondary template-button" href="/api/templates/catechism">下载 CSV 模板</a></div>
      <p className="notice">必填：<code>item_key,sequence,question_zh,question_en,answer_zh,answer_en</code>。系统不会自动翻译或改写获授权的要理文本。</p>
      {learners?.length ? <CatechismImportForm learners={learners} /> : <p className="notice">请先在家长页创建孩子档案。</p>}
    </section>
    {collectionRows.length > 0 && <section className="panel">
      <h2>已有问答册</h2>
      <div className="catechism-collection-grid">{collectionRows.map((collection) => {
        const assignedIds = (links ?? []).filter((link) => link.collection_id === collection.id).map((link) => link.learner_id);
        const count = itemRows.filter((item) => item.collection_id === collection.id).length;
        return <details className="catechism-collection-card" key={collection.id}><summary><span className="catechism-seal">册</span><span><strong>{collection.title}</strong><small lang="en">{collection.english_title ?? ""}</small><em>{count} 问 · {assignedIds.map((id) => learnerNameById.get(id)).filter(Boolean).join("、") || "未分配孩子"}</em></span><span className={`music-publish-badge ${collection.status}`}>{collection.status === "published" ? "已发布" : collection.status === "draft" ? "草稿" : "已归档"}</span></summary><CatechismCollectionForm collection={collection} learners={learners ?? []} assignedLearnerIds={assignedIds} /></details>;
      })}</div>
    </section>}
    <section className="panel">
      <div className="library-header"><div><h2>逐条检查与修正</h2><p className="library-meta">共 {itemRows.length} 问 · 筛选到 {filtered.length} 问 · 每页 {PAGE_SIZE} 问</p></div><Link className="text-button" href="/catechism">返回孩子问答册</Link></div>
      <form action="/catechism/manage" method="get" className="catechism-manage-filters"><label>搜索问题<input name="q" defaultValue={query} placeholder="编号、中英文问题" /></label><label>问答册<select name="collection" defaultValue={selectedCollection?.id ?? ""}><option value="">全部问答册</option>{collectionRows.map((collection) => <option key={collection.id} value={collection.id}>{collection.title}</option>)}</select></label><button className="secondary" type="submit">筛选</button></form>
      {rows.length ? <div className="catechism-admin-list">{rows.map((item) => {
        const collection = collectionRows.find((row) => row.id === item.collection_id);
        return <Link className="catechism-admin-row" href={`/catechism/manage/${item.id}`} key={item.id}><span className="catechism-number">{item.sort_order}</span><span><strong>{item.question_zh}</strong><small lang="en">{item.question_en ?? "暂无英文问题"}</small><em>{collection?.title ?? "未命名问答册"} · {item.item_key}</em></span><span className={`catechism-status ${item.status === "active" ? "learning" : "new"}`}>{item.status === "active" ? "编辑" : "已归档"}</span></Link>;
      })}</div> : <p className="notice">还没有符合条件的问题。</p>}
      <nav className="library-pagination" aria-label="管理问答分页"><Link className={`secondary ${page <= 1 ? "disabled" : ""}`} href={manageHref(selectedCollection?.id, query, Math.max(1, page - 1))}>上一页</Link><span>第 {page} / {pageCount} 页</span><Link className={`secondary ${page >= pageCount ? "disabled" : ""}`} href={manageHref(selectedCollection?.id, query, Math.min(pageCount, page + 1))}>下一页</Link></nav>
    </section>
  </div>;
}
