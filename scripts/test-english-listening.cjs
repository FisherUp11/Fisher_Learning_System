/* eslint-disable @typescript-eslint/no-require-imports -- Local isolated regression harness. */
// No production credentials, network, or application data are used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
function load(name) {
  const moduleObject = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'lib', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module: moduleObject, exports: moduleObject.exports, require: p => load(p.replace('./', '')), Date, Intl, Set });
  return moduleObject.exports;
}
const { splitMeeting, wordCount, validateSource, validateListening, rotateOptions, wordLabel } = load('english-listening');
const { prepareEnglishSource, listeningSourceInput } = load('english-source');
const { listeningAudioText } = load('english-audio');
const sentence = 'The team agreed to review the delivery plan before Friday. ';
const excerpt = sentence.repeat(30);
function lesson() { return { title: '交付计划', summary: sentence.repeat(25), translation: '讨论交付计划。', questions: Array.from({ length: 3 }, () => ({ prompt: 'What is next?', translation: '下一步是什么？', options: ['Review the plan', 'Cancel the project', 'Close the office', 'Change the supplier'], correct: 0, explanation: '团队将审核计划。', evidence: sentence.trim() })), expressions: ['review', 'delivery plan', 'agreed to', 'before Friday'].map(phrase => ({ phrase, meaning: '意思：' + phrase, example: sentence, source_quote: sentence.trim(), category: 'phrase', options: ['意思：' + phrase, '错误一', '错误二', '错误三'], correct: 0 })) }; }
test('15,000 word import is lossless, sentence-bound, and bounded', () => {
  const text = ('word '.repeat(99) + 'end.\n\n').repeat(150).trim();
  assert.equal(wordCount(text), 15000); validateSource(text);
  const parts = splitMeeting(text); assert.equal(parts.length, 50);
  assert.equal(parts.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.ok(parts.every(p => wordCount(p) <= 400));
  assert.throws(() => validateSource(text + ' extra'));
  assert.throws(() => validateSource('中'.repeat(150001)));
  assert.throws(() => splitMeeting('unbroken '.repeat(1100)));
});
test('Validation rejects fabricated evidence, ambiguous option duplicates, and mismatched word meanings', () => {
  validateListening(lesson(), excerpt);
  const bad = lesson(); bad.questions[0].evidence = 'Invented fact.'; assert.throws(() => validateListening(bad, excerpt));
  const dup = lesson(); dup.questions[0].options[1] = dup.questions[0].options[0]; assert.throws(() => validateListening(dup, excerpt));
  const word = lesson(); word.expressions[0].correct = 1; assert.throws(() => validateListening(word, excerpt));
  const six = lesson(); six.expressions.push({ ...six.expressions[0], phrase: 'the team' }, { ...six.expressions[0], phrase: 'plan' }); validateListening(six, excerpt);
});
test('Rotating choices preserves the correct answer and does not mutate the course', () => {
  const q = lesson().questions[0]; for (let n = 0; n < 8; n++) { const rotated = rotateOptions(q, n); assert.equal(rotated.options[rotated.correct], q.options[q.correct]); } assert.equal(q.correct, 0);
  assert.equal(wordLabel({ stage: 5, independent_days: 3, spaced_success: false }), '巩固中');
});

test('Bilingual adjacent lines are paired in either order, including Chinese with English terminology', () => {
  for (const reverse of [false,true]) {
    const pairs = [['Please review the delivery plan.', '请审核 delivery plan。'], ['We will follow up next week.', '我们将在下周跟进。']];
    const raw = pairs.map(p => (reverse ? [...p].reverse() : p).join('\n')).join('\n');
    const prepared = prepareEnglishSource(raw); assert.equal(prepared.pairs.length,2);
    assert.equal(prepared.pairs[0].english,pairs[0][0]); assert.equal(prepared.pairs[0].chinese,pairs[0][1]);
    assert.ok(!prepared.english.includes('请审核')); assert.equal(prepared.englishWords,11);
  }
});
test('Pair direction may change between blank-separated groups; wrapping and CRLF are supported', () => {
  const raw='We will follow up\r\non Friday.\r\n我们将在星期五\r\n跟进。\r\n\r\n请确认计划。\r\nPlease confirm the plan.';
  const p=prepareEnglishSource(raw); assert.equal(p.pairs.length,2); assert.equal(p.pairs[0].english,'We will follow up on Friday.'); assert.equal(p.pairs[1].english,'Please confirm the plan.');
});
test('SRT/VTT metadata is ignored for generation, not removed from the stored raw slices', () => {
  const raw='WEBVTT\n\nNOTE private caption note\nnot spoken\n\ncue-1\n00:00:01.000 --> 00:00:03.000 align:start\n<i>Please review the plan.</i>\n请审核计划。\n\n2\n00:00:04,000 --> 00:00:06,000\n我们会跟进。\nWe will follow up.';
  const p=prepareEnglishSource(raw); assert.equal(p.pairs.length,2); assert.ok(!p.english.includes('00:00')); assert.ok(!p.english.includes('not spoken')); assert.ok(!p.english.includes('<i>'));
  assert.equal(p.rawUnits.join('').replace(/\s/g,''),raw.replace(/\s/g,''));
  assert.equal(p.pairs[0].english,'Please review the plan.'); assert.equal(p.pairs[1].chinese,'我们会跟进。');
});
test('Long bilingual text stays lossless and no pair is divided at the 300-word lesson boundary', () => {
  for (const reverse of [false,true]) {
    const pairs=Array.from({length:120},(_,i)=>[`Sentence ${i}: Please review the delivery plan before our next meeting.`,`第${i}句：请在下次会议之前审核交付计划。`]);
    const raw=pairs.map(p=>(reverse?[...p].reverse():p).join('\n')).join('\n\n');
    const chunks=splitMeeting(raw); assert.ok(chunks.length>1);
    assert.equal(chunks.join('').replace(/\s/g,''),raw.replace(/\s/g,''));
    const parsed=chunks.map(prepareEnglishSource); assert.equal(parsed.reduce((n,p)=>n+p.pairs.length,0),120);
    assert.ok(parsed.every(p=>p.englishWords<=400&&p.pairs.every(pair=>/Sentence (\d+)/.exec(pair.english)[1]===/第(\d+)句/.exec(pair.chinese)[1])));
    assert.ok(parsed.every(p=>p.warnings.length===0));
  }
});
test('Mixed-line / Chinese-only sources surface warnings rather than inventing English', () => {
  const p=prepareEnglishSource('We will follow up tomorrow. 我们明天跟进。'); assert.ok(p.warnings.length); assert.equal(p.english,'');
  assert.throws(()=>listeningSourceInput('这是纯中文内容。'.repeat(30)));
  assert.throws(()=>listeningSourceInput('Too short.\n太短。'));
  const text=Array.from({length:20},()=>sentence+'\n团队同意在周五前审核交付计划。').join('\n\n');
  const input=listeningSourceInput(text); assert.ok(input.english_source.includes('Friday')); assert.ok(!input.english_source.includes('团队')); assert.ok(input.chinese_reference.includes('团队'));
});
test('Generation validation requires English audio/terms and quotes from cleaned English, not translations', () => {
  const raw=Array.from({length:30},()=>`<i>${sentence.trim()}</i>\n团队同意在周五前审核交付计划。`).join('\n\n');
  validateListening(lesson(),raw);
  const chinese=lesson();chinese.summary+=' 中文混进听力。';assert.throws(()=>validateListening(chinese,raw));
  const quoted=lesson();quoted.expressions[0].source_quote='团队同意在周五前审核交付计划。';assert.throws(()=>validateListening(quoted,raw));
  const phrase=lesson();phrase.expressions[0].phrase='交付计划';assert.throws(()=>validateListening(phrase,raw));
});
test('Audio selector supports saved word/phrase and example, never arbitrary browser text or fields', () => {
  const snapshot=lesson(),session={snapshot,review_words:[snapshot.expressions[0]]};
  assert.equal(listeningAudioText(session,'w:0'),snapshot.expressions[0].phrase);
  assert.equal(listeningAudioText(session,'w:0','example'),snapshot.expressions[0].example);
  assert.equal(listeningAudioText(session,'r:0','example'),snapshot.expressions[0].example);
  assert.equal(listeningAudioText(session,'q:0'),snapshot.questions[0].evidence);
  assert.equal(listeningAudioText(session,'w:999'),''); assert.equal(listeningAudioText(session,'https://example.com'),'');
  assert.throws(()=>listeningAudioText(session,'w:0','meaning'));
});

test('PostgreSQL integration: upgrade, isolation, schedules, idempotency, hints, and deletion', { skip: !process.env.PGLITE_MODULE }, async t => {
  const { PGlite } = require(process.env.PGLITE_MODULE); const db = new PGlite();
  const A = randomUUID(), B = randomUUID(), PA = randomUUID(), PB = randomUUID(), SOURCE = randomUUID(), LESSON = randomUUID(), SESSION = randomUUID();
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon; insert into auth.users values('${A}'),('${B}');`);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/019_parent_growth.sql'), 'utf8'));
  const sql = fs.readFileSync(path.join(root, 'supabase/020_english_listening_courses.sql'), 'utf8');
  await db.exec(sql); await db.exec(sql);
  const user = (id, fn) => db.transaction(async tx => { await tx.exec('set local role authenticated'); await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id]); return fn(tx); });
  const query = (text, values = []) => user(A, tx => tx.query(text, values));
  await query("insert into adult_profiles(id,name) values($1,'爸爸')", [PA]);
  await user(B, tx => tx.query("insert into adult_profiles(id,name) values($1,'另一家庭')", [PB]));
  await query("insert into adult_english_sources(id,title,body,content_hash,meeting_date) values($1,'Meeting',$2,'hash',current_date)", [SOURCE, excerpt]);
  let section, concepts, snapshot;
  await t.test('Splitting rejects missing text and is idempotent after a complete split', async () => {
    await assert.rejects(query('select adult_split_source($1,$2)', [SOURCE, JSON.stringify([{ excerpt: 'Missing text', word_count: 2 }])]));
    const args = [SOURCE, JSON.stringify([{ excerpt, word_count: wordCount(excerpt) }])];
    await query('select adult_split_source($1,$2)', args); await query('select adult_split_source($1,$2)', args);
    const rows = (await query('select * from adult_english_sections')).rows; assert.equal(rows.length, 1); section = rows[0].id;
  });
  await t.test('Cross-account read/write/FK and anonymous access are denied', async () => {
    assert.equal((await user(B, tx => tx.query('select * from adult_english_sections'))).rows.length, 0);
    await assert.rejects(user(B, tx => tx.query("insert into adult_english_sections(source_id,ordinal,title,excerpt,word_count) values($1,2,'x','x',1)", [SOURCE])));
    await assert.rejects(db.transaction(tx => tx.exec('set local role anon; select * from adult_listening_sessions')));
    await assert.rejects(query("insert into adult_listening_sessions(profile_id,local_date) values($1,current_date)", [PB]));
  });
  await t.test('Working generation is unique; published version and concepts are durable/idempotent', async () => {
    await query("insert into adult_english_lessons(id,source_id,section_id,format_version,level,status) values($1,$2,$3,2,'practical','draft')", [LESSON, SOURCE, section]);
    await assert.rejects(query("insert into adult_english_lessons(source_id,section_id,format_version,level) values($1,$2,2,'practical')", [SOURCE, section]));
    const content = lesson(); content.expressions.push({ ...content.expressions[0], phrase: 'team' }, { ...content.expressions[0], phrase: 'plan' });
    const args = [LESSON, JSON.stringify(content), JSON.stringify(content.expressions.map((e,i) => ({ ...e, key: `key-${i}` })))];
    await query('select adult_publish_lesson($1,$2,$3)', args); await query('select adult_publish_lesson($1,$2,$3)', args);
    concepts = (await query('select * from adult_english_concepts order by concept_key')).rows; assert.equal(concepts.length, 6);
    snapshot = { ...content, expressions: content.expressions.map((e,i) => ({ ...e, concept_id: concepts[i].id })) };
    await query("insert into adult_listening_sessions(id,profile_id,local_date,lesson_id,snapshot) values($1,$2,(now() at time zone 'Asia/Shanghai')::date,$3,$4)", [SESSION, PA, LESSON, JSON.stringify(snapshot)]);
  });
  const answer = (task, selected = 0, id = randomUUID(), rating = null) => query('select adult_listening_answer($1,$2,$3,$4,$5,false) a', [id, SESSION, task, selected, rating]).then(r => r.rows[0].a);
  await t.test('Answers use snapshot key; duplicate requests do not count twice; retries are assisted', async () => {
    const id = randomUUID(); const first = await answer('q:0', 1, id); assert.equal(first.correct, false); assert.equal(first.assisted, false);
    const replay = await answer('q:0', 0, id); assert.equal(replay.correct, false); assert.equal(replay.id, first.id);
    assert.equal((await query('select * from adult_listening_attempts')).rows.length, 1);
    const retry = await answer('q:0'); assert.equal(retry.correct, true); assert.equal(retry.assisted, true);
    await assert.rejects(answer('q:9')); await assert.rejects(answer('q:1', 8)); await assert.rejects(answer('q:1', 0, id));
    await assert.rejects(user(B, tx => tx.query('select adult_listening_answer($1,$2,$3,0,null,false)', [randomUUID(), SESSION, 'q:1'])));
  });
  await t.test('Hints persist on server across reloads; vocabulary hints only affect that task', async () => {
    await query('select adult_listening_hint($1,$2)', [SESSION, 'w:0']);
    const assisted = await answer('w:0'); assert.equal(assisted.assisted, true);
    const independent = await answer('w:1'); assert.equal(independent.assisted, false);
    const state = (await query('select * from adult_english_word_states where concept_id=$1', [concepts[1].id])).rows[0];
    assert.equal(state.stage, 1); assert.equal(state.independent_days, 1); assert.equal(state.spaced_success, false);
    await query('select adult_listening_hint($1,null)', [SESSION]); assert.equal((await answer('q:1')).assisted, true);
  });
  await t.test('Repeated wrong answers downgrade only once per day; self-rating never promotes', async () => {
    await query('update adult_english_word_states set stage=3 where concept_id=$1', [concepts[1].id]);
    await answer('w:1', 1); await answer('w:1', 1);
    let state = (await query('select * from adult_english_word_states where concept_id=$1', [concepts[1].id])).rows[0]; assert.equal(state.stage, 2);
    await answer('w:2', null, randomUUID(), 'known');
    state = (await query('select * from adult_english_word_states where concept_id=$1', [concepts[2].id])).rows[0]; assert.equal(state.stage, 0); assert.equal(state.independent_days, 0);
  });
  await t.test('Seven-day independent recall is distinct from same-day drilling; one plan per day', async () => {
    await query("insert into adult_english_word_states(profile_id,concept_id,stage,independent_days,last_success_date,due_date) values($1,$2,2,2,(now() at time zone 'Asia/Shanghai')::date-7,(now() at time zone 'Asia/Shanghai')::date-3)", [PA,concepts[4].id]);
    await answer('w:4');
    const state=(await query('select * from adult_english_word_states where concept_id=$1',[concepts[4].id])).rows[0];
    assert.equal(state.stage,3); assert.equal(state.independent_days,3); assert.equal(state.spaced_success,true);
    await assert.rejects(query("insert into adult_listening_sessions(profile_id,local_date) values($1,(now() at time zone 'Asia/Shanghai')::date)",[PA]));
  });
  await t.test('Completion requires all items, stale-day submissions rejected, deleting source cascades safely', async () => {
    for (const id of ['q:2', 'w:3', 'w:4', 'w:5']) await answer(id);
    assert.ok((await query('select completed_at from adult_listening_sessions')).rows[0].completed_at);
    await query('update adult_listening_sessions set local_date=local_date-1 where id=$1', [SESSION]); await assert.rejects(answer('q:2'));
    await query('select adult_delete_source($1)', [SOURCE]);
    for (const name of ['adult_english_sections', 'adult_english_lessons', 'adult_listening_sessions', 'adult_listening_attempts', 'adult_english_word_states']) assert.equal((await query(`select count(*)::int n from ${name}`)).rows[0].n, 0);
    assert.equal((await query('select count(*)::int n from adult_profiles')).rows[0].n, 1);
    assert.equal((await user(B, tx => tx.query('select count(*)::int n from adult_profiles'))).rows[0].n, 1);
  });
  await db.close();
});
