import assert from "node:assert/strict";
import { test } from "node:test";
import { frogSapiPinyin, frogSpeechBillableCharacters, frogSpeechObjectKey, frogSpeechSsml, resolveFrogAudio } from "../lib/hanzi-frog-speech-cache.ts";
import { FrogSpeechClient } from "../lib/hanzi-frog-speech-client.ts";

const workspace = "00000000-0000-4000-8000-000000000001";
const word = { hanzi: "上", pinyin_marked: "shàng" };
const voice = "zh-CN-XiaoxiaoNeural";
const bytes = new Uint8Array(400).fill(42);

test("朗读路径确定、版本/空间/声音归类，读音和音色变化会换缓存", () => {
  const key = frogSpeechObjectKey(workspace, voice, word);
  assert.match(key, /^learning-audio\/hanzi-frog\/v1\/00000000-0000-4000-8000-000000000001\/zh-CN\/zh-CN-XiaoxiaoNeural\/slow32-repeat2-gap650\/[a-f0-9]{2}\/[a-f0-9]{64}\.mp3$/);
  assert.equal(frogSpeechObjectKey(workspace, voice, word), key);
  assert.notEqual(frogSpeechObjectKey(workspace, "zh-CN-YunxiNeural", word), key);
  assert.notEqual(frogSpeechObjectKey(workspace.replace(/1$/, "2"), voice, word), key);
  assert.notEqual(frogSpeechObjectKey(workspace, voice, { ...word, pinyin_marked: "shǎng" }), key);
  assert.throws(() => frogSpeechObjectKey("../../outside", voice, word));
});

test("中文拼音控制读音；慢读两遍、停顿、完整 SSML 命名空间", () => {
  for (const [pinyin, sapi] of [["shàng", "shang 4"], ["zhōng", "zhong 1"], ["lǜ", "lv 4"], ["lüè", "lue 4"], ["nǚ", "nv 3"], ["jué", "jue 2"], ["de", "de 5"], ["chang2", "chang 2"]]) {
    assert.equal(frogSapiPinyin(pinyin), sapi);
  }
  assert.equal(frogSapiPinyin("cháng/zhǎng"), null);
  assert.equal(frogSapiPinyin("shàng1"), null);
  const ssml = frogSpeechSsml(word, voice);
  assert.equal((ssml.match(/>上<\/phoneme>/g) ?? []).length, 2);
  assert.match(ssml, /rate="-32%"/);
  assert.match(ssml, /break time="650ms"/);
  assert.match(ssml, /xmlns="http:\/\/www.w3.org\/2001\/10\/synthesis"/);
  assert.match(frogSpeechSsml({ hanzi: "<&", pinyin_marked: "invalid!" }, 'x"y'), /name="x&amp;quot;y"|name="x&quot;y"/);
  assert.match(frogSpeechSsml({ hanzi: "<&", pinyin_marked: "invalid!" }, voice), /&lt;&amp;/);
});

test("冷缓存仅生成一次；后续命中即使禁止新合成也直接返回", async () => {
  let generated = 0;
  const storage = new Map();
  const deps = {
    read: async (key) => storage.has(key) ? "https://r2.example/cached.mp3" : null,
    generate: async () => { generated += 1; return bytes; },
    write: async (key, value) => { storage.set(key, value); },
    sign: async () => "https://r2.example/cached.mp3",
  };
  assert.equal((await resolveFrogAudio("key", true, deps)).cache, "miss");
  assert.equal((await resolveFrogAudio("key", false, deps)).cache, "hit");
  assert.equal(generated, 1);
  await assert.rejects(resolveFrogAudio("new", false, deps), /尚未缓存/);
  assert.equal(generated, 1);
});

test("额度估算包含内层 SSML 和中文双字符，不计外层声音名称", () => {
  const ssml = frogSpeechSsml(word, voice);
  const inner = ssml.replace(/<\/?(?:speak|voice)\b[^>]*>/g, "");
  assert.equal(frogSpeechBillableCharacters(word, voice), [...inner].length + 2);
  assert.ok(frogSpeechBillableCharacters(word, voice) > 4);
  assert.equal(frogSpeechBillableCharacters(word, voice), frogSpeechBillableCharacters(word, "another-longer-voice-name"));
});

test("R2 读取权限错误不触发付费；写入失败仍可播放已合成的音频", async () => {
  let generated = 0;
  const deps = {
    read: async () => { throw new Error("R2 denied"); },
    generate: async () => { generated += 1; return bytes; },
    write: async () => { throw new Error("R2 write failed"); },
    sign: async () => "signed",
  };
  await assert.rejects(resolveFrogAudio("key", true, deps), /R2 denied/);
  assert.equal(generated, 0);
  const result = await resolveFrogAudio("key", true, { ...deps, read: async () => null });
  assert.equal(result.cache, "temporary");
  assert.match(result.url, /^data:audio\/mpeg;base64,/);
  assert.equal(generated, 1);
});

test("客户端提前下载，重复请求合并，重听零网络；销毁清理缓存", async () => {
  const oldFetch = globalThis.fetch;
  let posts = 0;
  let downloads = 0;
  globalThis.fetch = async (url, options) => {
    if (url === "/api/hanzi-frog/speech") {
      posts += 1;
      const body = JSON.parse(options.body);
      assert.equal(body.learnerId, workspace);
      return Response.json({ items: body.characterIds.map((id) => ({ characterId: id, url: `https://r2.example/${id}.mp3` })) });
    }
    downloads += 1;
    return new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } });
  };
  const cache = new FrogSpeechClient(workspace);
  try {
    await Promise.all([cache.warm(["one", "two"]), cache.get("one"), cache.get("two")]);
    assert.equal(posts, 1);
    assert.equal(downloads, 2);
    assert.match(await cache.get("one"), /^blob:/);
    await cache.warm(["two", "one"]);
    assert.equal(posts, 1);
    assert.equal(downloads, 2);
    cache.dispose();
    assert.equal(cache.peek("one"), null);
    await cache.warm(["three"]);
    assert.equal(posts, 1);
  } finally { cache.dispose(); globalThis.fetch = oldFetch; }
});

test("额度拦截不反复合成，仍能读取其他已缓存的字", async () => {
  const oldFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    if (url === "/api/hanzi-frog/speech") {
      const body = JSON.parse(options.body);
      requests.push(body);
      return Response.json({ items: body.characterIds.map((id) => id === "new"
        ? { characterId: id, error: "刚才使用语音的人较多，请稍后再试", retryAfterSeconds: 60 }
        : { characterId: id, url: "https://r2.example/cached.mp3" }) });
    }
    return new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } });
  };
  const cache = new FrogSpeechClient(workspace);
  try {
    assert.equal(await cache.get("new"), null);
    assert.equal(await cache.get("new"), null);
    assert.equal(requests.length, 1);
    assert.match(await cache.get("cached"), /^blob:/);
    assert.equal(requests[1].allowGenerate, false);
  } finally { cache.dispose(); globalThis.fetch = oldFetch; }
});

test("浏览器下载被 CORS 阻止时保留可由 audio 播放的签名源", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === "/api/hanzi-frog/speech") return Response.json({ items: [{ characterId: "one", url: "https://r2.example/one.mp3" }] });
    throw new Error("CORS failed");
  };
  const cache = new FrogSpeechClient(workspace);
  try { assert.equal(await cache.get("one"), "https://r2.example/one.mp3"); }
  finally { cache.dispose(); globalThis.fetch = oldFetch; }
});
