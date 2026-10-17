/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.join(__dirname,'..');
function load(file,overrides={}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const loaded={exports:{}};
  new Function('module','exports','require',code)(loaded,loaded.exports,id=>id in overrides?overrides[id]:id.startsWith('@/')?load(`${id.slice(2)}.ts`,overrides):require(id));
  return loaded.exports;
}

test('愿望进度按各自成本计算；实现、撤销、归档与旧礼物分开',()=>{
  const {rewardWishProgress}=load('lib/reward-types.ts');
  const item={id:'car',learner_id:'child',sticker_cost:30,status:'active'};
  assert.equal(rewardWishProgress(item,10,[]).remaining,20);
  assert.equal(rewardWishProgress(item,40,[]).percent,100);
  assert.equal(rewardWishProgress(item,40,[]).state,'ready');
  const redemption={learner_id:'child',reward_item_id:'car',status:'completed'};
  assert.equal(rewardWishProgress(item,0,[redemption]).state,'fulfilled');
  assert.equal(rewardWishProgress(item,0,[{...redemption,status:'reversed'}]).state,'saving');
  assert.equal(rewardWishProgress(item,0,[{...redemption,learner_id:'sibling'}]).state,'saving');
  assert.equal(rewardWishProgress({...item,status:'archived'},0,[]).state,'archived');
  assert.equal(rewardWishProgress({...item,learner_id:null},40,[redemption]).state,'ready');
});

test('愿望卡服务端呈现进度、已实现快照和旧礼物；不把其他孩子愿望混入列表',()=>{
  const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
  const {RewardWishlist}=load('components/reward-wishlist.tsx',{
    'next/link':{default:({children,...props})=>React.createElement('a',props,children)},
    '@/components/reward-redeem-button':{RewardRedeemButton:()=>React.createElement('button',null,'请爸爸妈妈兑换')},
  });
  const item=(id,learner_id,title)=>({id,learner_id,title,sticker_cost:30,icon:'🎁',note:null,status:'active'});
  const dashboard={balance:10,catalogItems:[item('car','child','小汽车'),item('rod','child','现在的名字'),item('other','sibling','不应显示的愿望'),item('legacy',null,'原共用礼物')],redemptions:[{learner_id:'child',reward_item_id:'rod',status:'completed',title_snapshot:'兑换时的钓鱼竿',sticker_cost:20,local_date:'2026-10-17'}]};
  const html=renderToStaticMarkup(React.createElement(RewardWishlist,{dashboard,learnerId:'child',learnerName:'测试孩子'}));
  assert.match(html,/测试孩子.*愿望清单/);assert.match(html,/再攒 20 枚/);assert.match(html,/<progress[^>]*value="10"/);
  assert.match(html,/兑换时的钓鱼竿/);assert.doesNotMatch(html,/不应显示的愿望/);assert.match(html,/以前的共用礼物/);
});

test('完整余额来自库内汇总，不用最近20行估算余额；目录按孩子筛选',async()=>{
  const {loadRewardDashboard}=load('lib/rewards.ts');
  const calls=[];
  function db(walletError=null) {
    return {rpc:async(name,args)=>{assert.equal(name,'reward_wallet_summary');assert.equal(args.p_learner_id,'child');return {data:{balance:1205,lifetimeEarned:1250,lifetimeSpent:45},error:walletError};},from(table){
      const chain={then(resolve,reject){const data=table==='reward_accounts'?null:table==='reward_ledger'?Array.from({length:20},()=>({amount:1})):[];return Promise.resolve({data,error:null}).then(resolve,reject);}};
      for(const method of ['select','eq','maybeSingle','order','limit','range','or'])chain[method]=(...args)=>{calls.push([table,method,...args]);return chain;};
      return chain;
    }};
  }
  const dashboard=await loadRewardDashboard(db(),'child');
  assert.equal(dashboard.balance,1205);assert.equal(dashboard.ledger.length,20);
  assert.ok(calls.some(x=>x[0]==='reward_catalog_items'&&x[1]==='or'&&x[2]==='learner_id.eq.child,learner_id.is.null'));
  assert.ok(calls.some(x=>x[0]==='reward_ledger'&&x[1]==='limit'&&x[2]===20));
  await assert.rejects(loadRewardDashboard(db({message:'failed'}),'child'),/037/);
});

test('037 两次运行：家庭隔离、同请求重试、仅实现一次、旧礼物兼容、准确余额及撤销', {skip:!process.env.PGLITE_MODULE},async()=>{
  const {PGlite}=require(process.env.PGLITE_MODULE);const db=new PGlite();
  const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const dad=uid(1),mom=uid(2),other=uid(3),admin=uid(4),workspace=uid(10),fa=uid(11),fb=uid(12),fc=uid(13),child=uid(20),sibling=uid(21),bchild=uid(22);
  let next=100;const request=()=>uid(next++);
  try {
    await db.exec(`create role authenticated;create role anon;create schema auth;create schema private;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.families(id uuid primary key,workspace_id uuid,status text);
      create table public.workspace_members(workspace_id uuid,user_id uuid,status text,role text);
      create table public.family_members(family_id uuid,user_id uuid,status text);
      create table public.learner_profiles(id uuid primary key,parent_user_id uuid,family_id uuid,timezone text);
      grant usage on schema auth,private to authenticated;grant select on public.learner_profiles to authenticated;
      insert into auth.users values('${dad}'),('${mom}'),('${other}'),('${admin}');
      insert into public.families values('${fa}','${workspace}','active'),('${fb}','${workspace}','active'),('${fc}','${workspace}','active');
      insert into public.workspace_members values('${workspace}','${dad}','active','parent'),('${workspace}','${mom}','active','parent'),('${workspace}','${other}','active','parent'),('${workspace}','${admin}','active','owner');
      insert into public.family_members values('${fa}','${dad}','active'),('${fa}','${mom}','active'),('${fb}','${other}','active'),('${fc}','${admin}','active');
      insert into public.learner_profiles values('${child}','${dad}','${fa}','Asia/Shanghai'),('${sibling}','${dad}','${fa}','Asia/Shanghai'),('${bchild}','${other}','${fb}','Asia/Shanghai');
    `);
    await db.exec(fs.readFileSync(path.join(root,'supabase/012_reward_sticker_module.sql'),'utf8'));
    const sql=fs.readFileSync(path.join(root,'supabase/037_child_reward_wishlist.sql'),'utf8');await db.exec(sql);await db.exec(sql);
    const as=(user,sql,args=[])=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);return tx.query(sql,args);});
    const save=async(user,learner,title,cost,req=request(),item=null)=>(await as(user,'select public.save_reward_wish($1,$2,$3,$4,$5,$6,$7) id',[learner,item,title,cost,'🎁',null,req])).rows[0].id;
    const wallet=async(user,learner=child)=>(await as(user,'select public.reward_wallet_summary($1) value',[learner])).rows[0].value;
    const redeem=async(user,item,cost,req=request(),learner=child)=>(await as(user,'select public.redeem_reward_wish($1,$2,$3,$4,$5) value',[learner,item,null,req,cost])).rows[0].value;
    const reverse=async(user,id)=>(await as(user,'select public.reverse_reward_redemption($1,$2,$3) value',[id,'误操作返还',request()])).rows[0].value;
    const createId=request();const car=await save(dad,child,'小汽车',20,createId);
    assert.equal(await save(dad,child,'小汽车',20,createId),car);
    await assert.rejects(save(dad,child,'另一辆车',30,createId),/已经完成/);
    await assert.rejects(save(other,child,'不能创建',20),/本家庭/);
    await assert.rejects(save(admin,child,'不能越权',20),/本家庭/);
    assert.equal((await as(other,'select id from public.reward_catalog_items where id=$1',[car])).rows.length,0);
    assert.equal((await as(mom,'select id from public.reward_catalog_items where id=$1',[car])).rows.length,1);
    await assert.rejects(as(dad,'update public.reward_catalog_items set learner_id=$1 where id=$2',[sibling,car]),/permission denied/);
    await assert.rejects(as(dad,'delete from public.reward_catalog_items where id=$1',[car]),/permission denied/);
    await assert.rejects(redeem(dad,car,20,request(),sibling),/找不到这个孩子/);
    await db.query(`insert into public.reward_ledger(learner_id,event_type,amount,title,local_date) select $1,'manual_bonus',1,'测试努力',current_date from generate_series(1,1005)`,[child]);
    assert.equal((await wallet(mom)).balance,1005);
    const redemptionId=request();const redeemed=await redeem(mom,car,20,redemptionId);
    assert.equal(redeemed.balance,985);assert.equal((await redeem(mom,car,20,redemptionId)).duplicate,true);
    await assert.rejects(redeem(dad,car,20),/已经实现/);
    await assert.rejects(redeem(other,car,20),/本家庭/);
    await assert.rejects(redeem(admin,car,20),/本家庭/);
    await save(dad,child,'更名但不改历史',50,request(),car);
    const snapshot=(await db.query('select title_snapshot,sticker_cost from public.reward_redemptions where id=$1',[redeemed.redemption_id])).rows[0];
    assert.equal(snapshot.title_snapshot,'小汽车');assert.equal(snapshot.sticker_cost,20);
    assert.equal((await reverse(dad,redeemed.redemption_id)).balance,1005);
    assert.equal((await reverse(mom,redeemed.redemption_id)).duplicate,true);
    assert.equal((await wallet(dad)).balance,1005);
    await assert.rejects(redeem(dad,car,20),/已被修改/);
    const again=await redeem(dad,car,50);assert.equal(again.balance,955);
    assert.equal((await db.query("select count(*)::int n from public.reward_ledger where reference_id=$1 and event_type='redemption_reversal'",[redeemed.redemption_id])).rows[0].n,1);
    const noMoney=await save(dad,sibling,'小愿望',10);await assert.rejects(redeem(dad,noMoney,10,request(),sibling),/贴纸还不够/);
    const old=uid(40),foreignOld=uid(41);
    await db.query('insert into public.reward_catalog_items(id,created_by,title,sticker_cost) values($1,$2,$3,10),($4,$5,$6,10)',[old,dad,'原礼物',foreignOld,other,'他人旧礼物']);
    await assert.rejects(redeem(dad,foreignOld,10),/找不到这个孩子/);
    await assert.rejects(save(dad,child,'不能改他人旧礼物',10,request(),foreignOld),/不能修改/);
    assert.equal((await redeem(dad,old,10)).redeemed,true);assert.equal((await redeem(dad,old,10)).redeemed,true);
    await as(dad,"update public.reward_catalog_items set status='archived' where id=$1",[old]);await assert.rejects(redeem(dad,old,10),/找不到/);
    const balanceBefore=(await wallet(dad)).balance;
    await as(dad,'select public.grant_manual_reward($1,$2,$3,$4,$5,$6)',[child,'bonus',1,'原奖励兼容',null,request()]);
    assert.equal((await wallet(dad)).balance,balanceBefore+1);
    await assert.rejects(as(dad,"insert into public.reward_ledger(learner_id,event_type,amount,title,local_date) values($1,'manual_bonus',100,'伪造',current_date)",[child]),/permission denied/);
    await db.query("update public.workspace_members set status='inactive' where user_id=$1",[mom]);await assert.rejects(wallet(mom),/无权/);
    assert.equal((await as(mom,'select id from public.reward_catalog_items where id=$1',[car])).rows.length,0);
    await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select public.reward_wallet_summary($1)',[child]);}),/permission denied/);
  } finally {await db.close();}
});
