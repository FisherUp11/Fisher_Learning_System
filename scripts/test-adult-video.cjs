/* eslint-disable @typescript-eslint/no-require-imports -- isolated test harness */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { randomUUID, createHash } = require('node:crypto');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name).exports;
  const m = { exports: {} };
  cache.set(name, m);
  const code = ts.transpileModule(read(`lib/${name}.ts`), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('module', 'exports', 'require', code)(m, m.exports, p => p === 'server-only' ? {} : p.startsWith('@/lib/') ? load(p.slice(6)) : require(p));
  return m.exports;
}

test('YouTube 链接只使用安全的视频 ID，时间点选填且支持零秒', () => {
  const { youtubeId, parseVideoTimestamp, youtubeHref, videoTime } = load('adult-video');
  const key = 'fr5-2nKnmgw';
  assert.equal(youtubeId(`https://www.youtube.com/watch?v=${key}&t=3&list=x`), key);
  assert.equal(youtubeId(`https://youtu.be/${key}?si=test`), key);
  assert.equal(youtubeId(`https://m.youtube.com/shorts/${key}`), key);
  for (const url of ['javascript:alert(1)', `https://www.youtube.com.evil.test/watch?v=${key}`, `https://user@youtu.be/${key}`, 'https://www.youtube.com/playlist?list=abc', 'https://youtu.be/;']) assert.throws(() => youtubeId(url));
  assert.equal(parseVideoTimestamp(''), null);
  assert.equal(parseVideoTimestamp('00:00'), 0);
  assert.equal(parseVideoTimestamp('02:14'), 134);
  assert.equal(parseVideoTimestamp('1:02:14'), 3734);
  assert.equal(videoTime(3734), '1:02:14');
  assert.equal(youtubeHref(key, 134), `https://www.youtube.com/watch?v=${key}&t=134s`);
  assert.equal(youtubeHref(key, null), `https://www.youtube.com/watch?v=${key}`);
  assert.throws(() => parseVideoTimestamp('02:83'));
  assert.throws(() => parseVideoTimestamp('-3'));
});

test('模板可直接解析；双引号、中文字段、跨行例句与报错行号', async () => {
  const { buildImportTemplate } = load('csv-import');
  const { parseVideoImport } = load('adult-video-import');
  const template = buildImportTemplate('adult_video');
  assert.match(template.headers.get('content-disposition'), /attachment/);
  assert.equal(parseVideoImport(await template.text()).length, 2);
  const rows = parseVideoImport('单词,释义,例句,音标,时间点\r\nsteady,稳定,"One, ""two"".",,\r\n');
  assert.equal(rows[0].example, 'One, "two".');
  assert.equal(rows[0].track, false);
  assert.throws(() => parseVideoImport('word,meaning,example,timestamp\nfirst,第一个,"line 1\nline 2",01:00\nsecond,第二个,,34:70'),
    e => e.details?.[0].startsWith('第 4 行'));
  assert.throws(() => parseVideoImport('word,example\nfirst,text'), /表头/);
});

test('全选会标记 42 个词句并保留原内容，勾前五项不取消已有选项', () => {
  const { selectVideoReviewRows } = load('adult-video');
  const rows = Array.from({ length: 42 }, (_, i) => ({
    word: `word ${i}`, meaning: '释义', example: 'Example.', pronunciation: '/wɝd/', timestamp: i, track: i === 8,
  }));
  const all = selectVideoReviewRows(rows);
  assert.deepEqual(all, rows.map(row => ({ ...row, track: true })));
  assert.equal(rows.filter(row => row.track).length, 1);
  assert.deepEqual(selectVideoReviewRows(rows, 5).map((row, i) => row.track ? i : -1).filter(i => i >= 0), [0, 1, 2, 3, 4, 8]);
});

test('即时预览只换卡，不猜测进度；没有下一张时不把队列当作完成', () => {
  const { previewNextVideoCard } = load('adult-video');
  const first = { concept_id:'a', attempt_count:0 }, next = { concept_id:'b', attempt_count:2 };
  const before = { today:'2026-11-24', total:5, remaining:2, cards:[first,next] };
  assert.deepEqual(previewNextVideoCard(before, 'a'), { ...before, cards:[next] });
  assert.equal(previewNextVideoCard(before, 'stale-card'), before);
  const single = { ...before, remaining:1, cards:[first] };
  assert.deepEqual(previewNextVideoCard(single, 'a'), { ...single, cards:[] });
});

test('轻量同步只读取本用户和本档案的两张待复习词卡，并保持原队列顺序', async () => {
  const { createClient } = require('@supabase/supabase-js');
  const { readVideoPracticeQueue } = load('adult-video-practice-server');
  const source = ({ id, second, date }) => ({ video:{ id, title:id, youtube_id:'fr5-2nKnmgw', created_at:date }, start_second:second, pronunciation:'/a/', example:'Example.' });
  const pendingRows = [{ concept_id:'a', queue_kind:'review', attempt_count:2, confirmations:1, had_failure:true,
    concept:{ phrase:'example', meaning:'例子', links:[source({id:'new',second:null,date:'2026-11-24'}),source({id:'timed',second:0,date:'2026-11-23'})] } }];
  let calls = 0;
  const db = createClient('https://test.example', 'example-key', { auth:{ persistSession:false }, global:{ fetch: async (input, init) => {
    calls++;
    const url = new URL(input), f = url.searchParams;
    assert.equal(url.pathname, '/rest/v1/adult_video_daily_items');
    assert.equal(f.get('owner_id'), 'eq.user');
    assert.equal(f.get('profile_id'), 'eq.profile');
    assert.equal(f.get('local_date'), 'eq.2026-11-24');
    if (init.method === 'HEAD') return new Response(null,{headers:{'content-range':'0-0/3'}});
    assert.equal(f.get('order'), 'last_answered_at.asc.nullsfirst,ordinal.asc,concept_id.asc');
    assert.equal(f.get('limit'), '2');
    assert.equal(f.get('completed_at'), 'is.null');
    return Response.json(pendingRows,{headers:{'content-range':'0-0/1'}});
  } } });
  const result = await readVideoPracticeQueue(db, 'user', 'profile', '2026-11-24');
  assert.equal(calls,2);
  assert.deepEqual([result.total,result.remaining], [3,1]);
  assert.equal(result.cards[0].attempt_count,2);
  assert.deepEqual(result.cards[0].origins.map(({id,start_second}) => [id,start_second]), [['timed',0],['new',null]]);
});

function renderDesk(studyOverride) {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const code = ts.transpileModule(read('components/adult-video-desk.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const m = { exports: {} };
  const mocks = {
    'next/link': { default: props => React.createElement('a', props) },
    'next/navigation': { useRouter: () => ({}) },
    '@/lib/adult-video-actions': {},
    '@/lib/adult-video': load('adult-video'),
    './adult-video.module.css': { default: {} },
    './feedback-form': { FeedbackForm: ({ children }) => React.createElement('form', null, children) },
    './adult-english-study': { PrivateAudio: ({ label }) => React.createElement('button', null, label) },
    './use-immediate-study': { useImmediateStudy: ({ initial }) => ({ data:initial, status:'ready', blocked:false, ...studyOverride }) },
  };
  new Function('module','exports','require',code)(m,m.exports,id=>mocks[id] ?? require(id));
  const video={id:'v1',title:'本周访谈',youtube_id:'fr5-2nKnmgw',practice_count:2,word_count:1,last_on:'2026-11-24'};
  return renderToStaticMarkup(React.createElement(m.exports.AdultVideoDesk,{profileId:'profile',wordView:true,data:{
    today:'2026-11-24', focus:video, selected:video, videos:[video], due:1, remaining:1, tracked:1,
    daily_new:5,total_today:1,total_videos:1,total_words:1, video_page:1,word_page:1,history:[],
    current:{concept_id:'c',phrase:'in the long run',meaning:'练习未揭晓的释义',queue_kind:'review',attempt_count:0,origins:[]},
    words:[{concept_id:'c',phrase:'in the long run',meaning:'测试词表的释义',start_second:134,tracked:true}],
  }}));
}

test('实际 React 界面显示本周四轮、独立打卡和词表时间链接；作答前不展开释义', () => {
  const html = renderDesk();
  assert.match(html,/已练 2 次，目标 4 次/);
  assert.match(html,/本次练完/);
  assert.match(html,/t=134s/);
  assert.match(html,/我先回忆，再看答案/);
  assert.doesNotMatch(html,/练习未揭晓的释义/);
});

test('保存中先展示下一张；最后一张未确认时不显示已完成，错误时提供原作答重试', () => {
  const queue = { today:'2026-11-24', total:2, remaining:1, cards:[] };
  const next = { concept_id:'next', phrase:'get better', meaning:'好转',queue_kind:'new', attempt_count:0, origins:[] };
  const preview = renderDesk({ data:{ ...queue, cards:[next] }, status:'saving', blocked:true });
  assert.match(preview,/get better/);
  assert.match(preview,/上一笔正在保存/);
  assert.doesNotMatch(preview,/今日词卡完成/);
  assert.doesNotMatch(renderDesk({ data:queue, status:'saving', blocked:true }),/今日词卡完成/);
  assert.match(renderDesk({ data:queue, error:'save failed', status:'save-error', blocked:true }),/重试保存这次作答/);
  assert.match(renderDesk({ data:{...queue, remaining:0} }),/今日词卡完成/);
});

test('041 本地 PostgreSQL：导入、权限隔离、打卡、同义复用和记忆逻辑', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = require(process.env.PGLITE_MODULE); const db = new PGlite();
  try {
    const a = randomUUID(), b = randomUUID(), inactive = randomUUID(), workspace = randomUUID(), p = randomUUID(), q = randomUUID(), other = randomUUID(), noModule = randomUUID();
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema private;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth,private to authenticated;
      insert into auth.users values('${a}'),('${b}'),('${inactive}');
      create table public.learning_workspaces(id uuid primary key,status text);
      create table public.workspace_members(workspace_id uuid,user_id uuid,status text);
      create table public.account_module_access(workspace_id uuid,user_id uuid,module_key text,enabled boolean);
      grant select on public.learning_workspaces,public.workspace_members to authenticated;
      insert into public.learning_workspaces values('${workspace}','active');
      insert into public.workspace_members values('${workspace}','${a}','active'),('${workspace}','${b}','active'),('${workspace}','${inactive}','active');
      insert into public.account_module_access values('${workspace}','${a}','adult_english',true),('${workspace}','${b}','adult_english',true);
    `);
    const prerequisites = ['019_parent_growth.sql','020_english_listening_courses.sql','028_adult_academic_english.sql'];
    for (const file of prerequisites) await db.exec(read(`supabase/${file}`));
    const accessSql = read('supabase/024_module_access_and_kids_english.sql').split('create or replace function private.can_use_account_module')[1].split('create or replace function private.can_use_learner_module')[0];
    await db.exec('create or replace function private.can_use_account_module'+accessSql);
    const sql = read('supabase/041_adult_video_practice.sql');
    assert.equal(sql, read('supabase/migrations/20261123161038_adult_video_practice.sql'));
    await db.exec(sql); await db.exec(sql);
    const { rows: foreignKeys } = await db.query("select conname from pg_constraint where contype='f' and conrelid in ('adult_video_daily_items'::regclass,'adult_video_terms'::regclass)");
    for (const name of ['adult_video_daily_items_concept_id_owner_id_fkey','adult_video_terms_concept_id_owner_id_fkey','adult_video_terms_video_id_owner_id_fkey']) {
      assert.ok(foreignKeys.some(row => row.conname === name), name);
    }
    const as = (user, query, params = []) => db.transaction(async tx => {
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      return tx.query(query, params).then(r => r.rows);
    });
    await as(a, "insert into adult_profiles(id,name) values($1,'爸爸'),($2,'妈妈')", [p,q]);
    await as(b, "insert into adult_profiles(id,name) values($1,'其他账号')", [other]);
    await as(inactive, "insert into adult_profiles(id,name) values($1,'未开通账号')", [noModule]);
    const old = randomUUID();
    await as(a, "insert into adult_english_concepts(id,phrase,meaning,example,concept_key) values($1,'In  the long run','从长远来看','旧例句','old')",[old]);
    const today = (await db.query("select (now() at time zone 'Asia/Shanghai')::date::text as local_day")).rows[0].local_day;
    await as(a, "insert into adult_english_word_states(profile_id,concept_id,due_date,stage,attempts) values($1,$2,$3,3,7)",[p,old,today]);
    const cmd = async (action,data = {},profile = p,user = a) => (await as(user,'select adult_video_command($1,$2,$3) result',[profile,action,JSON.stringify(data)]))[0].result;
    const snap = async (profile = p,user = a,video = null,wordPage=1) => (await as(user,'select adult_video_snapshot($1,$2,1,$3) result',[profile,video,wordPage]))[0].result;
    const list = (id, rows) => ({ youtube_id:id,title:'本周访谈', rows });
    const reuse = { word:'in the long run',meaning:'从长远来看',example:'New source example.',track:true,timestamp:134 };
    const fresh = { word:'put it simply',meaning:'简单来说',track:true };
    const browseOnly = { word:'state',meaning:'说明',track:false };
    const batch = list('fr5-2nKnmgw',[reuse,fresh,browseOnly]);
    const first = await cmd('import',batch);
    assert.deepEqual([first.new_terms,first.new_links,first.reused],[2,3,1]);
    assert.equal((await cmd('import',batch)).new_links,0);
    await assert.rejects(() => cmd('import',list('5NlzOwX6io0',[fresh,{word:'错误'}])),/词表字段/);
    assert.equal((await snap()).total_videos,1,'invalid batch left no video');
    await cmd('import',list('M7lc1UVf-VE',[reuse,{word:'state',meaning:'州'},{...fresh,track:false},...Array.from({length:31},(_,i)=>({word:`archive term ${i}`,meaning:`存档词 ${i}`}))]));
    const s = await snap();
    assert.equal(s.focus.id,first.video_id,'later imports do not change weekly video');
    assert.equal(s.words.find(w=>w.concept_id===old).attempts,7);
    assert.equal(s.words.find(w=>w.concept_id===old).example,'New source example.');
    assert.equal(s.words.find(w=>w.concept_id===old).start_second,134);
    const vid2=s.videos.find(v=>v.id!==first.video_id).id;
    assert.equal((await snap(p,a,vid2,2)).words.length,4);
    const freshId = s.words.find(w=>w.phrase===fresh.word).concept_id;
    assert.equal((await as(a,'select concept_key from adult_english_concepts where id=$1',[freshId]))[0].concept_key,createHash('sha256').update('put it simply\n简单来说').digest('hex'));
    assert.equal((await as(a,'select count(*)::int n from adult_english_concepts where phrase=$1',['state']))[0].n,2);
    assert.equal((await snap(q)).tracked,0);
    assert.equal((await snap(other,b)).total_videos,0);
    await assert.rejects(()=>snap(other,b,first.video_id),/无权限/);
    await assert.rejects(()=>cmd('import',batch,p,b),/无权限|未开通/);
    await assert.rejects(()=>cmd('import',batch,noModule,inactive),/未开通/);
    await assert.rejects(()=>as(a,'delete from adult_video_sources where id=$1',[first.video_id]),/permission denied/);
    await assert.rejects(()=>cmd('checkin',{video_id:first.video_id,request_id:randomUUID()},other,b),/无权限/);
    const req = randomUUID();
    assert.deepEqual(await cmd('checkin',{video_id:first.video_id,request_id:req}),{ count:1,duplicate:false });
    assert.deepEqual(await cmd('checkin',{video_id:first.video_id,request_id:req}),{ count:1,duplicate:true });
    await assert.rejects(()=>cmd('checkin',{video_id:vid2,request_id:req}),/不匹配/);
    await cmd('checkin',{video_id:first.video_id,request_id:randomUUID()});
    assert.equal((await snap()).focus.practice_count,2);
    assert.equal((await snap(q)).focus.practice_count,0);
    assert.equal((await snap()).current,null,'viewing and checkins do not enqueue practice');
    assert.equal((await cmd('start')).remaining,2);
    const visibleQueue = (user=a, profile=p) => as(user, "select concept_id from adult_video_daily_items where owner_id=$1 and profile_id=$2 and local_date=$3 and completed_at is null order by last_answered_at nulls first,ordinal,concept_id limit 2", [a,profile,today]).then(rows=>rows.map(row=>row.concept_id));
    assert.deepEqual(await visibleQueue(),[old,freshId]);
    assert.deepEqual(await visibleQueue(b),[]);
    assert.deepEqual(await visibleQueue(a,q),[]);
    const review = (await snap()).current;
    assert.equal(review.concept_id,old); assert.equal(review.origins.length,2);
    assert.equal(review.queue_kind,'review');
    const answer=(id,result,request_id=randomUUID(),day=today)=>cmd('answer',{concept_id:id,result,request_id,day});
    const x = randomUUID();
    assert.equal((await answer(old,'again',x)).stage,2);
    assert.equal((await answer(old,'again',x)).duplicate,true);
    assert.equal((await answer(old,'again',x,'2000-01-01')).duplicate,true,'recovery can acknowledge a committed reply even after midnight');
    assert.equal((await as(a,'select attempts from adult_english_word_states where profile_id=$1 and concept_id=$2',[p,old]))[0].attempts,8);
    assert.deepEqual(await visibleQueue(),[freshId,old]);
    assert.equal((await snap()).current.concept_id,freshId);
    assert.equal((await answer(freshId,'known')).completed,false);
    assert.equal((await answer(old,'again')).stage,2,'does not drop again the same day');
    assert.equal((await answer(freshId,'known')).stage,1);
    assert.equal((await answer(old,'known')).completed,false);
    assert.equal((await answer(old,'known')).stage,2,'later same-day success does not restore stage');
    assert.equal((await snap()).total_today,2);
    assert.equal((await cmd('start')).remaining,0);
    await assert.rejects(()=>answer(freshId,'again',randomUUID(),'2000-01-01'),/新的一天/);
    await cmd('edit_timestamp',{video_id:first.video_id,concept_id:old,timestamp:155});
    assert.equal((await snap()).words.find(w=>w.concept_id===old).start_second,155);
    await cmd('import',batch);
    assert.equal((await snap()).words.find(w=>w.concept_id===old).start_second,155,'reimport does not erase saved edits');
    await db.exec(sql);
    assert.equal((await snap()).focus.practice_count,2);
    await db.query("update workspace_members set status='suspended' where user_id=$1",[a]);
    await assert.rejects(()=>snap(),/未开通/);
    assert.equal((await as(a,'select count(*)::int n from adult_video_sources'))[0].n,0);
  } finally { await db.close(); }
});
