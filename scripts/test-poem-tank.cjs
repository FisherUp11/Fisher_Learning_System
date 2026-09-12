/* eslint-disable @typescript-eslint/no-require-imports */
// Execute the real Canvas component with a deterministic frame clock and no network.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
function setup(difficulty = "normal", longPoem = false) {
  let now = 0, frame, result, stateIndex = 0, refIndex = 0;
  const effects = [], states = [], windowEvents = {}, canvasEvents = {};
  const timers = [];
  let tx = 0, ty = 0; const stack = [];
  const texts = [];
  const ctx = new Proxy({ canvas: { width: 960, height: 600 }, save() { stack.push([tx, ty]); }, restore() { [tx, ty] = stack.pop() ?? [0, 0]; }, translate(x, y) { tx += x; ty += y; }, drawImage() { texts.length = 0; }, fillText(text, x, y) { texts.push({ text, x: x + tx, y: y + ty, color: ctx.fillStyle }); }, createLinearGradient() { return { addColorStop() {} }; } }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const canvas = { width: 960, height: 600, getContext: () => ctx, focus() {}, dataset: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 600 }), addEventListener(name, fn) { canvasEvents[name] = fn; }, removeEventListener() {} };
  const cache = new Map();
  let releaseSpeech;
  const speech = { warmPoemSpeech() {}, stopPoemSpeech() { releaseSpeech?.(); }, speakPoemText() { return new Promise(resolve => { releaseSpeech = resolve; }); } };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const fixtureModule = { exports: {} };
    const requireMock = id => id === "react" ? {
      useRef: value => ({ current: refIndex++ === 0 ? canvas : value }),
      useState: value => { const i = stateIndex++; states[i] = i === 0 ? true : value; return [states[i], next => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
      useEffect: effect => effects.push(effect),
    } : id === "react/jsx-runtime" ? { jsx() {}, jsxs() {} } : id === "@/lib/poem-speech" ? speech : id.startsWith("@/") ? load(id.slice(2) + ".ts") : require(id);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(source, { module: fixtureModule, exports: fixtureModule.exports, require: requireMock, performance: { now: () => now }, navigator: { getGamepads: () => [] }, document: { createElement: () => canvas, addEventListener() {}, removeEventListener() {} }, window: { addEventListener(name, fn) { windowEvents[name] = fn; }, removeEventListener() {}, setTimeout(fn, ms) { timers.push({ fn, at: now + ms }); } }, requestAnimationFrame(fn) { frame = fn; return 1; }, cancelAnimationFrame() {}, console, Event }, { filename: file });
    cache.set(file, fixtureModule.exports); return fixtureModule.exports;
  }
  const poem = { title: "春晓", content: "春眠不觉晓，处处闻啼鸟。夜来风雨声，花落知多少。", lines: ["春眠不觉晓", "处处闻啼鸟", "夜来风雨声", "花落知多少"] };
  if (longPoem) poem.lines = Array.from({ length: 12 }, (_, i) => `长诗测试第${i + 1}句`);
  const game = load("components/desktop-poem-tank-game.tsx");
  game.DesktopPoemTankGame({ poem, distractorLines: [], difficulty, blueprint: load("lib/poem-game.ts").proceduralPoemMap(poem), onStart() {}, onFinish(value) { result = value; } });
  effects.forEach(effect => effect());
  async function advance(seconds) { for (let i = 0; i < Math.ceil(seconds / .033); i++) { now += 33; for (const timer of timers.filter(t => t.at <= now)) { timer.at = Infinity; timer.fn(); } frame(now); await Promise.resolve(); } }
  return { advance, states, get result() { return result; }, canvasEvents, windowEvents, texts, release: () => releaseSpeech?.() };
}

test("each difficulty ends at its active-play limit and pause freezes the timer", async () => {
  for (const [difficulty, seconds] of [["easy", 300], ["normal", 360], ["challenge", 420]]) {
    const game = setup(difficulty);
    await game.advance(2);
    game.windowEvents.keydown({ code: "KeyP", preventDefault() {} });
    const before = game.states[1].time;
    await game.advance(30);
    assert.equal(game.states[1].time, before);
    assert.equal(game.result, undefined);
    game.windowEvents.keydown({ code: "KeyP", preventDefault() {} });
    await game.advance(seconds + 1);
    assert.equal(game.result.durationSeconds, seconds);
    assert.equal(game.result.isCompleted, false);
  }
});

test("held fire during narration cannot record the same poem target twice", async () => {
  const game = setup("easy");
  await game.advance(31);
  const target = game.texts.find(item => item.text === "春眠不觉晓" && item.color === "#162e46");
  assert.ok(target);
  game.canvasEvents.pointerdown({ clientX: target.x, clientY: target.y });
  await game.advance(2);
  game.windowEvents.keydown({ code: "Space", preventDefault() {} });
  await game.advance(5);
  game.windowEvents.keyup({ code: "Space" });
  game.release(); await game.advance(.8);
  assert.match(game.states[1].objective, /处处闻啼鸟/);
  game.canvasEvents["poem-game-stop"]();
  assert.equal(game.result.attempts.length, 1);
  assert.equal(game.result.correctCount, 1);
});

test("all twelve lines of a long poem remain inside the reachable arena", async () => {
  const game = setup("normal", true);
  await game.advance(31);
  const lines = game.texts.filter(item => /^长诗测试/.test(item.text));
  assert.equal(lines.length, 12);
  for (const line of lines) { assert.ok(line.x >= 125 && line.x <= 835); assert.ok(line.y >= 132 && line.y <= 568); }
});
