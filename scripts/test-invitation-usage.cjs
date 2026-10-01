/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname,'..');
function load(file, dependencies={}) {
  const m={exports:{}};
  const js=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(js,{module:m,exports:m.exports,require:n=>dependencies[n] ?? require(n),Response,AbortSignal,console,Date});
  return m.exports;
}
const invitation=load('lib/invitation.ts'), usage=load('lib/service-usage-values.ts');
test('Invitation token and return URL validation',()=>{
  const token=crypto.randomBytes(32).toString('base64url');
  assert.equal(invitation.validInvitationToken(token),true);
  for(const t of ['',token+'x','https://evil','<script>']) assert.equal(invitation.validInvitationToken(t),false);
  for(const p of ['//evil.test','/\\evil.test','https://evil.test','/\n/evil']) assert.equal(invitation.safeNextPath(p),'/learn');
  assert.equal(invitation.safeNextPath('/join?token='+token),'/join?token='+token);
  assert.match(invitation.invitationError('function digest(text, unknown) does not exist'),/021/);
  assert.doesNotMatch(invitation.invitationError('database password secret'),/secret/);
});
test('Provider usage: actual zero stays zero, missing stays unknown, cache is not extra tokens',()=>{
  const v=usage.usageValues({usage:{prompt_tokens:20,completion_tokens:0,prompt_tokens_details:{cached_tokens:8}}},'text');
  assert.equal(v.input_tokens,20); assert.equal(v.output_tokens,0); assert.equal(v.cached_input_tokens,8);
  assert.equal(usage.usageValues({},'text').input_tokens,null);
  assert.equal(usage.usageValues({usage:{input_tokens:-1,output_tokens:'3'}},'image').output_tokens,null);
  assert.equal(usage.usageValues({data:[{url:'x'},{b64_json:'x'},{}]},'image').images,2);
});

test('Metering boundary: authorization, atomic guard, success, timeout, safe log payload',async()=>{
  let active=true, mustChange=false, reserveError=false, reserveResult='allowed', fetchCount=0, throws=false;
  const writes=[], reservations=[];
  const db={auth:{getUser:async()=>({data:{user:{id:'u'}},error:null})},from:table=>({select:()=>({eq:()=>({single:async()=>table==='learning_workspaces'?{data:{status:'active'}}:{data:{must_change_password:mustChange},error:null}})})})};
  const admin={rpc:async(name,args)=>{reservations.push({name,args});return {data:reserveResult,error:reserveError?{code:'42883'}:null};},from:()=>({update:row=>({eq:async()=>{writes.push(row);return {error:null};}})})};
  const m={exports:{}}; const file=fs.readFileSync(path.join(root,'lib/metered-fetch.ts'),'utf8');
  vm.runInNewContext(ts.transpileModule(file,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    module:m,exports:m.exports,Response,AbortSignal,console,Date,
    fetch:async()=>{fetchCount++;if(throws) throw Error('timeout');return Response.json({usage:{prompt_tokens:17,completion_tokens:9}});},
    require:n=>({'server-only':{},'node:crypto':crypto,'@/lib/supabase/server':{createClient:async()=>db},'@/lib/supabase/admin':{createAdminClient:()=>admin},'@/lib/access':{loadAccessContext:async()=>active?{workspaceId:'w'}:null},'./service-usage-values':usage,'./service-guard':{serviceGuardLimits:()=>({workspaceMinute:15,accountMinute:6,workspaceDay:1500,accountDay:300,workspaceUnitsDay:50000,accountUnitsDay:5000}),guardDenialMessage:()=>"达到保护额度"}})[n],
  });
  const run=()=>m.exports.meteredFetch('https://provider.test',{body:'PRIVATE MEETING SECRET'},{service:'text',feature:'test',model:'deployment'});
  active=false; await assert.rejects(run()); assert.equal(fetchCount,0);
  active=true;mustChange=true;await assert.rejects(run());assert.equal(fetchCount,0);
  mustChange=false;reserveError=true;await assert.rejects(run(),/023/);assert.equal(fetchCount,0);
  reserveError=false;reserveResult=null;await assert.rejects(run(),/未知状态/);assert.equal(fetchCount,0);
  reserveError=false;reserveResult='workspace_minute';await assert.rejects(run(),/达到保护额度/);assert.equal(fetchCount,0);
  reserveResult='allowed';await run();assert.equal(fetchCount,1);assert.equal(writes.at(-1).input_tokens,17);
  assert.equal(reservations.at(-1).name,'reserve_metered_service_call');
  assert.equal(reservations.at(-1).args.p_workspace_minute_limit,15);
  throws=true;await assert.rejects(run());assert.equal(writes.at(-1).status,'unknown');
  assert.ok(!JSON.stringify(writes).includes('SECRET'));
});

test('PostgreSQL: invitation transaction, password change proof and private usage', {skip:!process.env.PGLITE_MODULE},async t=>{
  const {PGlite}=require(process.env.PGLITE_MODULE);const db=new PGlite();
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const owner=id(1),parent=id(2),other=id(3),unverified=id(4),manager=id(5),workspace=id(10),elsewhere=id(11);
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema private;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,private to authenticated;grant execute on function auth.uid() to authenticated;
    insert into auth.users values('${owner}','owner@test.com',now(),'hash1'),('${parent}','friend@test.com',now(),'hash1'),('${other}','other@test.com',now(),'hash1'),('${unverified}','pending@test.com',null,'hash1'),('${manager}','admin@test.com',now(),'hash1');`);
  const base=fs.readFileSync(path.join(root,'supabase/015_multi_family_admin.sql'),'utf8');
  await db.exec(base.slice(base.indexOf('create table if not exists public.learning_workspaces'),base.indexOf('create index if not exists workspace_members_user_idx')));
  const old=fs.readFileSync(path.join(root,'supabase/017_owner_user_management_and_duplicate_cleanup.sql'),'utf8');
  await db.exec(old.slice(old.indexOf('create table if not exists public.workspace_user_profiles'),old.indexOf('create index if not exists workspace_user_profiles_workspace_idx')));
  await db.exec(base.match(/create or replace function private\.is_workspace_admin\([\s\S]*?\$\$;/)[0]);
  await db.exec(`grant execute on function private.is_workspace_admin(uuid) to authenticated;insert into public.learning_workspaces(id,name,owner_user_id) values('${workspace}','A','${owner}'),('${elsewhere}','B','${other}');
    insert into public.workspace_members(workspace_id,user_id,role,status) values('${workspace}','${owner}','owner','active'),('${workspace}','${manager}','admin','active'),('${elsewhere}','${other}','owner','active');`);
  const sql=fs.readFileSync(path.join(root,'supabase/021_invitation_and_service_usage.sql'),'utf8');await db.exec(sql);await db.exec(sql);
  const asUser=(u,fn)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[u]);return fn(tx);});
  const token=crypto.randomBytes(32).toString('base64url');
  async function invite(email='friend@test.com',status='pending',expired=false){const value=crypto.randomBytes(32).toString('base64url');await db.query("insert into public.workspace_invitations(workspace_id,invited_email,family_name,token_hash,created_by,status,expires_at) values($1,$2,'Friend',$3,$4,$5,now()+$6::interval)",[workspace,email,crypto.createHash('sha256').update(value).digest('hex'),owner,status,expired?'-1 day':'7 days']);return value;}
  const valid=await invite();
  const accept=(u,value)=>asUser(u,tx=>tx.query('select public.accept_workspace_invitation($1) result',[value]));
  await t.test('Wrong email, missing, expired, revoked and unverified are rejected without membership',async()=>{
    await assert.rejects(accept(other,valid),/邮箱/);await assert.rejects(accept(parent,token),/不存在/);
    await assert.rejects(accept(parent,await invite('friend@test.com','revoked')),/撤销/);
    await assert.rejects(accept(parent,await invite('friend@test.com','pending',true)),/过期/);
    await assert.rejects(accept(unverified,await invite('pending@test.com')),/验证/);
    assert.equal((await db.query('select count(*)::int n from public.families')).rows[0].n,0);
  });
  await t.test('Empty search_path works without pgcrypto; same-user retry creates one family',async()=>{
    assert.equal((await accept(parent,valid)).rows[0].result.accepted,true);
    assert.equal((await accept(parent,valid)).rows[0].result.already_accepted,true);
    assert.equal((await db.query('select count(*)::int n from public.families')).rows[0].n,1);
    await assert.rejects(accept(parent,await invite()),/已加入/);
    await db.query("update public.workspace_members set status='suspended' where user_id=$1",[parent]);
    await assert.rejects(accept(parent,valid));await assert.rejects(accept(parent,await invite()),/停用/);
    await db.query("update public.workspace_members set status='active' where user_id=$1",[parent]);
  });
  await t.test('Initial password completion cannot be called without changing Auth password',async()=>{
    await db.query('update public.workspace_user_profiles set must_change_password=true,password_reset_at=now() where user_id=$1',[parent]);
    await assert.rejects(asUser(parent,tx=>tx.query('select public.complete_initial_password_change()')),/新密码/);
    await assert.rejects(asUser(parent,tx=>tx.query('select * from private.initial_password_baselines')));
    await db.query("update auth.users set encrypted_password='hash2' where id=$1",[parent]);
    await asUser(parent,tx=>tx.query('select public.complete_initial_password_change()'));
    assert.equal((await db.query('select must_change_password from public.workspace_user_profiles where user_id=$1',[parent])).rows[0].must_change_password,false);
  });
  await t.test('Usage write restricted to server; admins see their workspace only; parent cannot forge',async()=>{
    const insert="insert into public.service_usage_events(workspace_id,user_id,service,feature,model,input_tokens,status) values($1,$2,'text','test','gpt',100,'success')";
    await db.transaction(async tx=>{await tx.exec('set local role service_role');await tx.query(insert,[workspace,parent]);await tx.query(insert,[elsewhere,other]);});
    await assert.rejects(asUser(parent,tx=>tx.query(insert,[workspace,parent])));
    await assert.rejects(asUser(parent,tx=>tx.query("update public.service_usage_events set input_tokens=0")));
    assert.equal((await asUser(parent,tx=>tx.query('select * from public.service_usage_events'))).rows.length,0);
    assert.equal((await asUser(owner,tx=>tx.query('select * from public.service_usage_events'))).rows.length,1);
    assert.equal((await asUser(manager,tx=>tx.query('select * from public.service_usage_events'))).rows.length,1);
    const agg=(tx,w)=>tx.query("select * from public.workspace_service_usage($1,now()-interval '1 day',now()+interval '1 day')",[w]);
    assert.equal((await asUser(manager,tx=>agg(tx,workspace))).rows[0].input_tokens,'100');
    assert.equal((await asUser(manager,tx=>agg(tx,elsewhere))).rows.length,0);
    await db.query("update public.workspace_members set status='suspended' where user_id=$1",[manager]);
    assert.equal((await asUser(manager,tx=>agg(tx,workspace))).rows.length,0);
  });
  await db.close();
});
