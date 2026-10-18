/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.join(__dirname,'..');
function load(file,overrides={}) {
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const m={exports:{}};
  new Function('module','exports','require',code)(m,m.exports,id=>id in overrides?overrides[id]:id==='server-only'?{}:id.startsWith('@/')?load(`${id.slice(2)}.ts`,overrides):require(id));
  return m.exports;
}

test('北京时间、自然月月底、闰年和到期右开边界一致',()=>{
  const {beijingDate,addCalendarMonths,lastUsableDate,describeHanziTerm}=load('lib/hanzi-terms.ts');
  assert.equal(beijingDate(new Date('2026-10-18T16:00:00Z')),'2026-10-19');
  assert.equal(addCalendarMonths('2026-01-31',3),'2026-04-30');
  assert.equal(addCalendarMonths('2024-02-29',12),'2025-02-28');
  assert.equal(lastUsableDate('2024-03-01'),'2024-02-29');
  const term={mode:'term',starts_on:'2026-10-18',valid_until:'2027-01-18'};
  assert.equal(describeHanziTerm(term,true,'2027-01-17').active,true);
  assert.equal(describeHanziTerm(term,true,'2027-01-18').label,'已到期');
  assert.equal(describeHanziTerm(term,false,'2026-10-18').label,'已暂停');
  assert.equal(describeHanziTerm(null,true).active,false);
  assert.equal(describeHanziTerm({mode:'permanent'},true).active,true);
});

test('汉字学习和付费接口使用同一数据库校验；其他模块不改为收费',async()=>{
  let gate=true,calls=0;
  const {requireChildModule}=load('lib/module-access.ts',{'react':{cache:f=>f}});
  const db={from:table=>{
    const chain={then:r=>Promise.resolve({data:table==='account_module_access'?[{module_key:'hanzi'},{module_key:'poem'}]:{enabled:true},error:null}).then(r)};
    for(const name of ['select','eq','maybeSingle'])chain[name]=()=>chain;
    return chain;
  },rpc:async(name)=>{assert.equal(name,'can_study_child_module');calls++;return {data:gate,error:null};}};
  await requireChildModule(db,{},'parent','child','hanzi');
  gate=false;await assert.rejects(requireChildModule(db,{},'parent','child','hanzi'),/到期/);
  await requireChildModule(db,{},'parent','child','poem');assert.equal(calls,2);
  for(const file of ['app/api/speech/route.ts','app/api/hanzi-frog/speech/route.ts','app/api/ai/character-memory-image/route.ts','app/api/ai/character-content/route.ts']) {
    const source=fs.readFileSync(path.join(root,file),'utf8');
    assert.ok(source.indexOf('await requireChildModule')<Math.max(source.indexOf('await meteredFetch'),source.indexOf('await prepareFrogAudio')),file);
  }
});

test('日常孩子查询在数据库按本家庭过滤，管理中心仍保留跨家庭入口',()=>{
  for(const file of ['learn/page','library/page','parent/page','poems/page','poems/game/page','music/page','music/[itemId]/page','catechism/page','catechism/study/page','kids-english/page','kids-english/library/page','learn/frog/page','learn/frog/music/page']) {
    const source=fs.readFileSync(path.join(root,`app/(app)/${file}.tsx`),'utf8');
    assert.match(source,/\.eq\("family_id",\s*access\?*\.familyId/ ,file);
  }
  const management=fs.readFileSync(path.join(root,'app/(app)/admin/families/page.tsx'),'utf8');
  assert.match(management,/pageFamilies\.map/);assert.match(management,/admin\/learners/);
  assert.doesNotMatch(management,/href=\{`\/parent\?learner/);
});

test('过期朗读与图片请求在调用 Azure 或读取游戏缓存前明确拒绝',async()=>{
  for(const file of ['app/api/speech/route.ts','app/api/ai/character-content/route.ts','app/api/ai/character-memory-image/route.ts','app/api/hanzi-frog/speech/route.ts']) {
    let paid=0;
    const route=load(file,{
      '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'parent'}}})},from:()=>assert.fail('拒绝授权前后都不应读取学习内容'),rpc:()=>assert.fail('拒绝后不能读取游戏字池')})},
      '@/lib/access':{loadAccessContext:async()=>({workspaceId:'workspace'})},
      '@/lib/module-access':{requireChildModule:async()=>{throw new Error('汉字已到期');}},
      '@/lib/metered-fetch':{meteredFetch:async()=>{paid++;throw new Error('不应调用');}},
      '@/lib/hanzi-frog-speech-server':{prepareFrogAudio:async()=>{paid++;throw new Error('不应读取');}},
    });
    const id='00000000-0000-4000-8000-000000000001';
    const response=await route.POST(new Request('https://example.test/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({learnerId:id,learner:id,module:'hanzi',characterId:id,characterIds:[id],text:'木',character:'木',pinyin:'mù',meaning:'树木'})}));
    assert.equal(response.status,403,file);assert.equal(paid,0,file);
  }
});

test('管理详情只在当前空间查孩子；普通 admin 不读取收费流水，parent 不能进入',async()=>{
  const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
  const child='00000000-0000-4000-8000-000000000030';
  for(const role of ['owner','admin','parent']) {
    const reads=[],filters=[];
    const learner={id:child,display_name:'测试孩子',family_id:'family',timezone:'Asia/Shanghai',families:{workspace_id:'workspace',name:'测试家庭',status:'active'}};
    const chain=(table)=>{
      let isSingle=false;
      const result={then(resolve,reject){const data=table==='learner_profiles'?(isSingle?learner:[learner]):table==='learner_hanzi_terms'?{learner_id:child,mode:'permanent',version:1}:table==='learner_module_access'?[{module_key:'hanzi',enabled:true}]:table==='family_hanzi_billing'?null:[];return Promise.resolve({data,error:null}).then(resolve,reject);}};
      for(const method of ['select','eq','order','limit','maybeSingle'])result[method]=(...args)=>{filters.push([table,method,...args]);if(method==='maybeSingle')isSingle=true;return result;};
      return result;
    };
    const db={auth:{getUser:async()=>({data:{user:{id:'user'}}})},from:table=>{reads.push(table);return chain(table);},rpc:async()=>({data:[],error:null})};
    const Page=load('app/(app)/admin/learners/[learnerId]/page.tsx',{
      'next/link':{default:({children,...props})=>React.createElement('a',props,children)},
      'next/navigation':{redirect:p=>{throw new Error(`redirect:${p}`);},notFound:()=>{throw new Error('notFound');}},
      '@/lib/supabase/server':{createClient:async()=>db},
      '@/lib/access':{loadAccessContext:async()=>({workspaceId:'workspace',isOwner:role==='owner',isAdmin:role!=='parent'})},
      '@/lib/dashboard':{loadLearnerDashboard:async()=>({started:20,stable:8,due:3,firstAttemptRate:80,assignedPoemCollections:1,assignedMusicItems:2,assignedCatechismCollections:1})},
      '@/components/owner-hanzi-term-manager':{OwnerHanziTermManager:()=>React.createElement('button',null,'owner续期')},
      '@/components/pinyin-parent-panel':{PinyinParentPanel:({readOnly})=>React.createElement('p',null,readOnly?'只读拼音统计':'可写拼音')},
      '@/components/learner-settings-editor':{LearnerSettingsEditor:()=>React.createElement('p',null,'管理学习设置')},
    }).default;
    const render=()=>Page({params:Promise.resolve({learnerId:child}),searchParams:Promise.resolve({})});
    if(role==='parent') {await assert.rejects(render(),/redirect:\/parent/);assert.equal(reads.length,0);continue;}
    const html=renderToStaticMarkup(await render());assert.match(html,/测试家庭/);assert.match(html,/只读拼音统计/);assert.match(html,/管理学习设置/);
    assert.ok(filters.some(row=>row[0]==='learner_profiles'&&row[1]==='eq'&&row[2]==='families.workspace_id'&&row[3]==='workspace'));
    if(role==='owner')assert.match(html,/owner续期/);else {assert.doesNotMatch(html,/owner续期/);assert.ok(!reads.includes('hanzi_term_events'));assert.ok(!reads.includes('family_hanzi_billing'));}
  }
});

test('038 两次运行：旧授权保留，权限隔离、10/8元、续期幂等、暂停不复活、数据库写入防线', {skip:!process.env.PGLITE_MODULE}, async()=>{
  const {PGlite}=require(process.env.PGLITE_MODULE);const db=new PGlite();
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const owner=id(1),parent=id(2),admin=id(3),outsider=id(4),ws=id(10),otherWs=id(11),family=id(20),otherFamily=id(21),child=id(30),sibling=id(31),legacy=id(32),foreignChild=id(33);
  let serial=100;
  try {
    await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table auth.users(id uuid primary key);
      create table public.learning_workspaces(id uuid primary key,owner_user_id uuid,status text);
      create table public.families(id uuid primary key,workspace_id uuid,status text);
      create table public.workspace_members(workspace_id uuid,user_id uuid,status text,role text);
      create table public.family_members(family_id uuid,user_id uuid,status text);
      create table public.learner_profiles(id uuid primary key,parent_user_id uuid,family_id uuid);
      create table public.account_module_access(workspace_id uuid,user_id uuid,module_key text,enabled boolean,primary key(workspace_id,user_id,module_key));
      create table public.learner_module_access(learner_id uuid,module_key text,enabled boolean,updated_by uuid,updated_at timestamptz,primary key(learner_id,module_key));
      create table public.pinyin_states(learner_id uuid,stage integer);
      create table public.hanzi_frog_sessions(id uuid primary key,learner_id uuid);
      create table public.hanzi_frog_taps(session_id uuid,correct boolean);
      grant usage on schema auth,private to authenticated;
      grant select on public.families,public.learner_profiles,public.learner_module_access to authenticated;
      create function private.is_workspace_owner(w uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.learning_workspaces where id=w and owner_user_id=(select auth.uid()) and status='active') $$;
      create function private.can_access_learner(c uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.learner_profiles l join public.families f on f.id=l.family_id join public.workspace_members m on m.workspace_id=f.workspace_id and m.user_id=(select auth.uid()) and m.status='active' where l.id=c and (l.parent_user_id=(select auth.uid()) or m.role in ('admin','owner'))) $$;
      create function private.can_use_account_module(w uuid,k text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.account_module_access a join public.workspace_members m on m.workspace_id=a.workspace_id and m.user_id=a.user_id and m.status='active' where a.workspace_id=w and a.user_id=(select auth.uid()) and a.module_key=k and a.enabled) $$;
      insert into auth.users values('${owner}'),('${parent}'),('${admin}'),('${outsider}');
      insert into learning_workspaces values('${ws}','${owner}','active'),('${otherWs}','${outsider}','active');
      insert into families values('${family}','${ws}','active'),('${otherFamily}','${otherWs}','active');
      insert into workspace_members values('${ws}','${owner}','active','owner'),('${ws}','${parent}','active','parent'),('${ws}','${admin}','active','admin'),('${otherWs}','${outsider}','active','owner');
      insert into family_members values('${family}','${parent}','active'),('${family}','${owner}','active'),('${otherFamily}','${outsider}','active');
      insert into learner_profiles values('${child}','${parent}','${family}'),('${sibling}','${parent}','${family}'),('${legacy}','${owner}','${family}'),('${foreignChild}','${outsider}','${otherFamily}');
      insert into learner_module_access values('${legacy}','hanzi',true,null,now()),('${child}','poem',true,null,now());
      insert into account_module_access select '${ws}',u,k,true from (values ('${owner}'::uuid),('${parent}'::uuid),('${admin}'::uuid)) users(u) cross join (values ('hanzi'),('poem')) keys(k);
      alter table learner_profiles add column timezone text default 'Asia/Shanghai';
      create table characters(id uuid primary key,character text);
      create table content_packages(id uuid primary key,status text,review_status text);
      create table learner_content_packages(learner_id uuid,package_id uuid,assignment_status text,assignment_order integer);
      create table package_characters(package_id uuid,character_id uuid,sequence integer);
      create table learning_attempts(learner_id uuid,character_id uuid,answered_at timestamptz);
      create table learning_states(learner_id uuid,character_id uuid,stage smallint,due_at timestamptz);
      insert into characters values('${id(40)}','木');
      insert into learning_attempts select '${child}','${id(40)}',now() from generate_series(1,3);
      insert into learning_states values('${child}','${id(40)}',4,now());
      insert into pinyin_states values('${legacy}',5);
    `);
    const sql=fs.readFileSync(path.join(root,'supabase/038_child_hanzi_terms.sql'),'utf8');await db.exec(sql);await db.exec(sql);
    const as=(u,query,args=[])=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[u]);return tx.query(query,args);});
    const can=async(c=child,k='hanzi',u=parent)=>(await as(u,'select public.can_study_child_module($1,$2) value',[c,k])).rows[0].value;
    const version=async(c=child)=>(await db.query('select version from learner_hanzi_terms where learner_id=$1',[c])).rows[0]?.version ?? 0;
    const grant=async({c=child,actor=owner,action='term',months=3,enabled=true,standard=child,v=undefined,cents=3000,req=id(serial++),note='',workspace=ws}={})=>(await as(actor,'select public.owner_manage_hanzi_term($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[workspace,c,action,months,enabled,standard,v ?? await version(c),cents,note,req])).rows[0].value;
    assert.equal(await can(legacy,'hanzi',owner),true);assert.equal(await can(),false);assert.equal(await can(child,'poem'),true);
    await assert.rejects(grant({actor:parent}),/只有 owner/);await assert.rejects(grant({actor:admin}),/只有 owner/);
    await assert.rejects(grant({c:foreignChild}),/不属于当前空间/);
    await assert.rejects(grant({standard:foreignChild}),/本家庭/);
    await assert.rejects(grant({cents:1}),/金额/);assert.equal((await db.query('select count(*)::int n from family_hanzi_billing')).rows[0].n,0);
    const req=id(serial++);const first=await grant({req});assert.equal(await can(),true);assert.equal(first.amount_cents,3000);
    const duplicate=await grant({req,v:0});assert.equal(duplicate.duplicate,true);assert.equal(duplicate.valid_until,first.valid_until);
    await assert.rejects(grant({req,v:0,note:'不同内容'}),/其他操作/);
    await assert.rejects(grant({v:0}),/已经|已被更新/);
    assert.equal((await db.query('select count(*)::int n from hanzi_term_events')).rows[0].n,1);
    const second=await grant({c:sibling,months:12,cents:9600});assert.equal(second.monthly_cents,800);assert.equal(await can(sibling),true);
    await assert.rejects(db.query('update learner_profiles set family_id=$2 where id=$1',[child,otherFamily]),/不能直接更换家庭/);
    const renewed=await grant({months:6,cents:6000});
    assert.equal(renewed.valid_until,(await db.query("select ($1::date + interval '6 months')::date::text d",[first.valid_until])).rows[0].d);
    // 手动暂停后续期仍保持暂停；恢复开关不会替代日期判断。
    await grant({action:'enabled',months:null,cents:0,enabled:false});assert.equal(await can(),false);
    await grant({enabled:false});assert.equal(await can(),false);
    await grant({action:'enabled',months:null,cents:0,enabled:true});assert.equal(await can(),true);
    const today=(await db.query("select (now() at time zone 'Asia/Shanghai')::date::text d")).rows[0].d;
    await db.query("update learner_hanzi_terms set starts_on=$2::date-90,valid_until=$2::date where learner_id=$1",[child,today]);
    assert.equal(await can(),false);
    assert.equal((await as(parent,'select learner_id from learner_hanzi_terms where learner_id=$1',[child])).rows.length,1);
    const sheet=(await as(parent,"select public.get_hanzi_print_sheet($1,'all',false) value",[child])).rows[0].value;
    assert.equal(sheet.selected_total,1);assert.equal(sheet.rows[0].stage,4);assert.equal(sheet.rows[0].attempt_count,3);
    assert.equal((await db.query('select stage from pinyin_states where learner_id=$1',[legacy])).rows[0].stage,5);
    await assert.rejects(as(parent,"select public.get_hanzi_print_sheet($1,'all',false)",[foreignChild]),/权限/);
    // 数据库触发器阻止旧客户端/旧 definer RPC 的写入，已有行不删除。
    await assert.rejects(db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[parent]);await tx.query('insert into pinyin_states values($1,3)',[child]);}),/到期/);
    await assert.rejects(db.query('insert into pinyin_states values($1,3)',[legacy]),/到期/); // 无调用者仍须失败。
    const restart=await grant();assert.equal(restart.starts_on,today);
    assert.equal(restart.valid_until,(await db.query("select ($1::date+interval '3 months')::date::text d",[today])).rows[0].d);
    await db.query("update families set status='suspended' where id=$1",[family]);assert.equal(await can(),false);
    await grant();assert.equal(await can(),false);await db.query("update families set status='active' where id=$1",[family]);
    await db.query("update account_module_access set enabled=false where user_id=$1 and module_key='hanzi'",[parent]);
    await grant();assert.equal(await can(),false);assert.equal(await can(child,'poem'),true);
    await db.query("update account_module_access set enabled=true where user_id=$1 and module_key='hanzi'",[parent]);
    await db.query("update family_members set status='suspended' where user_id=$1",[parent]);assert.equal(await can(),false);
    await db.query("update family_members set status='active' where user_id=$1",[parent]);assert.equal(await can(),true);
    await as(parent,'select public.can_study_child_module($1,$2)',[child,'hanzi']);
    assert.equal((await as(parent,'select id from hanzi_term_events')).rows.length,0);
    assert.equal((await as(admin,'select id from hanzi_term_events')).rows.length,0);
    assert.ok((await as(owner,'select id from hanzi_term_events')).rows.length>0);
    await assert.rejects(as(parent,"update learner_hanzi_terms set mode='permanent',starts_on=null,valid_until=null where learner_id=$1",[child]),/permission denied/);
    await assert.rejects(as(owner,'delete from hanzi_term_events'),/permission denied/);
    await db.query("update workspace_members set status='suspended' where user_id=$1",[owner]);await assert.rejects(grant(),/只有 owner/);
    assert.equal((await as(owner,'select id from hanzi_term_events')).rows.length,0);
    await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select public.can_study_child_module($1,$2)',[child,'hanzi']);}),/permission denied/);
    // 再运行升级脚本，不把已到期的授权恢复为长期权限。
    await db.query("update learner_hanzi_terms set starts_on=$2::date-90,valid_until=$2::date where learner_id=$1",[child,today]);await db.exec(sql);
    assert.equal(await can(),false);assert.equal((await db.query('select mode from learner_hanzi_terms where learner_id=$1',[child])).rows[0].mode,'term');
  } finally { await db.close(); }
});
