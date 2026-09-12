"use client";

import { useEffect, useRef, useState } from "react";
import type { PoemGameAttemptInput, PoemGamePoem, PoemGameStage, PoemGameSummary, PoemMapBlueprint } from "@/lib/poem-game";
import { POEM_GAME_DIFFICULTIES, type PoemGameDifficulty } from "@/lib/poem-game";
import { paintPoemScene } from "@/lib/poem-game-scene";
import { speakPoemText, stopPoemSpeech, warmPoemSpeech } from "@/lib/poem-speech";

type Point = { x: number; y: number };
type Tank = Point & { dir: number; speed: number; cooldown: number; turnIn?: number; glyph?: string };
type Bullet = Point & { dx: number; dy: number; owner: "player" | "enemy"; life: number };
type Target = Point & { w: number; h: number; text: string; lineIndex: number; correct: boolean; active: boolean; dx: number };
type EngineStage = "warmup" | "exposure" | "choice" | "order" | "boss";

const STAGE_LABELS: Record<EngineStage, string> = {
  warmup: "01 · 热身巡游",
  exposure: "02 · 点亮诗堡",
  choice: "03 · 追击下句",
  order: "04 · 占领诗序",
  boss: "05 · 诗卷 Boss",
};

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function formatTime(seconds: number) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function targetPositions(count: number) {
  const columns = count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => ({
    x: columns === 2 ? 250 + (index % 2) * 460 : 170 + (index % 3) * 310,
    y: 170 + Math.floor(index / columns) * (rows > 1 ? 340 / (rows - 1) : 0),
  }));
}

export function DesktopPoemTankGame({ poem, distractorLines, blueprint, difficulty = "normal", onStart, onFinish }: { poem: PoemGamePoem; distractorLines: string[]; blueprint: PoemMapBlueprint; difficulty?: PoemGameDifficulty; onStart: () => void; onFinish: (summary: PoemGameSummary) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFinishRef = useRef(onFinish);
  const blueprintRef = useRef(blueprint);
  const [started, setStarted] = useState(false);
  const [hud, setHud] = useState({ stage: "等待出发", objective: "准备进入诗境", time: formatTime(POEM_GAME_DIFFICULTIES[difficulty].minutes * 60), stars: 0, revealed: 0, controller: "键盘可用", shield: 3, combo: 0, battle: false });
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const [tip, setTip] = useState("方向键 / WASD 移动，空格键发射；也支持常见 USB 或蓝牙手柄。");
  const [finishing, setFinishing] = useState(false);

  useEffect(() => { onFinishRef.current = onFinish; }, [onFinish]);
  useEffect(() => { blueprintRef.current = blueprint; }, [blueprint]);
  useEffect(() => { warmPoemSpeech(poem.lines); return stopPoemSpeech; }, [poem.lines]);

  useEffect(() => {
    if (!started) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const drawingContext = canvas.getContext("2d");
    if (!drawingContext) return;
    const context: CanvasRenderingContext2D = drawingContext;
    const width = canvas.width;
    const height = canvas.height;
    const activeBlueprint = blueprintRef.current;
    const settings = POEM_GAME_DIFFICULTIES[difficulty];
    const backdrop = document.createElement("canvas"); backdrop.width = width; backdrop.height = height;
    const backdropContext = backdrop.getContext("2d")!;
    paintPoemScene(backdropContext, activeBlueprint, poem.title + poem.content);
    if (activeBlueprint.backgroundImage) {
      const sceneImage = new Image();
      sceneImage.onload = () => { if (!cancelled) paintPoemScene(backdropContext, activeBlueprint, poem.title + poem.content, sceneImage); };
      sceneImage.src = activeBlueprint.backgroundImage;
    }
    const keys = new Set<string>();
    let frame = 0;
    let cancelled = false;
    let last = performance.now();
    let lastHud = 0;
    let timeLeft = settings.minutes * 60;
    let elapsed = 0;
    let speaking = false;
    let battleLeft = 0;
    let afterBattle: (() => void) | null = null;
    let shield = difficulty === "easy" ? 5 : 3;
    let invincible = 0;
    let rapid = 0;
    let combo = 0;
    let spawnIn = 1;
    let drops: Array<Point & { kind: "star" | "shield" | "rapid"; life: number }> = [];
    const missed = new Set<number>();
    let bossQueue: number[] = [];
    let bossStep = 0;
    let mainCompleted = false;
    let reviewRound = 0;
    let stage: EngineStage = "warmup";
    let stageLocked = false;
    let stageElapsed = 0;
    const player: Tank = { x: width / 2, y: height - 55, dir: -Math.PI / 2, speed: 210, cooldown: 0 };
    let enemies: Tank[] = [];
    let bullets: Bullet[] = [];
    let targets: Target[] = [];
    let particles: Array<Point & { life: number; color: string }> = [];
    let kills = 0;
    let stars = 0;
    let revealed = 0;
    let exposureIndex = 0;
    let choiceIndex = 1;
    let orderIndex = 0;
    let bossIndex = 0;
    let firstTry = true;
    let questionStartedAt = 0;
    let answerLockedUntil = 0;
    let ended = false;
    const attempts: PoemGameAttemptInput[] = [];
    const orderedLines = poem.lines.slice(0, 12);

    function objective(text: string) {
      setHud((current) => ({ ...current, stage: STAGE_LABELS[stage], objective: text }));
      setTip(text);
    }

    function spawnEnemy(seed = Math.random()) {
      const safe = [
        { x: 70, y: 145, dir: 0 }, { x: width - 70, y: 145, dir: Math.PI },
        { x: 75, y: 355, dir: 0 }, { x: width - 75, y: 355, dir: Math.PI },
        { x: width / 2, y: 165, dir: Math.PI / 2 },
      ];
      const point = safe[Math.floor(seed * safe.length) % safe.length];
      if (enemies.some((enemy) => Math.hypot(enemy.x - point.x, enemy.y - point.y) < 85)) return;
      enemies.push({ ...point, speed: settings.enemySpeed + Math.random() * 12, cooldown: 1 + Math.random(), turnIn: 0.5 + Math.random() * 1.2, glyph: ["忘", "雾", "乱", "散"][enemies.length % 4] });
    }

    function recordTarget(target: Target) {
      const expected = stage === "exposure" ? orderedLines[exposureIndex] : stage === "order" ? orderedLines[orderIndex] : orderedLines[stage === "boss" ? bossIndex : choiceIndex];
      const correct = target.text === expected && target.active;
      attempts.push({
        eventIndex: attempts.length,
        stage,
        lineIndex: correct ? target.lineIndex : (stage === "exposure" ? exposureIndex : stage === "order" ? orderIndex : stage === "boss" ? bossIndex : choiceIndex),
        promptText: stage === "exposure" ? "按顺序点亮诗句" : stage === "order" ? `寻找第 ${orderIndex + 1} 句` : stage === "boss" ? "诗卷 Boss 诗印" : "看上句找下句",
        expectedText: expected,
        selectedText: target.text,
        isCorrect: correct,
        isFirstTry: correct && firstTry,
        responseMs: Math.max(0, Math.round((elapsed - questionStartedAt) * 1000)),
      });
      if (!correct) { firstTry = false; missed.add(stage === "order" ? orderIndex : stage === "boss" ? bossIndex : choiceIndex); }
      return correct;
    }

    function answerTargets(answer: string, lineIndex: number, moving = true) {
      const wrong = distractorLines.filter((line) => line !== answer && !orderedLines.includes(line)).slice(lineIndex * 2, lineIndex * 2 + 2);
      const localWrong = orderedLines.filter((line) => line !== answer && line !== orderedLines[Math.max(0, lineIndex - 1)]);
      const options = shuffle([answer, ...wrong, ...localWrong].filter((line, index, rows) => rows.indexOf(line) === index).slice(0, settings.options));
      targets = options.map((text, index) => ({ x: width / (options.length + 1) * (index + 1), y: 220 + (index % 2) * 145, w: 230, h: 66, text, lineIndex, correct: text === answer, active: true, dx: moving ? (index % 2 ? settings.targetSpeed : -settings.targetSpeed) : 0 }));
      firstTry = true;
      questionStartedAt = elapsed;
    }

    function enterStage(next: EngineStage) {
      stage = next;
      stageLocked = false;
      stageElapsed = 0;
      bullets = [];
      enemies = [];
      targets = [];
      drops = [];
      answerLockedUntil = 0;
      if (next === "warmup") {
        kills = 0;
        for (let index = 0; index < settings.enemyCount; index += 1) spawnEnemy((index + 1) / 5);
        objective("移动、发射！收集星星，守护你的诗境");
      } else if (next === "exposure") {
        exposureIndex = 0;
        const positions = targetPositions(orderedLines.length);
        targets = orderedLines.map((line, index) => ({ ...positions[index], w: orderedLines.length > 4 ? 250 : 285, h: 64, text: line, lineIndex: index, correct: true, active: index === 0, dx: 0 }));
        firstTry = true;
        questionStartedAt = elapsed;
        objective(`按顺序击中发光诗堡：${orderedLines[0]}`);
      } else if (next === "choice") {
        choiceIndex = orderedLines.length > 1 ? 1 : 0;
        answerTargets(orderedLines[choiceIndex], choiceIndex);
        objective(choiceIndex === 0 ? `《${poem.title}》第一句是？` : `${orderedLines[choiceIndex - 1]}，下一句是？`);
      } else if (next === "order") {
        orderIndex = 0;
        const positions = targetPositions(orderedLines.length);
        targets = shuffle(orderedLines.map((line, index) => ({ line, index }))).map((item, index) => ({ ...positions[index], w: orderedLines.length > 4 ? 250 : 285, h: 64, text: item.line, lineIndex: item.index, correct: true, active: true, dx: 0 }));
        firstTry = true;
        questionStartedAt = elapsed;
        objective("占领第 1 句诗序据点");
      } else {
        bossQueue = [...missed, ...orderedLines.map((_, i) => i)].filter((value, i, all) => value >= 0 && value < orderedLines.length && all.indexOf(value) === i);
        bossStep = 0;
        bossIndex = bossQueue[0];
        answerTargets(orderedLines[bossIndex], bossIndex, false);
        objective(`诗卷 Boss：回想第 ${bossIndex + 1} 句，击碎记忆封印`);
      }
    }

    function battleThen(next: () => void) {
      speaking = false;
      bullets = []; targets = [];
      battleLeft = Math.min(settings.battleSeconds, Math.max(0, timeLeft - 35));
      if (battleLeft <= 0) return next();
      afterBattle = next;
      for (let i = 0; i < settings.enemyCount; i++) spawnEnemy((i + 1) / 5);
      drops.push({ x: width / 2, y: 350, kind: combo >= 3 ? "rapid" : "shield", life: 12 });
      objective(combo >= 3 ? "连对奖励！拾取闪电，试试快速发射" : "诗句已点亮！击散迷雾，拾取补给");
    }

    function advanceStage() {
      if (stageLocked) return;
      stageLocked = true;
      const next = stage === "warmup" ? "exposure" : stage === "exposure" ? "choice" : stage === "choice" ? "order" : stage === "order" ? "boss" : null;
      if (!next) {
        finish(true);
        return;
      }
      objective("任务完成，马上进入下一段诗境");
      window.setTimeout(() => { if (!cancelled && !ended) enterStage(next); }, 650);
    }

    async function correctHit(target: Target) {
      if (stageLocked || speaking || battleLeft > 0 || performance.now() < answerLockedUntil) return;
      const correct = recordTarget(target);
      if (!correct) {
        combo = 0; speaking = true; bullets = [];
        const answer = stage === "exposure" ? orderedLines[exposureIndex] : stage === "order" ? orderedLines[orderIndex] : orderedLines[stage === "boss" ? bossIndex : choiceIndex];
        objective(`一起记住：${answer}。听完再找一找`);
        await speakPoemText(answer);
        speaking = false;
        answerLockedUntil = performance.now() + 350;
        return;
      }
      speaking = true; bullets = [];
      target.active = false;
      combo += 1;
      stars += firstTry ? 2 : 1;
      answerLockedUntil = performance.now() + 450;
      for (let index = 0; index < 18; index += 1) particles.push({ x: target.x + (Math.random() - 0.5) * 60, y: target.y + (Math.random() - 0.5) * 45, life: 1, color: activeBlueprint.palette[2] });
      objective(`命中！慢慢听：${target.text}`);
      await speakPoemText(target.text);
      if (cancelled || ended) return;
      speaking = false;
      if (stage === "exposure") {
        revealed += 1;
        exposureIndex += 1;
        if (exposureIndex >= orderedLines.length) return battleThen(advanceStage);
        targets.forEach((item) => { item.active = item.lineIndex === exposureIndex; });
        firstTry = true;
        questionStartedAt = elapsed;
        objective(`继续点亮：${orderedLines[exposureIndex]}`);
      } else if (stage === "choice") {
        choiceIndex += 1;
        battleThen(() => {
          if (choiceIndex >= orderedLines.length) return advanceStage();
          answerTargets(orderedLines[choiceIndex], choiceIndex);
          objective(`${orderedLines[choiceIndex - 1]}，下一句是？`);
        });
      } else if (stage === "order") {
        orderIndex += 1;
        if (orderIndex >= orderedLines.length) return battleThen(advanceStage);
        targets = targets.filter((item) => item !== target);
        firstTry = true;
        questionStartedAt = elapsed;
        objective(`占领第 ${orderIndex + 1} 句诗序据点`);
      } else if (stage === "boss") {
        bossStep += 1;
        if (bossStep >= bossQueue.length) {
          mainCompleted = true;
          // Fast players get short retrieval + arcade rounds, never an idle timer.
          if (timeLeft > 45) {
            reviewRound += 1;
            const reviewLines = missed.size ? [...missed] : orderedLines.map((_, i) => i);
            bossQueue = [reviewLines[reviewRound % reviewLines.length], reviewLines[(reviewRound + 1) % reviewLines.length]];
            bossStep = 0;
            return battleThen(() => {
              bossIndex = bossQueue[0];
              answerTargets(orderedLines[bossIndex], bossIndex, difficulty !== "easy");
              objective(`记忆巡游：不看诗卷，找出第 ${bossIndex + 1} 句`);
            });
          }
          objective("诗卷 Boss 已击退，听完整首诗");
          speaking = true;
          await speakPoemText(`${poem.title}。${orderedLines.join("。")}`);
          if (cancelled || ended) return;
          speaking = false;
          return advanceStage();
        }
        battleThen(() => {
          bossIndex = bossQueue[bossStep];
          answerTargets(orderedLines[bossIndex], bossIndex, false);
          objective(`诗卷 Boss：回想第 ${bossIndex + 1} 句${bossIndex > 0 ? ` · ${orderedLines[bossIndex - 1]}` : ""}`);
        });
      }
    }

    function fire() {
      if (player.cooldown > 0 || ended || speaking || pausedRef.current || stageLocked) return;
      bullets.push({ x: player.x + Math.cos(player.dir) * 27, y: player.y + Math.sin(player.dir) * 27, dx: Math.cos(player.dir) * 430, dy: Math.sin(player.dir) * 430, owner: "player", life: 2.2 });
      player.cooldown = rapid > 0 ? 0.12 : 0.28;
    }

    function moveTank(tank: Tank, dx: number, dy: number, delta: number) {
      if (!dx && !dy) return;
      const length = Math.hypot(dx, dy) || 1;
      tank.dir = Math.atan2(dy, dx);
      tank.x = Math.max(34, Math.min(width - 34, tank.x + dx / length * tank.speed * delta));
      tank.y = Math.max(102, Math.min(height - 32, tank.y + dy / length * tank.speed * delta));
    }

    function finish(completed: boolean) {
      if (ended) return;
      ended = true;
      setFinishing(true);
      const correctCount = attempts.filter((attempt) => attempt.isCorrect).length;
      onFinishRef.current({
        mode: "desktop",
        durationSeconds: Math.max(1, Math.round(elapsed)),
        completedStage: stage as PoemGameStage,
        isCompleted: completed,
        correctCount,
        wrongCount: attempts.length - correctCount,
        firstTryCorrectCount: attempts.filter((attempt) => attempt.isCorrect && attempt.isFirstTry).length,
        bossHits: attempts.filter((attempt) => attempt.stage === "boss" && attempt.isCorrect).length,
        attempts,
      });
    }

    function update(delta: number, now: number) {
      if (ended || pausedRef.current) return;
      elapsed += delta;
      stageElapsed += delta;
      timeLeft -= delta;
      if (timeLeft <= 0) return finish(mainCompleted);
      if (speaking) { setHud((current) => current.time === formatTime(timeLeft) ? current : { ...current, time: formatTime(timeLeft) }); return; }
      invincible = Math.max(0, invincible - delta); rapid = Math.max(0, rapid - delta);
      if (battleLeft > 0) {
        battleLeft -= delta;
        if (battleLeft <= 0) { enemies = []; bullets = []; drops = []; const next = afterBattle; afterBattle = null; next?.(); }
      }
      const fighting = stage === "warmup" || battleLeft > 0;
      if (fighting) { spawnIn -= delta; if (spawnIn <= 0) { spawnIn = 1.6; if (enemies.length < settings.enemyCount) spawnEnemy(); } }
      player.cooldown = Math.max(0, player.cooldown - delta);
      let dx = 0;
      let dy = 0;
      if (keys.has("ArrowLeft") || keys.has("KeyA")) dx -= 1;
      if (keys.has("ArrowRight") || keys.has("KeyD")) dx += 1;
      if (keys.has("ArrowUp") || keys.has("KeyW")) dy -= 1;
      if (keys.has("ArrowDown") || keys.has("KeyS")) dy += 1;
      const gamepad = navigator.getGamepads?.()[0];
      if (gamepad) {
        if (Math.abs(gamepad.axes[0] ?? 0) > 0.18) dx += gamepad.axes[0];
        if (Math.abs(gamepad.axes[1] ?? 0) > 0.18) dy += gamepad.axes[1];
        if (gamepad.buttons[0]?.pressed) fire();
      }
      moveTank(player, dx, dy, delta);
      if (keys.has("Space")) fire();

      targets.forEach((target) => {
        if (!target.dx) return;
        target.x += target.dx * delta;
        if (target.x - target.w / 2 < 35 || target.x + target.w / 2 > width - 35) { target.dx *= -1; target.x = Math.max(35 + target.w / 2, Math.min(width - 35 - target.w / 2, target.x)); }
      });
      enemies.forEach((enemy) => {
        enemy.cooldown = Math.max(0, enemy.cooldown - delta);
        if (fighting && enemy.cooldown <= 0) {
          const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
          bullets.push({ x: enemy.x, y: enemy.y, dx: Math.cos(angle) * 125, dy: Math.sin(angle) * 125, owner: "enemy", life: 4 });
          enemy.cooldown = settings.shotInterval;
        }
        enemy.turnIn = (enemy.turnIn ?? 0) - delta;
        if ((enemy.turnIn ?? 0) <= 0) {
          enemy.dir = Math.atan2(player.y - enemy.y, player.x - enemy.x) + (Math.random() - 0.5) * 1.2;
          enemy.turnIn = 0.7 + Math.random() * 1.2;
        }
        const before = { x: enemy.x, y: enemy.y };
        moveTank(enemy, Math.cos(enemy.dir), Math.sin(enemy.dir), delta);
        if ((enemy.x <= 36 || enemy.x >= width - 36 || enemy.y <= 104 || enemy.y >= height - 34) && Math.hypot(enemy.x - before.x, enemy.y - before.y) < 1) enemy.dir += Math.PI * (0.6 + Math.random() * 0.8);
      });

      bullets.forEach((bullet) => { bullet.x += bullet.dx * delta; bullet.y += bullet.dy * delta; bullet.life -= delta; });
      for (const bullet of bullets.filter((item) => item.owner === "player" && item.life > 0)) {
        const enemy = enemies.find((item) => Math.hypot(item.x - bullet.x, item.y - bullet.y) < 27);
        if (enemy) {
          bullet.life = 0;
          enemies = enemies.filter((item) => item !== enemy);
          kills += 1;
          stars += 1;
          for (let i = 0; i < 14; i++) particles.push({ x: enemy.x + (Math.random() - .5) * 40, y: enemy.y + (Math.random() - .5) * 40, life: 1, color: i % 2 ? "#ffd874" : "#fff1cc" });
          drops.push({ x: enemy.x, y: enemy.y, kind: kills % 4 === 0 ? "rapid" : "star", life: 8 });
          if (stage === "warmup" && kills >= 4 && stageElapsed >= 20) advanceStage();
          else if (stage === "warmup" && enemies.length < settings.enemyCount) spawnEnemy();
          continue;
        }
        const target = targets.find((item) => item.active && Math.abs(item.x - bullet.x) < item.w / 2 && Math.abs(item.y - bullet.y) < item.h / 2);
        if (target) { bullet.life = 0; void correctHit(target); }
      }
      for (const bullet of bullets.filter((item) => item.owner === "enemy" && item.life > 0)) {
        if (Math.hypot(bullet.x - player.x, bullet.y - player.y) < 25) {
          bullet.life = 0;
          if (invincible <= 0) { shield -= 1; invincible = 2; if (shield <= 0) { shield = difficulty === "easy" ? 5 : 3; invincible = 4; objective("小小维修站补满护盾，继续出发！"); } }
        }
      }
      drops.forEach((drop) => {
        drop.life -= delta;
        if (Math.hypot(drop.x - player.x, drop.y - player.y) < 42) { drop.life = 0; if (drop.kind === "star") stars += 2; else if (drop.kind === "shield") shield = Math.min(5, shield + 2); else rapid = 6; }
      });
      drops = drops.filter((drop) => drop.life > 0);
      bullets = bullets.filter((bullet) => bullet.life > 0 && bullet.x > -20 && bullet.x < width + 20 && bullet.y > 70 && bullet.y < height + 20);
      particles.forEach((particle) => { particle.y -= 24 * delta; particle.life -= delta * 1.5; });
      particles = particles.filter((particle) => particle.life > 0);

      if (stage === "warmup" && stageElapsed > 30 && !stageLocked) advanceStage();
      if (now - lastHud > 180) {
        lastHud = now;
        setHud((current) => ({ ...current, time: formatTime(timeLeft), stars, revealed, shield, combo, battle: fighting, controller: gamepad ? "手柄已连接" : "键盘可用" }));
      }
    }

    function drawTank(tank: Tank, friendly: boolean) {
      context.save();
      context.translate(tank.x, tank.y);
      context.shadowColor = "rgba(0,10,25,.6)"; context.shadowBlur = 8; context.shadowOffsetY = 4;
      if (friendly) {
        context.strokeStyle = invincible > 0 ? "#fff6aa" : "#b5f1ff"; context.lineWidth = 3;
        context.beginPath(); context.arc(0, 0, invincible > 0 ? 37 : 32, 0, Math.PI * 2); context.stroke();
      }
      context.rotate(tank.dir);
      context.fillStyle = friendly ? "#f4fcff" : "#fff0db";
      context.fillRect(-24, -18, 48, 36);
      context.strokeStyle = "#122b44"; context.lineWidth = 3; context.strokeRect(-24, -18, 48, 36);
      context.fillStyle = friendly ? "#168bdb" : "#dd563f";
      context.fillRect(-16, -13, 32, 26);
      context.beginPath(); context.arc(0, 0, 11, 0, Math.PI * 2); context.fill();
      context.fillStyle = friendly ? "#a6e5ff" : "#ffcf86"; context.fillRect(7, -4, 31, 8); context.strokeRect(7, -4, 31, 8);
      context.shadowBlur = 0; context.shadowOffsetY = 0;
      if (tank.glyph) { context.rotate(-tank.dir); context.fillStyle = "#fff4dd"; context.font = "bold 13px serif"; context.textAlign = "center"; context.fillText(tank.glyph, 0, 5); }
      context.restore();
    }

    function drawTarget(target: Target) {
      context.save();
      context.translate(target.x, target.y);
      const glowing = target.active;
      context.fillStyle = glowing ? "#fffbed" : "#364b62";
      context.strokeStyle = glowing ? "#f6b63f" : "#a0b3c6";
      context.shadowColor = "rgba(4,20,38,.45)"; context.shadowBlur = 12; context.shadowOffsetY = 5;
      context.lineWidth = glowing ? 4 : 2;
      context.beginPath(); context.roundRect(-target.w / 2, -target.h / 2, target.w, target.h, 14); context.fill(); context.stroke();
      context.shadowBlur = 0; context.shadowOffsetY = 0;
      context.fillStyle = glowing ? "#162e46" : "#d8e3ec";
      context.font = `bold ${target.text.length > 12 ? 17 : 22}px KaiTi, serif`;
      context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(target.text, 0, 1, target.w - 20);
      context.restore();
    }

    function draw(now: number) {
      context.drawImage(backdrop, 0, 0);
      context.globalAlpha = 0.45;
      for (let index = 0; index < 16; index += 1) {
        const x = (index * 137 + now * 0.006 * (index % 3 + 1)) % width;
        const y = 90 + ((index * 83 + now * 0.004) % (height - 110));
        context.fillStyle = activeBlueprint.weather === "snow" ? "#ffffff" : activeBlueprint.weather === "petals" ? "#ffd8d9" : "#ffeab0";
        context.beginPath(); context.arc(x, y, 2 + index % 3, 0, Math.PI * 2); context.fill();
      }
      context.globalAlpha = 1;
      drops.forEach((drop) => {
        context.fillStyle = drop.kind === "star" ? "#ffdb65" : drop.kind === "shield" ? "#91e2fc" : "#d8c2ff";
        context.strokeStyle = "#20354e"; context.lineWidth = 3;
        context.beginPath(); context.roundRect(drop.x - 16, drop.y - 16, 32, 32, 8); context.fill(); context.stroke();
        context.fillStyle = "#20354e"; context.font = "bold 22px sans-serif"; context.textAlign = "center"; context.fillText(drop.kind === "star" ? "★" : drop.kind === "shield" ? "+" : "ϟ", drop.x, drop.y + 8);
      });
      targets.forEach(drawTarget);
      enemies.forEach((enemy) => drawTank(enemy, false));
      drawTank(player, true);
      bullets.forEach((bullet) => { context.fillStyle = bullet.owner === "player" ? "#fff09d" : "#ff795e"; context.strokeStyle = bullet.owner === "player" ? "#714d10" : "#fff4d9"; context.lineWidth = 2; context.beginPath(); context.arc(bullet.x, bullet.y, bullet.owner === "player" ? 5 : 7, 0, Math.PI * 2); context.fill(); context.stroke(); });
      particles.forEach((particle) => { context.globalAlpha = particle.life; context.fillStyle = particle.color; context.fillRect(particle.x, particle.y, 5, 5); });
      context.globalAlpha = 1;
      if (stage === "boss") {
        context.fillStyle = "#704a79"; context.beginPath(); context.roundRect(width / 2 - 68, 112, 136, 58, 18); context.fill();
        context.fillStyle = "#fff0d0"; context.font = "bold 22px KaiTi"; context.textAlign = "center"; context.fillText(`诗印 ${bossStep}/${bossQueue.length}`, width / 2, 149);
      }
      if (battleLeft > 0) { context.fillStyle = "#fff2c7"; context.font = "bold 22px sans-serif"; context.textAlign = "right"; context.fillText(`补给巡游 ${Math.ceil(battleLeft)}s`, width - 25, 45); }
      if (speaking) { context.fillStyle = "rgba(16,36,54,.88)"; context.fillRect(270, height - 50, 420, 38); context.fillStyle = "#fff3cb"; context.textAlign = "center"; context.font = "bold 19px sans-serif"; context.fillText("♫  仔细听，也可以一起读", width / 2, height - 24); }
    }

    function loop(now: number) {
      if (cancelled) return;
      const delta = Math.min(0.033, Math.max(0, (now - last) / 1000));
      last = now;
      update(delta, now);
      draw(now);
      frame = requestAnimationFrame(loop);
    }
    function keyDown(event: KeyboardEvent) {
      if (event.code === "KeyP" || event.code === "Escape") { if (!event.repeat) { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); keys.clear(); } return; }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
      keys.add(event.code);
    }
    function keyUp(event: KeyboardEvent) { keys.delete(event.code); }
    function pointAndFire(event: PointerEvent) {
      const bounds = canvas!.getBoundingClientRect();
      const x = (event.clientX - bounds.left) * width / bounds.width;
      const y = (event.clientY - bounds.top) * height / bounds.height;
      player.dir = Math.atan2(y - player.y, x - player.x);
      canvas!.focus(); fire();
    }
    function gamepadConnected() { setHud((current) => ({ ...current, controller: "手柄已连接" })); }

    enterStage("warmup");
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    const clearKeys = () => { keys.clear(); pausedRef.current = true; setPaused(true); };
    window.addEventListener("blur", clearKeys);
    const visibilityChanged = () => { if (document.hidden) clearKeys(); };
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("gamepadconnected", gamepadConnected);
    canvas.addEventListener("pointerdown", pointAndFire);
    canvas.focus();
    frame = requestAnimationFrame(loop);
    const currentCanvas = canvas;
    currentCanvas.dataset.stopGame = "ready";
    const stopHandler = () => finish(false);
    currentCanvas.addEventListener("poem-game-stop", stopHandler);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stopPoemSpeech();
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", clearKeys);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("gamepadconnected", gamepadConnected);
      currentCanvas.removeEventListener("poem-game-stop", stopHandler);
      currentCanvas.removeEventListener("pointerdown", pointAndFire);
    };
  }, [distractorLines, poem, started, difficulty]);

  function stopGame() {
    canvasRef.current?.dispatchEvent(new Event("poem-game-stop"));
  }

  return <section className="poem-tank-shell">
    <div className="poem-tank-hud"><div><span>剩余时间</span><strong>{hud.time}</strong></div><div className="poem-tank-objective"><span>{hud.stage}</span><strong>{hud.objective}</strong></div><div><span>记忆星</span><strong>★ {hud.stars}</strong></div></div>
    <div className="poem-tank-layout">
      <div className="poem-tank-arena"><canvas ref={canvasRef} width={960} height={600} tabIndex={0} aria-label="诗境守卫战坦克战场" />{!started && <div className="poem-tank-intro" style={blueprint.backgroundImage ? { backgroundImage: `linear-gradient(rgba(255,250,238,.82),rgba(255,250,238,.92)),url(${blueprint.backgroundImage})`, backgroundSize: "cover" } : undefined}><span className="poem-tank-seal">诗</span><p className="eyebrow">Poem guardian · {POEM_GAME_DIFFICULTIES[difficulty].label}</p><h2>{blueprint.name}</h2><p>{blueprint.brief}</p><div className="poem-map-tags">{blueprint.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><p className="poem-game-legend">蓝白色是你 · 红色是迷雾 · 金色诗堡里藏着诗句</p><button className="primary" type="button" onClick={() => { onStart(); setStarted(true); }}>出发 · 最多 {POEM_GAME_DIFFICULTIES[difficulty].minutes} 分钟</button></div>}{paused && started && <div className="poem-game-pause"><h2>诗境等着你</h2><p>计时已暂停，准备好了就继续。</p><button type="button" className="primary" onClick={() => { pausedRef.current = false; setPaused(false); canvasRef.current?.focus(); }}>继续探险</button></div>}</div>
      <aside className="poem-tank-side"><div><p className="eyebrow">今日诗卷</p><h2>{poem.title}</h2><p>{poem.author}{poem.dynasty ? ` · ${poem.dynasty}` : ""}</p></div><div className="poem-tank-lines">{poem.lines.map((line, index) => <p className={index < hud.revealed ? "revealed" : ""} key={`${line}-${index}`}>{index < hud.revealed && !(difficulty === "challenge" && hud.stage !== STAGE_LABELS.exposure) ? line : "回想这一句…"}</p>)}</div><div className="poem-tank-status"><strong>护盾 {"◆".repeat(hud.shield)} · 连对 {hud.combo}</strong><span>{hud.battle ? "收集 ★ 星星 / ＋ 护盾 / ϟ 闪电" : "命中诗句后，听一听、读一读"}</span><span>{hud.controller} · P 暂停</span></div>{started && <><button className="secondary" type="button" onClick={() => { pausedRef.current = !pausedRef.current; setPaused(pausedRef.current); }}> {paused ? "已暂停" : "暂停一下"}</button><button className="text-button" type="button" onClick={stopGame} disabled={finishing}>{finishing ? "正在结算…" : "提前结束并保存"}</button></>}</aside>
    </div>
    <div className="poem-tank-controls"><span><kbd>↑↓←→</kbd> / <kbd>WASD</kbd> 移动</span><strong aria-live="polite">{tip}</strong><span><kbd>SPACE</kbd> 发射 · 鼠标点选瞄准 · 手柄 A 键</span></div>
  </section>;
}
