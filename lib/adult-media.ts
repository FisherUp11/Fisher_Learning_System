import "server-only";
import { meteredFetch } from "@/lib/metered-fetch";
import { createHash } from "node:crypto";
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
function cacheClient() {
  if (!process.env.R2_ADULT_BUCKET_NAME || !process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) return null;
  return { bucket: process.env.R2_ADULT_BUCKET_NAME, client: new S3Client({ region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } }) };
}
export async function clearAdultAudioCache(owner: string) {
  const cache = cacheClient(); if (!cache) return;
  // Only the account's generated English cache, never original music or another account's files.
  for (;;) {
    const list = await cache.client.send(new ListObjectsV2Command({ Bucket: cache.bucket, Prefix: `adult-audio/${owner}/`, MaxKeys: 1000 }), { abortSignal: AbortSignal.timeout(10000) });
    if (!list.Contents?.length) break;
    const result = await cache.client.send(new DeleteObjectsCommand({ Bucket: cache.bucket, Delete: { Objects: list.Contents.map(x => ({ Key: x.Key! })), Quiet: true } }), { abortSignal: AbortSignal.timeout(10000) });
    if (result.Errors?.length) throw new Error("无法清理私有音频缓存，请检查 R2 删除权限后重试。资料尚未删除。");
  }
}
export async function adultAudio(owner: string, text: string, slow: boolean) {
  const voice = process.env.AZURE_SPEECH_EN_VOICE || "en-US-JennyNeural";
  const key = `adult-audio/${owner}/${createHash("sha256").update(`${voice}:${slow}:${text}`).digest("hex")}.mp3`;
  const cache = cacheClient();
  if (cache) {
    try { const result = await cache.client.send(new GetObjectCommand({ Bucket: cache.bucket, Key: key }), { abortSignal: AbortSignal.timeout(5000) }); if (result.Body) return await result.Body.transformToByteArray(); } catch { /* A cache failure must not prevent learning. */ }
  }
  const speechKey = process.env.AZURE_SPEECH_KEY; const region = process.env.AZURE_SPEECH_REGION;
  if (!speechKey || !region) throw new Error("请配置 Azure Speech KEY 和 REGION");
  const escape = (s: string) => s.replace(/[<>&'\"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
  const response = await meteredFetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, { method: "POST", signal: AbortSignal.timeout(20000), headers: { "Ocp-Apim-Subscription-Key": speechKey, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3" }, body: `<speak version="1.0" xml:lang="en-US"><voice name="${escape(voice)}"><prosody rate="${slow ? "-22%" : "0%"}">${escape(text)}</prosody></voice></speak>`, cache: "no-store" }, {service:"tts",feature:"adult.read_aloud",model:voice,characters:[...text].length});
  if (!response.ok) throw new Error(`朗读暂时不可用（HTTP ${response.status}），可以先看文本练习。`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (cache) { try { await cache.client.send(new PutObjectCommand({ Bucket: cache.bucket, Key: key, Body: bytes, ContentType: "audio/mpeg" }), { abortSignal: AbortSignal.timeout(5000) }); } catch { /* Optional cache. */ } }
  return bytes;
}
