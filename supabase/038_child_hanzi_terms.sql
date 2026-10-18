-- 038 · 家庭日常入口与孩子汉字有效期。先运行 001–037，整段执行。
-- 不删除、不重算任何学习记录；已有开通孩子明确保留为长期授权。
begin;

create table if not exists public.learner_hanzi_terms (
  learner_id uuid primary key references public.learner_profiles(id) on delete cascade,
  mode text not null check (mode in ('permanent','term')),
  starts_on date,
  valid_until date, -- 北京日期，右开区间；最后可用日 = valid_until - 1
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  check ((mode='permanent' and starts_on is null and valid_until is null)
      or (mode='term' and starts_on is not null and valid_until > starts_on))
);
create index if not exists learner_hanzi_terms_expiry_idx on public.learner_hanzi_terms(valid_until,learner_id) where mode='term';
create table if not exists public.family_hanzi_billing (
  family_id uuid primary key references public.families(id) on delete cascade,
  standard_learner_id uuid not null references public.learner_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists family_hanzi_billing_child_idx on public.family_hanzi_billing(standard_learner_id);
create table if not exists public.hanzi_term_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  workspace_id uuid not null references public.learning_workspaces(id) on delete restrict,
  family_id uuid not null references public.families(id) on delete restrict,
  learner_id uuid not null references public.learner_profiles(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check(action in ('term','permanent','enabled')),
  months integer check(months in (3,6,12)),
  monthly_cents integer check(monthly_cents in (800,1000)),
  amount_cents integer not null default 0 check(amount_cents >= 0),
  before_state jsonb not null,
  after_state jsonb not null,
  request_payload jsonb not null,
  note text not null default '' check(char_length(note)<=500),
  created_at timestamptz not null default now()
);
create index if not exists hanzi_term_events_child_idx on public.hanzi_term_events(learner_id,created_at desc,id);
create index if not exists hanzi_term_events_workspace_idx on public.hanzi_term_events(workspace_id,created_at desc);
create index if not exists hanzi_term_events_family_idx on public.hanzi_term_events(family_id);
create index if not exists hanzi_term_events_actor_idx on public.hanzi_term_events(actor_user_id);

-- 仅第一次升级回填；重复运行不会把到期孩子恢复为长期授权。
insert into public.learner_hanzi_terms(learner_id,mode)
select learner_id,'permanent' from public.learner_module_access a
where a.module_key='hanzi' and a.enabled
  and not exists(select 1 from public.hanzi_term_events e where e.learner_id=a.learner_id)
on conflict do nothing;

alter table public.learner_hanzi_terms enable row level security;
alter table public.family_hanzi_billing enable row level security;
alter table public.hanzi_term_events enable row level security;
create or replace function private.can_manage_hanzi_terms(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select private.is_workspace_owner(p_workspace_id) and exists (
    select 1 from public.workspace_members m where m.workspace_id=p_workspace_id
    and m.user_id=(select auth.uid()) and m.role='owner' and m.status='active');
$$;
revoke all on function private.can_manage_hanzi_terms(uuid) from public,anon;
grant execute on function private.can_manage_hanzi_terms(uuid) to authenticated;
drop policy if exists "read child term" on public.learner_hanzi_terms;
create policy "read child term" on public.learner_hanzi_terms for select to authenticated using(private.can_access_learner(learner_id));
drop policy if exists "owner reads billing" on public.family_hanzi_billing;
create policy "owner reads billing" on public.family_hanzi_billing for select to authenticated
using(private.can_manage_hanzi_terms((select f.workspace_id from public.families f where f.id=family_id)));
drop policy if exists "owner reads term events" on public.hanzi_term_events;
create policy "owner reads term events" on public.hanzi_term_events for select to authenticated using(private.can_manage_hanzi_terms(workspace_id));
revoke all on public.learner_hanzi_terms,public.family_hanzi_billing,public.hanzi_term_events from public,anon,authenticated;
grant select on public.learner_hanzi_terms,public.family_hanzi_billing,public.hanzi_term_events to authenticated;

-- 保留既有账号/孩子开关；额外按当前数据库时间校验汉字有效期，不依赖定时任务。
create or replace function private.can_use_learner_module(p_learner_id uuid,p_module_key text)
returns boolean language sql stable security definer set search_path='' as $$
  select private.can_access_learner(p_learner_id) and exists (
    select 1 from public.learner_profiles l
    join public.families f on f.id=l.family_id
    join public.learning_workspaces w on w.id=f.workspace_id
    join public.learner_module_access a on a.learner_id=l.id and a.module_key=p_module_key
    where l.id=p_learner_id and a.enabled and f.status='active' and w.status='active'
      and private.can_use_account_module(f.workspace_id,p_module_key)
      and exists (
        select 1 from public.workspace_members member where member.workspace_id=f.workspace_id
          and member.user_id=(select auth.uid()) and member.status='active'
          and (member.role in ('owner','admin') or exists (
            select 1 from public.family_members fm where fm.family_id=f.id
              and fm.user_id=member.user_id and fm.status='active')))
      and (p_module_key<>'hanzi' or exists (
        select 1 from public.learner_hanzi_terms t where t.learner_id=l.id
        and (t.mode='permanent' or ((now() at time zone 'Asia/Shanghai')::date >= t.starts_on
          and (now() at time zone 'Asia/Shanghai')::date < t.valid_until))))
  );
$$;
revoke all on function private.can_use_learner_module(uuid,text) from public,anon;
grant execute on function private.can_use_learner_module(uuid,text) to authenticated;
create or replace function public.can_study_child_module(p_learner_id uuid,p_module_key text)
returns boolean language sql stable security invoker set search_path='' as $$
  select private.can_use_learner_module(p_learner_id,p_module_key);
$$;
revoke all on function public.can_study_child_module(uuid,text) from public,anon;
grant execute on function public.can_study_child_module(uuid,text) to authenticated;

-- 旧版汉字 RPC 的写入已有 024 触发器；为拼音和游戏补齐数据库层防线。
create or replace function private.enforce_hanzi_term_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare child_id uuid;
begin
  if tg_table_name in ('pinyin_daily_items','pinyin_daily_progress') then
    select learner_id into child_id from public.pinyin_daily_sessions where id=new.session_id;
  elsif tg_table_name='hanzi_frog_taps' then
    select learner_id into child_id from public.hanzi_frog_sessions where id=new.session_id;
  else child_id:=new.learner_id; end if;
  if not private.can_use_learner_module(child_id,'hanzi') then
    raise exception '汉字学习未开通、已暂停或已到期；学习记录仍然保留' using errcode='42501';
  end if;
  return new;
end; $$;
revoke all on function private.enforce_hanzi_term_write() from public,anon,authenticated;
do $$ declare tab text; begin
  foreach tab in array array['pinyin_states','pinyin_daily_sessions','pinyin_daily_items','pinyin_daily_progress','pinyin_attempts','pinyin_introductions','hanzi_frog_sessions','hanzi_frog_taps'] loop
    if to_regclass('public.'||tab) is not null then
      execute format('drop trigger if exists enforce_hanzi_term_write on public.%I',tab);
      execute format('create trigger enforce_hanzi_term_write before insert or update on public.%I for each row execute function private.enforce_hanzi_term_write()',tab);
    end if;
  end loop;
end $$;

-- 原有“开通”按钮不再能绕过期限管理为全新孩子隐式创建长期权限。
create or replace function private.guard_hanzi_access_enable()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.module_key='hanzi' and new.enabled and not exists(select 1 from public.learner_hanzi_terms where learner_id=new.learner_id) then
    raise exception '请先在家庭与孩子详情中设置汉字学习有效期';
  end if;
  return new;
end; $$;
revoke all on function private.guard_hanzi_access_enable() from public,anon,authenticated;
drop trigger if exists guard_hanzi_access_enable on public.learner_module_access;
create trigger guard_hanzi_access_enable before insert or update on public.learner_module_access
for each row execute function private.guard_hanzi_access_enable();

-- 当前应用不提供跨家庭迁移孩子；避免从 REST 偷改 family_id 造成价格/账单归属错位。
create or replace function private.guard_licensed_child_family()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.family_id is distinct from old.family_id and (
    exists(select 1 from public.learner_hanzi_terms where learner_id=old.id)
    or exists(select 1 from public.family_hanzi_billing where standard_learner_id=old.id)
    or exists(select 1 from public.hanzi_term_events where learner_id=old.id)) then
    raise exception '已有汉字授权或收款记录的孩子不能直接更换家庭，请由 owner 核查后进行受控迁移';
  end if;
  return new;
end; $$;
revoke all on function private.guard_licensed_child_family() from public,anon,authenticated;
drop trigger if exists guard_licensed_child_family on public.learner_profiles;
create trigger guard_licensed_child_family before update of family_id on public.learner_profiles
for each row execute function private.guard_licensed_child_family();

create or replace function private.owner_manage_hanzi_term(
  p_workspace_id uuid,p_learner_id uuid,p_action text,p_months integer,p_enabled boolean,
  p_standard_learner_id uuid,p_expected_version integer,p_expected_cents integer,p_note text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  child public.learner_profiles%rowtype; family public.families%rowtype;
  current_term public.learner_hanzi_terms%rowtype; prior public.hanzi_term_events%rowtype;
  billing public.family_hanzi_billing%rowtype;
  today date:=(now() at time zone 'Asia/Shanghai')::date;
  term_end date; term_start date; unit_cents integer:=0; cents integer:=0; old_enabled boolean:=false;
  payload jsonb; old_state jsonb; new_state jsonb;
begin
  if p_request_id is null or p_enabled is null or p_action is null or p_action not in ('term','permanent','enabled') then raise exception '授权参数无效'; end if;
  if not private.can_manage_hanzi_terms(p_workspace_id) then raise exception '只有 owner 可以管理学习有效期' using errcode='42501'; end if;
  if char_length(coalesce(p_note,''))>500 then raise exception '备注最多500字'; end if;
  payload:=jsonb_build_object('workspace',p_workspace_id,'learner',p_learner_id,'action',p_action,'months',p_months,'enabled',p_enabled,'standard',p_standard_learner_id,'version',p_expected_version,'cents',p_expected_cents,'note',coalesce(p_note,''));
  -- 同请求串行；即使网络重试，也只写一条授权和一条流水。
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,38));
  select * into prior from public.hanzi_term_events where request_id=p_request_id;
  if found then
    if prior.actor_user_id<>(select auth.uid()) or prior.request_payload<>payload then raise exception '该请求编号已用于其他操作'; end if;
    return prior.after_state || jsonb_build_object('duplicate',true);
  end if;
  select * into child from public.learner_profiles where id=p_learner_id;
  if not found then raise exception '找不到孩子'; end if;
  -- 家庭 → 孩子，所有授权请求遵循同一锁顺序。
  select * into family from public.families where id=child.family_id and workspace_id=p_workspace_id for update;
  if not found then raise exception '孩子不属于当前空间'; end if;
  perform 1 from public.learner_profiles where id=p_learner_id and family_id=family.id for update;
  if not found then raise exception '孩子的家庭已变化，请刷新后重试'; end if;
  select * into current_term from public.learner_hanzi_terms where learner_id=p_learner_id for update;
  if p_expected_version is distinct from coalesce(current_term.version,0) then raise exception '授权已被更新，请刷新后核对，本次未重复延期'; end if;
  select enabled into old_enabled from public.learner_module_access where learner_id=p_learner_id and module_key='hanzi' for update;
  old_enabled:=coalesce(old_enabled,false);
  old_state:=jsonb_build_object('mode',current_term.mode,'starts_on',current_term.starts_on,'valid_until',current_term.valid_until,'version',coalesce(current_term.version,0),'enabled',old_enabled);
  if p_action='term' then
    if p_months is null or p_months not in (3,6,12) then raise exception '请选择季度、半年或一年'; end if;
    select * into billing from public.family_hanzi_billing where family_id=family.id;
    if not found then
      if not exists(select 1 from public.learner_profiles where id=p_standard_learner_id and family_id=family.id) then raise exception '请选择本家庭的原价孩子'; end if;
      insert into public.family_hanzi_billing(family_id,standard_learner_id) values(family.id,p_standard_learner_id) returning * into billing;
    elsif billing.standard_learner_id is distinct from p_standard_learner_id then raise exception '家庭原价孩子已固定，请刷新后重新核对'; end if;
    unit_cents:=case when billing.standard_learner_id=p_learner_id then 1000 else 800 end;
    cents:=unit_cents*p_months;
    if p_expected_cents is distinct from cents then raise exception '金额已变化，请重新核对'; end if;
    term_start:=case when current_term.mode='term' and current_term.valid_until>today then current_term.starts_on else today end;
    term_end:=((case when current_term.mode='term' and current_term.valid_until>today then current_term.valid_until else today end)::timestamp + make_interval(months=>p_months))::date;
    insert into public.learner_hanzi_terms(learner_id,mode,starts_on,valid_until,updated_by)
    values(p_learner_id,'term',term_start,term_end,(select auth.uid()))
    on conflict(learner_id) do update set mode='term',starts_on=excluded.starts_on,valid_until=excluded.valid_until,version=learner_hanzi_terms.version+1,updated_at=now(),updated_by=excluded.updated_by;
  elsif p_action='permanent' then
    if coalesce(p_expected_cents,0)<>0 then raise exception '长期授权不记录收费'; end if;
    insert into public.learner_hanzi_terms(learner_id,mode,updated_by) values(p_learner_id,'permanent',(select auth.uid()))
    on conflict(learner_id) do update set mode='permanent',starts_on=null,valid_until=null,version=learner_hanzi_terms.version+1,updated_at=now(),updated_by=excluded.updated_by;
  else
    if current_term.learner_id is null then raise exception '请先设置有效期'; end if;
    if coalesce(p_expected_cents,0)<>0 then raise exception '暂停或恢复不收费'; end if;
    update public.learner_hanzi_terms set version=version+1,updated_at=now(),updated_by=(select auth.uid()) where learner_id=p_learner_id;
  end if;
  -- p_enabled 是 owner 独立确认的开关，前端续期默认沿用旧值；不触碰账号或家庭状态。
  insert into public.learner_module_access(learner_id,module_key,enabled,updated_by,updated_at)
  values(p_learner_id,'hanzi',p_enabled,(select auth.uid()),now())
  on conflict(learner_id,module_key) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now();
  select to_jsonb(t)||jsonb_build_object('enabled',p_enabled,'amount_cents',cents,'monthly_cents',unit_cents)
  into new_state from public.learner_hanzi_terms t where learner_id=p_learner_id;
  insert into public.hanzi_term_events(request_id,workspace_id,family_id,learner_id,actor_user_id,action,months,monthly_cents,amount_cents,before_state,after_state,request_payload,note)
  values(p_request_id,p_workspace_id,family.id,p_learner_id,(select auth.uid()),p_action,case when p_action='term' then p_months end,nullif(unit_cents,0),cents,old_state,new_state,payload,coalesce(p_note,''));
  return new_state;
end; $$;
revoke all on function private.owner_manage_hanzi_term(uuid,uuid,text,integer,boolean,uuid,integer,integer,text,uuid) from public,anon;
grant execute on function private.owner_manage_hanzi_term(uuid,uuid,text,integer,boolean,uuid,integer,integer,text,uuid) to authenticated;
create or replace function public.owner_manage_hanzi_term(
  p_workspace_id uuid,p_learner_id uuid,p_action text,p_months integer,p_enabled boolean,
  p_standard_learner_id uuid,p_expected_version integer,p_expected_cents integer,p_note text,p_request_id uuid
) returns jsonb language sql security invoker set search_path='' as $$
  select private.owner_manage_hanzi_term(p_workspace_id,p_learner_id,p_action,p_months,p_enabled,p_standard_learner_id,p_expected_version,p_expected_cents,p_note,p_request_id);
$$;
revoke all on function public.owner_manage_hanzi_term(uuid,uuid,text,integer,boolean,uuid,integer,integer,text,uuid) from public,anon;
grant execute on function public.owner_manage_hanzi_term(uuid,uuid,text,integer,boolean,uuid,integer,integer,text,uuid) to authenticated;
-- 已学记录打印属于只读历史；到期仍可打印。未来新字计划仍要求有效授权。
create or replace function public.get_hanzi_print_sheet(
  p_learner_id uuid, p_mode text default 'all', p_only_unmastered boolean default false
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_timezone text; v_today date; v_result jsonb;
begin
  if not private.can_access_learner(p_learner_id) then
    raise exception '没有查看这位孩子汉字记录的权限' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('all', 'recent30', 'recent60', 'ongoing') then
    raise exception '打印范围无效' using errcode = '22023';
  end if;
  select learner.timezone into v_timezone from public.learner_profiles learner where learner.id = p_learner_id;
  v_today := (now() at time zone coalesce(v_timezone, 'Asia/Shanghai'))::date;
  with assigned as (
    select link.character_id, min(assignment.assignment_order) as package_order,
      min(link.sequence) as sequence
    from public.learner_content_packages assignment
    join public.content_packages book on book.id = assignment.package_id
      and book.status = 'published' and book.review_status = 'approved'
    join public.package_characters link on link.package_id = book.id
    where assignment.learner_id = p_learner_id and assignment.assignment_status = 'active'
    group by link.character_id
  ), practiced as (
    select attempt.character_id, count(*)::integer as attempt_count,
      max(attempt.answered_at) as last_answered_at
    from public.learning_attempts attempt
    where attempt.learner_id = p_learner_id
    group by attempt.character_id
  ), ranked as (
    select word.id, word.character as hanzi,
      sum(practiced.attempt_count) over (partition by word.character)::integer as attempt_count,
      practiced.last_answered_at, coalesce(state.stage, 0)::smallint as stage,
      state.due_at,
      min(assigned.package_order) over (partition by word.character) as package_order,
      min(assigned.sequence) over (partition by word.character) as sequence,
      row_number() over (partition by word.character order by practiced.last_answered_at desc, word.id) as rank_number
    from practiced
    join public.characters word on word.id = practiced.character_id
    left join assigned on assigned.character_id = word.id
    left join public.learning_states state
      on state.learner_id = p_learner_id and state.character_id = word.id
  ), base as (
    select ranked.id, ranked.hanzi, ranked.attempt_count, ranked.last_answered_at,
      ranked.stage, ranked.due_at, ranked.package_order, ranked.sequence
    from ranked where ranked.rank_number = 1
  ), filtered as (
    select * from base item where
      (p_mode = 'all'
        or (p_mode = 'recent30' and (item.last_answered_at at time zone coalesce(v_timezone, 'Asia/Shanghai'))::date >= v_today - 29)
        or (p_mode = 'recent60' and (item.last_answered_at at time zone coalesce(v_timezone, 'Asia/Shanghai'))::date >= v_today - 59)
        or (p_mode = 'ongoing' and item.stage < 7))
      and (not p_only_unmastered or item.stage < 7)
  )
  select jsonb_build_object(
    'printed_on', v_today,
    'learned_total', (select count(*) from base),
    'selected_total', count(*),
    'stable_total', count(*) filter (where item.stage between 5 and 6),
    'mastered_total', count(*) filter (where item.stage = 7),
    'due_total', count(*) filter (where item.due_at <= now()),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', item.id, 'hanzi', item.hanzi, 'stage', item.stage,
      'attempt_count', item.attempt_count, 'due', coalesce(item.due_at <= now(), false),
      'last_answered_at', item.last_answered_at
    ) order by item.package_order, item.sequence, item.hanzi), '[]'::jsonb)
  ) into v_result from filtered item;
  return v_result;
end;
$$;
revoke all on function public.get_hanzi_print_sheet(uuid,text,boolean) from public,anon;
grant execute on function public.get_hanzi_print_sheet(uuid,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
