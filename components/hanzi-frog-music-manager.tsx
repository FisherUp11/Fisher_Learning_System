"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  deleteHanziFrogMusic, registerHanziFrogUpload, renameHanziFrogMusic,
  saveHanziFrogMusic, type FrogMusicTrack,
} from "@/lib/hanzi-frog-music-actions";
import styles from "@/components/hanzi-frog-music-manager.module.css";

type Mode = "url" | "r2";
type UploadResponse = { uploadUrl?: string; objectKey?: string; error?: string };
const maxBytes = 30 * 1024 * 1024;

function contentTypeFor(file: File) {
  if (/\.mp3$/i.test(file.name)) return "audio/mpeg";
  if (/\.m4a$/i.test(file.name)) return file.type === "audio/x-m4a" ? "audio/x-m4a" : "audio/mp4";
  throw new Error("请选择 MP3 或 M4A 文件");
}

export function HanziFrogMusicManager({ learnerId, learnerName, initialTracks, r2Configured }: {
  learnerId: string; learnerName: string; initialTracks: FrogMusicTrack[]; r2Configured: boolean;
}) {
  const [tracks, setTracks] = useState(initialTracks);
  const [mode, setMode] = useState<Mode>(r2Configured ? "r2" : "url");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const uploadedRef = useRef<{ file: File; objectKey: string } | null>(null);
  const editing = tracks.find((track) => track.id === editingId);

  function play(url: string) {
    setError("");
    const audio = previewRef.current;
    if (!audio) return;
    audio.pause();
    audio.src = url;
    void audio.play().catch(() => setError("暂时没听到声音，请检查设备音量、网络或音源链接。"));
  }

  function previewUrl() {
    const url = audioUrl.trim();
    if (!url.startsWith("https://") || /\.(?:html?|php|aspx?)(?:[?#]|$)/i.test(url)) {
      setError("试听需要 HTTPS 音频直链；你填的可能是普通网页。");
      return;
    }
    play(url);
  }

  function clear() {
    previewRef.current?.pause();
    setEditingId(null); setTitle(""); setAudioUrl(""); setFile(null); setProgress("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    uploadedRef.current = null;
  }

  function edit(track: FrogMusicTrack) {
    clear();
    setEditingId(track.id);
    setMode(track.source_type);
    setTitle(track.title);
    setAudioUrl(track.audio_url ?? "");
    setMessage(""); setError("");
  }

  function chooseMode(next: Mode) {
    clear();
    setMode(next); setMessage(""); setError("");
  }

  async function saveUrl() {
    const row = await saveHanziFrogMusic({ learnerId, id: editingId ?? undefined, title, audioUrl });
    setTracks((current) => editingId
      ? current.map((item) => item.id === row.id ? row : item)
      : [...current, row]);
    clear();
    setMessage("✓ 在线配乐已保存，回到游戏即可选择。");
  }

  async function saveR2() {
    if (editingId) {
      const row = await renameHanziFrogMusic({ learnerId, id: editingId, title });
      setTracks((current) => current.map((item) => item.id === row.id ? row : item));
      clear();
      setMessage("✓ 配乐名称已更新。");
      return;
    }
    if (!file) throw new Error("请先选择 MP3 或 M4A 文件");
    if (!title.trim()) throw new Error("请先填写配乐名称");
    if (!r2Configured) throw new Error("R2 尚未配置，请先检查服务器环境变量");
    if (file.size < 1 || file.size > maxBytes) throw new Error("音频文件请控制在 30MB 内");
    if (!window.confirm("确认把“" + file.name + "”上传到私有 R2 并作为游戏配乐吗？")) return;
    const contentType = contentTypeFor(file);
    let objectKey = uploadedRef.current?.file === file ? uploadedRef.current.objectKey : "";
    if (!objectKey) {
      setProgress("正在取得安全上传地址…");
      const response = await fetch("/api/hanzi-frog/music/upload-url", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ learnerId, fileName: file.name, contentType, byteSize: file.size }),
      });
      const payload = await response.json() as UploadResponse;
      if (!response.ok || !payload.uploadUrl || !payload.objectKey) throw new Error(payload.error ?? "无法取得上传地址");
      setProgress("正在上传到 R2，请保持页面打开…");
      const upload = await fetch(payload.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
      if (!upload.ok) throw new Error("R2 上传失败（" + upload.status + "）；请检查 Bucket CORS 配置");
      objectKey = payload.objectKey;
      uploadedRef.current = { file, objectKey };
    }
    setProgress("上传完成，正在核对并保存配乐…");
    const row = await registerHanziFrogUpload({
      learnerId, title, objectKey, originalName: file.name, contentType, byteSize: file.size,
    });
    setTracks((current) => current.some((item) => item.id === row.id) ? current : [...current, row]);
    clear();
    setMessage("✓ 音频已上传 R2 并保存，回到游戏即可循环播放。");
  }

  async function save() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(""); setMessage("");
    try { if (mode === "url") await saveUrl(); else await saveR2(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "保存没有成功，请重试"); }
    finally { busyRef.current = false; setBusy(false); setProgress(""); }
  }

  async function remove(id: string) {
    if (busyRef.current) return;
    const track = tracks.find((item) => item.id === id);
    if (!track || !window.confirm(track.source_type === "r2"
      ? "确定移除这首配乐，并删除它在 R2 中的音频吗？"
      : "确定移除这条在线配乐链接吗？")) return;
    busyRef.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await deleteHanziFrogMusic({ learnerId, id });
      setTracks((current) => current.filter((item) => item.id !== id));
      if (editingId === id) clear();
      setMessage(result.storageCleanupOk ? "✓ 配乐已移除。" : "✓ 配乐记录已移除；R2 文件清理未成功，请联系管理员检查存储。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "移除失败，请重试"); }
    finally { busyRef.current = false; setBusy(false); }
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>字芽 · 家长维护</p><h1>池塘配乐</h1><p>给 {learnerName} 的跳字岛选一段轻轻的伴奏。</p></div>
      <Link href={"/learn/frog?learner=" + learnerId}>← 回到游戏</Link>
    </header>
    <div className={styles.layout}>
      <section className={styles.card}>
        <h2>{editingId ? "修改配乐" : "加一首配乐"}</h2>
        {!editingId && <div className={styles.modeSwitch} role="group" aria-label="配乐来源">
          <button type="button" aria-pressed={mode === "r2"} className={mode === "r2" ? styles.modeActive : ""} onClick={() => chooseMode("r2")}>↑ 上传到 R2</button>
          <button type="button" aria-pressed={mode === "url"} className={mode === "url" ? styles.modeActive : ""} onClick={() => chooseMode("url")}>↗ 在线音频链接</button>
        </div>}
        <p className={styles.hint}>{mode === "r2"
          ? "音频保存在现有私有 R2 中。孩子游戏时才获取短时播放地址，不需要开通「唱一唱」模块。"
          : "填可直接播放的 HTTPS 音频地址；普通网页（例如 …/a/213086.html）不能当作音频循环播放。"}</p>
        <label>乐曲名称<input value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} placeholder="例如：小跳蛙伴奏" /></label>
        {mode === "url" ? <>
          <label>音频直链<input value={audioUrl} type="url" onChange={(event) => { previewRef.current?.pause(); setAudioUrl(event.target.value); }} placeholder="https://…/music.mp3" inputMode="url" /></label>
          <button type="button" className={styles.previewButton} onClick={previewUrl}>试听链接</button>
        </> : editing ? <p className={styles.hint}>已上传：{editing.original_name}。更换文件时，请先移除这首，再重新上传。</p> : <>
          <label>选择音频文件<input ref={fileInputRef} type="file" accept=".mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a" onChange={(event) => { setFile(event.target.files?.[0] ?? null); uploadedRef.current = null; }} /></label>
          <p className={styles.hint}>支持 MP3 / M4A，单个最多 30MB。{!r2Configured && "当前服务器尚未配置 R2，暂不能上传。"}</p>
        </>}
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={busy || (mode === "r2" && !r2Configured)} onClick={() => void save()}>
            {busy ? progress || "保存中…" : editingId ? "保存修改" : mode === "r2" ? "上传并保存" : "保存链接"}
          </button>
          {editingId && <button type="button" disabled={busy} onClick={clear}>取消修改</button>}
        </div>
        {message && <p className={styles.success} role="status">{message}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>
      <section className={styles.card}><h2>已维护的配乐 <small>{tracks.length} 首</small></h2>
        {tracks.length === 0 ? <p className={styles.empty}>还没有配乐。游戏可以先无配乐玩，不影响认字。</p> :
          <ul className={styles.list}>{tracks.map((track) => <li key={track.id}>
            <div><strong>{track.title}</strong><span>{track.source_type === "r2" ? "私有 R2 · " + (track.original_name ?? "已上传音频") : "在线链接 · " + track.audio_url}</span></div>
            <div className={styles.rowActions}>
              <button type="button" disabled={busy} onClick={() => play(track.source_type === "r2"
                ? "/api/hanzi-frog/music/audio?learner=" + encodeURIComponent(learnerId) + "&track=" + encodeURIComponent(track.id)
                : track.audio_url ?? "")}>试听</button>
              <button type="button" disabled={busy} onClick={() => edit(track)}>编辑</button>
              <button type="button" disabled={busy} onClick={() => void remove(track.id)}>移除</button>
            </div>
          </li>)}</ul>}
        <div className={styles.preview}><span>试听播放器</span><audio ref={previewRef} controls preload="none" onError={() => setError("音频暂时打不开，请检查来源链接或 R2 配置。")}>浏览器不支持音频播放</audio></div>
        <p className={styles.hint}>游戏中会低音量循环，读字时自动变轻，结束时停止。R2 文件仅凭身份和孩子权限取得短时播放链接。</p>
      </section>
    </div>
  </main>;
}
