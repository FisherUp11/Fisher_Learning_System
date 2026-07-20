import Link from "next/link";
import { notFound } from "next/navigation";
import { CatechismItemForm } from "@/components/catechism-item-form";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Params = Promise<{ itemId: string }>;

export default async function CatechismItemEditPage({ params }: { params: Params }) {
  const { itemId } = await params;
  const supabase = await createClient();
  const { data: item, error } = await supabase.from("catechism_items").select("id,collection_id,item_key,sort_order,section_title,question_zh,question_en,answer_zh,answer_en,scripture_reference,parent_note,status").eq("id", itemId).maybeSingle();
  if (error) return <section className="panel"><h1>无法打开这条问答</h1><p className="error">{error.message}</p></section>;
  if (!item) notFound();
  const { data: collection } = await supabase.from("catechism_collections").select("title,english_title").eq("id", item.collection_id).maybeSingle();
  return <div className="catechism-editor-page">
    <Link className="back-link" href={`/catechism/manage?collection=${item.collection_id}`}>← 返回问答管理</Link>
    <header className="hero"><p className="eyebrow">第 {item.sort_order} 问 · {item.item_key}</p><h1>修正中英文问答</h1><p className="lede">{collection?.title}{collection?.english_title ? ` · ${collection.english_title}` : ""}</p></header>
    <section className="panel"><p className="notice">保存只更新文本和显示状态，不会清除任何孩子已经产生的阶段、练习次数或日期记录。已有练习的问题建议使用“归档”，不要直接从数据库删除。</p><CatechismItemForm item={item} /></section>
  </div>;
}
