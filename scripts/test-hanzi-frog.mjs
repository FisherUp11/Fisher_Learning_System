import assert from "node:assert/strict";
import { makeFrogQuestions, pinyinBase, FROG_LEVELS } from "../lib/hanzi-frog.ts";

assert.equal(pinyinBase("lǜ"), "lv");
assert.equal(pinyinBase("shàng"), "shang");

const hanzi = "上下左右中大小日月天地水火山林花草木马牛鸟鱼人手足口目耳心家朋友爱红黄蓝绿春夏秋冬走跑跳笑";
const sounds = ["shàng","xià","zuǒ","yòu","zhōng","dà","xiǎo","rì","yuè","tiān","dì","shuǐ","huǒ","shān","lín","huā","cǎo","mù","mǎ","niú","niǎo","yú","rén","shǒu","zú","kǒu","mù","ěr","xīn","jiā","péng","yǒu","ài","hóng","huáng","lán","lǜ","chūn","xià","qiū","dōng","zǒu","pǎo","tiào","xiào"];
const words = [...hanzi].map((char, index) => ({
  character_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  hanzi: char, pinyin_marked: sounds[index], word_one: null, stage: 2,
  due_at: "2026-10-01T00:00:00Z", due_first: index % 2 === 0,
}));

for (const difficulty of Object.keys(FROG_LEVELS)) {
  const questions = makeFrogQuestions(words, difficulty, () => 0.45);
  assert.equal(questions.length, FROG_LEVELS[difficulty].targets);
  for (const question of questions) {
    assert.equal(question.options.length, FROG_LEVELS[difficulty].options);
    assert.equal(new Set(question.options.map((word) => word.character_id)).size, question.options.length);
    assert.equal(question.options.filter((word) => word.character_id === question.target.character_id).length, 1);
    assert.equal(question.options.filter((word) => pinyinBase(word.pinyin_marked) === pinyinBase(question.target.pinyin_marked)).length, 1);
  }
}
assert.deepEqual(makeFrogQuestions(words.slice(0, 3), "easy"), []);
console.log("汉字青蛙游戏题库测试通过");
