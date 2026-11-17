-- 040 · owner 代建孩子、免费试用、多模块开通/续期。先运行 001–039。
-- 只新增管理能力；不删除学习事实、不更改记忆算法或已冻结的每日计划。
begin;

alter table public.learner_hanzi_terms add column if not exists grant_kind text not null default 'paid'
  check (grant_kind in ('paid','trial'));
create table if not exists public.learner_module_terms (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  module_key text not null check(module_key in ('poem','music','catechism','kids_english','family_maxims')),
  mode text not null check(mode in ('permanent','term')),
  starts_on date, valid_until date,
  grant_kind text not null default 'paid' check(grant_kind in ('paid','trial')),
  version integer not null default 1 check(version>0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key(learner_id,module_key),
  check((mode='permanent' and starts_on is null and valid_until is null)
    or (mode='term' and starts_on is not null and valid_until>starts_on))
);
create index if not exists learner_module_terms_expiry_idx on public.learner_module_terms(valid_until,learner_id,module_key) where mode='term';
create index if not exists learner_module_terms_updated_by_idx on public.learner_module_terms(updated_by);
create table if not exists public.learner_trial_windows (
  learner_id uuid primary key references public.learner_profiles(id) on delete cascade,
  starts_on date not null, valid_until date not null check(valid_until>starts_on),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists learner_trial_windows_created_by_idx on public.learner_trial_windows(created_by);
-- 保留旧版已开启附加模块的长期权限。重复执行不会覆盖已经设置的限期。
insert into public.learner_module_terms(learner_id,module_key,mode)
select a.learner_id,a.module_key,'permanent' from public.learner_module_access a
where a.enabled and a.module_key in ('poem','music','catechism','kids_english','family_maxims')
  and not exists(select 1 from public.hanzi_term_events e where e.learner_id=a.learner_id and e.request_payload ? 'modules')
on conflict do nothing;
alter table public.learner_module_terms enable row level security;
alter table public.learner_trial_windows enable row level security;
drop policy if exists "read child module terms" on public.learner_module_terms;
create policy "read child module terms" on public.learner_module_terms for select to authenticated using(private.can_access_learner(learner_id));
drop policy if exists "read child trial window" on public.learner_trial_windows;
create policy "read child trial window" on public.learner_trial_windows for select to authenticated using(private.can_access_learner(learner_id));
revoke all on public.learner_module_terms,public.learner_trial_windows from public,anon,authenticated;
grant select on public.learner_module_terms,public.learner_trial_windows to authenticated;
alter table public.hanzi_term_events drop constraint if exists hanzi_term_events_action_check;
alter table public.hanzi_term_events add constraint hanzi_term_events_action_check check(action in ('term','trial','permanent','enabled'));
alter table public.hanzi_term_events drop constraint if exists hanzi_term_events_months_check;
alter table public.hanzi_term_events add constraint hanzi_term_events_months_check check(months in (1,3,6,12));
create unique index if not exists workspace_owner_child_request_idx
  on public.workspace_audit_events(workspace_id,(details->>'request_id')) where event_type='learner.owner_created';

-- 管理入口与实际学习写入统一使用此判定；不缓存成功授权，不需要定时关闭任务。
create or replace function private.can_use_learner_module(p_learner_id uuid,p_module_key text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.can_access_learner(p_learner_id) and exists (
    select 1 from public.learner_profiles l
    join public.families f on f.id=l.family_id
    join public.learning_workspaces w on w.id=f.workspace_id
    join public.learner_module_access a on a.learner_id=l.id and a.module_key=p_module_key
    where l.id=p_learner_id and a.enabled and f.status='active' and w.status='active'
      and private.can_use_account_module(f.workspace_id,p_module_key)
      and exists(select 1 from public.workspace_members m where m.workspace_id=f.workspace_id
        and m.user_id=(select auth.uid()) and m.status='active'
        and (m.role in ('owner','admin') or exists(select 1 from public.family_members fm
          where fm.family_id=f.id and fm.user_id=m.user_id and fm.status='active')))
      and case when p_module_key='hanzi' then exists(
        select 1 from public.learner_hanzi_terms t where t.learner_id=l.id
          and (t.mode='permanent' or ((now() at time zone 'Asia/Shanghai')::date>=t.starts_on
            and (now() at time zone 'Asia/Shanghai')::date<t.valid_until)))
      else exists(select 1 from public.learner_module_terms t where t.learner_id=l.id and t.module_key=p_module_key
          and (t.mode='permanent' or ((now() at time zone 'Asia/Shanghai')::date>=t.starts_on
            and (now() at time zone 'Asia/Shanghai')::date<t.valid_until))) end
  );
$$;
revoke all on function private.can_use_learner_module(uuid,text) from public,anon;
grant execute on function private.can_use_learner_module(uuid,text) to authenticated;
create or replace function private.guard_hanzi_access_enable()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.enabled and not (
    (new.module_key='hanzi' and exists(select 1 from public.learner_hanzi_terms where learner_id=new.learner_id))
    or (new.module_key<>'hanzi' and exists(select 1 from public.learner_module_terms where learner_id=new.learner_id and module_key=new.module_key))
  ) then raise exception '请到孩子的“开通 / 续期”页面先设置学习有效期'; end if;
  return new;
end; $$;
revoke all on function private.guard_hanzi_access_enable() from public,anon,authenticated;
create or replace function private.guard_licensed_child_family()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.family_id is distinct from old.family_id and (
    exists(select 1 from public.learner_hanzi_terms where learner_id=old.id)
    or exists(select 1 from public.learner_module_terms where learner_id=old.id)
    or exists(select 1 from public.learner_trial_windows where learner_id=old.id)
    or exists(select 1 from public.family_hanzi_billing where standard_learner_id=old.id)
    or exists(select 1 from public.hanzi_term_events where learner_id=old.id)) then
    raise exception '已有学习授权或收款记录的孩子不能直接更换家庭，请由 owner 核查后受控迁移';
  end if;
  return new;
end; $$;
revoke all on function private.guard_licensed_child_family() from public,anon,authenticated;

-- 不使用 service_role；数据库再次核验 owner、空间、家庭和所选家长。
create or replace function private.owner_create_learner(
  p_workspace_id uuid,p_family_id uuid,p_parent_user_id uuid,p_display_name text,
  p_daily_new_limit integer,p_allow_same_name boolean,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare child_id uuid; prior public.workspace_audit_events%rowtype; payload jsonb;
begin
  if not private.can_manage_hanzi_terms(p_workspace_id) then raise exception '只有 owner 可以代建孩子档案' using errcode='42501'; end if;
  if p_request_id is null or nullif(btrim(p_display_name),'') is null or char_length(btrim(p_display_name))>24
    or p_daily_new_limit is null or p_daily_new_limit not in (3,5,8,10,15,20,30,40,50) then raise exception '孩子昵称或每日新字数量无效'; end if;
  payload:=jsonb_build_object('family',p_family_id,'parent',p_parent_user_id,'name',btrim(p_display_name),'limit',p_daily_new_limit,'same_name',coalesce(p_allow_same_name,false));
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,40));
  select * into prior from public.workspace_audit_events where workspace_id=p_workspace_id
    and event_type='learner.owner_created' and details->>'request_id'=p_request_id::text;
  if found then
    if prior.actor_user_id is distinct from (select auth.uid()) or prior.details->'payload' is distinct from payload then raise exception '该请求编号已用于其他操作'; end if;
    if not exists(select 1 from public.learner_profiles where id=prior.entity_id) then raise exception '此前创建的档案已删除，请核对后重新操作'; end if;
    return jsonb_build_object('learner_id',prior.entity_id,'duplicate',true);
  end if;
  -- 容量锁先于插入；先锁账号，兼容旧账号维护的账号 → 家庭成员锁序。
  perform pg_advisory_xact_lock(7101,hashtext(p_workspace_id::text));
  perform 1 from public.workspace_members where workspace_id=p_workspace_id and user_id=p_parent_user_id and status='active' for share;
  if not found then raise exception '所选家长不是这个家庭的正常成员'; end if;
  -- 不修改家庭主键；NO KEY UPDATE 与外键插入的 KEY SHARE 兼容。
  perform 1 from public.families where id=p_family_id and workspace_id=p_workspace_id and status='active' for no key update;
  if not found then raise exception '所选家庭不属于当前空间或已停用'; end if;
  perform 1 from public.family_members where family_id=p_family_id and user_id=p_parent_user_id and status='active' for share;
  if not found then raise exception '所选家长不是这个家庭的正常成员'; end if;
  if not coalesce(p_allow_same_name,false) and exists(select 1 from public.learner_profiles where family_id=p_family_id and display_name=btrim(p_display_name)) then
    raise exception '这个家庭已有同名孩子。请先查看现有档案；确为另一个孩子时勾选同名确认';
  end if;
  insert into public.learner_profiles(parent_user_id,family_id,display_name,daily_new_limit,timezone)
    values(p_parent_user_id,p_family_id,btrim(p_display_name),p_daily_new_limit,'Asia/Shanghai') returning id into child_id;
  insert into public.workspace_audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,details)
    values(p_workspace_id,(select auth.uid()),'learner.owner_created','learner',child_id,jsonb_build_object('request_id',p_request_id,'payload',payload));
  return jsonb_build_object('learner_id',child_id,'duplicate',false);
end; $$;
revoke all on function private.owner_create_learner(uuid,uuid,uuid,text,integer,boolean,uuid) from public,anon;
grant execute on function private.owner_create_learner(uuid,uuid,uuid,text,integer,boolean,uuid) to authenticated;
create or replace function public.owner_create_learner(
  p_workspace_id uuid,p_family_id uuid,p_parent_user_id uuid,p_display_name text,
  p_daily_new_limit integer,p_allow_same_name boolean,p_request_id uuid
) returns jsonb language sql security invoker set search_path='' as $$
  select private.owner_create_learner(p_workspace_id,p_family_id,p_parent_user_id,p_display_name,p_daily_new_limit,p_allow_same_name,p_request_id);
$$;
revoke all on function public.owner_create_learner(uuid,uuid,uuid,text,integer,boolean,uuid) from public,anon;
grant execute on function public.owner_create_learner(uuid,uuid,uuid,text,integer,boolean,uuid) to authenticated;

-- 一次确认、一次事务、一个流水；每个勾选模块分别接续自己的截止日期。
create or replace function private.owner_manage_child_access(
  p_workspace_id uuid,p_learner_id uuid,p_action text,p_months integer,p_modules text[],
  p_enabled jsonb,p_expected_versions jsonb,p_standard_learner_id uuid,p_expected_cents integer,
  p_convert_permanent boolean,p_note text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  child public.learner_profiles%rowtype; family public.families%rowtype;
  prior public.hanzi_term_events%rowtype; billing public.family_hanzi_billing%rowtype;
  trial public.learner_trial_windows%rowtype;
  today date:=(now() at time zone 'Asia/Shanghai')::date;
  modules text[]; key text; current_state jsonb; new_state jsonb;
  payload jsonb; before_modules jsonb:='{}'; after_modules jsonb:='{}'; result jsonb;
  current_version integer; old_enabled boolean; new_mode text; kind text; term_start date; term_end date;
  unit_cents integer:=0; cents integer:=0;
begin
  if not private.can_manage_hanzi_terms(p_workspace_id) then raise exception '只有 owner 可以管理学习有效期' using errcode='42501'; end if;
  if p_request_id is null or p_action is null or p_action not in ('trial','term','permanent','enabled')
    or p_modules is null or cardinality(p_modules)=0 or char_length(coalesce(p_note,''))>500 then raise exception '授权参数无效'; end if;
  select array_agg(distinct item order by item) into modules from unnest(p_modules) item;
  if exists(select 1 from unnest(modules) item where item is null or item not in ('hanzi','poem','music','catechism','kids_english','family_maxims')) then raise exception '孩子模块无效'; end if;
  if p_action='term' and (p_months is null or p_months not in (1,3,6,12)) then raise exception '请选择1、3、6或12个月'; end if;
  if jsonb_typeof(p_enabled) is distinct from 'object' or jsonb_typeof(p_expected_versions) is distinct from 'object' then raise exception '请刷新并核对模块开关与版本'; end if;
  payload:=jsonb_build_object('workspace',p_workspace_id,'learner',p_learner_id,'action',p_action,'months',p_months,
    'modules',to_jsonb(modules),'enabled',p_enabled,'versions',p_expected_versions,'standard',p_standard_learner_id,
    'cents',p_expected_cents,'convert_permanent',coalesce(p_convert_permanent,false),'note',coalesce(p_note,''));
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,38));
  select * into prior from public.hanzi_term_events where request_id=p_request_id;
  if found then
    if prior.actor_user_id is distinct from (select auth.uid()) or prior.request_payload is distinct from payload then raise exception '该请求编号已用于其他操作；请先核对此前结果'; end if;
    return prior.after_state||jsonb_build_object('duplicate',true);
  end if;
  select * into child from public.learner_profiles where id=p_learner_id;
  if not found then raise exception '找不到孩子'; end if;
  select * into family from public.families where id=child.family_id and workspace_id=p_workspace_id for update;
  if not found then raise exception '孩子不属于当前空间'; end if;
  perform 1 from public.learner_profiles where id=p_learner_id and family_id=family.id for update;
  if not found then raise exception '孩子家庭已变化，请刷新'; end if;
  -- 不替家长恢复账号/家庭；授权可事先设置，停用状态仍阻止学习。
  select * into trial from public.learner_trial_windows where learner_id=p_learner_id for update;
  if p_action='trial' then
    if trial.learner_id is null then
      if exists(select 1 from public.learner_hanzi_terms where learner_id=p_learner_id)
        or exists(select 1 from public.learner_module_terms where learner_id=p_learner_id)
        or exists(select 1 from public.hanzi_term_events where learner_id=p_learner_id and action in ('term','trial','permanent')) then
        raise exception '这个孩子已有正式授权，不能重新领取首次免费试用';
      end if;
      insert into public.learner_trial_windows(learner_id,starts_on,valid_until,created_by)
        values(p_learner_id,today,(today+interval '1 month')::date,(select auth.uid())) returning * into trial;
    elsif today>=trial.valid_until then raise exception '免费试用已结束；每位孩子只能领取一次，请使用正式开通 / 续期'; end if;
  end if;
  if p_action='term' and 'hanzi'=any(modules) then
    select * into billing from public.family_hanzi_billing where family_id=family.id;
    if billing.family_id is null then
      if not exists(select 1 from public.learner_profiles where id=p_standard_learner_id and family_id=family.id) then raise exception '请选择本家庭的原价孩子'; end if;
      insert into public.family_hanzi_billing(family_id,standard_learner_id) values(family.id,p_standard_learner_id) returning * into billing;
    elsif billing.standard_learner_id is distinct from p_standard_learner_id then raise exception '家庭原价孩子已固定，请刷新核对'; end if;
    unit_cents:=case when billing.standard_learner_id=p_learner_id then 1000 else 800 end;
    cents:=unit_cents*p_months;
  end if;
  if p_expected_cents is distinct from cents then raise exception '金额不一致，请重新核对；附加模块不另收费'; end if;
  foreach key in array modules loop
    if key='hanzi' then
      select to_jsonb(t) into current_state from public.learner_hanzi_terms t where learner_id=p_learner_id for update;
    else
      select to_jsonb(t) into current_state from public.learner_module_terms t where learner_id=p_learner_id and module_key=key for update;
    end if;
    current_version:=coalesce((current_state->>'version')::integer,0);
    if jsonb_typeof(p_expected_versions->key) is distinct from 'number'
      or (p_expected_versions->>key)::integer is distinct from current_version then raise exception '授权已被更新，请刷新核对，本次未重复延期'; end if;
    if jsonb_typeof(p_enabled->key) is distinct from 'boolean' then raise exception '请明确确认每个模块的开启 / 暂停状态'; end if;
    select enabled into old_enabled from public.learner_module_access where learner_id=p_learner_id and module_key=key for update;
    before_modules:=before_modules||jsonb_build_object(key,coalesce(current_state,'{}')||jsonb_build_object('enabled',coalesce(old_enabled,false),'version',current_version));
    if p_action='trial' then
      if current_state is not null and (current_state->>'mode'='permanent' or current_state->>'grant_kind'<>'trial') then raise exception '不能将已有正式或长期授权改为免费试用'; end if;
      new_mode:='term';kind:='trial';term_start:=trial.starts_on;term_end:=trial.valid_until;
    elsif p_action='term' then
      if current_state->>'mode'='permanent' and not coalesce(p_convert_permanent,false) then raise exception '所选模块已有长期授权；如确要改为限期，请明确勾选确认'; end if;
      new_mode:='term';kind:='paid';
      term_start:=case when current_state->>'mode'='term' and (current_state->>'valid_until')::date>today then (current_state->>'starts_on')::date else today end;
      term_end:=((case when current_state->>'mode'='term' and (current_state->>'valid_until')::date>today then (current_state->>'valid_until')::date else today end)+make_interval(months=>p_months))::date;
    elsif p_action='permanent' then new_mode:='permanent';kind:='paid';term_start:=null;term_end:=null;
    else
      if current_state is null then raise exception '请先为所选模块设置有效期'; end if;
      new_mode:=current_state->>'mode';kind:=current_state->>'grant_kind';term_start:=(current_state->>'starts_on')::date;term_end:=(current_state->>'valid_until')::date;
    end if;
    if key='hanzi' then
      insert into public.learner_hanzi_terms(learner_id,mode,starts_on,valid_until,grant_kind,updated_by)
      values(p_learner_id,new_mode,term_start,term_end,kind,(select auth.uid()))
      on conflict(learner_id) do update set mode=excluded.mode,starts_on=excluded.starts_on,valid_until=excluded.valid_until,
        grant_kind=excluded.grant_kind,version=learner_hanzi_terms.version+1,updated_at=now(),updated_by=excluded.updated_by;
    else
      insert into public.learner_module_terms(learner_id,module_key,mode,starts_on,valid_until,grant_kind,updated_by)
      values(p_learner_id,key,new_mode,term_start,term_end,kind,(select auth.uid()))
      on conflict(learner_id,module_key) do update set mode=excluded.mode,starts_on=excluded.starts_on,valid_until=excluded.valid_until,
        grant_kind=excluded.grant_kind,version=learner_module_terms.version+1,updated_at=now(),updated_by=excluded.updated_by;
    end if;
    insert into public.learner_module_access(learner_id,module_key,enabled,updated_by,updated_at)
      values(p_learner_id,key,(p_enabled->>key)::boolean,(select auth.uid()),now())
      on conflict(learner_id,module_key) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now();
    new_state:=jsonb_build_object('learner_id',p_learner_id,'mode',new_mode,'starts_on',term_start,'valid_until',term_end,
      'grant_kind',kind,'version',current_version+1,'enabled',(p_enabled->>key)::boolean);
    after_modules:=after_modules||jsonb_build_object(key,new_state);
  end loop;
  result:=coalesce(after_modules->'hanzi','{}')||jsonb_build_object('modules',after_modules,'amount_cents',cents,'monthly_cents',unit_cents,'trial_until',trial.valid_until);
  insert into public.hanzi_term_events(request_id,workspace_id,family_id,learner_id,actor_user_id,action,months,monthly_cents,amount_cents,before_state,after_state,request_payload,note)
    values(p_request_id,p_workspace_id,family.id,p_learner_id,(select auth.uid()),p_action,case when p_action='term' then p_months end,
      nullif(unit_cents,0),cents,jsonb_build_object('modules',before_modules),result,payload,coalesce(p_note,''));
  return result;
end; $$;
revoke all on function private.owner_manage_child_access(uuid,uuid,text,integer,text[],jsonb,jsonb,uuid,integer,boolean,text,uuid) from public,anon;
grant execute on function private.owner_manage_child_access(uuid,uuid,text,integer,text[],jsonb,jsonb,uuid,integer,boolean,text,uuid) to authenticated;
create or replace function public.owner_manage_child_access(
  p_workspace_id uuid,p_learner_id uuid,p_action text,p_months integer,p_modules text[],
  p_enabled jsonb,p_expected_versions jsonb,p_standard_learner_id uuid,p_expected_cents integer,
  p_convert_permanent boolean,p_note text,p_request_id uuid
) returns jsonb language sql security invoker set search_path='' as $$
  select private.owner_manage_child_access(p_workspace_id,p_learner_id,p_action,p_months,p_modules,p_enabled,p_expected_versions,p_standard_learner_id,p_expected_cents,p_convert_permanent,p_note,p_request_id);
$$;
revoke all on function public.owner_manage_child_access(uuid,uuid,text,integer,text[],jsonb,jsonb,uuid,integer,boolean,text,uuid) from public,anon;
grant execute on function public.owner_manage_child_access(uuid,uuid,text,integer,text[],jsonb,jsonb,uuid,integer,boolean,text,uuid) to authenticated;

-- 保留旧客户端签名；不允许旧表单静默把长期权限降为限期。
create or replace function private.owner_manage_hanzi_term(
  p_workspace_id uuid,p_learner_id uuid,p_action text,p_months integer,p_enabled boolean,
  p_standard_learner_id uuid,p_expected_version integer,p_expected_cents integer,p_note text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare old_event public.hanzi_term_events%rowtype; legacy_payload jsonb;
begin
  if not private.can_manage_hanzi_terms(p_workspace_id) then raise exception '只有 owner 可以管理学习有效期' using errcode='42501'; end if;
  -- 升级前已提交但响应丢失的请求，仍返回原结果，不重复收款/延期。
  legacy_payload:=jsonb_build_object('workspace',p_workspace_id,'learner',p_learner_id,'action',p_action,'months',p_months,'enabled',p_enabled,'standard',p_standard_learner_id,'version',p_expected_version,'cents',p_expected_cents,'note',coalesce(p_note,''));
  select * into old_event from public.hanzi_term_events where request_id=p_request_id;
  if found and not(old_event.request_payload ? 'modules') then
    if old_event.actor_user_id is distinct from (select auth.uid()) or old_event.request_payload is distinct from legacy_payload then raise exception '该请求编号已用于其他操作'; end if;
    return old_event.after_state||jsonb_build_object('duplicate',true);
  end if;
  return private.owner_manage_child_access(p_workspace_id,p_learner_id,p_action,p_months,array['hanzi'],
    jsonb_build_object('hanzi',p_enabled),jsonb_build_object('hanzi',p_expected_version),p_standard_learner_id,p_expected_cents,false,p_note,p_request_id);
end; $$;
revoke all on function private.owner_manage_hanzi_term(uuid,uuid,text,integer,boolean,uuid,integer,integer,text,uuid) from public,anon;
grant execute on function private.owner_manage_hanzi_term(uuid,uuid,text,integer,boolean,uuid,integer,integer,text,uuid) to authenticated;

-- 为旧的直接写入路径补齐有效期防线；父母维护资源不受孩子期限影响。
do $$ declare tab text; key text; begin
  for tab,key in select * from (values
    ('kids_english_states','kids_english'),('kids_english_daily_items','kids_english'),('kids_english_attempts','kids_english'),
    ('family_maxim_states','family_maxims'),('family_maxim_attempts','family_maxims')) pairs(tab,key) loop
    if to_regclass('public.'||tab) is not null then
      execute format('drop trigger if exists enforce_child_module_term on public.%I',tab);
      execute format('create trigger enforce_child_module_term before insert or update on public.%I for each row execute function private.enforce_child_module_write(%L)',tab,key);
    end if;
  end loop;
end $$;
create or replace function private.can_study_family_maxim(p_learner_id uuid,p_maxim_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.can_use_learner_module(p_learner_id,'family_maxims') and exists(
    select 1 from public.learner_profiles l join public.family_maxims m on m.family_id=l.family_id
    join public.learner_family_maxims a on a.learner_id=l.id and a.maxim_id=m.id
    where l.id=p_learner_id and m.id=p_maxim_id and m.archived_at is null and a.active
      and private.can_use_family_maxims(l.family_id));
$$;
revoke all on function private.can_study_family_maxim(uuid,uuid) from public,anon;
grant execute on function private.can_study_family_maxim(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
