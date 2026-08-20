import Link from "next/link";
import { createMusicItem, type MusicItemType } from "@/lib/music-actions";
import { musicTypeMeta } from "@/lib/music";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MusicManagePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(supabase, user.id);
  if (!access) redirect("/join");
  const itemQuery = supabase.from("music_items").select("id,item_type,title,category,status,difficulty,updated_at").order("updated_at", { ascending: false });
  if (!access.isAdmin) itemQuery.eq("created_by", user.id);
  const [{ data: items, error }, { data: assets }, { data: assignments }, { data: learners }] = await Promise.all([
    itemQuery,
    supabase.from("music_assets").select("item_id,asset_type"),
    supabase.from("learner_music_items").select("item_id,learner_id").eq("assignment_status", "active"),
    supabase.from("learner_profiles").select("id,display_name").order("created_at"),
  ]);
  if (error) return <section className="panel"><h1>音乐管理还差一步</h1><p className="lede">请先在 Supabase SQL Editor 运行音乐模块脚本。</p><p className="notice"><code>supabase/009_music_learning_mvp.sql</code></p><p className="error">{error.message}</p></section>;
  const counts = { song: 0, instrument: 0, rhythm: 0 };
  for (const item of items ?? []) counts[item.item_type as MusicItemType] += 1;
  return <div>
    <header className="hero music-manage-hero"><p className="eyebrow">Music studio</p><h1>音乐内容工作台</h1><p className="lede">{access.isAdmin ? "创建、审核前检查并维护音乐资源。" : "可创建并上传自己有权使用的资源；保存后由管理员审核和分配。"} MP3 与图片保存在私有 R2，学习记录保存在 Supabase。</p></header>
    <section className="today-card"><p className="eyebrow">当前内容</p><div className="today-grid"><div className="metric"><span className="metric-label">唱一唱</span><span className="metric-value">{counts.song}</span><small>首歌曲</small></div><div className="metric"><span className="metric-label">辨声音</span><span className="metric-value">{counts.instrument}</span><small>个辨音项</small></div><div className="metric"><span className="metric-label">打节奏</span><span className="metric-value">{counts.rhythm}</span><small>个练习</small></div></div></section>
    <section className="panel music-create-panel"><div><p className="eyebrow">新建内容</p><h2>先建资料，再上传媒体</h2><p className="library-meta">名称和类型创建后，会进入完整维护页。封面、琴谱和节奏谱都不是必填。</p></div><form action={createMusicItem} className="music-create-form"><label>内容类型<select name="item_type" defaultValue="song"><option value="song">唱一唱 · 歌曲</option><option value="instrument">辨声音 · 乐器</option><option value="rhythm">打节奏 · 节拍</option></select></label><label>名称<input name="title" required maxLength={100} placeholder="例如：小星星" /></label>{!access.isAdmin && <label>建议分配给<select name="submitted_for_learner_id" required defaultValue={learners?.[0]?.id}>{learners?.map((learner) => <option value={learner.id} key={learner.id}>{learner.display_name}</option>)}</select></label>}<button className="primary" type="submit" disabled={!access.isAdmin && !learners?.length}>创建并继续编辑</button></form></section>
    <section className="panel"><div className="library-header"><div><h2>全部音乐内容</h2><p className="library-meta">共 {items?.length ?? 0} 条。草稿不会出现在孩子页面。</p></div><Link className="text-button" href="/music">查看孩子页面</Link></div>
      {!items?.length ? <div className="empty"><span className="empty-mark">♪</span><p className="lede">还没有音乐内容，从上面创建第一首歌曲。</p></div> : <div className="music-admin-list">{items.map((item) => {
        const meta = musicTypeMeta[item.item_type as MusicItemType];
        const itemAssets = (assets ?? []).filter((asset) => asset.item_id === item.id);
        const childCount = new Set((assignments ?? []).filter((assignment) => assignment.item_id === item.id).map((assignment) => assignment.learner_id)).size;
        return <Link className="music-admin-row" href={`/music/manage/${item.id}`} key={item.id}><span className={`music-type-mark ${item.item_type}`}>{meta.mark}</span><span className="music-admin-title"><strong>{item.title}</strong><small>{meta.label}{item.category ? ` · ${item.category}` : ""}</small></span><span className="music-admin-meta">{itemAssets.length} 个媒体<br />分配 {childCount} 位孩子</span><span className={`music-publish-badge ${item.status}`}>{item.status === "published" ? "已发布" : item.status === "archived" ? "已归档" : "草稿"}</span></Link>;
      })}</div>}
    </section>
  </div>;
}
