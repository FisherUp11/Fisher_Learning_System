"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBulkMusicItem, finishBulkMusicUpload, publishBulkMusicItem, registerMusicAsset, type MusicItemType } from "@/lib/music-actions";

type Folder = { id: string; title: string };
type Row = { name: string; state: "waiting" | "uploading" | "done" | "error"; message?: string };

const accept: Record<MusicItemType, string> = {
  song: "audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,.mp3,.m4a",
  instrument: "audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,.mp3,.m4a",
  rhythm: "image/jpeg,image/png,image/webp,audio/mpeg,audio/mp4,audio/x-m4a,.mp3,.m4a",
};

function contentTypeOf(file: File) {
  if (file.type) return file.type;
  if (/\.mp3$/i.test(file.name)) return "audio/mpeg";
  if (/\.m4a$/i.test(file.name)) return "audio/mp4";
  if (/\.wav$/i.test(file.name)) return "audio/wav";
  if (/\.png$/i.test(file.name)) return "image/png";
  if (/\.webp$/i.test(file.name)) return "image/webp";
  return "image/jpeg";
}

export function MusicBulkUpload({ folders, defaultFolderId, r2Configured }: { folders: Folder[]; defaultFolderId?: string; r2Configured: boolean }) {
  const router = useRouter();
  const [itemType, setItemType] = useState<MusicItemType>("song");
  const [folderId, setFolderId] = useState(defaultFolderId ?? folders[0]?.id ?? "");
  const [publish, setPublish] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);

  async function uploadOne(file: File) {
    const contentType = contentTypeOf(file);
    const isImage = contentType.startsWith("image/");
    const assetType = itemType === "rhythm" ? (isImage ? "rhythm_sheet" : "demo_audio") : "audio";
    if (itemType !== "rhythm" && isImage) throw new Error("这个类型需要音频文件");
    const title = file.name.replace(/\.[^.]+$/, "").trim();
    const { id } = await createBulkMusicItem({ itemType, title, folderId: folderId || null });
    const response = await fetch("/api/music/assets/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: id, assetType, fileName: file.name, contentType, byteSize: file.size }) });
    const payload = await response.json() as { uploadUrl?: string; objectKey?: string; error?: string };
    if (!response.ok || !payload.uploadUrl || !payload.objectKey) throw new Error(payload.error ?? "无法取得上传地址");
    const uploaded = await fetch(payload.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
    if (!uploaded.ok) throw new Error(`上传到 R2 失败（${uploaded.status}）；已建立草稿，可在内容页补传`);
    await registerMusicAsset({ itemId: id, assetType, objectKey: payload.objectKey, originalName: file.name, contentType, byteSize: file.size });
    if (publish) await publishBulkMusicItem(id);
  }

  async function start() {
    if (running || !files.length) return;
    setRunning(true);
    const next: Row[] = files.map((file) => ({ name: file.name, state: "waiting" }));
    setRows([...next]);
    for (let index = 0; index < files.length; index += 1) {
      next[index] = { ...next[index], state: "uploading" };
      setRows([...next]);
      try {
        await uploadOne(files[index]);
        next[index] = { ...next[index], state: "done" };
      } catch (error) {
        next[index] = { ...next[index], state: "error", message: error instanceof Error ? error.message : "上传失败" };
      }
      setRows([...next]);
    }
    await finishBulkMusicUpload().catch(() => undefined);
    setRunning(false);
    setFiles([]);
    router.refresh();
  }

  if (!r2Configured) return <p className="notice">尚未配置 Cloudflare R2，暂时不能批量上传。</p>;
  const done = rows.filter((row) => row.state === "done").length;
  const failed = rows.filter((row) => row.state === "error").length;
  return <div className="music-bulk-upload">
    <div className="music-editor-grid">
      <label>内容类型<select value={itemType} disabled={running} onChange={(event) => setItemType(event.target.value as MusicItemType)}><option value="song">唱一唱 · 每个音频是一首歌</option><option value="instrument">辨声音 · 文件名即正确乐器</option><option value="rhythm">打节奏 · 每张图/音频是一个练习</option></select></label>
      <label>放入文件夹<select value={folderId} disabled={running} onChange={(event) => setFolderId(event.target.value)}><option value="">未归类</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title}</option>)}</select></label>
    </div>
    <label>选择多个文件（一次最多 50 个）<input type="file" multiple accept={accept[itemType]} disabled={running} onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 50))} /></label>
    <label className="checkbox-label"><input type="checkbox" checked={publish} disabled={running} onChange={(event) => setPublish(event.target.checked)} />上传成功后直接发布（已分配这个文件夹的孩子会自动收到）</label>
    <p className="field-note">文件名会成为内容名称，例如“小星星.mp3”→“小星星”。歌词、封面和琴谱可以之后在单条内容页补充。</p>
    <button className="primary" type="button" disabled={running || !files.length} onClick={() => void start()}>{running ? `正在上传 ${done + failed + 1} / ${rows.length}…` : `开始批量上传${files.length ? `（${files.length} 个）` : ""}`}</button>
    {rows.length > 0 && <div role="status">
      <p className="library-meta">{running ? "请保持页面打开…" : `完成 ${done} 个${failed ? `，失败 ${failed} 个` : ""}。`}</p>
      <ul className="music-bulk-list">{rows.map((row, index) => <li key={`${row.name}-${index}`} className={row.state}><span>{row.state === "done" ? "✓" : row.state === "error" ? "!" : row.state === "uploading" ? "…" : "○"}</span>{row.name}{row.message && <small>{row.message}</small>}</li>)}</ul>
    </div>}
  </div>;
}
