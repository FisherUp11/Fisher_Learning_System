/* eslint-disable @typescript-eslint/no-require-imports -- Local Node regression harness. */
// Pure tests: node --test scripts/test-parent-growth.cjs
// SQL tests too: PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite node --test scripts/test-parent-growth.cjs
// Never connects to Supabase or reads .env.local.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "lib/adult-learning.ts"), "utf8");
const moduleObject = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: moduleObject.exports, module: moduleObject, Date, Intl, Set });
const { localDay, addDays, dayProgress, goalOnDay, validateLesson, masteryLabel, makeTasks, normalizeText } = moduleObject.exports;
const today = localDay();
const goal = { id: "goal", created_at: "2026-09-01T00:00:00Z", unit: "sets" };
const versions = [{ goal_id: "goal", effective_date: "2026-09-01", target: 3, weekdays: [1, 2, 3, 4, 5], active: true }, { goal_id: "goal", effective_date: "2026-09-19", target: 5, weekdays: [1, 2, 3, 4, 5], active: true }];
test("Shanghai day and month/year rollover", () => {
  assert.equal(localDay(new Date("2026-09-17T16:00:00Z")), "2026-09-18");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});
test("Changing goals does not rewrite past targets; rest day is not achieved", () => {
  assert.equal(goalOnDay(goal, versions, "2026-09-18").target, 3);
  assert.equal(goalOnDay(goal, versions, "2026-09-21").target, 5);
  const logs = [{ goal_id: "goal", local_date: "2026-09-18", amount: 2 }, { goal_id: "goal", local_date: "2026-09-18", amount: 1, voided_at: "now" }];
  assert.equal(dayProgress([goal], versions, logs, "2026-09-18").achieved, false);
  assert.equal(dayProgress([goal], versions, logs, "2026-09-18").participated, true);
  assert.equal(dayProgress([goal], versions, [], "2026-09-20").scheduled, 0);
});
test("Source normalization catches whitespace/case duplicates", () => assert.equal(normalizeText(" Deadline \n review "), "deadline review"));
const content = { summary: "The team discussed a deadline.", translation: "团队讨论了交期。", questions: [{ prompt: "What did they discuss?", answer: "A deadline." }], expressions: [{ phrase: "Could you confirm the deadline?", meaning: "确认截止时间", example: "Could you confirm the deadline?", source_quote: "confirm the deadline" }], speaking: [{ prompt: "Ask about a deadline", answer: "Could you confirm the deadline?" }], quiz: [{ prompt: "Ask about delivery", answer: "When can we deliver?" }] };
test("Lesson validation rejects fabricated source quotes and empty tasks", () => {
  validateLesson(content, "Please confirm the deadline.");
  assert.throws(() => validateLesson(content, "Nothing about that here."));
  assert.throws(() => validateLesson({ ...content, questions: [] }));
});
test("Stable mastery needs multi-day evidence AND a 7-day gap", () => {
  assert.notEqual(masteryLabel({ stage: 5, independent_days: 2, spaced_success: true }), "稳定掌握");
  assert.notEqual(masteryLabel({ stage: 5, independent_days: 3, spaced_success: false }), "稳定掌握");
  assert.equal(masteryLabel({ stage: 3, independent_days: 3, spaced_success: true }), "稳定掌握");
});
test("Plans distinguish listening/speaking, bound review load, and short plan remains small", () => {
  const lesson = { id: "lesson", content };
  const concepts = [{ id: "concept", ...content.expressions[0] }];
  const links = [{ lesson_id: "lesson", concept_id: "concept" }];
  const tasks = makeTasks(lesson, concepts, links, [], today, "standard", 5, 10);
  assert.ok(tasks.some(t => t.concept_id === "concept" && t.skill === "listening"));
  assert.ok(tasks.some(t => t.concept_id === "concept" && t.skill === "speaking"));
  assert.equal(new Set(tasks.map(t => t.id)).size, tasks.length);
  const states = ["listening", "speaking"].map(skill => ({ concept_id: "concept", skill, due_date: addDays(today, -4), stage: 0 }));
  assert.equal(makeTasks(lesson, concepts, links, states, today, "short", 5, 10).length, 2);
  assert.equal(makeTasks(lesson, concepts, [], states, today, "short", 5, 10).some(t => t.kind === "review"), false);
  const notDue = states.map(st => ({ ...st, due_date: addDays(today, 3) }));
  assert.equal(makeTasks(lesson, concepts, links, notDue, today, "standard", 5, 10).some(t => t.concept_id === "concept"), false);
  assert.equal(makeTasks(lesson, concepts, links, [], today, "short", 0, 10).some(t => t.concept_id === "concept"), false);
  const dueTasks = makeTasks(lesson, concepts, links, states, today, "standard", 5, 10).filter(t => t.concept_id === "concept");
  assert.equal(dueTasks.length, 2);
  assert.ok(dueTasks.every(t => t.kind === "review"));
});

test("PostgreSQL: schema, RLS, goal snapshots, atomic saves, schedules, and deletion", { skip: !process.env.PGLITE_MODULE }, async t => {
  const { PGlite } = require(process.env.PGLITE_MODULE);
  const db = new PGlite();
  const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
  const PA = "33333333-3333-4333-8333-333333333333", PB = "44444444-4444-4444-8444-444444444444";
  const ID = "55555555-5555-4555-8555-555555555555", SOURCE = "66666666-6666-4666-8666-666666666666", LESSON = "77777777-7777-4777-8777-777777777777", PLAN = "88888888-8888-4888-8888-888888888888";
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon; insert into auth.users values('${A}'),('${B}');`);
  const sql = fs.readFileSync(path.join(root, "supabase/019_parent_growth.sql"), "utf8");
  await db.exec(sql); await db.exec(sql); // rerunnable without resets
  const asUser = (user, callback) => db.transaction(async tx => { await tx.exec("set local role authenticated"); await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]); return callback(tx); });
  await asUser(A, tx => tx.query("insert into public.adult_profiles(id,name) values($1,'爸爸')", [PA]));
  await asUser(B, tx => tx.query("insert into public.adult_profiles(id,name) values($1,'另一家庭')", [PB]));
  let G;
  await t.test("RLS isolates profiles and forbids ownership forgery", async () => {
    assert.equal((await asUser(A, tx => tx.query("select * from public.adult_profiles"))).rows.length, 1);
    await assert.rejects(asUser(A, tx => tx.query("insert into public.adult_profiles(name,owner_id) values('伪造',$1)", [B])));
    await assert.rejects(db.transaction(tx => tx.exec("set local role anon; select * from public.adult_profiles")));
    await assert.rejects(asUser(A, tx => tx.query("insert into public.adult_exercise_goals(profile_id,name,unit) values($1,'伪造','sets')", [PB])));
  });
  await t.test("Goal change takes effect tomorrow only", async () => {
    G = (await asUser(A, tx => tx.query("select public.adult_save_goal($1,null,'腹肌轮','sets',3,array[0,1,2,3,4,5,6],true) id", [PA]))).rows[0].id;
    await asUser(A, tx => tx.query("select public.adult_save_goal($1,$2,'腹肌轮','sets',5,array[1,2,3,4,5],true)", [PA, G]));
    const rows = (await asUser(A, tx => tx.query("select target from public.adult_goal_versions order by effective_date"))).rows;
    assert.equal(Number(rows[0].target), 3); assert.equal(Number(rows[1].target), 5);
  });
  await t.test("Exercise retry is idempotent; genuine second click creates second log", async () => {
    const query = (tx, id) => tx.query("select public.adult_log_exercise($1,$2,$3,(now() at time zone 'Asia/Shanghai')::date,1,10,null,null,'test')", [id, PA, G]);
    await asUser(A, tx => query(tx, ID)); await asUser(A, tx => query(tx, ID));
    assert.equal((await asUser(A, tx => tx.query("select count(*)::int n from public.adult_exercise_logs"))).rows[0].n, 1);
    await asUser(A, tx => query(tx, "55555555-5555-4555-8555-555555555556"));
    assert.equal((await asUser(A, tx => tx.query("select count(*)::int n from public.adult_exercise_logs"))).rows[0].n, 2);
    await assert.rejects(asUser(B, tx => query(tx, "55555555-5555-4555-8555-555555555557")));
  });
  let concept;
  await t.test("Publication links concepts exactly once", async () => {
    await asUser(A, tx => tx.query("insert into public.adult_english_sources(id,title,body,content_hash,meeting_date) values($1,'Meeting','Please confirm the deadline.','hash',current_date)", [SOURCE]));
    await asUser(A, tx => tx.query("insert into public.adult_english_lessons(id,source_id,level,status) values($1,$2,'supported','draft')", [LESSON, SOURCE]));
    const args = [LESSON, JSON.stringify(content), JSON.stringify([{ ...content.expressions[0], key: "expr-key" }])];
    await asUser(A, tx => tx.query("select public.adult_publish_lesson($1,$2,$3)", args));
    await asUser(A, tx => tx.query("select public.adult_publish_lesson($1,$2,$3)", args));
    const rows = (await asUser(A, tx => tx.query("select * from public.adult_english_concepts"))).rows;
    assert.equal(rows.length, 1); concept = rows[0].id;
    assert.equal((await asUser(B, tx => tx.query("select * from public.adult_english_sources"))).rows.length, 0);
    await asUser(A, tx => tx.query("insert into public.adult_english_plans(id,profile_id,local_date,mode,tasks) values($1,$2,(now() at time zone 'Asia/Shanghai')::date,'standard',$3)", [PLAN, PA, JSON.stringify([{ id: "task", lesson_id: LESSON, concept_id: concept, skill: "speaking" }])]));
  });
  let sequence = 10;
  const answer = (mode = "speech", hinted = false, result = "correct", evaluator = "ai", id) => asUser(A, tx => tx.query("select public.adult_record_attempt($1,$2,'task','Could you confirm the deadline?',$3,$4,$5,$6,'Feedback')", [id ?? `99999999-9999-4999-8999-${String(sequence++).padStart(12, "0")}`, PLAN, result, evaluator, hinted, mode]));
  const state = async () => (await asUser(A, tx => tx.query("select * from public.adult_english_states"))).rows[0];
  await t.test("Self, text, hinted, corrected responses do not inflate independent speaking", async () => {
    await answer("self", false, "correct", "self"); await answer("text"); await answer("speech", true); await answer("corrected");
    assert.equal((await state()).stage, 0); assert.equal((await state()).independent_days, 0);
  });
  await t.test("Independent speech advances once per day; retries exactly once", async () => {
    const id = "99999999-9999-4999-8999-999999999999";
    await answer("speech", false, "correct", "ai", id); const n = (await state()).attempts;
    await answer("speech", false, "correct", "ai", id); assert.equal((await state()).attempts, n);
    await answer(); assert.equal((await state()).stage, 1); assert.equal((await state()).independent_days, 1);
  });
  await t.test("A missed session remains due; a 7-day recall is recorded; wrong resets short", async () => {
    await asUser(A, tx => tx.query("update public.adult_english_states set last_success_date=(now() at time zone 'Asia/Shanghai')::date-7,due_date=current_date-6"));
    await answer(); assert.equal((await state()).spaced_success, true); assert.equal((await state()).stage, 2);
    await answer("speech", false, "again"); assert.equal((await state()).stage, 1); assert.equal((await state()).spaced_success, false);
    await asUser(A, tx => tx.query("update public.adult_english_plans set local_date=local_date-1 where id=$1", [PLAN]));
    await assert.rejects(answer());
    await asUser(A, tx => tx.query("update public.adult_english_plans set local_date=(now() at time zone 'Asia/Shanghai')::date where id=$1", [PLAN]));
  });
  await t.test("Atomic deletion removes private snapshots but not exercises or other accounts", async () => {
    await assert.rejects(asUser(B, tx => tx.query("select public.adult_delete_source($1)", [SOURCE])));
    await asUser(A, tx => tx.query("select public.adult_delete_source($1)", [SOURCE]));
    for (const table of ["adult_english_sources", "adult_english_lessons", "adult_english_plans", "adult_english_attempts", "adult_english_states", "adult_english_concepts"]) assert.equal((await asUser(A, tx => tx.query(`select count(*)::int n from public.${table}`))).rows[0].n, 0);
    assert.equal((await asUser(A, tx => tx.query("select count(*)::int n from public.adult_exercise_logs"))).rows[0].n, 2);
    assert.equal((await asUser(B, tx => tx.query("select count(*)::int n from public.adult_profiles"))).rows[0].n, 1);
  });
  await db.close();
});
