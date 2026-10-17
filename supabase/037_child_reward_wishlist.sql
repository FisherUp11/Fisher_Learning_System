-- 037：每个孩子独立的礼物愿望；前置 012、015（现有完整项目可直接升级）。
-- 不改变贴纸获取、成长星或任何学习规则；保留旧礼物和兑换流水。
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.reward_catalog_items add column if not exists learner_id uuid references public.learner_profiles(id) on delete cascade;
alter table public.reward_catalog_items add column if not exists create_request_id uuid;
create unique index if not exists reward_wish_create_request_idx on public.reward_catalog_items(create_request_id) where create_request_id is not null;
create index if not exists reward_wish_learner_status_idx on public.reward_catalog_items(learner_id,status,created_at desc) where learner_id is not null;
create index if not exists reward_wish_completed_idx on public.reward_redemptions(learner_id,reward_item_id) where status='completed';

-- 家庭私有：管理员角色本身不授予替其他家庭花贴纸的权限。
create or replace function private.can_manage_reward_learner(p_learner_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.learner_profiles l join public.families f on f.id=l.family_id
    join public.workspace_members wm on wm.workspace_id=f.workspace_id and wm.user_id=(select auth.uid()) and wm.status='active'
    where l.id=p_learner_id and f.status='active' and (
      l.parent_user_id=(select auth.uid()) or exists (
        select 1 from public.family_members fm where fm.family_id=f.id and fm.user_id=(select auth.uid()) and fm.status='active'))
  );
$$;
revoke all on function private.can_manage_reward_learner(uuid) from public,anon;
grant execute on function private.can_manage_reward_learner(uuid) to authenticated;

alter table public.reward_catalog_items enable row level security;
drop policy if exists "parent manages reward catalog" on public.reward_catalog_items;
drop policy if exists "family reads reward wishes" on public.reward_catalog_items;
drop policy if exists "family inserts reward wishes" on public.reward_catalog_items;
drop policy if exists "family updates reward wishes" on public.reward_catalog_items;
create policy "family reads reward wishes" on public.reward_catalog_items for select to authenticated
using ((learner_id is null and created_by=(select auth.uid())) or private.can_manage_reward_learner(learner_id));
create policy "family inserts reward wishes" on public.reward_catalog_items for insert to authenticated
with check (created_by=(select auth.uid()) and (learner_id is null or private.can_manage_reward_learner(learner_id)));
create policy "family updates reward wishes" on public.reward_catalog_items for update to authenticated
using ((learner_id is null and created_by=(select auth.uid())) or private.can_manage_reward_learner(learner_id))
with check ((learner_id is null and created_by=(select auth.uid())) or private.can_manage_reward_learner(learner_id));
-- 不允许客户端改写愿望归属/创建人/请求编号，也不永久删除愿望。
revoke update,delete on public.reward_catalog_items from authenticated;
grant update(title,sticker_cost,icon,note,status,updated_at) on public.reward_catalog_items to authenticated;

-- 同家庭另一位家长也可核对奖励；流水/账户/兑换仍只能由事务函数写。
drop policy if exists "parent writes reward accounts" on public.reward_accounts;
drop policy if exists "parent reads reward accounts" on public.reward_accounts;
drop policy if exists "family reads reward accounts" on public.reward_accounts;
create policy "family reads reward accounts" on public.reward_accounts for select to authenticated using(private.can_manage_reward_learner(learner_id));
drop policy if exists "parent reads reward ledger" on public.reward_ledger;
drop policy if exists "family reads reward ledger" on public.reward_ledger;
create policy "family reads reward ledger" on public.reward_ledger for select to authenticated using(private.can_manage_reward_learner(learner_id));
drop policy if exists "parent reads reward redemptions" on public.reward_redemptions;
drop policy if exists "family reads reward redemptions" on public.reward_redemptions;
create policy "family reads reward redemptions" on public.reward_redemptions for select to authenticated using(private.can_manage_reward_learner(learner_id));
revoke insert,update,delete on public.reward_accounts,public.reward_ledger,public.reward_redemptions from authenticated;

create or replace function public.reward_wallet_summary(p_learner_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
  if not private.can_manage_reward_learner(p_learner_id) then raise exception '无权查看这个孩子的贴纸' using errcode='42501'; end if;
  select jsonb_build_object('balance',coalesce(sum(amount),0),'lifetimeEarned',coalesce(sum(greatest(amount,0)),0),'lifetimeSpent',-coalesce(sum(least(amount,0)),0))
  into v_result from public.reward_ledger where learner_id=p_learner_id;
  return v_result;
end; $$;
revoke all on function public.reward_wallet_summary(uuid) from public,anon;
grant execute on function public.reward_wallet_summary(uuid) to authenticated;

create or replace function private.save_reward_wish(p_learner_id uuid,p_item_id uuid,p_title text,p_cost integer,p_icon text,p_note text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_item public.reward_catalog_items%rowtype; v_id uuid;
begin
  if not private.can_manage_reward_learner(p_learner_id) then raise exception '只有这个孩子本家庭的家长可以维护愿望' using errcode='42501'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 80 or p_cost is null or p_cost not between 1 and 100
    or p_icon is null or char_length(btrim(p_icon)) not between 1 and 12 or char_length(coalesce(p_note,''))>300 then
    raise exception '请检查愿望名称、1–100 枚贴纸、图标和备注' using errcode='22023';
  end if;
  if p_item_id is null then
    if p_request_id is null then raise exception '缺少保存编号' using errcode='22023'; end if;
    insert into public.reward_catalog_items(created_by,learner_id,title,sticker_cost,icon,note,create_request_id)
    values((select auth.uid()),p_learner_id,btrim(p_title),p_cost,btrim(p_icon),nullif(btrim(p_note),''),p_request_id)
    on conflict(create_request_id) where create_request_id is not null do nothing returning id into v_id;
    if v_id is null then
      select * into v_item from public.reward_catalog_items where create_request_id=p_request_id;
      if v_item.learner_id is distinct from p_learner_id or v_item.created_by is distinct from (select auth.uid()) then raise exception '保存编号无效' using errcode='42501'; end if;
      if v_item.title<>btrim(p_title) or v_item.sticker_cost<>p_cost or v_item.icon<>btrim(p_icon) or v_item.note is distinct from nullif(btrim(p_note),'') then
        raise exception '这次保存已经完成，请先刷新查看原愿望，再决定是否新增' using errcode='22023'; end if;
      v_id:=v_item.id;
    end if;
  else
    select * into v_item from public.reward_catalog_items where id=p_item_id for update;
    if not found or not coalesce(v_item.learner_id=p_learner_id or (v_item.learner_id is null and v_item.created_by=(select auth.uid())),false) then
      raise exception '不能修改这份愿望' using errcode='42501'; end if;
    update public.reward_catalog_items set title=btrim(p_title),sticker_cost=p_cost,icon=btrim(p_icon),note=nullif(btrim(p_note),''),updated_at=now() where id=p_item_id;
    v_id:=p_item_id;
  end if;
  return v_id;
end; $$;
revoke all on function private.save_reward_wish(uuid,uuid,text,integer,text,text,uuid) from public,anon;
grant execute on function private.save_reward_wish(uuid,uuid,text,integer,text,text,uuid) to authenticated;
create or replace function public.save_reward_wish(p_learner_id uuid,p_item_id uuid,p_title text,p_cost integer,p_icon text,p_note text,p_request_id uuid)
returns uuid language sql security invoker set search_path='' as $$ select private.save_reward_wish(p_learner_id,p_item_id,p_title,p_cost,p_icon,p_note,p_request_id); $$;
revoke all on function public.save_reward_wish(uuid,uuid,text,integer,text,text,uuid) from public,anon;
grant execute on function public.save_reward_wish(uuid,uuid,text,integer,text,text,uuid) to authenticated;

-- 所有兑换路径统一先锁孩子账户，再锁礼物；同请求幂等，新愿望只能实现一次。
create or replace function private.redeem_reward_wish(p_learner_id uuid,p_reward_item_id uuid,p_note text,p_request_id uuid,p_expected_cost integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_item public.reward_catalog_items%rowtype; v_existing public.reward_redemptions%rowtype;
  v_timezone text; v_today date; v_balance integer; v_id uuid;
begin
  if not private.can_manage_reward_learner(p_learner_id) then raise exception '只有这个孩子本家庭的家长可以确认兑换' using errcode='42501'; end if;
  if p_request_id is null or char_length(coalesce(p_note,''))>300 then raise exception '兑换编号或备注不正确' using errcode='22023'; end if;
  select timezone into v_timezone from public.learner_profiles where id=p_learner_id;
  insert into public.reward_accounts(learner_id) values(p_learner_id) on conflict do nothing;
  perform 1 from public.reward_accounts where learner_id=p_learner_id for update;
  select coalesce(sum(amount),0)::integer into v_balance from public.reward_ledger where learner_id=p_learner_id;
  select * into v_existing from public.reward_redemptions where request_id=p_request_id;
  if found then
    if v_existing.learner_id<>p_learner_id or v_existing.reward_item_id is distinct from p_reward_item_id then raise exception '兑换编号无效' using errcode='42501'; end if;
    return jsonb_build_object('redeemed',false,'duplicate',true,'balance',v_balance,'redemption_id',v_existing.id,'title',v_existing.title_snapshot,'cost',v_existing.sticker_cost);
  end if;
  select * into v_item from public.reward_catalog_items where id=p_reward_item_id and status='active' for update;
  if not found or not coalesce(v_item.learner_id=p_learner_id or (v_item.learner_id is null and v_item.created_by=(select auth.uid())),false) then
    raise exception '找不到这个孩子可以兑换的愿望' using errcode='42501'; end if;
  if v_item.learner_id is not null and exists(select 1 from public.reward_redemptions where learner_id=p_learner_id and reward_item_id=p_reward_item_id and status='completed') then
    raise exception '这个愿望已经实现啦；如果想再要一份，请家长新建愿望' using errcode='22023'; end if;
  if p_expected_cost is not null and p_expected_cost<>v_item.sticker_cost then raise exception '所需贴纸已被修改，请刷新后重新确认' using errcode='22023'; end if;
  if v_balance<v_item.sticker_cost then raise exception '贴纸还不够，当前 % 枚，需要 % 枚',v_balance,v_item.sticker_cost using errcode='22023'; end if;
  v_today:=(now() at time zone v_timezone)::date;
  insert into public.reward_redemptions(request_id,learner_id,reward_item_id,title_snapshot,sticker_cost,note,status,redeemed_by,local_date)
  values(p_request_id,p_learner_id,v_item.id,v_item.title,v_item.sticker_cost,nullif(btrim(p_note),''),'completed',(select auth.uid()),v_today) returning id into v_id;
  insert into public.reward_ledger(learner_id,event_type,amount,title,note,local_date,dedupe_key,reference_id,created_by)
  values(p_learner_id,'redemption',-v_item.sticker_cost,'兑换礼物：'||v_item.title,nullif(btrim(p_note),''),v_today,'redemption:'||v_id::text,v_id,(select auth.uid()));
  return jsonb_build_object('redeemed',true,'duplicate',false,'balance',v_balance-v_item.sticker_cost,'redemption_id',v_id,'title',v_item.title,'cost',v_item.sticker_cost);
end; $$;
revoke all on function private.redeem_reward_wish(uuid,uuid,text,uuid,integer) from public,anon;
grant execute on function private.redeem_reward_wish(uuid,uuid,text,uuid,integer) to authenticated;
create or replace function public.redeem_reward_wish(p_learner_id uuid,p_reward_item_id uuid,p_note text,p_request_id uuid,p_expected_cost integer)
returns jsonb language sql security invoker set search_path='' as $$
  select private.redeem_reward_wish(p_learner_id,p_reward_item_id,p_note,p_request_id,p_expected_cost);
$$;
revoke all on function public.redeem_reward_wish(uuid,uuid,text,uuid,integer) from public,anon;
grant execute on function public.redeem_reward_wish(uuid,uuid,text,uuid,integer) to authenticated;
-- 旧前端仍可使用旧签名；同样检查新愿望的孩子归属及一次性兑换。
create or replace function public.redeem_reward(p_learner_id uuid,p_reward_item_id uuid,p_note text,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.redeem_reward_wish(p_learner_id,p_reward_item_id,p_note,p_request_id,null); $$;

create or replace function private.reverse_reward_wish(p_redemption_id uuid,p_note text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.reward_redemptions%rowtype; v_balance integer;
begin
  select * into v_row from public.reward_redemptions where id=p_redemption_id;
  if not found or not private.can_manage_reward_learner(v_row.learner_id) then raise exception '无权撤销这条兑换' using errcode='42501'; end if;
  if p_request_id is null or char_length(coalesce(p_note,''))>300 then raise exception '撤销编号或备注不正确' using errcode='22023'; end if;
  insert into public.reward_accounts(learner_id) values(v_row.learner_id) on conflict do nothing;
  perform 1 from public.reward_accounts where learner_id=v_row.learner_id for update;
  select * into v_row from public.reward_redemptions where id=p_redemption_id for update;
  if v_row.status<>'reversed' then
    update public.reward_redemptions set status='reversed',reversed_at=now(),reversal_note=nullif(btrim(p_note),'') where id=p_redemption_id;
    insert into public.reward_ledger(learner_id,event_type,amount,title,note,sticker_code,local_date,dedupe_key,reference_id,created_by)
    values(v_row.learner_id,'redemption_reversal',v_row.sticker_cost,'撤销兑换：'||v_row.title_snapshot,nullif(btrim(p_note),''),'sprout',v_row.local_date,'reversal:'||v_row.id::text,v_row.id,(select auth.uid())) on conflict(learner_id,dedupe_key) do nothing;
  else
    select coalesce(sum(amount),0)::integer into v_balance from public.reward_ledger where learner_id=v_row.learner_id;
    return jsonb_build_object('reversed',false,'duplicate',true,'balance',v_balance,'title',v_row.title_snapshot,'amount',v_row.sticker_cost);
  end if;
  select coalesce(sum(amount),0)::integer into v_balance from public.reward_ledger where learner_id=v_row.learner_id;
  return jsonb_build_object('reversed',true,'duplicate',false,'balance',v_balance,'title',v_row.title_snapshot,'amount',v_row.sticker_cost,'sticker_code','sprout');
end; $$;
revoke all on function private.reverse_reward_wish(uuid,text,uuid) from public,anon;
grant execute on function private.reverse_reward_wish(uuid,text,uuid) to authenticated;
create or replace function public.reverse_reward_redemption(p_redemption_id uuid,p_note text,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.reverse_reward_wish(p_redemption_id,p_note,p_request_id); $$;
revoke all on function public.redeem_reward(uuid,uuid,text,uuid),public.reverse_reward_redemption(uuid,text,uuid) from public,anon;
grant execute on function public.redeem_reward(uuid,uuid,text,uuid),public.reverse_reward_redemption(uuid,text,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
