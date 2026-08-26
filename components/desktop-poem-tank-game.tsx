"use client";

import { useEffect, useRef, useState } from "react";
import type { PoemGameAttemptInput, PoemGamePoem, PoemGameStage, PoemGameSummary, PoemMapBlueprint } from "@/lib/poem-game";
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
  return Array.from({ length: count }, (_, index) => ({
    x: columns === 2 ? 250 + (index % 2) * 460 : 170 + (index % 3) * 310,
    y: 165 + Math.floor(index / columns) * 200,
  }));
}

export function DesktopPoemTankGame({ poem, distractorLines, blueprint, onStart, onFinish }: { poem: PoemGamePoem; distractorLines: string[]; blueprint: PoemMapBlueprint; onStart: () => void; onFinish: (summary: PoemGameSummary) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFinishRef = useRef(onFinish);
  const blueprintRef = useRef(blueprint);
  const [started, setStarted] = useState(false);
  const [hud, setHud] = useState({ stage: "等待出发", objective: "准备进入诗境", time: "07:00", stars: 0, revealed: 0, controller: "键盘可用" });
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
    const keys = new Set<string>();
    let frame = 0;
    let cancelled = false;
    let last = performance.now();
    let lastHud = 0;
    let timeLeft = 420;
    let stage: EngineStage = "warmup";
    let stageLocked = false;
    let stageStartedAt = performance.now();
    let sessionStartedAt = performance.now();
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
    let questionStartedAt = performance.now();
    let answerLockedUntil = 0;
    let ended = false;
    const attempts: PoemGameAttemptInput[] = [];
    const orderedLines = poem.lines.slice(0, 8);

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
      enemies.push({ ...point, speed: 52 + Math.random() * 24, cooldown: 1 + Math.random(), turnIn: 0.5 + Math.random() * 1.2, glyph: ["忘", "雾", "乱", "散"][enemies.length % 4] });
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
        responseMs: Math.max(0, Math.round(performance.now() - questionStartedAt)),
      });
      if (!correct) firstTry = false;
      return correct;
    }

    function answerTargets(answer: string, lineIndex: number, moving = true) {
      const wrong = distractorLines.filter((line) => line !== answer && !orderedLines.includes(line)).slice(lineIndex * 2, lineIndex * 2 + 2);
      const localWrong = orderedLines.filter((line) => line !== answer && line !== orderedLines[Math.max(0, lineIndex - 1)]);
      const options = shuffle([answer, ...wrong, ...localWrong].filter((line, index, rows) => rows.indexOf(line) === index).slice(0, 3));
      targets = options.map((text, index) => ({ x: 180 + index * 300, y: 210 + (index % 2) * 150, w: 230, h: 66, text, lineIndex, correct: text === answer, active: true, dx: moving ? (index % 2 ? 28 : -28) : 0 }));
      firstTry = true;
      questionStartedAt = performance.now();
    }

    function enterStage(next: EngineStage) {
      stage = next;
      stageLocked = false;
      stageStartedAt = performance.now();
      bullets = [];
      enemies = [];
      targets = [];
      answerLockedUntil = 0;
      if (next === "warmup") {
        kills = 0;
        for (let index = 0; index < 4; index += 1) spawnEnemy((index + 1) / 5);
        objective("先击退两辆遗忘迷雾坦克，熟悉移动与发射");
      } else if (next === "exposure") {
        exposureIndex = 0;
        const positions = targetPositions(orderedLines.length);
        targets = orderedLines.map((line, index) => ({ ...positions[index], w: orderedLines.length > 4 ? 250 : 285, h: 64, text: line, lineIndex: index, correct: true, active: index === 0, dx: 0 }));
        firstTry = true;
        questionStartedAt = performance.now();
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
        questionStartedAt = performance.now();
        objective("占领第 1 句诗序据点");
      } else {
        bossIndex = 0;
        answerTargets(orderedLines[0], 0, false);
        objective(`诗卷 Boss：击中《${poem.title}》第一句`);
      }
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
      if (stageLocked || performance.now() < answerLockedUntil) return;
      const correct = recordTarget(target);
      if (!correct) {
        answerLockedUntil = performance.now() + 500;
        objective(`差一点，正确的是：${stage === "exposure" ? orderedLines[exposureIndex] : stage === "order" ? orderedLines[orderIndex] : orderedLines[stage === "boss" ? bossIndex : choiceIndex]}`);
        return;
      }
      target.active = false;
      stars += firstTry ? 2 : 1;
      answerLockedUntil = performance.now() + 450;
      for (let index = 0; index < 18; index += 1) particles.push({ x: target.x + (Math.random() - 0.5) * 60, y: target.y + (Math.random() - 0.5) * 45, life: 1, color: activeBlueprint.palette[2] });
      objective(`命中！慢慢听：${target.text}`);
      await speakPoemText(target.text);
      if (cancelled || ended) return;
      if (stage === "exposure") {
        revealed += 1;
        exposureIndex += 1;
        if (exposureIndex >= orderedLines.length) return advanceStage();
        targets.forEach((item) => { item.active = item.lineIndex === exposureIndex; });
        firstTry = true;
        questionStartedAt = performance.now();
        objective(`继续点亮：${orderedLines[exposureIndex]}`);
      } else if (stage === "choice") {
        choiceIndex += 1;
        if (choiceIndex >= Math.min(orderedLines.length, 4)) return advanceStage();
        answerTargets(orderedLines[choiceIndex], choiceIndex);
        objective(`${orderedLines[choiceIndex - 1]}，下一句是？`);
      } else if (stage === "order") {
        orderIndex += 1;
        if (orderIndex >= orderedLines.length) return advanceStage();
        targets = targets.filter((item) => item !== target);
        firstTry = true;
        questionStartedAt = performance.now();
        objective(`占领第 ${orderIndex + 1} 句诗序据点`);
      } else if (stage === "boss") {
        bossIndex += 1;
        if (bossIndex >= Math.min(orderedLines.length, 6)) {
          objective("诗卷 Boss 已击退，听完整首诗");
          await speakPoemText(`${poem.title}。${orderedLines.join("。")}`);
          return advanceStage();
        }
        answerTargets(orderedLines[bossIndex], bossIndex, false);
        objective(`${orderedLines[bossIndex - 1]}，下一句是？`);
      }
    }

    function fire() {
      if (player.cooldown > 0 || ended) return;
      bullets.push({ x: player.x + Math.cos(player.dir) * 27, y: player.y + Math.sin(player.dir) * 27, dx: Math.cos(player.dir) * 430, dy: Math.sin(player.dir) * 430, owner: "player", life: 2.2 });
      player.cooldown = 0.24;
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
        durationSeconds: Math.max(1, Math.round((performance.now() - sessionStartedAt) / 1000)),
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
      if (ended) return;
      timeLeft -= delta;
      if (timeLeft <= 0) return finish(false);
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
        if (target.x - target.w / 2 < 35 || target.x + target.w / 2 > width - 35) target.dx *= -1;
      });
      enemies.forEach((enemy) => {
        enemy.cooldown = Math.max(0, enemy.cooldown - delta);
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
          if (stage === "warmup" && kills >= 2) advanceStage();
          else if (stage === "warmup" && enemies.length < 3) spawnEnemy();
          continue;
        }
        const target = targets.find((item) => item.active && Math.abs(item.x - bullet.x) < item.w / 2 && Math.abs(item.y - bullet.y) < item.h / 2);
        if (target) { bullet.life = 0; void correctHit(target); }
      }
      bullets = bullets.filter((bullet) => bullet.life > 0 && bullet.x > -20 && bullet.x < width + 20 && bullet.y > 70 && bullet.y < height + 20);
      particles.forEach((particle) => { particle.y -= 24 * delta; particle.life -= delta * 1.5; });
      particles = particles.filter((particle) => particle.life > 0);

      if (stage === "warmup" && now - stageStartedAt > 60000 && !stageLocked) advanceStage();
      if (now - lastHud > 180) {
        lastHud = now;
        setHud((current) => ({ ...current, time: formatTime(timeLeft), stars, revealed, controller: gamepad ? "手柄已连接" : "键盘可用" }));
      }
    }

    function drawTank(tank: Tank, friendly: boolean) {
      context.save();
      context.translate(tank.x, tank.y);
      context.rotate(tank.dir);
      context.fillStyle = friendly ? "#efd57d" : "#bd6249";
      context.fillRect(-24, -18, 48, 36);
      context.fillStyle = friendly ? "#315d45" : "#6f352d";
      context.fillRect(-16, -13, 32, 26);
      context.beginPath(); context.arc(0, 0, 11, 0, Math.PI * 2); context.fill();
      context.fillStyle = "#ead8b7"; context.fillRect(7, -4, 31, 8);
      if (tank.glyph) { context.rotate(-tank.dir); context.fillStyle = "#fff4dd"; context.font = "bold 13px serif"; context.textAlign = "center"; context.fillText(tank.glyph, 0, 5); }
      context.restore();
    }

    function drawTarget(target: Target) {
      context.save();
      context.translate(target.x, target.y);
      const glowing = target.active;
      context.fillStyle = glowing ? "rgba(255,248,224,.96)" : "rgba(54,76,60,.72)";
      context.strokeStyle = glowing ? activeBlueprint.palette[2] : "rgba(255,255,255,.16)";
      context.lineWidth = glowing ? 4 : 2;
      context.beginPath(); context.roundRect(-target.w / 2, -target.h / 2, target.w, target.h, 14); context.fill(); context.stroke();
      context.fillStyle = glowing ? "#183125" : "#9eafa2";
      context.font = `bold ${target.text.length > 12 ? 17 : 22}px KaiTi, serif`;
      context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(target.text, 0, 1, target.w - 20);
      context.restore();
    }

    function draw(now: number) {
      const [ground, deep, accent, leaf] = activeBlueprint.palette;
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, deep); gradient.addColorStop(1, ground);
      context.fillStyle = gradient; context.fillRect(0, 0, width, height);
      context.globalAlpha = 0.2;
      for (let index = 0; index < 40; index += 1) {
        const x = (index * 137 + now * 0.006 * (index % 3 + 1)) % width;
        const y = 90 + ((index * 83 + now * 0.004) % (height - 110));
        context.fillStyle = index % 4 ? leaf : accent;
        context.beginPath(); context.arc(x, y, 2 + index % 3, 0, Math.PI * 2); context.fill();
      }
      context.globalAlpha = 1;
      context.fillStyle = "rgba(7,17,12,.32)";
      context.fillRect(0, 74, width, 28);
      context.fillStyle = "rgba(255,248,232,.72)";
      context.font = "bold 12px ui-monospace"; context.textAlign = "left"; context.fillText(`${activeBlueprint.name} · ${activeBlueprint.landmarks.join(" · ")}`, 20, 93);
      targets.forEach(drawTarget);
      enemies.forEach((enemy) => drawTank(enemy, false));
      drawTank(player, true);
      bullets.forEach((bullet) => { context.fillStyle = bullet.owner === "player" ? "#ffd56c" : "#ee7854"; context.beginPath(); context.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2); context.fill(); });
      particles.forEach((particle) => { context.globalAlpha = particle.life; context.fillStyle = particle.color; context.fillRect(particle.x, particle.y, 5, 5); });
      context.globalAlpha = 1;
      if (stage === "boss") {
        context.fillStyle = "rgba(180,70,55,.2)"; context.beginPath(); context.arc(width / 2, 145, 52, 0, Math.PI * 2); context.fill();
        context.fillStyle = "#fff0d0"; context.font = "bold 30px KaiTi"; context.textAlign = "center"; context.fillText("忘", width / 2, 156);
      }
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
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
      keys.add(event.code);
    }
    function keyUp(event: KeyboardEvent) { keys.delete(event.code); }
    function gamepadConnected() { setHud((current) => ({ ...current, controller: "手柄已连接" })); }

    enterStage("warmup");
    sessionStartedAt = performance.now();
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    const clearKeys = () => keys.clear();
    window.addEventListener("blur", clearKeys);
    window.addEventListener("gamepadconnected", gamepadConnected);
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
      window.removeEventListener("gamepadconnected", gamepadConnected);
      currentCanvas.removeEventListener("poem-game-stop", stopHandler);
    };
  }, [distractorLines, poem, started]);

  function stopGame() {
    canvasRef.current?.dispatchEvent(new Event("poem-game-stop"));
  }

  return <section className="poem-tank-shell">
    <div className="poem-tank-hud"><div><span>剩余时间</span><strong>{hud.time}</strong></div><div className="poem-tank-objective"><span>{hud.stage}</span><strong>{hud.objective}</strong></div><div><span>记忆星</span><strong>★ {hud.stars}</strong></div></div>
    <div className="poem-tank-layout">
      <div className="poem-tank-arena"><canvas ref={canvasRef} width={960} height={600} tabIndex={0} aria-label="诗境守卫战坦克战场" />{!started && <div className="poem-tank-intro"><span className="poem-tank-seal">诗</span><p className="eyebrow">Poem guardian</p><h2>{blueprint.name}</h2><p>{blueprint.brief}</p><div className="poem-map-tags">{blueprint.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><button className="primary" type="button" onClick={() => { onStart(); setStarted(true); }}>进入 7 分钟诗境</button></div>}</div>
      <aside className="poem-tank-side"><div><p className="eyebrow">今日诗卷</p><h2>{poem.title}</h2><p>{poem.author}{poem.dynasty ? ` · ${poem.dynasty}` : ""}</p></div><div className="poem-tank-lines">{poem.lines.map((line, index) => <p className={index < hud.revealed ? "revealed" : ""} key={`${line}-${index}`}>{index < hud.revealed ? line : "诗句尚未点亮"}</p>)}</div><div className="poem-tank-status"><span>{hud.controller}</span><span>{blueprint.source === "ai" ? "AI 诗意地图" : "稳定诗意地图"}</span></div>{started && <button className="secondary" type="button" onClick={stopGame} disabled={finishing}>{finishing ? "正在结算…" : "提前结束并保存"}</button>}</aside>
    </div>
    <div className="poem-tank-controls"><span><kbd>↑↓←→</kbd> / <kbd>WASD</kbd> 移动</span><strong aria-live="polite">{tip}</strong><span><kbd>SPACE</kbd> 发射 · 手柄 A 键</span></div>
  </section>;
}
