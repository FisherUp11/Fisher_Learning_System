/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const migration=read('supabase/039_freeze_hanzi_daily_plan.sql');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const parent=id(1),other=id(2),workspace=id(3),family=id(4),pack=id(5);
const clocked=sql=>sql.replace(/\bnow\(\)/g,'private.test_now()');
const functionFrom=(sql,name)=>sql.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))[0];

test('039 编号 SQL 与 CLI migration 完全一致，RPC 契约和只读会话权限保留',()=>{
  assert.equal(migration,read('supabase/migrations/20261022130938_freeze_hanzi_daily_plan.sql'));
  assert.match(migration,/if v_plan_frozen_at is null then/);
  assert.match(migration,/security invoker/);
  assert.match(migration,/revoke insert, update, delete on public.daily_sessions/);
  assert.doesNotMatch(migration,/delete from public\.(learning_states|learning_attempts|reward_ledger)/i);
  const ui=read('components/learning-experience.tsx');
  assert.doesNotMatch(ui,/看看有没有新任务/);
});

test('旧页面终态恢复：仅识别专用数据库码，且新授权队列确实为空；网络和普通错误不吞掉',async()=>{
  const ts=require('typescript');const loaded={exports:{}};
  const code=ts.transpileModule(read('lib/study-queue-server.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('module','exports','require',code)(loaded,loaded.exports,name=>name==='server-only'?{}:require(name));
  const {recoverCompletedHanziDay}=loaded.exports;let calls=0;
  const client=data=>({rpc:async(name,args)=>{calls++;assert.equal(name,'get_today_queue');assert.equal(args.p_learner_id,'child');return {data,error:null};}});
  assert.equal(await recoverCompletedHanziDay(client([]),'child',{code:'22023'}),null);assert.equal(calls,0);
  assert.equal(await recoverCompletedHanziDay(client([{today_total:1}]),'child',{code:'PZ039'}),null);
  assert.equal(await recoverCompletedHanziDay(client(null),'child',{code:'PZ039'}),null);
  const result=await recoverCompletedHanziDay(client([]),'child',{code:'PZ039'});
  assert.equal(result.daily_complete,true);assert.equal(result.today_remaining,0);assert.equal(result.reward,null);assert.deepEqual(result.queue,[]);
  for(const file of ['lib/actions.ts','lib/pinyin-actions.ts'])assert.match(read(file),/recoverCompletedHanziDay\(supabase, input.learnerId, error\)/);
});

async function fixture(patched=true){
  const {PGlite}=require(process.env.PGLITE_MODULE);const db=new PGlite();
  const base=read('supabase/001_hanzi_mvp.sql');
  const dynamic=read('supabase/014_dynamic_double_confirmation.sql');
  const adaptive=read('supabase/016_adaptive_queue_and_shared_content_rpcs.sql');
  const rewards=read('supabase/012_reward_sticker_module.sql');
  await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function private.test_now() returns timestamptz language sql stable as $$ select current_setting('test.clock')::timestamptz $$;
    set test.clock='2026-10-22T10:00:00Z';
    create table auth.users(id uuid primary key);
    insert into auth.users values('${parent}'),('${other}');
    ${base.slice(base.indexOf('create table if not exists public.content_packages'),base.indexOf('create index if not exists learning_states_due_idx'))}
    alter table learner_profiles add column family_id uuid,add column hanzi_review_mode text default 'adaptive',add column hanzi_base_review_limit integer default 15,add column hanzi_max_review_limit integer default 30;
    alter table content_packages add column review_status text default 'approved';
    create table families(id uuid primary key,workspace_id uuid);
    create table learner_content_packages(learner_id uuid,package_id uuid,assignment_status text default 'active',assignment_order integer default 0,linked_at timestamptz default now());
    create table learner_character_priorities(learner_id uuid,character_id uuid,selected_at timestamptz default now());
    ${dynamic.slice(dynamic.indexOf('alter table public.daily_session_items'),dynamic.indexOf('-- 返回今日队列'))}
    ${adaptive.slice(adaptive.indexOf('alter table public.learner_profiles'),adaptive.indexOf('drop function if exists public.get_today_queue'))}
    ${rewards.slice(rewards.indexOf('create table if not exists public.reward_accounts'),rewards.indexOf('-- 同一首诗'))}
    create function private.can_access_learner(c uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.learner_profiles where id=c and parent_user_id=(select auth.uid())) $$;
    create function private.can_use_learner_module(c uuid,k text) returns boolean language sql stable security definer set search_path='' as $$ select private.can_access_learner(c) and coalesce(current_setting('test.module_enabled',true),'true') <> 'false' $$;
    create function private.is_workspace_admin(w uuid) returns boolean language sql stable security definer set search_path='' as $$ select w='${workspace}' and (select auth.uid())='${parent}' $$;
    create table learner_music_items(learner_id uuid,item_id uuid,assignment_status text);
    create table music_items(id uuid,status text,review_status text);
    create table learner_catechism_collections(learner_id uuid,collection_id uuid,assignment_status text);
    create table catechism_collections(id uuid,status text,review_status text);
    create table catechism_items(id uuid,collection_id uuid,status text);
    create table learner_poem_collections(learner_id uuid,collection_id uuid,assignment_status text);
    create table poem_collections(id uuid,status text,review_status text);
    create table music_learning_states(learner_id uuid,item_id uuid,due_at timestamptz);
    create table catechism_learning_states(learner_id uuid,item_id uuid,next_review_date date);
    grant usage on schema public,private,auth to authenticated;
    grant select,insert,update,delete on all tables in schema public to authenticated;
    insert into families values('${family}','${workspace}');
    insert into content_packages(id,created_by,code,title) values('${pack}','${parent}','test','测试字册');
  `);
  await db.exec(clocked(functionFrom(adaptive,'get_today_queue')));
  await db.exec(clocked(functionFrom(adaptive,'answer_queue_item')));
  const pinyin=read('supabase/029_pinyin_learning.sql');
  await db.exec(clocked(pinyin.slice(pinyin.indexOf('alter table public.learning_attempts drop constraint if exists learning_attempts_result_check'),pinyin.indexOf('revoke execute on function public.pinyin_get_today'))));
  await db.exec(clocked(functionFrom(rewards,'claim_hanzi_daily_reward')));
  if(patched){await db.exec(clocked(migration));await db.exec(clocked(migration));}
  const as=(query,args=[],user=parent)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);return tx.query(query,args);});
  let serial=1000;
  const seed=async(n,{stages=[3,3,0,0],newLimit=1}={})=>{
    const child=id(n),chars=stages.map((_,i)=>id(n*10+i));
    await db.query('insert into learner_profiles(id,parent_user_id,display_name,family_id,daily_new_limit) values($1,$2,$3,$4,$5)',[child,parent,'测试孩子'+n,family,newLimit]);
    await db.query('insert into learner_content_packages(learner_id,package_id) values($1,$2)',[child,pack]);
    for(let i=0;i<chars.length;i++){
      await db.query('insert into characters(id,created_by,character,pinyin_marked,meaning) values($1,$2,$3,$4,$5)',[chars[i],parent,String.fromCodePoint(0x4e00+n*10+i),'zì','测试字']);
      await db.query('insert into package_characters(package_id,character_id,sequence) values($1,$2,$3)',[pack,chars[i],n*10+i+1]);
      if(stages[i]>0)await db.query("insert into learning_states(learner_id,character_id,stage,due_at) values($1,$2,$3,private.test_now()+$4::interval)",[child,chars[i],stages[i],i===0?'-1 hour':'1 hour']);
    }
    // 每个孩子只分配自己的字，避免测试孩子共享其它用例的未学字。
    const ownPack=id(n*100);await db.query('insert into content_packages(id,created_by,code,title) values($1,$2,$3,$3)',[ownPack,parent,'pack'+n]);
    await db.query('update learner_content_packages set package_id=$2 where learner_id=$1',[child,ownPack]);
    await db.query('insert into package_characters(package_id,character_id,sequence) select $1,character_id,sequence from package_characters where package_id=$2 and character_id=any($3::uuid[])',[ownPack,pack,chars]);
    return {child,chars,ownPack};
  };
  const queue=async c=>(await as('select * from public.get_today_queue($1)',[c])).rows;
  const answer=async(c,item,result='known',req=id(serial++))=>(await as('select public.answer_queue_item($1,$2,$3,$4,false) value',[c,item,result,req])).rows[0].value;
  const claim=async c=>(await as('select public.claim_hanzi_daily_reward($1) value',[c])).rows[0].value;
  const drain=async c=>{let count=0;while(true){const q=await queue(c);if(!q.length)return count;await answer(c,q[0].session_item_id);assert.ok(++count<50);}};
  return {db,as,seed,queue,answer,claim,drain};
}

test('真实 Postgres RPC：复现旧版补字；固定、重试、完成、旧奖励、次日和权限回归',{skip:!process.env.PGLITE_MODULE},async t=>{
  await t.test('旧函数复现：迟到期的复习字会补入当天已建字单',async()=>{
    const f=await fixture(false);try{
      const {child,chars}=await f.seed(10);const q=await f.queue(child);assert.equal(q.length,2);
      await f.db.query('update learning_states set due_at=private.test_now() where learner_id=$1 and character_id=$2',[child,chars[1]]);
      assert.equal((await f.queue(child)).length,3);
    }finally{await f.db.close();}
  });
  const f=await fixture();const {db,as,seed,queue,answer,claim,drain}=f;
  try{
    await t.test('当天进行中不补字；双确认、答错只降一次、不限重试仍正确',async()=>{
      const {child,chars}=await seed(11);const q=await queue(child);assert.equal(q.length,2);
      await db.query('update learning_states set due_at=private.test_now() where learner_id=$1 and character_id=$2',[child,chars[1]]);
      await db.query('update learner_profiles set daily_new_limit=10 where id=$1',[child]);
      assert.deepEqual((await queue(child)).map(x=>x.character_id),q.map(x=>x.character_id));
      const first=q.find(x=>x.character_id===chars[0]);
      let saved=await answer(child,first.session_item_id,'again');assert.equal(saved.next_stage,1);assert.equal(saved.daily_passed,false);
      for(let i=0;i<3;i++){const retry=(await queue(child)).find(x=>x.character_id===chars[0]);saved=await answer(child,retry.session_item_id,'again');assert.equal(saved.next_stage,1);}
      let retry=(await queue(child)).find(x=>x.character_id===chars[0]);saved=await answer(child,retry.session_item_id);assert.equal(saved.daily_passed,false);
      retry=(await queue(child)).find(x=>x.character_id===chars[0]);saved=await answer(child,retry.session_item_id);assert.equal(saved.daily_passed,true);assert.equal(saved.next_stage,1);
      const fresh=(await queue(child))[0];const req=id(9900);saved=await answer(child,fresh.session_item_id,'known',req);assert.equal(saved.daily_passed,false);
      assert.equal((await answer(child,fresh.session_item_id,'known',req)).idempotent,true);
      assert.equal((await db.query('select finished_at from daily_sessions where learner_id=$1',[child])).rows[0].finished_at,null);
      await drain(child);assert.equal((await queue(child)).length,0);
      assert.ok((await db.query('select finished_at,plan_frozen_at from daily_sessions where learner_id=$1',[child])).rows[0].finished_at);
      assert.equal((await claim(child)).awarded,true);assert.equal((await claim(child)).duplicate,true);
      assert.equal((await queue(child)).length,0);
      assert.equal((await db.query('select count(*)::int n from reward_ledger where learner_id=$1',[child])).rows[0].n,1);
      assert.equal((await as('select public.learner_dashboard_snapshot($1) value',[child])).rows[0].value.todayRemaining,0);
      await assert.rejects(as('update daily_sessions set finished_at=null where learner_id=$1',[child]),/permission denied/);
      await assert.rejects(as('select * from public.get_today_queue($1)',[child],other),/无权/);
      await db.exec("set test.module_enabled='false'");await assert.rejects(queue(child),/无权/);await db.exec("set test.module_enabled='true'");
      await db.exec("set test.clock='2026-10-23T10:00:00Z'");
      assert.ok((await queue(child)).some(x=>x.character_id===chars[1]));
      await db.exec("set test.clock='2026-10-22T10:00:00Z'");
    });
    await t.test('旧版已领贴纸又补字：重新打开完成，旧页面写入回滚，不删除历史',async()=>{
      const {child,chars}=await seed(12);const q=await queue(child);await drain(child);await claim(child);
      await db.query('update daily_sessions set finished_at=null,plan_frozen_at=null where learner_id=$1',[child]);
      const session=q[0].session_id;
      const extra=(await db.query("insert into daily_session_items(session_id,character_id,queue_kind,queue_position) values($1,$2,'review',99) returning id",[session,chars[1]])).rows[0].id;
      await db.query("insert into daily_character_progress(session_id,learner_id,character_id,initial_queue_kind,starting_stage,required_confirmations) values($1,$2,$3,'review',3,1)",[session,child,chars[1]]);
      const stateBefore=(await db.query('select * from learning_states where learner_id=$1 and character_id=$2',[child,chars[1]])).rows;
      const attemptsBefore=(await db.query('select count(*)::int n from learning_attempts where learner_id=$1',[child])).rows[0].n;
      // 即使还未再次打开队列，旧卡也不能把已完成日重新写成未完成。
      await assert.rejects(answer(child,extra,'again'),/已经完成/);
      assert.deepEqual((await db.query('select * from learning_states where learner_id=$1 and character_id=$2',[child,chars[1]])).rows,stateBefore);
      assert.equal((await queue(child)).length,0);assert.equal((await claim(child)).duplicate,true);
      assert.equal((await db.query('select count(*)::int n from learning_attempts where learner_id=$1',[child])).rows[0].n,attemptsBefore);
      assert.equal((await db.query('select status from daily_session_items where id=$1',[extra])).rows[0].status,'pending');
      assert.equal((await db.query('select passed_at from daily_character_progress where session_id=$1 and character_id=$2',[session,chars[1]])).rows[0].passed_at,null);
      assert.equal((await as('select public.learner_dashboard_snapshot($1) value',[child])).rows[0].value.todayRemaining,0);
      assert.equal((await as('select * from public.workspace_today_remaining($1)',[workspace])).rows.find(x=>x.learner_id===child).remaining,0);
      await db.exec("set test.clock='2026-10-23T10:00:00Z'");assert.ok((await queue(child)).some(x=>x.character_id===chars[1]));await db.exec("set test.clock='2026-10-22T10:00:00Z'");
    });
    await t.test('升级接纳未完成字单，不补足旧名额；空计划不能领奖；匿名拒绝',async()=>{
      const {child,chars}=await seed(13);const before=await queue(child);
      await db.query('update daily_sessions set plan_frozen_at=null where learner_id=$1',[child]);
      await db.query('update learning_states set due_at=private.test_now() where learner_id=$1 and character_id=$2',[child,chars[1]]);
      assert.deepEqual((await queue(child)).map(x=>x.character_id),before.map(x=>x.character_id));
      const empty=await seed(14,{stages:[]});assert.equal((await queue(empty.child)).length,0);assert.equal((await claim(empty.child)).eligible,false);
      await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select * from public.get_today_queue($1)',[child]);}),/permission denied/);
    });
    await t.test('中性提示仍保留阶段并生成原字重试；首答不误记为完成',async()=>{
      const {child,chars}=await seed(15,{stages:[3],newLimit:1});let q=await queue(child);
      const hint=(await as('select public.record_hanzi_hint_retry($1,$2,$3) value',[child,q[0].session_item_id,id(9998)])).rows[0].value;
      assert.equal(hint.daily_passed,false);assert.equal(hint.next_stage,3);
      q=await queue(child);assert.equal(q.length,1);assert.equal(q[0].queue_kind,'same_day_retry');assert.equal(q[0].character_id,chars[0]);
      assert.equal((await answer(child,q[0].session_item_id)).daily_passed,false);
      assert.equal((await db.query('select finished_at from daily_sessions where learner_id=$1',[child])).rows[0].finished_at,null);
      await drain(child);assert.equal((await claim(child)).awarded,true);
    });
  }finally{await db.close();}
});
