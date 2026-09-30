"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { PoemGameAttemptInput, PoemGameDifficulty, PoemGamePoem, PoemGameStage, PoemGameSummary, PoemMapBlueprint } from "@/lib/poem-game";
import { speakPoemText, stopPoemSpeech, warmPoemSpeech } from "@/lib/poem-speech";
import s from "./poem-adventure.module.css";

type Phase = "intro" | "listen" | "fill" | "choice" | "order" | "boss" | "done";
type Pet = "dragon" | "panda" | "bunny";
export type PoemCollectionEntry = { id: string; title: string; done: boolean };

const LEVELS: Record<PoemGameDifficulty, { label: string; hint: string; blanks: number; options: number; bridges: number; fillLines: number; bridgeCount: number }> = {
  easy: { label: "小芽", hint: "4–5 岁 · 每句找 1 个字", blanks: 1, options: 3, bridges: 2, fillLines: 4, bridgeCount: 2 },
  normal: { label: "小树", hint: "5–6 岁 · 每句找 2 个字", blanks: 2, options: 4, bridges: 3, fillLines: 6, bridgeCount: 3 },
  challenge: { label: "大树", hint: "7–8 岁 · 每句找 3 个字", blanks: 3, options: 6, bridges: 3, fillLines: 8, bridgeCount: 4 },
};
const PETS: Record<Pet, { icon: string; name: string }> = {
  dragon: { icon: "🐲", name: "小龙阿芽" },
  panda: { icon: "🐼", name: "熊猫团团" },
  bunny: { icon: "🐰", name: "兔子跳跳" },
};
const STATIONS: Array<{ phase: Phase; icon: string; label: string }> = [
  { phase: "listen", icon: "🎧", label: "听一听" },
  { phase: "fill", icon: "🧩", label: "拼诗句" },
  { phase: "choice", icon: "🌉", label: "过小桥" },
  { phase: "order", icon: "🛤️", label: "铺诗路" },
  { phase: "boss", icon: "☁️", label: "赶雾怪" },
];
const STAGE_OF: Partial<Record<Phase, PoemGameStage>> = { fill: "exposure", choice: "choice", order: "order", boss: "boss" };
const HAN = /\p{Script=Han}/u;
const clock = () => performance.now();

function seeded(seed: number) {
  let value = seed % 2147483647 || 1;
  return () => (value = value * 16807 % 2147483647) / 2147483647;
}
function shuffle<T>(items: T[], random: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

let audioContext: AudioContext | null = null;
function chime(kind: "good" | "soft" | "win") {
  try {
    audioContext ??= new AudioContext();
    const notes = kind === "good" ? [660, 880] : kind === "win" ? [523, 659, 784, 1047] : [300];
    notes.forEach((frequency, index) => {
      const oscillator = audioContext!.createOscillator();
      const gain = audioContext!.createGain();
      const start = audioContext!.currentTime + index * 0.1;
      oscillator.type = kind === "soft" ? "sine" : "triangle";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      oscillator.connect(gain).connect(audioContext!.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.25);
    });
  } catch {}
}

function readStore<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function writeStore(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function PoemAdventureGame({ learnerId, poem, distractorLines, blueprint, collection, onStart, onFinish }: {
  learnerId: string;
  poem: PoemGamePoem;
  distractorLines: string[];
  blueprint: PoemMapBlueprint;
  collection: PoemCollectionEntry[];
  onStart: () => void;
  onFinish: (summary: PoemGameSummary) => void;
}) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [level, setLevel] = useState<PoemGameDifficulty>("easy");
  const [pet, setPet] = useState<Pet>("dragon");
  const [totalStars, setTotalStars] = useState(0);
  const [stars, setStars] = useState(0);
  const [seed, setSeed] = useState(1);
  const [step, setStep] = useState(0);
  const [blankStep, setBlankStep] = useState(0);
  const [bubble, setBubble] = useState("");
  const [shake, setShake] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [built, setBuilt] = useState<number[]>([]);
  const [cleared, setCleared] = useState<Array<"clean" | "hint" | "listen">>([]);
  const [hinted, setHinted] = useState(0);
  const attempts = useRef<PoemGameAttemptInput[]>([]);
  const starsRef = useRef(0);
  const locked = useRef(false);
  const lastTap = useRef(0);
  // Blocks double taps before React re-renders the next question.
  const tapBlocked = () => {
    if (locked.current || clock() - lastTap.current < 300) return true;
    lastTap.current = clock();
    return false;
  };
  const listenToken = useRef(0);
  const firstTry = useRef(true);
  const shownAt = useRef(0);
  const startedAt = useRef(0);
  const lines = poem.lines;
  const config = LEVELS[level];

  useEffect(() => {
    // Local preferences are only readable after hydration.
    const restore = () => {
      setPet(readStore<Pet>("poem-adventure-pet", "dragon"));
      setTotalStars(readStore<number>(`poem-adventure-stars:${learnerId}`, 0));
      setLevel(readStore<PoemGameDifficulty>(`poem-adventure-level:${learnerId}`, "easy"));
    };
    restore();
  }, [learnerId]);
  useEffect(() => { warmPoemSpeech(lines); return stopPoemSpeech; }, [lines]);

  const plan = useMemo(() => {
    const random = seeded(seed * 7919 + lines.join("").length);
    const pool = [...new Set([...lines.join(""), ...distractorLines.join("")].filter((char) => HAN.test(char)))];
    const fillIndexes = lines.map((_, index) => index).slice(0, config.fillLines);
    const fills = fillIndexes.map((lineIndex) => {
      const chars = Array.from(lines[lineIndex]);
      const positions = chars.map((char, index) => HAN.test(char) ? index : -1).filter((index) => index >= 0);
      const blanks = shuffle(positions, random).slice(0, Math.min(config.blanks, Math.max(1, positions.length - 1))).sort((a, b) => a - b);
      const choices = blanks.map((position) => {
        const answer = chars[position];
        const wrong = shuffle(pool.filter((char) => char !== answer), random).slice(0, config.options - 1);
        return shuffle([answer, ...wrong], random);
      });
      return { lineIndex, chars, blanks, choices };
    }).filter((puzzle) => puzzle.blanks.length > 0);
    const bridgeTargets = shuffle(lines.map((_, index) => index).slice(1), random).slice(0, config.bridgeCount).sort((a, b) => a - b);
    const otherLines = [...new Set([...lines, ...distractorLines])];
    const bridges = bridgeTargets.map((lineIndex) => {
      const answer = lines[lineIndex];
      const wrong = shuffle(otherLines.filter((line) => line !== answer && line !== lines[lineIndex - 1]), random).slice(0, config.bridges - 1);
      return { lineIndex, prompt: lines[lineIndex - 1], answer, options: shuffle([answer, ...wrong], random) };
    });
    const orderCount = Math.min(lines.length, 8);
    return { fills, bridges, orderCount, orderCards: shuffle(lines.slice(0, orderCount).map((_, index) => index), random) };
  }, [seed, lines, distractorLines, config]);

  function say(text: string) { setBubble(text); }
  function record(stage: PoemGameStage, lineIndex: number | null, prompt: string, expected: string, selected: string, correct: boolean) {
    if (attempts.current.length >= 500) return;
    attempts.current.push({ eventIndex: attempts.current.length, stage, lineIndex, promptText: prompt, expectedText: expected, selectedText: selected, isCorrect: correct, isFirstTry: correct && firstTry.current, responseMs: Math.max(0, Math.round(clock() - shownAt.current)) });
  }
  function nextQuestion() { firstTry.current = true; shownAt.current = clock(); }
  function reward(amount: number) {
    starsRef.current += amount;
    setStars(starsRef.current);
    setBurst((value) => value + 1);
    chime("good");
  }
  function miss(key: string, text: string) {
    firstTry.current = false;
    setShake(key);
    window.setTimeout(() => setShake(null), 450);
    chime("soft");
    say(text);
  }

  function begin() {
    writeStore("poem-adventure-pet", pet);
    writeStore(`poem-adventure-level:${learnerId}`, level);
    onStart();
    attempts.current = [];
    startedAt.current = clock();
    setSeed((value) => value + 1);
    starsRef.current = 0;
    setStars(0); setStep(0); setBlankStep(0); setBuilt([]); setCleared([]); setHinted(0);
    setPhase("listen");
    say(`${PETS[pet].name}：我们先一起听《${poem.title}》，边听边看哦！`);
    const token = ++listenToken.current;
    void (async () => {
      for (let index = 0; index < lines.length; index += 1) {
        if (token !== listenToken.current) return;
        setStep(index);
        await speakPoemText(lines[index]);
      }
      if (token === listenToken.current) setStep(lines.length);
    })();
  }
  function goFill() {
    listenToken.current += 1;
    stopPoemSpeech();
    setPhase("fill"); setStep(0); setBlankStep(0); nextQuestion();
    say("诗句路上缺了几块砖，找到对的字，小坦克才能开过去！");
  }
  function goChoice() {
    if (!plan.bridges.length) return goOrder();
    setPhase("choice"); setStep(0); nextQuestion();
    say("河上有几座小桥，只有接对下一句的桥最结实！不会读可以点 🔊 听一听。");
  }
  function goOrder() {
    setPhase("order"); setBuilt([]); nextQuestion();
    say("诗句卡片被风吹乱了，按顺序一张张铺成诗路吧！");
  }
  function goBoss() {
    setPhase("boss"); setStep(0); setCleared([]); nextQuestion();
    say("遗忘雾怪来了！把诗一句一句背出来，雾就会散开。请爸爸妈妈当裁判～");
  }

  function pickChar(char: string) {
    const puzzle = plan.fills[step];
    if (!puzzle || tapBlocked()) return;
    const position = puzzle.blanks[blankStep];
    const answer = puzzle.chars[position];
    const prompt = puzzle.chars.map((c, index) => puzzle.blanks.includes(index) && puzzle.blanks.indexOf(index) >= blankStep ? "□" : c).join("");
    const correct = char === answer;
    record("exposure", puzzle.lineIndex, prompt, answer, char, correct);
    if (!correct) return miss(`fill-${char}`, `“${char}”不太对，再听一听这句？`);
    reward(firstTry.current ? 1 : 0);
    nextQuestion();
    if (blankStep + 1 < puzzle.blanks.length) { setBlankStep(blankStep + 1); say("对啦！还有一块砖～"); return; }
    say(`拼好啦：${lines[puzzle.lineIndex]}`);
    void speakPoemText(lines[puzzle.lineIndex]);
    locked.current = true;
    window.setTimeout(() => {
      locked.current = false;
      if (step + 1 < plan.fills.length) { setStep(step + 1); setBlankStep(0); nextQuestion(); }
      else goChoice();
    }, 900);
  }

  function pickBridge(option: string) {
    const bridge = plan.bridges[step];
    if (!bridge || tapBlocked()) return;
    const correct = option === bridge.answer;
    record("choice", bridge.lineIndex, `${bridge.prompt}，下一句是？`, bridge.answer, option, correct);
    if (!correct) return miss(`bridge-${option}`, "这座桥摇摇晃晃……想一想上一句后面接什么？");
    reward(firstTry.current ? 2 : 1);
    say("小坦克稳稳过桥啦！");
    void speakPoemText(`${bridge.prompt}，${bridge.answer}`);
    locked.current = true;
    window.setTimeout(() => {
      locked.current = false;
      if (step + 1 < plan.bridges.length) { setStep(step + 1); nextQuestion(); }
      else goOrder();
    }, 1100);
  }

  function pickCard(lineIndex: number) {
    if (tapBlocked()) return;
    const expected = built.length;
    const correct = lineIndex === expected;
    record("order", expected, `第 ${expected + 1} 句是？`, lines[expected], lines[lineIndex], correct);
    if (!correct) return miss(`card-${lineIndex}`, expected === 0 ? "诗路要从第一句开始铺哦。" : `接在“${lines[expected - 1]}”后面的是哪一句？`);
    reward(firstTry.current ? 1 : 0);
    const next = [...built, lineIndex];
    setBuilt(next);
    nextQuestion();
    if (next.length >= plan.orderCount) {
      locked.current = true;
      say("诗路铺好啦！远处好像飘来一团雾……");
      window.setTimeout(() => { locked.current = false; goBoss(); }, 1200);
    }
  }

  function judge(result: "clean" | "hint" | "listen") {
    if (cleared.length >= lines.length || tapBlocked()) return;
    const line = lines[step];
    record("boss", step, `背出第 ${step + 1} 句`, line, result === "clean" ? "独立背出" : result === "hint" ? "提示后背出" : "听后跟读", result !== "listen");
    const next = [...cleared, result];
    setCleared(next);
    setHinted(0);
    if (result === "clean") reward(2); else if (result === "hint") reward(1); else chime("soft");
    say(result === "clean" ? "哇！雾怪被打散一块！" : result === "hint" ? "提示一下也很棒，继续！" : "跟着读一遍，下次一定能背出来！");
    if (result === "listen") void speakPoemText(line);
    nextQuestion();
    if (next.length >= lines.length) {
      locked.current = true;
      chime("win");
      window.setTimeout(() => { locked.current = false; finishRun(true); }, 900);
    } else setStep(step + 1);
  }

  function finishRun(completed: boolean) {
    listenToken.current += 1;
    stopPoemSpeech();
    const earned = starsRef.current;
    const nextTotal = totalStars + earned;
    setTotalStars(nextTotal);
    writeStore(`poem-adventure-stars:${learnerId}`, nextTotal);
    if (completed) { setPhase("done"); say(`${PETS[pet].name}：你太棒啦！现在请爸爸妈妈听你完整背一遍吧～`); }
    else submit(false);
  }

  function goFillOrSkip() {
    if (plan.fills.length) goFill(); else goChoice();
  }

  function submit(completed: boolean) {
    const correctCount = attempts.current.filter((attempt) => attempt.isCorrect).length;
    const stage = (STAGE_OF[phase] ?? (phase === "done" ? "boss" : "warmup")) as PoemGameStage;
    onFinish({
      mode: window.matchMedia("(max-width: 759px)").matches ? "mobile" : "desktop",
      durationSeconds: Math.max(1, Math.round((clock() - startedAt.current) / 1000)),
      completedStage: stage,
      isCompleted: completed,
      correctCount,
      wrongCount: attempts.current.length - correctCount,
      firstTryCorrectCount: attempts.current.filter((attempt) => attempt.isCorrect && attempt.isFirstTry).length,
      bossHits: cleared.filter((result) => result === "clean").length,
      attempts: attempts.current,
    });
  }

  useEffect(() => {
    if (phase !== "fill" && phase !== "choice") return;
    function onKey(event: KeyboardEvent) {
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0) return;
      if (phase === "fill") { const option = plan.fills[step]?.choices[blankStep]?.[index]; if (option) pickChar(option); }
      if (phase === "choice") { const option = plan.bridges[step]?.options[index]; if (option) pickBridge(option); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const petLevel = Math.floor(totalStars / 20) + 1;
  const stationIndex = Math.max(0, STATIONS.findIndex((station) => station.phase === phase));
  const collected = collection.filter((entry) => entry.done).length;
  const mapStyle = { "--sky": blueprint.palette[0], "--ground": blueprint.palette[3], "--accent": blueprint.palette[2], backgroundImage: blueprint.backgroundImage ? `linear-gradient(#ffffff55,#ffffff22), url(${blueprint.backgroundImage})` : undefined } as CSSProperties;

  if (phase === "intro") return <section className={s.game} aria-label="诗境小坦克大冒险">
    <div className={s.introHero} style={mapStyle}>
      <span className={s.introTank} aria-hidden="true"><TankIcon /></span>
      <div><p className={s.kicker}>诗境小坦克 · 寻句大冒险</p><h2>《{poem.title}》</h2><p>{blueprint.brief}</p></div>
    </div>
    <div className={s.setupGrid}>
      <fieldset className={s.choiceGroup}><legend>选一个小伙伴</legend>{(Object.keys(PETS) as Pet[]).map((key) => <button key={key} type="button" aria-pressed={pet === key} className={pet === key ? s.picked : ""} onClick={() => setPet(key)}><span className={s.petIcon}>{PETS[key].icon}</span>{PETS[key].name}</button>)}</fieldset>
      <fieldset className={s.choiceGroup}><legend>选难度</legend>{(Object.keys(LEVELS) as PoemGameDifficulty[]).map((key) => <button key={key} type="button" aria-pressed={level === key} className={level === key ? s.picked : ""} onClick={() => setLevel(key)}><strong>{LEVELS[key].label}</strong><small>{LEVELS[key].hint}</small></button>)}</fieldset>
    </div>
    <div className={s.petCard}><span className={s.petIcon}>{PETS[pet].icon}</span><div><strong>{PETS[pet].name} · Lv.{petLevel}</strong><small>累计 ⭐ {totalStars}，再得 {20 - (totalStars % 20)} 颗星就会长大一级</small></div></div>
    {collection.length > 1 && <details className={s.album}><summary>诗印图鉴 {collected} / {collection.length}</summary><div className={s.albumGrid}>{collection.map((entry) => <span key={entry.id} className={entry.done ? s.sealDone : s.seal} title={entry.title}>{entry.done ? "印" : "？"}<small>{entry.title}</small></span>)}</div></details>}
    <button type="button" className={`primary ${s.bigButton}`} onClick={begin}>出发！</button>
    <p className={s.note}>约 3–6 分钟。答错不扣分，会给提示；最后由爸爸妈妈当裁判听孩子背。</p>
  </section>;

  return <section className={s.game} aria-label="诗境小坦克大冒险">
    <header className={s.hud}>
      <strong>《{poem.title}》</strong>
      <span className={s.starCount} key={burst}>⭐ {stars}</span>
      <button type="button" className={s.iconButton} onClick={() => void speakPoemText(lines.join("，"))} aria-label="听整首诗">🔊 整首</button>
      {phase !== "done" && <button type="button" className={s.iconButton} onClick={() => finishRun(false)}>结束</button>}
    </header>
    <div className={s.map} style={mapStyle}>
      <div className={s.road} />
      {STATIONS.map((station, index) => <span key={station.phase} className={`${s.station} ${index < stationIndex || phase === "done" ? s.passed : ""} ${index === stationIndex && phase !== "done" ? s.current : ""}`} style={{ left: `${1 + index * 19.6}%` }}><span>{station.icon}</span><small>{station.label}</small></span>)}
      <span className={s.tank} style={{ left: `calc(${phase === "done" ? 88 : 1 + stationIndex * 19.6 + 9.8}% - 29px)` }} aria-hidden="true"><TankIcon /></span>
      {burst > 0 && <span className={s.burst} key={`b${burst}`} aria-hidden="true">✦ ⭐ ✦</span>}
    </div>
    <div className={s.bubble} aria-live="polite"><span className={s.petIcon}>{PETS[pet].icon}</span><p>{bubble}</p></div>

    {phase === "listen" && <div className={s.stage}>
      <div className={s.poemLines}>{lines.map((line, index) => <p key={index} className={index === step ? s.glow : index < step ? s.heard : ""}>{line}</p>)}</div>
      <div className={s.actions}><button type="button" className="secondary" onClick={() => void speakPoemText(lines.join("，"))}>再听一遍</button><button type="button" className={`primary ${s.bigButton}`} onClick={goFillOrSkip}>{step >= lines.length ? "听完啦，开始闯关" : "我会啦，直接闯关"}</button></div>
    </div>}

    {phase === "fill" && plan.fills[step] && <div className={s.stage}>
      <p className={s.progress}>第 {step + 1} / {plan.fills.length} 句</p>
      <div className={s.slots}>{plan.fills[step].chars.map((char, index) => {
        const order = plan.fills[step].blanks.indexOf(index);
        const hidden = order >= blankStep;
        return <span key={index} className={order < 0 ? s.slotFixed : hidden ? (order === blankStep ? s.slotActive : s.slotEmpty) : s.slotFilled}>{hidden ? "" : char}</span>;
      })}</div>
      <button type="button" className={s.listenLink} onClick={() => void speakPoemText(lines[plan.fills[step].lineIndex])}>🔊 听这句</button>
      <div className={s.blocks}>{plan.fills[step].choices[blankStep]?.map((char, index) => <button key={`${char}-${index}`} type="button" className={`${s.block} ${shake === `fill-${char}` ? s.shake : ""}`} style={{ animationDelay: `${index * 0.15}s` }} onClick={() => pickChar(char)}><span className={s.keyHint}>{index + 1}</span>{char}</button>)}</div>
    </div>}

    {phase === "choice" && plan.bridges[step] && <div className={s.stage}>
      <p className={s.progress}>第 {step + 1} / {plan.bridges.length} 座桥</p>
      <p className={s.prompt}>{plan.bridges[step].prompt}，<span>下一句是？</span></p>
      <div className={s.bridges}>{plan.bridges[step].options.map((option, index) => <div key={option} className={`${s.bridge} ${shake === `bridge-${option}` ? s.shake : ""}`}><button type="button" className={s.bridgeMain} onClick={() => pickBridge(option)}><span className={s.keyHint}>{index + 1}</span>🌉 {option}</button><button type="button" className={s.bridgeListen} aria-label={`听：${option}`} onClick={() => void speakPoemText(option)}>🔊</button></div>)}</div>
    </div>}

    {phase === "order" && <div className={s.stage}>
      <p className={s.progress}>已铺 {built.length} / {plan.orderCount} 段诗路</p>
      <ol className={s.builtRoad}>{built.map((lineIndex) => <li key={lineIndex}>{lines[lineIndex]}</li>)}</ol>
      <div className={s.cards}>{plan.orderCards.filter((lineIndex) => !built.includes(lineIndex)).map((lineIndex) => <button key={lineIndex} type="button" className={`${s.card} ${shake === `card-${lineIndex}` ? s.shake : ""}`} onClick={() => pickCard(lineIndex)}>{lines[lineIndex]}</button>)}</div>
    </div>}

    {phase === "boss" && <div className={s.stage}>
      <div className={s.boss}><span className={s.bossFace} aria-hidden="true"><FogMonster /></span><div className={s.hp}><span style={{ width: `${(1 - cleared.length / lines.length) * 100}%` }} /></div><small>遗忘雾怪 · 还剩 {lines.length - cleared.length} 句</small></div>
      <div className={s.poemLines}>{lines.map((line, index) => <p key={index} className={index < cleared.length ? s.clearedLine : index === step ? s.fogActive : s.fog}>{index < cleared.length ? line : index === step && hinted ? `${Array.from(line).slice(0, hinted).join("")}${"□".repeat(Math.max(0, Array.from(line).length - hinted))}` : "□".repeat(Array.from(line).length)}</p>)}</div>
      <p className={s.judgeTitle}>孩子背第 {step + 1} 句，爸爸妈妈来判断：</p>
      <div className={s.judge}>
        <button type="button" className="primary" onClick={() => judge(hinted ? "hint" : "clean")}>{hinted ? "✓ 提示后背出来了" : "✓ 背出来了"}</button>
        <button type="button" className="secondary" disabled={hinted >= Array.from(lines[step] ?? "").length - 1} onClick={() => { setHinted((value) => value + 1); firstTry.current = false; }}>💡 露一个字</button>
        <button type="button" className="text-button" onClick={() => judge("listen")}>🔊 听一遍再跟读</button>
      </div>
    </div>}

    {phase === "done" && <div className={`${s.stage} ${s.win}`}>
      <span className={s.sealBig}>印</span>
      <h2>雾怪被赶跑啦！</h2>
      <p>这一局得到 ⭐ {stars}，《{poem.title}》的诗印收进图鉴。{PETS[pet].name}{Math.floor(totalStars / 20) + 1 > Math.floor((totalStars - stars) / 20) + 1 ? " 长大了一级！" : " 很开心！"}</p>
      <button type="button" className={`primary ${s.bigButton}`} onClick={() => submit(true)}>保存本局，请家长评分</button>
    </div>}
  </section>;
}

function FogMonster() {
  return <svg viewBox="0 0 120 80" width="120" height="80">
    <path d="M22 62 q-16 0 -16 -14 q0 -14 16 -14 q2 -18 22 -18 q10 -12 26 -4 q20 -6 28 12 q18 2 16 20 q0 18 -20 18 z" fill="#c9cfd8" stroke="#8e98a8" strokeWidth="3" />
    <circle cx="48" cy="42" r="7" fill="#fff" /><circle cx="50" cy="43" r="3.5" fill="#3b4454" />
    <circle cx="74" cy="42" r="7" fill="#fff" /><circle cx="72" cy="43" r="3.5" fill="#3b4454" />
    <path d="M52 56 q9 6 18 0" stroke="#3b4454" strokeWidth="3" fill="none" strokeLinecap="round" />
    <circle cx="38" cy="52" r="4" fill="#f3b6b6" opacity=".7" /><circle cx="84" cy="52" r="4" fill="#f3b6b6" opacity=".7" />
  </svg>;
}

function TankIcon() {
  return <svg viewBox="0 0 64 48" width="100%" height="100%">
    <rect x="6" y="30" width="52" height="12" rx="6" fill="#3b5d4b" />
    {[14, 26, 38, 50].map((x) => <circle key={x} cx={x} cy="36" r="4" fill="#a8c5a0" />)}
    <rect x="10" y="18" width="44" height="15" rx="7" fill="#f08a6b" />
    <rect x="22" y="8" width="20" height="14" rx="7" fill="#ffd27a" />
    <rect x="40" y="12" width="18" height="5" rx="2.5" fill="#3b5d4b" />
    <circle cx="28" cy="15" r="1.8" fill="#23372c" /><circle cx="36" cy="15" r="1.8" fill="#23372c" />
    <path d="M29 18 q3 3 6 0" stroke="#23372c" strokeWidth="1.5" fill="none" strokeLinecap="round" />
  </svg>;
}
