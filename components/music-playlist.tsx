"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/components/music-playlist.module.css";

export type PlaylistSong = { id: string; title: string; category: string | null; lyrics: string | null };

export function MusicPlaylist({ learnerId, songs }: { learnerId: string; songs: PlaylistSong[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState<PlaylistSong[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const queueRef = useRef<PlaylistSong[]>([]);
  const indexRef = useRef(0);
  const requestRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtered = songs.filter((song) => `${song.title} ${song.category ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const current = queue[index];

  function clearTimeoutForPlayback() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      requestRef.current += 1;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      audio?.pause();
      audio?.removeAttribute("src");
      audio?.load();
    };
  }, []);

  function showPlaybackError(message: string, request: number) {
    if (request !== requestRef.current) return;
    clearTimeoutForPlayback();
    audioRef.current?.pause();
    setLoading(false);
    setPlaying(false);
    setError(message);
  }

  function playAt(nextQueue: PlaylistSong[], nextIndex: number) {
    const audio = audioRef.current;
    const song = nextQueue[nextIndex];
    if (!audio || !song) return;
    clearTimeoutForPlayback();
    const request = ++requestRef.current;
    queueRef.current = nextQueue;
    indexRef.current = nextIndex;
    setQueue(nextQueue);
    setIndex(nextIndex);
    setPlaying(false);
    setLoading(true);
    setError("");
    audio.pause();
    // The stable audio element is reused across tracks. Calling play directly
    // here preserves the iPhone/Safari user gesture when starting or retrying.
    audio.src = `/api/music/playlist-audio?learner=${encodeURIComponent(learnerId)}&item=${encodeURIComponent(song.id)}&play=${Date.now()}-${request}`;
    timeoutRef.current = setTimeout(() => showPlaybackError("这首歌加载时间较长，请检查网络后重试，或切换下一首。", request), 20000);
    void audio.play().catch((cause: unknown) => {
      if (request !== requestRef.current) return;
      if (cause instanceof DOMException && cause.name === "AbortError" && audio.paused) return;
      const blocked = cause instanceof DOMException && cause.name === "NotAllowedError";
      showPlaybackError(blocked ? "浏览器暂停了自动播放，请点“继续播放”即可接着听。" : "这首歌暂时无法播放，请重试或跳过；若持续失败，请检查音频是否已上传并分配。", request);
    });
  }

  function move(offset: number) {
    const active = queueRef.current;
    if (!active.length) return;
    playAt(active, (indexRef.current + offset + active.length) % active.length);
  }

  function pause() {
    requestRef.current += 1;
    clearTimeoutForPlayback();
    audioRef.current?.pause();
    setLoading(false);
    setPlaying(false);
  }

  function resume() {
    const audio = audioRef.current;
    if (!audio || !queueRef.current.length) return;
    if (error || !audio.src) {
      playAt(queueRef.current, indexRef.current);
      return;
    }
    const request = ++requestRef.current;
    setLoading(true);
    timeoutRef.current = setTimeout(() => showPlaybackError("暂时没能继续播放，请重试。", request), 20000);
    void audio.play().catch((cause: unknown) => {
      if (cause instanceof DOMException && cause.name === "AbortError" && audio.paused) return;
      showPlaybackError("暂时无法继续播放，请点“重试本首”刷新音频。", request);
    });
  }

  function stop() {
    pause();
    audioRef.current?.removeAttribute("src");
    audioRef.current?.load();
    queueRef.current = [];
    indexRef.current = 0;
    setQueue([]);
    setIndex(0);
    setError("");
  }

  if (!songs.length) return null;
  return <section className={`panel ${styles.panel}`} aria-label="多首歌曲循环播放">
    <div className={styles.heading}>
      <div><p className="eyebrow">一起听歌</p><h2>选一份今天的歌单</h2><p className={styles.description}>勾选喜欢的歌，依次播放；最后一首结束后，自动从第一首继续。</p></div>
      <span className={styles.badge} aria-hidden="true">♫</span>
    </div>
    <details className={styles.chooser} open={queue.length === 0 ? true : undefined}>
      <summary>选择歌曲 · 已选 {selected.length} 首</summary>
      <div className={styles.selection}>
        <label><span className={styles.visuallyHidden}>搜索可选歌曲</span><input type="search" placeholder="搜索歌曲名称或分类" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <div className={styles.tools}><button type="button" className="text-button" onClick={() => setSelected((ids) => [...new Set([...ids, ...filtered.map((song) => song.id)])])}>全选{search.trim() ? "搜索结果" : "歌曲"}</button><button type="button" className="text-button" onClick={() => setSelected([])}>清空勾选</button><span className={styles.count}>共 {songs.length} 首可播放</span></div>
        <div className={styles.songList}>{filtered.map((song) => <label className={styles.song} key={song.id}><input type="checkbox" checked={selected.includes(song.id)} onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, song.id] : ids.filter((id) => id !== song.id))} /><span><strong>{song.title}</strong>{song.category && <small>{song.category}</small>}</span></label>)}</div>
        {!filtered.length && <p className={styles.empty}>没有找到这首歌，试试其他名称。</p>}
        <button type="button" className={`primary ${styles.start}`} disabled={!selected.length} onClick={() => playAt(selected.flatMap((id) => songs.find((song) => song.id === id) ?? []), 0)}>{queue.length ? "播放所选，更新歌单" : `开始循环播放${selected.length ? `（${selected.length} 首）` : ""}`}</button>
        <p className={styles.note}>按勾选顺序播放。更改勾选后，点击上方按钮才会更新正在播放的歌单。</p>
      </div>
    </details>
    <div className={styles.player} hidden={!current}>
      <div className={styles.now}><div><p className="eyebrow">{loading ? "正在加载" : playing ? "正在播放 · 列表循环" : "当前歌曲"}</p><strong>{current?.title}</strong></div><span className={styles.position}>{queue.length ? index + 1 : 0} / {queue.length}</span></div>
      <audio ref={audioRef} className={styles.audio} controls preload="none" playsInline aria-label={current ? `${current.title} 播放器` : "歌单播放器"}
        onPlaying={() => { clearTimeoutForPlayback(); setLoading(false); setPlaying(true); setError(""); }}
        onPause={() => { if (audioRef.current?.paused) { clearTimeoutForPlayback(); setLoading(false); setPlaying(false); } }}
        onWaiting={() => {
          if (audioRef.current && !audioRef.current.paused) {
            setLoading(true);
            if (!timeoutRef.current) {
              const request = requestRef.current;
              timeoutRef.current = setTimeout(() => showPlaybackError("音频缓冲时间较长，请检查网络后重试，或切换下一首。", request), 20000);
            }
          }
        }}
        onEnded={() => { if (audioRef.current?.ended) move(1); }}
        onError={() => { if (audioRef.current?.error && audioRef.current.getAttribute("src")) showPlaybackError("这首歌暂时无法播放。可以重试本首，或跳过继续听下一首。", requestRef.current); }} />
      <div className={styles.controls}>
        <button type="button" className="secondary" disabled={queue.length < 2} onClick={() => move(-1)}>上一首</button>
        <button type="button" className="primary" onClick={playing || loading ? pause : resume}>{playing || loading ? "暂停" : "继续播放"}</button>
        <button type="button" className="secondary" disabled={queue.length < 2} onClick={() => move(1)}>下一首</button>
        <button type="button" className="secondary" onClick={stop}>结束听歌</button>
      </div>
      {error && <div role="alert"><p className={`${styles.status} ${styles.error}`}>{error}</p><button className="text-button" type="button" onClick={() => playAt(queueRef.current, indexRef.current)}>重试本首</button></div>}
      <p className={styles.status} role="status" aria-live="polite">{!error && (loading ? "音频正在加载，请稍等…" : playing ? `正在听《${current?.title}》，播完会自动接下一首。` : "已暂停，可以随时继续。")}</p>
      <details className={styles.lyrics}><summary>查看本次歌单{current?.lyrics ? "和当前歌词" : ""}</summary><ol className={styles.queue}>{queue.map((song, position) => <li aria-current={position === index ? "true" : undefined} key={song.id}>{song.title}</li>)}</ol>{current?.lyrics && <p>{current.lyrics}</p>}</details>
    </div>
    <p className={styles.note}>听歌不会自动增加练习次数或贴纸。一起唱过后，可进入歌曲详情打卡。离开本页会停止播放；手机锁屏播放取决于浏览器与系统设置。</p>
  </section>;
}
