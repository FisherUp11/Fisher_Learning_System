export type PoemGameMode = "desktop" | "mobile";

export type PoemGameDifficulty = "easy" | "normal" | "challenge";
export const POEM_GAME_DIFFICULTIES = {
  easy: { label: "轻松探索", minutes: 5, enemySpeed: 38, enemyCount: 2, shotInterval: 3.2, targetSpeed: 0, options: 2, battleSeconds: 7, description: "静止诗堡 · 两个选项 · 更多护盾" },
  normal: { label: "诗境冒险", minutes: 6, enemySpeed: 54, enemyCount: 3, shotInterval: 2.5, targetSpeed: 18, options: 3, battleSeconds: 9, description: "移动诗堡 · 三个选项 · 经典闯关" },
  challenge: { label: "小小守卫", minutes: 7, enemySpeed: 72, enemyCount: 4, shotInterval: 1.8, targetSpeed: 30, options: 3, battleSeconds: 11, description: "更快的迷雾 · 隐藏诗卷 · 回忆挑战" },
} as const;

export type PoemGameStage = "warmup" | "exposure" | "choice" | "order" | "boss" | "mobile";

export type PoemGamePoem = {
  id: string;
  title: string;
  author: string;
  dynasty: string | null;
  content: string;
  lines: string[];
  sourceTitles: string[];
  attemptCount: number;
  lastScore: number | null;
};

export type PoemMapBlueprint = {
  name: string;
  brief: string;
  tags: string[];
  palette: [string, string, string, string];
  landmarks: string[];
  weather: "petals" | "stars" | "ripples" | "dust" | "fireflies" | "snow";
  source: "procedural" | "ai";
  backgroundImage?: string;
};

export type PoemGameAttemptInput = {
  eventIndex: number;
  stage: PoemGameStage;
  lineIndex: number | null;
  promptText: string;
  expectedText: string;
  selectedText: string;
  isCorrect: boolean;
  isFirstTry: boolean;
  responseMs: number;
};

export type PoemGameResultInput = {
  clientSessionId: string;
  learnerId: string;
  poemId: string;
  mode: PoemGameMode;
  durationSeconds: number;
  completedStage: PoemGameStage;
  isCompleted: boolean;
  attempts: PoemGameAttemptInput[];
};

export type PoemGameSummary = {
  mode: PoemGameMode;
  durationSeconds: number;
  completedStage: PoemGameStage;
  isCompleted: boolean;
  correctCount: number;
  wrongCount: number;
  firstTryCorrectCount: number;
  bossHits: number;
  attempts: PoemGameAttemptInput[];
};

export type PoemGameHistoryRow = {
  id: string;
  mode: PoemGameMode;
  played_at: string;
  duration_seconds: number;
  correct_count: number;
  wrong_count: number;
  first_try_correct_count: number;
  is_completed: boolean;
  recitation_score: number | null;
};

export function splitPoemLines(content: string) {
  const normalized = content.replace(/\\n/g, "\n").replace(/\r/g, "").trim();
  const explicitLines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  if (explicitLines.length > 1) return explicitLines.slice(0, 12);
  const sentenceLines = normalized.match(/[^。！？；]+[。！？；]?/g)?.map((line) => line.trim()).filter(Boolean) ?? [];
  return (sentenceLines.length ? sentenceLines : [normalized]).slice(0, 12);
}

export function proceduralPoemMap(poem: Pick<PoemGamePoem, "title" | "content">): PoemMapBlueprint {
  const text = `${poem.title}${poem.content}`;
  if (/洞庭/.test(text)) return { name: "洞庭秋月", brief: "月光与湖水相映，远处的小山像白银盘里的一枚青螺。", tags: ["秋月", "湖面", "青山"], palette: ["#507b91", "#223854", "#e9deac", "#75958b"], landmarks: ["秋月", "平静湖水", "青螺般的山"], weather: "ripples", source: "procedural", backgroundImage: "/poem-game/dongting-moon.png" };
  if (/牧童.*黄牛/.test(text)) return { name: "牧童林间", brief: "牧童骑着黄牛唱歌，听见树上的蝉，忽然安静下来。", tags: ["牧童", "黄牛", "鸣蝉"], palette: ["#89a883", "#526f59", "#e9c56f", "#a8ba8b"], landmarks: ["林间小路", "黄牛", "树梢鸣蝉"], weather: "fireflies", source: "procedural" };
  if (/[春花鸟柳草蜂啼]/u.test(text)) return { name: "春日诗园", brief: "花树、鸟鸣与曲径组成一座适合慢慢寻找诗句的庭院。", tags: ["花树", "鸟鸣", "晨光"], palette: ["#315c43", "#1c3829", "#e7a86a", "#7fae83"], landmarks: ["花树", "飞鸟", "小池"], weather: "petals", source: "procedural" };
  if (/[月夜星霜]/u.test(text)) return { name: "月下诗庭", brief: "银蓝月色落在石径上，安静的远山守护着诗句。", tags: ["月光", "夜色", "远山"], palette: ["#29415b", "#17293c", "#d7dcae", "#6685a0"], landmarks: ["圆月", "窗影", "松林"], weather: "stars", source: "procedural" };
  if (/[江河湖海潭舟水波]/u.test(text)) return { name: "清波水城", brief: "河流穿过战场，桥与水纹把诗句连成一条路。", tags: ["清波", "小桥", "远帆"], palette: ["#31705f", "#1b443d", "#e9eee0", "#6ca5a0"], landmarks: ["河流", "木桥", "荷叶"], weather: "ripples", source: "procedural" };
  if (/[田禾农牧牛谷]/u.test(text)) return { name: "金色田野", brief: "整齐田垄组成通道，稻穗会随坦克经过轻轻摇动。", tags: ["田垄", "稻穗", "日光"], palette: ["#6a6b35", "#3e4927", "#e6b84b", "#a78345"], landmarks: ["禾田", "谷仓", "日轮"], weather: "dust", source: "procedural" };
  if (/[雪冰寒冬梅]/u.test(text)) return { name: "雪岭关隘", brief: "柔和的雪落在松林与山路上，诗句像灯火一样明亮。", tags: ["白雪", "松林", "暖灯"], palette: ["#496476", "#253b48", "#e8eee8", "#8ca7aa"], landmarks: ["雪岭", "松树", "灯火"], weather: "snow", source: "procedural" };
  if (/[山峰岭林鹿松]/u.test(text)) return { name: "深林山径", brief: "林间小路绕过青苔与山石，微光在树梢间移动。", tags: ["空山", "古木", "青苔"], palette: ["#244b3b", "#132f27", "#d9a94e", "#678b63"], landmarks: ["山影", "古木", "苔石"], weather: "fireflies", source: "procedural" };
  return { name: "清风诗园", brief: "温柔的风穿过曲径和树影，把每一句诗送到孩子身边。", tags: ["清风", "曲径", "树影"], palette: ["#315c43", "#1c3829", "#e7a86a", "#7fae83"], landmarks: ["庭树", "石径", "小亭"], weather: "fireflies", source: "procedural" };
}
