const audioCache = new Map<string, string>();
let activeAudio: HTMLAudioElement | null = null;

function browserSpeech(text: string) {
  return new Promise<void>((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.72;
    utterance.pitch = 1.02;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

async function audioUrl(text: string) {
  const cached = audioCache.get(text);
  if (cached) return cached;
  const response = await fetch("/api/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang: "zh", slow: true }),
  });
  if (!response.ok) throw new Error("speech unavailable");
  const url = URL.createObjectURL(await response.blob());
  audioCache.set(text, url);
  return url;
}

export function warmPoemSpeech(lines: string[]) {
  for (const line of lines) void audioUrl(line).catch(() => undefined);
}

export async function speakPoemText(text: string) {
  activeAudio?.pause();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  try {
    const audio = new Audio(await audioUrl(text));
    activeAudio = audio;
    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      void audio.play().catch(() => resolve());
    });
  } catch {
    await browserSpeech(text);
  }
}

export function stopPoemSpeech() {
  activeAudio?.pause();
  activeAudio = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

