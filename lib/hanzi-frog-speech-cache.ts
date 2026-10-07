import { createHash } from "node:crypto";

export const FROG_SPEECH_PROFILE = "slow32-repeat2-gap650";
export type FrogAudio = { url: string; cache: "hit" | "miss" | "temporary" };
export type FrogSpeechWord = { hanzi: string; pinyin_marked: string };

function escapeXml(value: string) {
  return value.replace(/[<>&'\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char]!);
}

// Azure zh-CN's SAPI alphabet uses syllable + tone, e.g. "shang 4".
// Pin the imported pronunciation so isolated polyphonic characters don't drift.
export function frogSapiPinyin(marked: string): string | null {
  const input = marked.trim().toLowerCase().normalize("NFD");
  if (/[,，、;/／\s]/.test(input)) return null;
  const toneMarks = [...input].filter((char) => ["\u0304", "\u0301", "\u030c", "\u0300"].includes(char));
  if (toneMarks.length > 1) return null;
  const markedTone = toneMarks.length ? ["\u0304", "\u0301", "\u030c", "\u0300"].indexOf(toneMarks[0]) + 1 : 0;
  const number = input.match(/([1-5])$/)?.[1];
  if (number && markedTone && Number(number) !== markedTone) return null;
  const base = input.replace(/u\u0308/g, "v").replace(/[\u0300-\u036f]/g, "").replace(/[1-5]$/, "").replace(/ve/g, "ue");
  if (!/^[a-zv]{1,8}$/.test(base)) return null;
  return `${base} ${number ? Number(number) : markedTone || 5}`;
}

export function frogSpeechSsml(word: FrogSpeechWord, voice: string) {
  const pronunciation = frogSapiPinyin(word.pinyin_marked);
  const glyph = escapeXml(word.hanzi);
  const spoken = pronunciation ? `<phoneme alphabet="sapi" ph="${pronunciation}">${glyph}</phoneme>` : glyph;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="${escapeXml(voice)}"><break time="180ms"/><prosody rate="-32%">${spoken}<break time="650ms"/>${spoken}</prosody><break time="200ms"/></voice></speak>`;
}

// Speech's pricing note counts SSML markup other than speak/voice, and counts
// each Chinese character twice. This is a guardrail estimate, not an invoice.
export function frogSpeechBillableCharacters(word: FrogSpeechWord, voice: string) {
  const inner = frogSpeechSsml(word, voice).replace(/<\/?(?:speak|voice)\b[^>]*>/g, "");
  const points = [...inner];
  return points.length + points.filter((point) => /\p{Script=Han}/u.test(point)).length;
}

export function frogSpeechObjectKey(workspaceId: string, voice: string, word: FrogSpeechWord) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) throw new Error("Invalid workspace");
  const hash = createHash("sha256").update(JSON.stringify({
    version: 1, voice, profile: FROG_SPEECH_PROFILE,
    hanzi: word.hanzi, pronunciation: frogSapiPinyin(word.pinyin_marked),
  })).digest("hex");
  const voiceFolder = voice.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
  return `learning-audio/hanzi-frog/v1/${workspaceId}/zh-CN/${voiceFolder}/${FROG_SPEECH_PROFILE}/${hash.slice(0, 2)}/${hash}.mp3`;
}

type CacheDependencies = {
  read: (key: string) => Promise<string | null>;
  generate: () => Promise<Uint8Array>;
  write: (key: string, bytes: Uint8Array) => Promise<void>;
  sign: (key: string) => Promise<string>;
};

export async function resolveFrogAudio(key: string, allowGenerate: boolean, deps: CacheDependencies): Promise<FrogAudio> {
  const url = await deps.read(key);
  if (url) return { url, cache: "hit" };
  if (!allowGenerate) throw new Error("新字的声音尚未缓存，稍后再准备；现在可用设备慢读");
  const bytes = await deps.generate();
  if (bytes.byteLength < 100 || bytes.byteLength > 1_000_000) throw new Error("朗读音频无效");
  try {
    await deps.write(key, bytes);
    return { url: await deps.sign(key), cache: "miss" };
  } catch {
    // A successful paid synthesis must remain usable if this one cache write fails.
    console.warn("hanzi_frog_speech_cache_write_failed");
    return { url: `data:audio/mpeg;base64,${Buffer.from(bytes).toString("base64")}`, cache: "temporary" };
  }
}
