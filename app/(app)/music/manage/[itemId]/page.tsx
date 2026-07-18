import Link from "next/link";
/* eslint-disable @next/next/no-img-element -- R2 签名 URL 为短时动态 host/query，不适合经 Next Image 代理与缓存。 */
import { DeleteMusicItemForm } from "@/components/delete-music-item-form";
import { MusicItemForm } from "@/components/music-item-form";
import { MusicUploadManager } from "@/components/music-upload-manager";
import { deleteMusicAsset, type MusicItemStatus, type MusicItemType } from "@/lib/music-actions";
import { musicTypeMeta } from "@/lib/music";
import { createR2ReadUrl, isR2Configured } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ itemId: string }> };
type AssetRow = { id: string; asset_type: string; object_key: string; original_name: string; content_type: string; byte_size: number; label: string | null; sequence: number };

const assetNames: Record<string, string> = { audio: "主音频", cover: "封面", score: "琴谱", instrument_image: "乐器答案图片", rhythm_sheet: "节奏谱", demo_audio: "示范音频" };

export default async function MusicItemManagePage({ params }: PageProps) {
  const { itemId } = await params;
  const supabase = await createClient();
  const [{ data: item, error }, { data: learners }, { data: assignments }, { data: assets }] = await Promise.all([
    supabase.from("music_items").select("id,item_type,title,category,description,lyrics,correct_answer,instructions,difficulty,status").eq("id", itemId).single(),
    supabase.from("learner_profiles").select("id,display_name").order("created_at"),
    supabase.from("learner_music_items").select("learner_id").eq("item_id", itemId),
    supabase.from("music_assets").select("id,asset_type,object_key,original_name,content_type,byte_size,label,sequence").eq("item_id", itemId).order("asset_type").order("sequence"),
  ]);
  if (error || !item) return <section className="empty panel"><h1>找不到这条音乐内容</h1><Link className="secondary" href="/music/manage">返回音乐管理</Link></section>;
  const itemType = item.item_type as MusicItemType;
  const meta = musicTypeMeta[itemType];
  const assigned = new Set((assignments ?? []).map((assignment) => assignment.learner_id));
  const r2Configured = isR2Configured();
  const assetViews = await Promise.all(((assets ?? []) as AssetRow[]).map(async (asset) => ({ ...asset, url: r2Configured ? await createR2ReadUrl(asset.object_key).catch(() => null) : null })));
  return <div className="music-editor-page">
    <Link className="back-link" href="/music/manage">← 返回音乐内容工作台</Link>
    <header className="hero"><p className="eyebrow">{meta.action}</p><h1>{item.title}</h1><p className="lede">维护文字、孩子分配和 R2 媒体。保存为“已发布”后才会出现在孩子的音乐页面。</p></header>
    <section className="panel"><h2>内容资料</h2><MusicItemForm item={{ id: item.id, itemType, title: item.title, category: item.category, description: item.description, lyrics: item.lyrics, correctAnswer: item.correct_answer, instructions: item.instructions, difficulty: item.difficulty, status: item.status as MusicItemStatus }} learners={(learners ?? []).map((learner) => ({ id: learner.id, displayName: learner.display_name }))} assignedLearnerIds={[...assigned]} /></section>
    <section className="panel"><h2>MP3、图片与琴谱</h2><p className="library-meta">文件直接从浏览器上传到私有 Cloudflare R2；封面、琴谱和节奏谱都可以留空。</p><MusicUploadManager itemId={item.id} itemType={itemType} r2Configured={r2Configured} />
      <div className="music-asset-list">{assetViews.length === 0 ? <p className="notice">还没有上传媒体。歌曲至少需要主音频；辨声音至少需要一段音频。</p> : assetViews.map((asset) => <article className="music-asset-row" key={asset.id}><div className="music-asset-preview">{asset.content_type.startsWith("image/") && asset.url ? <img src={asset.url} alt={asset.label ?? asset.original_name} /> : asset.content_type.startsWith("audio/") && asset.url ? <audio controls loop preload="metadata" src={asset.url} /> : <span>{assetNames[asset.asset_type] ?? "文件"}</span>}</div><div className="music-asset-info"><strong>{asset.label || assetNames[asset.asset_type] || asset.original_name}</strong><span>{asset.original_name} · {(asset.byte_size / 1024 / 1024).toFixed(1)} MB</span></div><form action={deleteMusicAsset}><input type="hidden" name="asset_id" value={asset.id} /><input type="hidden" name="item_id" value={item.id} /><button className="text-button danger" type="submit">删除</button></form></article>)}</div>
    </section>
    <section className="panel danger-zone"><h2>危险操作</h2><DeleteMusicItemForm itemId={item.id} title={item.title} /></section>
  </div>;
}
