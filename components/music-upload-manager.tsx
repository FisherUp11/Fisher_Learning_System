"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { registerMusicAsset, type MusicItemType } from "@/lib/music-actions";
import { FeedbackForm } from "@/components/feedback-form";

const choices: Record<MusicItemType, Array<{ value: string; label: string; accept: string }>> = {
  song: [
    { value: "audio", label: "歌曲 MP3 / 音频", accept: "audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav" },
    { value: "cover", label: "封面（可选）", accept: "image/jpeg,image/png,image/webp" },
    { value: "score", label: "琴谱（最多 5 张）", accept: "image/jpeg,image/png,image/webp" },
  ],
  instrument: [
    { value: "audio", label: "乐器辨音音频", accept: "audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav" },
    { value: "instrument_image", label: "答案图片（可选）", accept: "image/jpeg,image/png,image/webp" },
  ],
  rhythm: [
    { value: "demo_audio", label: "节奏示范音频（可选）", accept: "audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav" },
    { value: "rhythm_sheet", label: "节奏谱图片（可选）", accept: "image/jpeg,image/png,image/webp" },
  ],
};

function inferredContentType(file: File) {
  if (file.type) return file.type;
  if (/\.mp3$/i.test(file.name)) return "audio/mpeg";
  if (/\.m4a$/i.test(file.name)) return "audio/mp4";
  if (/\.png$/i.test(file.name)) return "image/png";
  if (/\.webp$/i.test(file.name)) return "image/webp";
  return "image/jpeg";
}

export function MusicUploadManager({ itemId, itemType, r2Configured }: { itemId: string; itemType: MusicItemType; r2Configured: boolean }) {
  const router = useRouter();
  const [assetType, setAssetType] = useState(choices[itemType][0].value);
  const uploadedFile = useRef<{ file: File; assetType: string; objectKey: string } | null>(null);
  const selected = choices[itemType].find((choice) => choice.value === assetType) ?? choices[itemType][0];

  async function upload(formData: FormData) {
    const file = formData.get("file");
    const uploadAssetType = String(formData.get("asset_type"));
    if (!(file instanceof File) || !file.size) throw new Error("请先选择文件");
    const contentType = inferredContentType(file);
    const previous = uploadedFile.current;
    let objectKey = previous && previous.assetType === uploadAssetType
      && previous.file.name === file.name && previous.file.size === file.size
      && previous.file.lastModified === file.lastModified && previous.file.type === file.type
      ? previous.objectKey : undefined;
    if (!objectKey) {
      const response = await fetch("/api/music/assets/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, assetType: uploadAssetType, fileName: file.name, contentType, byteSize: file.size }) });
      const payload = await response.json() as { uploadUrl?: string; objectKey?: string; error?: string };
      if (!response.ok || !payload.uploadUrl || !payload.objectKey) throw new Error(payload.error ?? "无法取得上传地址");
      const uploaded = await fetch(payload.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
      if (!uploaded.ok) throw new Error(`上传到 R2 失败（${uploaded.status}），请检查 CORS 与环境变量`);
      objectKey = payload.objectKey;
      // Keep the uploaded object for a same-page retry if registration loses its response.
      uploadedFile.current = { file, assetType: uploadAssetType, objectKey };
    }
    await registerMusicAsset({ itemId, assetType: uploadAssetType, objectKey, originalName: file.name, contentType, byteSize: file.size, label: String(formData.get("label") ?? "") });
    uploadedFile.current = null;
    router.refresh();
    return { status: "success", message: `“${file.name}”已上传并加入内容页。` };
  }

  if (!r2Configured) return <p className="notice">尚未配置 Cloudflare R2。请先完成 <code>10_Cloudflare_R2保姆级配置教程.md</code>，再回来上传 MP3 和图片。</p>;
  return <FeedbackForm className="music-upload-form" action={upload} clearFileOnSuccess successTitle="上传完成" pendingLabel="上传中，请保持页面打开…" confirm={{ title: "确认上传这个文件？", description: `上传位置：${selected.label}`, confirmLabel: "确认上传" }}>
    <label>上传到哪里<select name="asset_type" value={assetType} onChange={(event) => setAssetType(event.target.value)}>{choices[itemType].map((choice) => <option value={choice.value} key={choice.value}>{choice.label}</option>)}</select></label>
    <label>选择文件<input name="file" type="file" accept={selected.accept} required onChange={() => { uploadedFile.current = null; }} /></label>
    {(assetType === "score" || assetType === "rhythm_sheet") && <label>图片说明（可选）<input name="label" maxLength={60} placeholder={assetType === "score" ? "例如：吉他谱 1、钢琴谱" : "例如：四分音符练习"} /></label>}
    <button className="primary" type="submit">上传文件</button>
  </FeedbackForm>;
}
