/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.join(__dirname,'..');
function load(file) {
  const source=fs.readFileSync(path.join(root,file),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded={exports:{}};const resolve=id=>id.startsWith('@/')?load(`${id.slice(2)}.ts`):require(id);new Function('module','exports','require',code)(loaded,loaded.exports,resolve);return loaded.exports;
}

test('套餐预算不把 Pro 8GB 磁盘冒充为数据库额度；增长不足不伪报为0',()=>{
  const {databaseBudget,databaseGrowth}=load('lib/database-health-values.ts');
  assert.equal(databaseBudget(undefined,undefined).bytes,500000000);
  assert.equal(databaseBudget('Free',undefined).bytes,500000000);
  assert.equal(databaseBudget('Pro',undefined).bytes,null);
  assert.equal(databaseBudget('Pro','2000').bytes,2000000000);
  assert.equal(databaseBudget('Pro','not-a-number').bytes,null);
  assert.equal(databaseGrowth([{date:'2026-10-11',bytes:10}],'2026-10-11T04:00:00Z',10,7),null);
  assert.deepEqual(databaseGrowth([{date:'2026-10-04',bytes:10}],'2026-10-11T04:00:00Z',30,7),{bytes:20,days:7});
});

test('目录超过1000条分批读取；汇总失败不伪报零；短UUID列表',async()=>{
  const {loadResourceRows,loadResourceBatches,loadPracticeSummaries}=load('lib/resource-queries.ts');
  const all=Array.from({length:1007},(_,id)=>({id}));const ranges=[];
  assert.equal((await loadResourceRows((from,to)=>{ranges.push([from,to]);return Promise.resolve({data:all.slice(from,to+1),error:null});})).length,1007);
  assert.deepEqual(ranges,[[0,499],[500,999],[1000,1499]]);
  const chunks=[];
  await loadResourceBatches(all.map(x=>String(x.id)),(ids)=>{chunks.push(ids.length);return Promise.resolve({data:ids.map(id=>({id})),error:null});});
  assert.equal(Math.max(...chunks),100);
  await assert.rejects(loadResourceRows(()=>Promise.resolve({data:[],error:{message:'failed'}})),/failed/);
  await assert.rejects(loadPracticeSummaries({rpc:async()=>({data:null,error:{message:'missing'}})},'poem','id'),/036/);
});

test('问答今日复习额度仍按不同问题扣减；今天第一次学的不是复习',()=>{
  const {buildCatechismQueue}=load('lib/catechism.ts');const today='2026-10-11';
  const item=(id,overrides={})=>({id,totalAttempts:2,firstPracticedLocalDate:'2026-10-01',practicedToday:false,nextReviewDate:today,lastResult:'recited',stage:1,...overrides});
  const rows=[item('reviewed',{practicedToday:true,nextReviewDate:'2026-10-12'}),item('review'),item('newToday',{firstPracticedLocalDate:today,practicedToday:true,nextReviewDate:'2026-10-12'}),item('new',{totalAttempts:0,firstPracticedLocalDate:null,nextReviewDate:null})];
  const queue=buildCatechismQueue(rows,today,3,10);
  assert.equal(queue.reviewedToday,1);assert.equal(queue.newPracticedToday,1);assert.equal(queue.remainingReviews,9);assert.equal(queue.remainingNew,2);
  assert.deepEqual(queue.queue.map(x=>[x.id,x.queueKind]),[['review','review'],['new','new']]);
});

test('036 重复运行、1005条准确汇总/翻页、权限隔离、只删等价普通索引', {skip:!process.env.PGLITE_MODULE},async()=>{
  const {PGlite}=require(process.env.PGLITE_MODULE);const db=new PGlite();
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const owner=id(1),parent=id(2),workspace=id(3),learner=id(4),poem=id(5),music=id(6),catechism=id(7),collection=id(8);
  try {
    await db.exec(`
      create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create schema private;
      create table auth.users(id uuid primary key,email text);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table public.learning_workspaces(id uuid primary key);
      create table public.workspace_members(workspace_id uuid,user_id uuid,role text,status text);
      create table public.learner_profiles(id uuid primary key,timezone text);
      create function private.can_access_learner(p_id uuid) returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid and p_id='${learner}'::uuid$$;
      create table public.poems(id uuid primary key,created_by uuid,poem_key text,unique(created_by,poem_key));
      create index poems_owner_key_idx on public.poems(created_by,poem_key);
      create table public.poem_collection_items(collection_id uuid,poem_id uuid,sequence int,unique(collection_id,sequence));
      create index poem_collection_items_order_idx on public.poem_collection_items(collection_id,sequence);
      create table public.learner_poem_collections(learner_id uuid,collection_id uuid,assignment_status text);
      create table public.poem_recitation_attempts(id uuid primary key,learner_id uuid,poem_id uuid,recited_at timestamptz,recited_local_date date,score smallint,note text);
      create table public.music_items(id uuid primary key,status text);
      create table public.learner_music_items(learner_id uuid,item_id uuid,assignment_status text);
      create table public.music_practice_attempts(id uuid primary key,learner_id uuid,item_id uuid,practiced_at timestamptz,practiced_local_date date,result text,previous_stage smallint,next_stage smallint,guess_note text);
      create table public.catechism_collections(id uuid primary key,status text);
      create table public.catechism_items(id uuid primary key,collection_id uuid,status text,sort_order int,unique(collection_id,sort_order));
      -- 故意不同排序：守卫必须保留这个同名但不等价的索引。
      create index catechism_items_order_idx on public.catechism_items(collection_id,sort_order desc);
      create table public.learner_catechism_collections(learner_id uuid,collection_id uuid,assignment_status text);
      create table public.catechism_attempts(id uuid primary key,learner_id uuid,item_id uuid,practiced_at timestamptz,practiced_local_date date,result text,stage_before smallint,stage_after smallint,note text);
      grant usage on schema auth,private to authenticated;
      grant select on all tables in schema public to authenticated;
      insert into auth.users values('${owner}','xiangyufei11@gmail.com'),('${parent}','example@example.com');
      insert into public.learning_workspaces values('${workspace}');
      insert into public.workspace_members values('${workspace}','${owner}','owner','active'),('${workspace}','${parent}','parent','active');
      insert into public.learner_profiles values('${learner}','Asia/Shanghai');
      insert into public.poems values('${poem}','${owner}','p1');
      insert into public.poem_collection_items values('${collection}','${poem}',1);
      insert into public.learner_poem_collections values('${learner}','${collection}','active');
      insert into public.music_items values('${music}','published');
      insert into public.learner_music_items values('${learner}','${music}','active');
      insert into public.catechism_collections values('${collection}','published');
      insert into public.catechism_items values('${catechism}','${collection}','active',1);
      insert into public.learner_catechism_collections values('${learner}','${collection}','active');
      insert into public.poem_recitation_attempts select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${learner}','${poem}',now()-(1005-n)*interval '1 second',current_date-(n%3),case when n=1005 then null else 8 end,null from generate_series(1,1005)n;
      insert into public.music_practice_attempts select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${learner}','${music}',now()-(1005-n)*interval '1 second',current_date-(n%3),'recognized',1,2,'note' from generate_series(1,1005)n;
      insert into public.catechism_attempts select ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${learner}','${catechism}',now()-(1005-n)*interval '1 second',(now() at time zone 'Asia/Shanghai')::date-(n%3),'recited',1,2,null from generate_series(1,1005)n;
    `);
    const sql=fs.readFileSync(path.join(root,'supabase/036_database_health_and_resource_summaries.sql'),'utf8');
    await db.exec(sql);await db.exec(sql);
    const indexes=(await db.query("select indexname from pg_indexes where schemaname='public'")).rows.map(r=>r.indexname);
    assert.ok(indexes.includes('poems_created_by_poem_key_key'));assert.ok(!indexes.includes('poems_owner_key_idx'));
    assert.ok(!indexes.includes('poem_collection_items_order_idx'));assert.ok(indexes.includes('catechism_items_order_idx'));
    const asUser=(user,query,args=[])=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);return tx.query(query,args);});
    const summary=async kind=>(await asUser(owner,'select public.resource_practice_summary($1,$2) data',[kind,learner])).rows[0].data[0];
    const p=await summary('poem');assert.equal(p.attemptCount,1005);assert.equal(p.practiceDays,3);assert.equal(p.lastScore,8);assert.equal(p.averageScore,8);assert.equal(p.scoreCount,1004);
    assert.equal((await summary('music')).attemptCount,1005);
    const c=await summary('catechism');assert.equal(c.practiceDays,3);assert.equal(c.practicedToday,true);
    for(const [kind,item] of [['poem',poem],['music',music],['catechism',catechism]]) {
      const history=async page=>(await asUser(owner,'select public.resource_practice_history($1,$2,$3,$4) data',[kind,learner,item,page])).rows[0].data;
      const first=await history(1),second=await history(2),last=await history(9999);
      assert.equal(first.total,1005);assert.equal(first.rows.length,20);assert.equal(first.pages,51);assert.equal(last.page,51);assert.equal(last.rows.length,5);
      assert.equal(new Set([...first.rows,...second.rows].map(r=>r.id)).size,40);
      await assert.rejects(asUser(parent,'select public.resource_practice_history($1,$2,$3,1)',[kind,learner,item]),/无权/);
    }
    await assert.rejects(asUser(parent,'select public.resource_practice_summary($1,$2)',['poem',learner]),/无权/);
    await assert.rejects(asUser(owner,'select public.owner_database_health($1,$2)',[workspace,owner]),/permission denied/);
    const privileged=(who)=>db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query('select public.owner_database_health($1,$2) data',[workspace,who]);});
    await assert.rejects(privileged(parent),/只有系统 owner/);
    const h=(await privileged(owner)).rows[0].data;
    assert.ok(h.databaseBytes>0);assert.ok(h.clusterDatabaseBytes>=h.databaseBytes);assert.equal(h.diskUsedBytes,null);assert.equal(h.history.length,1);
    const again=(await privileged(owner)).rows[0].data;assert.equal(again.capturedAt,h.capturedAt);
    assert.equal((await db.query('select count(*)::int n from private.database_health_samples')).rows[0].n,1);
    await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select public.resource_practice_summary($1,$2)',['poem',learner]);}),/permission denied/);
  } finally {await db.close();}
});
