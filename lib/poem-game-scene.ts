import type { PoemMapBlueprint } from "./poem-game";

// Paint once into an offscreen canvas; gameplay objects remain on a separate,
// high-contrast layer. Scenery is decorative and never blocks a tank.
export function paintPoemScene(ctx: CanvasRenderingContext2D, map: PoemMapBlueprint, text: string, image?: HTMLImageElement) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const night = /月|夜|星/.test(text);
  const water = /江|河|湖|潭|舟|海|水|瀑/.test(text);
  const snow = /雪|冬|冰/.test(text);
  const field = /禾|农|田|牧|牛/.test(text);
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, night ? "#223854" : snow ? "#c2dfed" : "#addbd7");
  gradient.addColorStop(1, night ? "#41616b" : snow ? "#eef5ef" : field ? "#cfcc89" : "#b6cba1");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
  if (image) {
    const scale = Math.max(w / image.width, (h - 100) / image.height);
    // Anchor artwork below the title strip so its moon/mountains are not hidden.
    ctx.drawImage(image, (w - image.width * scale) / 2, 100, image.width * scale, image.height * scale);
    ctx.fillStyle = "rgba(13,34,48,.30)"; ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = night ? "#fff1bd" : "#fff4c9";
    ctx.beginPath(); ctx.arc(780, 73, night ? 34 : 43, 0, Math.PI * 2); ctx.fill();
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = ["#7caaa9", "#608e93", "#507b7a"][layer];
      ctx.globalAlpha = night ? .5 : .65;
      ctx.beginPath(); ctx.moveTo(0, 155 + layer * 27);
      for (let i = 0; i <= 12; i++) ctx.lineTo(i * 90, 70 + layer * 36 + Math.sin(i * 2.3 + layer) * 38);
      ctx.lineTo(w, 260); ctx.lineTo(0, 260); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (water) {
      ctx.fillStyle = night ? "#527d99" : "#73b7c9";
      ctx.beginPath(); ctx.moveTo(0, 220); ctx.bezierCurveTo(460, 170, 220, 400, 960, 430); ctx.lineTo(960, 575); ctx.bezierCurveTo(270, 470, 310, 290, 0, 325); ctx.fill();
      ctx.strokeStyle = "#d0ece6"; ctx.lineWidth = 2;
      for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.moveTo(30 + i * 76, 262 + i * 20); ctx.lineTo(66 + i * 76, 262 + i * 20); ctx.stroke(); }
      ctx.fillStyle = "#6c4d38"; ctx.beginPath(); ctx.moveTo(675, 365); ctx.lineTo(750, 365); ctx.lineTo(732, 380); ctx.lineTo(690, 380); ctx.fill();
      ctx.fillStyle = "#fff2ce"; ctx.beginPath(); ctx.moveTo(712, 303); ctx.lineTo(712, 360); ctx.lineTo(748, 356); ctx.fill();
    }
    if (field) {
      ctx.strokeStyle = "#a09352"; ctx.lineWidth = 5;
      for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(i * 120, 570); ctx.lineTo(300 + i * 58, 240); ctx.stroke(); }
    }
    // Branches, blossoms and reeds frame the arena, leaving the centre readable.
    for (let i = 0; i < 8; i++) {
      const x = i % 2 ? w - 22 - (i % 3) * 18 : 22 + (i % 3) * 18;
      const y = 235 + Math.floor(i / 2) * 106;
      ctx.fillStyle = "#685e4c"; ctx.fillRect(x - 5, y, 10, 45);
      ctx.fillStyle = snow ? "#eef6ef" : /花|春|桃|梅/.test(text) ? "#e7b4ac" : "#668c67";
      ctx.beginPath(); ctx.arc(x, y, 32, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x - 21, y + 9, 22, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "rgba(12,34,47,.24)"; ctx.fillRect(0, 100, w, h - 100);
  }
  ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 60) { ctx.beginPath(); ctx.moveTo(x, 100); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 120; y <= h; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.fillStyle = "rgba(15,33,50,.84)"; ctx.fillRect(0, 0, w, 100);
  ctx.fillStyle = "#f8e6b8"; ctx.font = "bold 28px KaiTi, serif"; ctx.textAlign = "left";
  ctx.fillText(map.name, 26, 43);
  ctx.fillStyle = "#c8dde4"; ctx.font = "16px sans-serif";
  ctx.fillText(map.landmarks.join("  /  "), 27, 76);
}
