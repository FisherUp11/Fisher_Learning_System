import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { PINYIN_CATEGORIES, PINYIN_CATEGORY_COUNTS, legacyPinyinCategories, pinyinCategoryLabel, pinyinSettingsPayload } from "../lib/pinyin-catalog.ts";

function form(categories = [], order = "sequential", limit = "4") {
  const data = new FormData();
  categories.forEach((category) => data.append("categories", category));
  data.set("new_order", order); data.set("daily_limit", limit);
  return data;
}

test("六类独立勾选；全部取消等于关闭；旧模式兼容", () => {
  assert.equal(pinyinSettingsPayload(form()).mode, "off");
  assert.deepEqual(pinyinSettingsPayload(form(["whole"])).enabled_categories, ["whole"]);
  assert.deepEqual(pinyinSettingsPayload(form(["compound", "initial", "compound"])).enabled_categories, ["initial", "compound"]);
  assert.deepEqual(pinyinSettingsPayload(form(["back_nasal", "front_nasal"])).enabled_categories, ["front_nasal", "back_nasal"]);
  assert.deepEqual(legacyPinyinCategories("both"), ["final", "initial"]);
  assert.deepEqual(legacyPinyinCategories("initials"), ["initial"]);
  assert.deepEqual(legacyPinyinCategories("off"), []);
});

test("每日上限与随机方式严格验证，默认不扩大孩子学习负担", () => {
  assert.equal(pinyinSettingsPayload(form(["initial"], "random")).new_order, "random");
  assert.equal(pinyinSettingsPayload(form(["initial"])).daily_limit, 4);
  assert.throws(() => pinyinSettingsPayload(form(["invalid"])), /类别/);
  assert.throws(() => pinyinSettingsPayload(form(["initial"], "invalid")), /顺序/);
  assert.throws(() => pinyinSettingsPayload(form(["initial"], "random", "50")), /3–5/);
});

test("特殊 er 标签与 16 个整体认读种子完整，不与原声母混淆", () => {
  assert.equal(PINYIN_CATEGORIES.length, 6);
  assert.equal(pinyinCategoryLabel("compound", "er"), "特殊韵母");
  assert.equal(pinyinCategoryLabel("whole", "zhi"), "整体认读音节");
  const sql = readFileSync(new URL("../supabase/034_pinyin_categories_and_random.sql", import.meta.url), "utf8");
  const whole = [...sql.matchAll(/\('([^']+)','whole',/g)].map((match) => match[1]);
  assert.deepEqual(whole, ["zhi", "chi", "shi", "ri", "zi", "ci", "si", "yi", "wu", "yu", "ye", "yue", "yuan", "yin", "yun", "ying"]);
  const compound = [...sql.matchAll(/\('([^']+)','compound',/g)].map((match) => match[1]);
  assert.deepEqual(compound, ["ai", "ei", "ui", "ao", "ou", "iu", "ie", "üe", "er"]);
  const mnemonicSection = sql.slice(sql.indexOf("-- 由家长提供"), sql.indexOf("-- 只在首次增加"));
  assert.equal([...mnemonicSection.matchAll(/\('[a-z]+','[^']+'\)/g)].length, 14);
  assert.match(sql, /primary key\(learner_id,unit_code\)/);
  assert.match(sql, /pg_advisory_xact_lock/);
});

test("前后鼻韵母独立分类，追加 9 单元且不自动开启或重置成绩", () => {
  const sql = readFileSync(new URL("../supabase/035_pinyin_nasal_finals.sql", import.meta.url), "utf8");
  assert.deepEqual([...sql.matchAll(/\('([^']+)','front_nasal',/g)].map((match) => match[1]), ["an", "en", "in", "un", "ün"]);
  assert.deepEqual([...sql.matchAll(/\('([^']+)','back_nasal',/g)].map((match) => match[1]), ["ang", "eng", "ing", "ong"]);
  assert.equal(pinyinCategoryLabel("front_nasal"), "前鼻韵母");
  assert.equal(PINYIN_CATEGORY_COUNTS.back_nasal, "4 个");
  assert.doesNotMatch(sql, /update public\.pinyin_(?:states|settings) set/i);
  assert.match(sql, /new\.enabled_categories is not distinct from old\.enabled_categories/);
});
