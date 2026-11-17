/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, overrides = {}) {
  const code = ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, id => id in overrides ? overrides[id] : id === 'server-only' ? {} : id.startsWith('@/') ? load(`${id.slice(2)}.ts`, overrides) : require(id));
  return m.exports;
}

test('每个模块按自己的截止日自然月续期；试用共用窗口', () => {
  assert.equal(source('supabase/040_owner_children_and_module_terms.sql'), source('supabase/migrations/20261116145651_owner_children_and_module_terms.sql'));
  const { previewChildTerm, describeChildTerm } = load('lib/child-access.ts');
  const t = { mode: 'term', starts_on: '2026-01-01', valid_until: '2026-01-31', grant_kind: 'trial' };
  assert.equal(previewChildTerm(t, 'term', 1, '2026-01-15', null), '可用至 2026-02-27（含当天）');
  assert.equal(previewChildTerm(null, 'trial', 1, '2026-01-15', { valid_until: '2026-01-31' }), '可用至 2026-01-30（含当天）');
  assert.equal(describeChildTerm(t, true, '2026-01-20').label, '免费试用中');
  assert.equal(describeChildTerm(t, true, '2026-01-31').label, '已到期');
});

test('儿童模块统一走数据库实时期限校验，不改父母英语/运动授权', async () => {
  const { requireChildModule } = load('lib/module-access.ts', { react: { cache: f => f } });
  const keys = load('lib/module-keys.ts').CHILD_MODULES;
  for (const key of keys) {
    let gate = true;
    const db = { rpc: async (name, args) => { assert.equal(name, 'can_study_child_module'); assert.equal(args.p_module_key, key); return { data: gate }; } };
    await requireChildModule(db, {}, 'user', 'child', key);
    gate = false;
    await assert.rejects(requireChildModule(db, {}, 'user', 'child', key), /到期/);
  }
  assert.doesNotMatch(source('supabase/040_owner_children_and_module_terms.sql').split('create or replace function private.owner_manage_child_access')[1].split('-- 保留旧客户端')[0], /adult_english|exercise/);
});

test('新增入口 owner-only，轻量授权页不加载整份字库或学习看板', async () => {
  const form = source('components/owner-child-access-manager.tsx');
  assert.match(form,/\[versions, setVersions\] = useState/);
  assert.match(form,/value=\{versions\[row.key\]\}/);
  assert.match(form,/intention\.current \?\?=/);
  const React = require('react'); const { renderToStaticMarkup } = require('react-dom/server');
  for (const file of ['app/(app)/admin/children/new/page.tsx', 'app/(app)/admin/learners/[learnerId]/access/page.tsx']) {
    for (const role of ['parent', 'admin']) {
      const Page = load(file, {
        'next/navigation': { redirect: p => { throw new Error(`redirect:${p}`); }, notFound: () => { throw new Error('notFound'); } },
        'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
        '@/components/owner-child-create-form': { OwnerChildCreateForm: () => null },
        '@/components/owner-child-access-manager': { OwnerChildAccessManager: () => null },
        '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) }, from: () => assert.fail('无权限不能查询') }) },
        '@/lib/access': { loadAccessContext: async () => ({ isOwner: false, isAdmin: role === 'admin' }) },
      }).default;
      await assert.rejects(Page({ params: Promise.resolve({ learnerId: 'id' }), searchParams: Promise.resolve({}) }), new RegExp(`redirect:${role === 'admin' ? '/admin' : '/parent'}`));
    }
    assert.doesNotMatch(source(file), /loadLearnerDashboard|get_library_rows|loadWorkspaceOverview/);
  }
  const { OwnerUserCard } = load('components/owner-user-manager.tsx', {
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/navigation': { useRouter: () => ({}) }, '@/lib/user-management-actions': { updateWorkspaceUser: async () => ({}), resetWorkspaceUserPassword: async () => ({}) },
    '@/components/feedback-form': { FeedbackForm: ({ children }) => React.createElement('div', null, children) },
  });
  const html = renderToStaticMarkup(React.createElement(OwnerUserCard, { member: { userId: 'p', email: 'p@example.com', displayName: '家长', familyId: 'f', role: 'parent', status: 'active' }, families: [{ id: 'f', name: '家' }], childPulses: [{ id: 'c', name: '孩子', stable: 0, due: 0 }], accountModules: [], childModules: {} }));
  assert.match(html, /children\/new\?family=f/); assert.match(html, /learners\/c\/access/);
});

test('040 数据库：代建归属/重试/容量/权限，试用/价格/多模块/到期/旧授权兼容', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = require(process.env.PGLITE_MODULE); const db = new PGlite();
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const owner=id(1), parent=id(2), admin=id(3), outsider=id(4), ws=id(10), otherWs=id(11), family=id(20), otherFamily=id(21), legacy=id(30);
  let serial=100;
  try {
    await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table auth.users(id uuid primary key);
      create table learning_workspaces(id uuid primary key,owner_user_id uuid,status text);
      create table families(id uuid primary key,workspace_id uuid,name text,status text);
      create table workspace_members(workspace_id uuid,user_id uuid,status text,role text);
      create table family_members(family_id uuid,user_id uuid,status text);
      create table learner_profiles(id uuid primary key default gen_random_uuid(),parent_user_id uuid,family_id uuid,display_name text,daily_new_limit integer,timezone text);
      create table workspace_audit_events(id uuid primary key default gen_random_uuid(),workspace_id uuid,actor_user_id uuid,event_type text,entity_type text,entity_id uuid,details jsonb,created_at timestamptz default now());
      create table account_module_access(workspace_id uuid,user_id uuid,module_key text,enabled boolean,primary key(workspace_id,user_id,module_key));
      create table learner_module_access(learner_id uuid,module_key text,enabled boolean,updated_by uuid,updated_at timestamptz,primary key(learner_id,module_key));
      create table kids_english_states(learner_id uuid,stage integer);
      create table kids_english_daily_items(learner_id uuid,stage integer);
      create table kids_english_attempts(learner_id uuid,stage integer);
      create table family_maxim_states(learner_id uuid,stage integer);
      create table family_maxim_attempts(learner_id uuid,stage integer);
      create table family_maxims(id uuid,family_id uuid,archived_at timestamptz);
      create table learner_family_maxims(learner_id uuid,maxim_id uuid,active boolean);
      grant usage on schema auth,private to authenticated;
      grant select on families,learner_profiles,learner_module_access to authenticated;
      grant insert on kids_english_states,family_maxim_attempts to authenticated;
      create function private.is_workspace_owner(w uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.learning_workspaces where id=w and owner_user_id=(select auth.uid()) and status='active') $$;
      create function private.can_access_learner(c uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.learner_profiles l join public.families f on f.id=l.family_id join public.workspace_members m on m.workspace_id=f.workspace_id and m.user_id=(select auth.uid()) and m.status='active' where l.id=c and (l.parent_user_id=(select auth.uid()) or m.role in ('admin','owner'))) $$;
      create function private.can_use_account_module(w uuid,k text) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.account_module_access where workspace_id=w and user_id=(select auth.uid()) and module_key=k and enabled) $$;
      create function private.can_use_family_maxims(f uuid) returns boolean language sql stable as $$ select true $$;
      create function private.enforce_child_module_write() returns trigger language plpgsql security definer set search_path='' as $$ begin if not private.can_use_learner_module(new.learner_id,tg_argv[0]) then raise exception '模块已到期或停用' using errcode='42501'; end if;return new;end; $$;
      insert into auth.users values('${owner}'),('${parent}'),('${admin}'),('${outsider}');
      insert into learning_workspaces values('${ws}','${owner}','active'),('${otherWs}','${outsider}','active');
      insert into families values('${family}','${ws}','测试家','active'),('${otherFamily}','${otherWs}','外部家','active');
      insert into workspace_members values('${ws}','${owner}','active','owner'),('${ws}','${parent}','active','parent'),('${ws}','${admin}','active','admin'),('${otherWs}','${outsider}','active','owner');
      insert into family_members values('${family}','${parent}','active'),('${family}','${owner}','active'),('${otherFamily}','${outsider}','active');
      insert into learner_profiles(id,parent_user_id,family_id,display_name) values('${legacy}','${parent}','${family}','旧孩子');
      insert into learner_module_access values('${legacy}','hanzi',true,null,now()),('${legacy}','poem',true,null,now());
      insert into account_module_access select '${ws}',u,k,true from (values('${owner}'::uuid),('${parent}'::uuid),('${admin}'::uuid)) users(u) cross join (values('hanzi'),('poem'),('music'),('catechism'),('kids_english'),('family_maxims')) keys(k);
    `);
    await db.exec(source('supabase/038_child_hanzi_terms.sql').split('-- 已学记录打印')[0]+'commit;');
    await db.exec(source('supabase/023_capacity_guard_50_learners.sql').split('-- A denied')[0]+'commit;');
    const sql=source('supabase/040_owner_children_and_module_terms.sql'); await db.exec(sql); await db.exec(sql);
    const as=(u,q,args=[])=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[u]);return tx.query(q,args);});
    const create=async({actor=owner,f=family,p=parent,name='新孩子',same=false,req=id(serial++)}={})=>(await as(actor,'select public.owner_create_learner($1,$2,$3,$4,$5,$6,$7) value',[ws,f,p,name,5,same,req])).rows[0].value;
    await assert.rejects(create({actor:parent}),/只有 owner/); await assert.rejects(create({actor:admin}),/只有 owner/);
    await assert.rejects(create({f:otherFamily,p:outsider}),/不属于当前空间|不是这个家庭/);await assert.rejects(create({p:outsider}),/不是这个家庭/);
    const req=id(serial++), created=await create({req}); const child=created.learner_id;
    assert.equal((await create({req})).learner_id,child); await assert.rejects(create({req,name:'换名字'}),/其他操作/);
    await assert.rejects(create(),/同名孩子/);
    const sibling=(await create({name:'弟弟'})).learner_id;
    const row=(await db.query('select * from learner_profiles where id=$1',[child])).rows[0];assert.equal(row.parent_user_id,parent);assert.equal(row.family_id,family);
    assert.equal((await db.query("select actor_user_id from workspace_audit_events where entity_id=$1",[child])).rows[0].actor_user_id,owner);
    const terms=async(c,key)=>(await db.query(key==='hanzi'?'select to_jsonb(t) value from learner_hanzi_terms t where learner_id=$1':'select to_jsonb(t) value from learner_module_terms t where learner_id=$1 and module_key=$2',key==='hanzi'?[c]:[c,key])).rows[0]?.value;
    const grant=async({actor=owner,c=child,action='term',months=3,keys=['hanzi'],enabled,versions,standard=child,cents=3000,convert=false,req=id(serial++)}={})=>{
      const v=versions ?? Object.fromEntries(await Promise.all(keys.map(async k=>[k,(await terms(c,k))?.version ?? 0])));
      return (await as(actor,'select public.owner_manage_child_access($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) value',[ws,c,action,action==='term'?months:null,keys,JSON.stringify(enabled ?? Object.fromEntries(keys.map(k=>[k,true]))),JSON.stringify(v),standard,cents,convert,'',req])).rows[0].value;
    };
    const can=async(c,key='hanzi',actor=parent)=>(await as(actor,'select can_study_child_module($1,$2) value',[c,key])).rows[0].value;
    assert.equal((await terms(legacy,'poem')).mode,'permanent');assert.equal(await can(legacy,'poem'),true);
    const trialReq=id(serial++);const trial=await grant({action:'trial',keys:['hanzi'],cents:0,req:trialReq});
    assert.equal(trial.amount_cents,0); assert.equal(trial.grant_kind,'trial'); assert.equal(await can(child),true);
    assert.equal((await db.query('select count(*)::int n from family_hanzi_billing')).rows[0].n,0);
    const retry=await grant({action:'trial',keys:['hanzi'],cents:0,req:trialReq,versions:{hanzi:0}});assert.equal(retry.duplicate,true);
    const added=await grant({action:'trial',keys:['poem'],cents:0});assert.equal(added.modules.poem.valid_until,trial.valid_until);
    await grant({action:'trial',keys:['hanzi'],cents:0});assert.equal((await terms(child,'hanzi')).valid_until,trial.valid_until);
    await assert.rejects(grant({actor:parent}),/只有 owner/);await assert.rejects(grant({actor:admin}),/只有 owner/);
    const paid=await grant({months:1,keys:['hanzi','poem'],cents:1000}); assert.equal(paid.monthly_cents,1000);
    const paidSibling=await grant({c:sibling,months:12,cents:9600});assert.equal(paidSibling.monthly_cents,800);
    await assert.rejects(grant({action:'trial',keys:['hanzi'],cents:0}),/正式或长期/);
    const poemBefore=(await terms(child,'poem')).valid_until;
    const long=await grant({months:6,cents:6000}); assert.equal((await terms(child,'poem')).valid_until,poemBefore);
    const both=await grant({keys:['hanzi','poem'],months:3});
    assert.notEqual(both.modules.hanzi.valid_until,both.modules.poem.valid_until);
    assert.equal(both.modules.hanzi.valid_until,(await db.query("select ($1::date+interval '3 months')::date::text d",[long.valid_until])).rows[0].d);
    await assert.rejects(grant({keys:['hanzi','poem'],versions:{hanzi:both.modules.hanzi.version,poem:0}}),/已被更新/);
    assert.equal((await terms(child,'hanzi')).version,both.modules.hanzi.version,'batch rollback');
    await grant({keys:['poem'],action:'permanent',cents:0});
    await assert.rejects(grant({keys:['poem'],cents:0}),/长期授权/);
    await grant({keys:['poem'],cents:0,convert:true});
    await grant({action:'enabled',enabled:{hanzi:false},cents:0});await grant({enabled:{hanzi:false}});assert.equal(await can(child),false);
    await grant({action:'enabled',cents:0});assert.equal(await can(child),true);
    await db.query("update learner_module_terms set starts_on=current_date-31,valid_until=current_date where learner_id=$1 and module_key='poem'",[child]);assert.equal(await can(child,'poem'),false);
    await db.query("update families set status='suspended' where id=$1",[family]);await grant({months:1,cents:1000});assert.equal(await can(child),false);
    await db.query("update families set status='active' where id=$1",[family]);
    await grant({keys:['kids_english','family_maxims'],cents:0});
    await db.query("update learner_module_terms set starts_on=current_date-31,valid_until=current_date where learner_id=$1 and module_key in ('kids_english','family_maxims')",[child]);
    await assert.rejects(as(parent,'insert into kids_english_states values($1,1)',[child]),/到期/);
    await assert.rejects(as(parent,'insert into family_maxim_attempts values($1,1)',[child]),/到期/);
    await assert.rejects(as(parent,"insert into learner_hanzi_terms(learner_id,mode) values($1,'permanent')",[id(999)]),/permission denied/);
    await assert.rejects(db.query('update learner_profiles set family_id=$2 where id=$1',[child,otherFamily]),/不能直接更换家庭/);
    const fresh=(await create({name:'首次试用'})).learner_id;await grant({c:fresh,action:'trial',cents:0});
    await db.query('update learner_trial_windows set starts_on=current_date-31,valid_until=current_date where learner_id=$1',[fresh]);await assert.rejects(grant({c:fresh,action:'trial',cents:0}),/免费试用已结束/);
    // Legacy signature remains callable and shares the new single authoritative ledger.
    const v=(await terms(sibling,'hanzi')).version;
    const legacyCall=await as(owner,'select owner_manage_hanzi_term($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',[ws,sibling,'term',1,true,child,v,800,'旧接口',id(serial++)]);assert.equal(legacyCall.rows[0].value.amount_cents,800);
    // Existing keys keep explicit EXECUTE/SELECT grants; anon cannot call privileged functions.
    const perms=(await db.query("select has_function_privilege('anon','public.owner_create_learner(uuid,uuid,uuid,text,integer,boolean,uuid)','execute') a,has_function_privilege('anon','public.owner_manage_child_access(uuid,uuid,text,integer,text[],jsonb,jsonb,uuid,integer,boolean,text,uuid)','execute') b")).rows[0];assert.equal(perms.a,false);assert.equal(perms.b,false);
    await db.exec(sql);assert.equal((await terms(child,'poem')).mode,'term');assert.equal((await terms(legacy,'poem')).mode,'permanent');
    for(let i=0;i<46;i++) await create({name:`容量${i}`}); // 1 legacy + 3 created + 46 = 50
    await assert.rejects(create({name:'第51位'}),/50 个孩子/);
  } finally { await db.close(); }
});
