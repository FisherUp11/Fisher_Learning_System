"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { FeedbackForm } from "@/components/feedback-form";
import { registerKidsEnglishVideo } from "@/lib/kids-english-actions";

export function KidsEnglishVideoUpload({ configured }: { configured: boolean }) {
  const router = useRouter();
  const uploaded = useRef<{ name: string; size: number; modified: number; key: string } | null>(null);
  if (!configured) return <p className="notice">尚未配置 R2，请先按 Cloudflare R2 教程配置环境变量与 CORS。</p>;
  async function action(formData: FormData) {
    const file = formData.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("请选择 MP4 视频");
    const title = String(formData.get("title") ?? "").trim();
    if (!title) throw new Error("请填写视频名称");
    let key = uploaded.current?.name === file.name && uploaded.current.size === file.size && uploaded.current.modified === file.lastModified ? uploaded.current.key : "";
    if (!key) {
      const response = await fetch("/api/kids-english/video/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: "video/mp4", byteSize: file.size }) });
      const payload = await response.json() as { uploadUrl?: string; objectKey?: string; error?: string };
      if (!response.ok || !payload.uploadUrl || !payload.objectKey) throw new Error(payload.error ?? "无法取得上传地址");
      const result = await fetch(payload.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: file });
      if (!result.ok) throw new Error(`视频上传失败（${result.status}），请检查 R2 CORS`);
      key = payload.objectKey;
      uploaded.current = { name: file.name, size: file.size, modified: file.lastModified, key };
    }
    const saved = await registerKidsEnglishVideo({ title, objectKey: key, originalName: file.name, contentType: "video/mp4", byteSize: file.size });
    if (saved.status === "success") { uploaded.current = null; router.refresh(); }
    return saved;
  }
  return <FeedbackForm action={action} pendingLabel="视频正在上传并保存，请勿重复点击…" successTitle="课堂视频已保存" clearFileOnSuccess confirm={{ title: "确认上传视频？", description: "视频保存到私有 R2，上传后仍需选择单词进行关联。" }} className="form-grid">
    <label>视频名称<input name="title" maxLength={120} placeholder="例如：哈森英语课 · 形状" required /></label>
    <label>MP4 视频（最多 200MB）<input name="file" type="file" accept="video/mp4,.mp4" required onChange={() => { uploaded.current = null; }} /></label>
    <button className="primary">上传课堂视频</button>
  </FeedbackForm>;
}
