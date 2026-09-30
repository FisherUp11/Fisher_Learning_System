import Link from "next/link";
import { createMusicFolder, createMusicItem, moveMusicItemsToFolder, saveMusicFolderAssignments, updateMusicFolder, type MusicItemType } from "@/lib/music-actions";
import { musicTypeMeta } from "@/lib/music";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { redirect } from "next/navigation";
import { FeedbackForm } from "@/components/feedback-form";
import { MusicBulkUpload } from "@/components/music-bulk-upload";
import { isR2Configured } from "@/lib/r2";

export const dynamic = "force-dynamic";

export default async function MusicManagePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(supabase, user.id);
  if (!access) redirect("/join");
  const { data: folders, error: folderError } = await supabase.from("music_folders").select("id,title,status").eq("workspace_id", access.workspaceId).order("title");
  const foldersReady = !folderError;
  const itemQuery = supabase.from("music_items").select(foldersReady ? "id,item_type,title,category,status,difficulty,updated_at,folder_id" : "id,item_type,title,category,status,difficulty,updated_at").order("updated_at", { ascending: false });
  if (!access.isAdmin) itemQuery.eq("created_by", user.id);
  const [{ data: rawItems, error }, { data: assets }, { data: assignments }, { data: learners }, { data: folderLinks }] = await Promise.all([
    itemQuery,
    supabase.from("music_assets").select("item_id,asset_type"),
    supabase.from("learner_music_items").select("item_id,learner_id").eq("assignment_status", "active"),
    supabase.from("learner_profiles").select("id,display_name,families(name)").order("created_at"),
    foldersReady ? supabase.from("learner_music_folders").select("folder_id,learner_id").eq("assignment_status", "active") : Promise.resolve({ data: [] as Array<{ folder_id: string; learner_id: string }> }),
  ]);
  if (error) return <section className="panel"><h1>音乐管理还差一步</h1><p className="lede">请先在 Supabase SQL Editor 运行音乐模块脚本。</p><p className="notice"><code>supabase/009_music_learning_mvp.sql</code></p><p className="error">{error.message}</p></section>;
  const items = (rawItems ?? []) as unknown as MusicRow[];
  const counts = { song: 0, instrument: 0, rhythm: 0 };
  for (const item of items) counts[item.item_type as MusicItemType] += 1;
  const activeFolders = (folders ?? []).filter((folder) => folder.status === "active");
  const familyName = (learner: { families: unknown }) => {
    const family = learner.families as { name?: string } | Array<{ name?: string }> | null;
    return (Array.isArray(family) ? family[0]?.name : family?.name) ?? "未命名家庭";
  };
  const learnerGroups = new Map<string, Array<{ id: string; display_name: string }>>();
  for (const learner of learners ?? []) learnerGroups.set(familyName(learner), [...(learnerGroups.get(familyName(learner)) ?? []), learner]);
  const groups = [
    ...(folders ?? []).map((folder) => ({ id: folder.id, title: folder.title, archived: folder.status === "archived", items: items.filter((item) => item.folder_id === folder.id) })),
    { id: "", title: foldersReady ? "未归类" : "全部内容", archived: false, items: items.filter((item) => !item.folder_id || !(folders ?? []).some((folder) => folder.id === item.folder_id)) },
  ].filter((group) => group.id || group.items.length);

  const renderRow = (item: MusicRow, selectable: boolean) => {
    const meta = musicTypeMeta[item.item_type as MusicItemType];
    const itemAssets = (assets ?? []).filter((asset) => asset.item_id === item.id);
    const childCount = new Set((assignments ?? []).filter((assignment) => assignment.item_id === item.id).map((assignment) => assignment.learner_id)).size;
    return <div className="music-admin-row" key={item.id}>
      {selectable && <input className="music-row-check" type="checkbox" name="item_ids" value={item.id} aria-label={`选择 ${item.title}`} />}
      <span className={`music-type-mark ${item.item_type}`}>{meta.mark}</span>
      <Link className="music-admin-title" href={`/music/manage/${item.id}`}><strong>{item.title}</strong><small>{meta.label}{item.category ? ` · ${item.category}` : ""}</small></Link>
      <span className="music-admin-meta">{itemAssets.length} 个媒体<br />分配 {childCount} 位孩子</span>
      <span className={`music-publish-badge ${item.status}`}>{item.status === "published" ? "已发布" : item.status === "archived" ? "已归档" : "草稿"}</span>
    </div>;
  };

  return <div>
    <header className="hero music-manage-hero"><p className="eyebrow">Music studio</p><h1>音乐内容工作台</h1><p className="lede">{access.isAdmin ? "用文件夹整理同类歌曲、辨音和节奏练习：可以单条分配，也可以把整个文件夹分配给孩子。" : "可创建并上传自己有权使用的资源；保存后由管理员审核和分配。"} MP3 与图片保存在私有 R2，学习记录保存在 Supabase。</p></header>
    <section className="today-card"><p className="eyebrow">当前内容</p><div className="today-grid"><div className="metric"><span className="metric-label">唱一唱</span><span className="metric-value">{counts.song}</span><small>首歌曲</small></div><div className="metric"><span className="metric-label">辨声音</span><span className="metric-value">{counts.instrument}</span><small>个辨音项</small></div><div className="metric"><span className="metric-label">打节奏</span><span className="metric-value">{counts.rhythm}</span><small>个练习</small></div>{foldersReady && <div className="metric"><span className="metric-label">文件夹</span><span className="metric-value">{activeFolders.length}</span><small>个</small></div>}</div></section>
    {access.isAdmin && !foldersReady && <p className="notice">要使用音乐文件夹和批量上传，请先在 Supabase 运行 <code>supabase/022_music_folders_activity_and_cost.sql</code>。</p>}

    {access.isAdmin && foldersReady && <section className="panel music-folder-panel">
      <div className="library-header"><div><p className="eyebrow">Folders</p><h2>文件夹与整夹分配</h2><p className="library-meta">整夹分配后，文件夹里已发布的内容立刻分配；以后新发布进来的内容也会自动分配。取消整夹分配只收回由文件夹带来的内容，单独分配的保留。</p></div></div>
      <FeedbackForm action={createMusicFolder} className="music-folder-create" resetOnSuccess pendingLabel="正在创建文件夹…" successTitle="文件夹已创建"><label>新文件夹名称<input name="title" required maxLength={60} placeholder="例如：大班儿歌、节奏入门 1" /></label><button className="secondary" type="submit">新建文件夹</button></FeedbackForm>
      <div className="music-folder-list">{(folders ?? []).map((folder) => {
        const folderItems = items.filter((item) => item.folder_id === folder.id);
        const assigned = new Set((folderLinks ?? []).filter((link) => link.folder_id === folder.id).map((link) => link.learner_id));
        return <details className="music-folder-card" key={folder.id}>
          <summary><span className="music-folder-icon" aria-hidden="true">▤</span><span><strong>{folder.title}{folder.status === "archived" ? "（已归档）" : ""}</strong><small>{folderItems.length} 条内容 · 已发布 {folderItems.filter((item) => item.status === "published").length} · 整夹分配给 {assigned.size} 位孩子</small></span></summary>
          <FeedbackForm action={saveMusicFolderAssignments} className="music-folder-assign" pendingLabel="正在同步文件夹分配…" successTitle="文件夹分配已保存">
            <input type="hidden" name="folder_id" value={folder.id} />
            {!learners?.length ? <p className="library-meta">还没有孩子档案。</p> : [...learnerGroups.entries()].map(([family, kids]) => <fieldset className="learner-assignment" key={family}><legend>{family}</legend>{kids.map((learner) => <label className="checkbox-label" key={learner.id}><input type="checkbox" name="learner_ids" value={learner.id} defaultChecked={assigned.has(learner.id)} />{learner.display_name}</label>)}</fieldset>)}
            <button className="primary" type="submit">保存整夹分配</button>
          </FeedbackForm>
          <FeedbackForm action={updateMusicFolder} className="music-folder-rename" pendingLabel="正在保存…"><input type="hidden" name="folder_id" value={folder.id} /><label>名称<input name="title" defaultValue={folder.title} required maxLength={60} /></label><label>状态<select name="status" defaultValue={folder.status}><option value="active">使用中</option><option value="archived">归档（隐藏）</option></select></label><button className="secondary compact" type="submit">保存</button></FeedbackForm>
        </details>;
      })}</div>
    </section>}

    {access.isAdmin && foldersReady && <section className="panel"><p className="eyebrow">Bulk upload</p><h2>批量上传：一个文件建一条内容</h2><MusicBulkUpload folders={activeFolders.map(({ id, title }) => ({ id, title }))} r2Configured={isR2Configured()} /></section>}

    <section className="panel music-create-panel"><div><p className="eyebrow">新建内容</p><h2>单条创建，再上传媒体</h2><p className="library-meta">名称和类型创建后，会进入完整维护页。封面、琴谱和节奏谱都不是必填。</p></div><FeedbackForm action={createMusicItem} className="music-create-form" pendingLabel="正在创建音乐内容…" successTitle="音乐内容已创建" confirm={{ title: "确认创建音乐内容？", description: "确认后建立草稿，再上传音频与图片。", confirmLabel: "确认创建" }}><label>内容类型<select name="item_type" defaultValue="song"><option value="song">唱一唱 · 歌曲</option><option value="instrument">辨声音 · 乐器</option><option value="rhythm">打节奏 · 节拍</option></select></label><label>名称<input name="title" required maxLength={100} placeholder="例如：小星星" /></label>{!access.isAdmin && <label>建议分配给<select name="submitted_for_learner_id" required defaultValue={learners?.[0]?.id}>{learners?.map((learner) => <option value={learner.id} key={learner.id}>{learner.display_name}</option>)}</select></label>}<button className="primary" type="submit" disabled={!access.isAdmin && !learners?.length}>创建并继续编辑</button></FeedbackForm></section>

    <section className="panel"><div className="library-header"><div><h2>全部音乐内容</h2><p className="library-meta">共 {items.length} 条。草稿不会出现在孩子页面。{access.isAdmin && foldersReady ? "勾选后可批量移动到文件夹。" : ""}</p></div><Link className="text-button" href="/music">查看孩子页面</Link></div>
      {!items.length ? <div className="empty"><span className="empty-mark">♪</span><p className="lede">还没有音乐内容，从上面创建第一首歌曲。</p></div> : access.isAdmin && foldersReady ? <FeedbackForm action={moveMusicItemsToFolder} className="music-move-form" pendingLabel="正在移动…" successTitle="已移动">
        {groups.map((group) => <details className="music-group" key={group.id || "none"} open={!group.archived && group.items.length <= 30}><summary>{group.title} <small>{group.items.length} 条</small></summary><div className="music-admin-list">{group.items.map((item) => renderRow(item, true))}</div></details>)}
        <div className="music-move-bar"><label>把勾选的内容移到<select name="folder_id" defaultValue=""><option value="">未归类</option>{activeFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title}</option>)}</select></label><button className="secondary" type="submit">移动</button></div>
      </FeedbackForm> : <div className="music-admin-list">{items.map((item) => renderRow(item, false))}</div>}
    </section>
  </div>;
}

type MusicRow = { id: string; item_type: string; title: string; category: string | null; status: string; difficulty: number; updated_at: string; folder_id?: string | null };
