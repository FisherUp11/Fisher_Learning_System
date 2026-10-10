import assert from "node:assert/strict";
import { test } from "node:test";
import { forgetStudyAnswer, readStudyAnswer, rememberStudyAnswer } from "../lib/study-answer-sync.ts";

function store() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key), values };
}
const answer = { learnerId: "child-a", itemId: "item-1", result: "known", assisted: false, requestId: "request-1" };

test("只记录重试所需的原作答；读回时不生成新 UUID", () => {
  const storage = store();
  assert.equal(rememberStudyAnswer(storage, "hanzi", answer), true);
  assert.deepEqual(readStudyAnswer(storage, "hanzi", "child-a"), answer);
  assert.deepEqual(readStudyAnswer(storage, "hanzi", "child-a"), answer);
  assert.equal(Object.keys(JSON.parse([...storage.values.values()][0])).length, 5);
});
test("按孩子和记忆域隔离，汉字不能当拼音、其他孩子不能恢复", () => {
  const storage = store(); rememberStudyAnswer(storage, "hanzi", answer);
  assert.equal(readStudyAnswer(storage, "pinyin", "child-a"), null);
  assert.equal(readStudyAnswer(storage, "hanzi", "child-b"), null);
});
test("旧页面的迟到响应不能删除新页面的新作答", () => {
  const storage = store(); rememberStudyAnswer(storage, "hanzi", answer);
  const newer = { ...answer, itemId: "item-2", requestId: "request-2" };
  rememberStudyAnswer(storage, "hanzi", newer); forgetStudyAnswer(storage, "hanzi", answer);
  assert.deepEqual(readStudyAnswer(storage, "hanzi", "child-a"), newer);
  forgetStudyAnswer(storage, "hanzi", newer);
  assert.equal(readStudyAnswer(storage, "hanzi", "child-a"), null);
});
test("浏览器禁用存储、损坏或不完整数据安全退回，不假定可以后台换卡", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(rememberStudyAnswer(blocked, "pinyin", answer), false);
  assert.equal(readStudyAnswer(blocked, "pinyin", "child-a"), null);
  const storage = store(); rememberStudyAnswer(storage, "hanzi", answer);
  const key = [...storage.values.keys()][0];
  for (const value of ["broken-json", JSON.stringify({ ...answer, result: "invalid" }), JSON.stringify({ ...answer, learnerId: "another-child" })]) {
    storage.setItem(key, value); assert.equal(readStudyAnswer(storage, "hanzi", "child-a"), null);
  }
});
