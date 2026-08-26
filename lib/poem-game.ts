export type PoemGameMode = "desktop" | "mobile";

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
  if (/[春花鸟柳草蜂啼]/u.test(text)) return { name: "春日诗园", brief: "花树、鸟鸣与曲径组成一座适合慢慢寻找诗句的庭院。", tags: ["花树", "鸟鸣", "晨光"], palette: ["#315c43", "#1c3829", "#e7a86a", "#7fae83"], landmarks: ["花树", "飞鸟", "小池"], weather: "petals", source: "procedural" };
  if (/[月夜星霜]/u.test(text)) return { name: "月下诗庭", brief: "银蓝月色落在石径上，安静的远山守护着诗句。", tags: ["月光", "夜色", "远山"], palette: ["#29415b", "#17293c", "#d7dcae", "#6685a0"], landmarks: ["圆月", "窗影", "松林"], weather: "stars", source: "procedural" };
  if (/[江河湖海潭舟水波]/u.test(text)) return { name: "清波水城", brief: "河流穿过战场，桥与水纹把诗句连成一条路。", tags: ["清波", "小桥", "远帆"], palette: ["#31705f", "#1b443d", "#e9eee0", "#6ca5a0"], landmarks: ["河流", "木桥", "荷叶"], weather: "ripples", source: "procedural" };
  if (/[田禾农牧牛谷]/u.test(text)) return { name: "金色田野", brief: "整齐田垄组成通道，稻穗会随坦克经过轻轻摇动。", tags: ["田垄", "稻穗", "日光"], palette: ["#6a6b35", "#3e4927", "#e6b84b", "#a78345"], landmarks: ["禾田", "谷仓", "日轮"], weather: "dust", source: "procedural" };
  if (/[雪冰寒冬梅]/u.test(text)) return { name: "雪岭关隘", brief: "柔和的雪落在松林与山路上，诗句像灯火一样明亮。", tags: ["白雪", "松林", "暖灯"], palette: ["#496476", "#253b48", "#e8eee8", "#8ca7aa"], landmarks: ["雪岭", "松树", "灯火"], weather: "snow", source: "procedural" };
  if (/[山峰岭林鹿松]/u.test(text)) return { name: "深林山径", brief: "林间小路绕过青苔与山石，微光在树梢间移动。", tags: ["空山", "古木", "青苔"], palette: ["#244b3b", "#132f27", "#d9a94e", "#678b63"], landmarks: ["山影", "古木", "苔石"], weather: "fireflies", source: "procedural" };
  return { name: "清风诗园", brief: "温柔的风穿过曲径和树影，把每一句诗送到孩子身边。", tags: ["清风", "曲径", "树影"], palette: ["#315c43", "#1c3829", "#e7a86a", "#7fae83"], landmarks: ["庭树", "石径", "小亭"], weather: "fireflies", source: "procedural" };
}
