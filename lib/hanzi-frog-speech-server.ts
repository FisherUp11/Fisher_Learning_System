import "server-only";
import { meteredFetch } from "@/lib/metered-fetch";
import { cachedR2AudioUrl, createR2ReadUrl, isR2Configured, writeR2Audio } from "@/lib/r2";
import { frogSpeechBillableCharacters, frogSpeechObjectKey, frogSpeechSsml, resolveFrogAudio, type FrogAudio, type FrogSpeechWord } from "@/lib/hanzi-frog-speech-cache";

// Merge concurrent cold requests within one server instance. R2 is the durable
// cross-instance cache; rare simultaneous cold misses remain metered separately.
const pending = new Map<string, Promise<FrogAudio>>();

export async function prepareFrogAudio(workspaceId: string, learnerId: string, word: FrogSpeechWord, allowGenerate: boolean) {
  if (!isR2Configured()) throw new Error("请先配置 R2 朗读缓存；现在可用设备慢读");
  const voice = process.env.AZURE_SPEECH_ZH_VOICE?.trim() || "zh-CN-XiaoxiaoNeural";
  const objectKey = frogSpeechObjectKey(workspaceId, voice, word);
  const active = pending.get(objectKey);
  if (active) return active;
  const task = resolveFrogAudio(objectKey, allowGenerate, {
    read: cachedR2AudioUrl,
    write: writeR2Audio,
    sign: createR2ReadUrl,
    generate: async () => {
      const key = process.env.AZURE_SPEECH_KEY;
      const region = process.env.AZURE_SPEECH_REGION;
      if (!key || !region) throw new Error("Azure Speech 尚未配置；现在可用设备慢读");
      const started = performance.now();
      const response = await meteredFetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST", signal: AbortSignal.timeout(12000), cache: "no-store",
        headers: {
          "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        },
        body: frogSpeechSsml(word, voice),
      }, { service: "tts", feature: "hanzi.frog.read_aloud", model: voice, characters: frogSpeechBillableCharacters(word, voice), learnerId });
      if (!response.ok) throw new Error(`Azure 朗读暂时不可用（HTTP ${response.status}）；现在可用设备慢读`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      console.info("hanzi_frog_speech_synthesis", { durationMs: Math.round(performance.now() - started) });
      return bytes;
    },
  });
  pending.set(objectKey, task);
  try { return await task; }
  finally { if (pending.get(objectKey) === task) pending.delete(objectKey); }
}
