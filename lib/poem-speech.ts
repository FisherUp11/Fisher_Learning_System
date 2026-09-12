const audioCache = new Map<string, string>();
let activeAudio: HTMLAudioElement | null = null;
let releasePlayback: (() => void) | null = null;
let speechVersion = 0;
const pendingAudio = new Map<string, Promise<string>>();

function browserSpeech(text: string) {
  return new Promise<void>((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.72;
    utterance.pitch = 1.02;
    const timer = window.setTimeout(done, Math.min(60000, 5000 + text.length * 700));
    function done() { window.clearTimeout(timer); if (releasePlayback === done) releasePlayback = null; resolve(); }
    releasePlayback = done;
    utterance.onend = done;
    utterance.onerror = done;
    window.speechSynthesis.speak(utterance);
  });
}

async function audioUrl(text: string) {
  const cached = audioCache.get(text);
  if (cached) return cached;
  const pending = pendingAudio.get(text);
  if (pending) return pending;
  const request = loadAudio(text);
  pendingAudio.set(text, request);
  try { return await request; } finally { pendingAudio.delete(text); }
}

async function loadAudio(text: string) {
  const response = await fetch("/api/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang: "zh", slow: true }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("speech unavailable");
  const url = URL.createObjectURL(await response.blob());
  audioCache.set(text, url);
  if (audioCache.size > 40) {
    const oldest = audioCache.keys().next().value;
    if (oldest) { URL.revokeObjectURL(audioCache.get(oldest)!); audioCache.delete(oldest); }
  }
  return url;
}

export function warmPoemSpeech(lines: string[]) {
  for (const line of lines) void audioUrl(line).catch(() => undefined);
}

export async function speakPoemText(text: string) {
  stopPoemSpeech();
  const version = speechVersion;
  try {
    const url = await audioUrl(text);
    if (version !== speechVersion) return;
    const audio = new Audio(url);
    activeAudio = audio;
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(() => { audio.pause(); done(); }, Math.min(60000, 5000 + text.length * 700));
      function done() { window.clearTimeout(timer); if (releasePlayback === done) releasePlayback = null; resolve(); }
      releasePlayback = done;
      audio.onended = done;
      audio.onerror = done;
      void audio.play().catch(done);
    });
  } catch {
    if (version === speechVersion) await browserSpeech(text);
  }
}

export function stopPoemSpeech() {
  speechVersion += 1;
  activeAudio?.pause();
  releasePlayback?.();
  releasePlayback = null;
  activeAudio = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
