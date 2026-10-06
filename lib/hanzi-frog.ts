export type FrogDifficulty = "easy" | "normal" | "challenge";
export type FrogWord = {
  character_id: string;
  hanzi: string;
  pinyin_marked: string;
  word_one: string | null;
  stage: number;
  due_at: string;
  due_first: boolean;
};
export type FrogQuestion = { target: FrogWord; options: FrogWord[] };

export const FROG_LEVELS: Record<FrogDifficulty, { label: string; options: number; targets: number; fallMs: number }> = {
  easy: { label: "轻松跳", options: 4, targets: 12, fallMs: 1300 },
  normal: { label: "勇敢跳", options: 5, targets: 15, fallMs: 1000 },
  challenge: { label: "观察家", options: 6, targets: 18, fallMs: 760 },
};

const SIMILAR_SETS = ["土士", "日目", "人入", "木本", "牛午", "末未", "口日", "田由", "已己", "千干", "天夫", "王玉", "手毛", "大太犬", "左在"];

export function pinyinBase(input: string) {
  return input.trim().toLocaleLowerCase().normalize("NFD").replace(/u\u0308/g, "v")
    .replace(/[\u0300-\u036f]/g, "").replace(/[1-5]/g, "").replace(/[^a-zv]/g, "");
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

export function makeFrogQuestions(words: FrogWord[], difficulty: FrogDifficulty, random = Math.random): FrogQuestion[] {
  const level = FROG_LEVELS[difficulty];
  const valid = words.filter((word) => word.hanzi.length === 1 && pinyinBase(word.pinyin_marked)
    && !/[,，、;/／\s]/.test(word.pinyin_marked));
  const seenGlyphs = new Set<string>();
  const unique = valid.filter((word) => {
    if (seenGlyphs.has(word.hanzi)) return false;
    seenGlyphs.add(word.hanzi);
    return true;
  });
  if (unique.length < level.options) return [];
  const due = shuffle(unique.filter((word) => word.due_first), random);
  const other = shuffle(unique.filter((word) => !word.due_first), random);
  // Due review dominates; a few previously learned words keep play varied.
  const selected = [...due.slice(0, Math.ceil(level.targets * 0.8)), ...other.slice(0, Math.floor(level.targets * 0.2))];
  const targets = [...selected, ...due.slice(Math.ceil(level.targets * 0.8)), ...other.slice(Math.floor(level.targets * 0.2))]
    .filter((word, index, list) => list.findIndex((item) => item.character_id === word.character_id) === index);
  const questions: FrogQuestion[] = [];
  for (const target of targets) {
    const targetSound = pinyinBase(target.pinyin_marked);
    const candidates = unique.filter((word) => word.character_id !== target.character_id
      && word.hanzi !== target.hanzi && pinyinBase(word.pinyin_marked) !== targetSound);
    if (candidates.length < level.options - 1) continue;
    const similar = difficulty === "challenge" ? candidates.filter((word) => SIMILAR_SETS.some((set) => set.includes(target.hanzi) && set.includes(word.hanzi))) : [];
    const preferred = shuffle(similar, random).slice(0, 2);
    const rest = shuffle(candidates.filter((word) => !preferred.some((item) => item.character_id === word.character_id)), random);
    questions.push({ target, options: shuffle([target, ...preferred, ...rest].slice(0, level.options), random) });
    if (questions.length >= level.targets) break;
  }
  return questions;
}
