type PreparedItem = { characterId: string; url?: string; error?: string; retryAfterSeconds?: number };
type Source = { url: string; expiresAt: number };

// One cache per mounted game/child. Audio bytes are downloaded ahead of play;
// replay does not revisit Auth, R2 or Azure. Nothing is stored in localStorage.
export class FrogSpeechClient {
  private readonly sources = new Map<string, Source>();
  private readonly pending = new Map<string, Promise<string | null>>();
  private readonly errors = new Map<string, { message: string; retryAt: number }>();
  private readonly controllers = new Set<AbortController>();
  private allowGenerateAt = 0;
  private disposed = false;
  private readonly learnerId: string;

  constructor(learnerId: string) { this.learnerId = learnerId; }

  peek(id: string) {
    const source = this.sources.get(id);
    if (!source || source.expiresAt <= Date.now()) return null;
    return source.url;
  }

  message(id: string) { return this.errors.get(id)?.message ?? "声音还在准备，先用设备慢读。"; }

  get(id: string): Promise<string | null> {
    const ready = this.peek(id);
    if (ready) return Promise.resolve(ready);
    return this.pending.get(id) ?? this.warm([id]).then(() => this.peek(id));
  }

  async warm(ids: string[]) {
    if (this.disposed) return;
    const unique = [...new Set(ids)].slice(0, 3);
    const needed = unique.filter((id) => !this.peek(id) && !this.pending.has(id)
      && (this.errors.get(id)?.retryAt ?? 0) <= Date.now());
    if (needed.length) {
      const controller = new AbortController();
      this.controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 50000);
      const task = this.loadBatch(needed, controller.signal).finally(() => {
        clearTimeout(timer);
        this.controllers.delete(controller);
        for (const id of needed) this.pending.delete(id);
      });
      for (const id of needed) this.pending.set(id, task.then(() => this.peek(id)));
    }
    await Promise.all(unique.map((id) => this.pending.get(id)));
  }

  private async loadBatch(ids: string[], signal: AbortSignal) {
    try {
      const response = await fetch("/api/hanzi-frog/speech", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal,
        body: JSON.stringify({ learnerId: this.learnerId, characterIds: ids, allowGenerate: Date.now() >= this.allowGenerateAt }),
      });
      const payload = await response.json() as { items?: PreparedItem[]; error?: string };
      if (!response.ok || !Array.isArray(payload.items)) throw new Error(payload.error || "朗读准备暂时失败，先用设备慢读。");
      await Promise.all(ids.map(async (id) => {
        const item = payload.items!.find((candidate) => candidate.characterId === id);
        if (!item?.url) {
          const message = item?.error || "声音未准备好，先用设备慢读。";
          const retryAt = Date.now() + Math.max(10, item?.retryAfterSeconds ?? 60) * 1000;
          this.errors.set(id, { message, retryAt });
          if (/刚才|保护额度|保护上限/.test(message)) this.allowGenerateAt = retryAt;
          return;
        }
        let url = item.url;
        let expiresAt = Date.now() + 50 * 60000;
        // CORS GET is in the existing R2 setup. If this download fails, a signed
        // source can still be played by an ordinary <audio> without CORS fetch.
        try {
          const download = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
          if (!download.ok) throw new Error("Audio download failed");
          const blob = await download.blob();
          if (blob.size < 100 || blob.size > 1_000_000 || !blob.type.startsWith("audio/")) throw new Error("Invalid audio");
          if (this.disposed) return;
          url = URL.createObjectURL(blob);
          expiresAt = Number.POSITIVE_INFINITY;
        } catch { if (this.disposed || signal.aborted) return; }
        const old = this.sources.get(id);
        if (old?.url.startsWith("blob:")) URL.revokeObjectURL(old.url);
        this.sources.set(id, { url, expiresAt });
        this.errors.delete(id);
        if (this.sources.size > 64) {
          const first = this.sources.keys().next().value;
          if (first) {
            const removed = this.sources.get(first);
            if (removed?.url.startsWith("blob:")) URL.revokeObjectURL(removed.url);
            this.sources.delete(first);
          }
        }
      }));
    } catch (error) {
      if (this.disposed) return;
      const message = error instanceof Error && error.name !== "AbortError" ? error.message : "声音准备超时，先用设备慢读。";
      for (const id of ids) this.errors.set(id, { message, retryAt: Date.now() + 60000 });
    }
  }

  dispose() {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    for (const source of this.sources.values()) if (source.url.startsWith("blob:")) URL.revokeObjectURL(source.url);
    this.sources.clear();
    this.errors.clear();
  }
}
