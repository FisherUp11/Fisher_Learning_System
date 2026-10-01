-- 025 · 家中箴言。请先运行 001–024；在 Supabase SQL Editor 整段执行。
-- 新模块默认不开通，不回填任何家庭私有内容，也不修改旧学习历史。
begin;

alter table public.account_module_access drop constraint if exists account_module_access_module_key_check;
alter table public.account_module_access add constraint account_module_access_module_key_check
  check (module_key in ('hanzi','poem','music','catechism','kids_english','adult_english','exercise','family_maxims'));
alter table public.learner_module_access drop constraint if exists learner_module_access_module_key_check;
alter table public.learner_module_access add constraint learner_module_access_module_key_check
  check (module_key in ('hanzi','poem','music','catechism','kids_english','family_maxims'));

create or replace function public.owner_set_module_access(p_workspace_id uuid,p_user_id uuid,p_learner_id uuid,p_module_key text,p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.workspace_members member where member.workspace_id=p_workspace_id and member.user_id=(select auth.uid()) and member.role='owner' and member.status='active') then
    raise exception '只有 owner 可以开通模块' using errcode='42501';
  end if;
  if p_learner_id is null then
    if p_module_key not in ('hanzi','poem','music','catechism','kids_english','adult_english','exercise','family_maxims') then raise exception '模块无效'; end if;
    if not exists(select 1 from public.workspace_members member where member.workspace_id=p_workspace_id and member.user_id=p_user_id and member.status='active') then raise exception '账号不属于当前空间'; end if;
    if p_user_id=(select auth.uid()) and not p_enabled then raise exception 'owner 不能关闭自己的模块'; end if;
    insert into public.account_module_access(workspace_id,user_id,module_key,enabled,updated_by,updated_at)
    values(p_workspace_id,p_user_id,p_module_key,p_enabled,(select auth.uid()),now())
    on conflict(workspace_id,user_id,module_key) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now();
  else
    if p_module_key not in ('hanzi','poem','music','catechism','kids_english','family_maxims') then raise exception '孩子模块无效'; end if;
    if not exists(select 1 from public.learner_profiles learner join public.families family on family.id=learner.family_id where learner.id=p_learner_id and family.workspace_id=p_workspace_id) then raise exception '孩子不属于当前空间'; end if;
    insert into public.learner_module_access(learner_id,module_key,enabled,updated_by,updated_at)
    values(p_learner_id,p_module_key,p_enabled,(select auth.uid()),now())
    on conflict(learner_id,module_key) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now();
  end if;
  insert into public.workspace_audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,details)
  values(p_workspace_id,(select auth.uid()),'module.access.changed',case when p_learner_id is null then 'account' else 'learner' end,coalesce(p_learner_id,p_user_id),jsonb_build_object('module',p_module_key,'enabled',p_enabled));
end; $$;
revoke all on function public.owner_set_module_access(uuid,uuid,uuid,text,boolean) from public,anon;
grant execute on function public.owner_set_module_access(uuid,uuid,uuid,text,boolean) to authenticated;

-- 与 private.can_read_family 不同：空间管理员不能越过家庭边界查看私有箴言。
create or replace function private.can_use_family_maxims(p_family_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.family_members fm
    join public.families f on f.id=fm.family_id
    join public.workspace_members wm on wm.workspace_id=f.workspace_id and wm.user_id=fm.user_id
    join public.account_module_access ma on ma.workspace_id=f.workspace_id and ma.user_id=fm.user_id and ma.module_key='family_maxims'
    where fm.family_id=p_family_id and fm.user_id=(select auth.uid()) and fm.status='active'
      and f.status='active' and wm.status='active' and ma.enabled
  );
$$;
revoke all on function private.can_use_family_maxims(uuid) from public,anon;
grant execute on function private.can_use_family_maxims(uuid) to authenticated;

create table if not exists public.family_maxims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.learning_workspaces(id) on delete restrict,
  family_id uuid not null references public.families(id) on delete restrict,
  text_zh text not null check (char_length(text_zh) between 1 and 1200),
  text_en text not null check (char_length(text_en) between 1 and 2000),
  source_title text not null default '' check (char_length(source_title)<=160),
  source_detail text not null default '' check (char_length(source_detail)<=160),
  translation_version text not null default '' check (char_length(translation_version)<=120),
  explanation_zh text not null default '' check (char_length(explanation_zh)<=2000),
  child_explanation_zh text not null default '' check (char_length(child_explanation_zh)<=800),
  tags text not null default '' check (char_length(tags)<=200),
  fingerprint text not null check (char_length(fingerprint)=64),
  imported_from_share_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id,fingerprint)
);
create index if not exists family_maxims_family_idx on public.family_maxims(family_id,archived_at,created_at desc);

create table if not exists public.family_maxim_reflections (
  id uuid primary key default gen_random_uuid(),
  maxim_id uuid not null references public.family_maxims(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(body) between 1 and 3000),
  show_to_child boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists family_maxim_reflections_item_idx on public.family_maxim_reflections(maxim_id,created_at desc);

create table if not exists public.learner_family_maxims (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  maxim_id uuid not null references public.family_maxims(id) on delete restrict,
  active boolean not null default true,
  linked_at timestamptz not null default now(),
  primary key (learner_id,maxim_id)
);
create index if not exists learner_family_maxims_item_idx on public.learner_family_maxims(maxim_id,active);

create table if not exists public.family_maxim_learning_settings (
  learner_id uuid primary key references public.learner_profiles(id) on delete cascade,
  daily_new_limit smallint not null default 1 check(daily_new_limit between 0 and 5),
  review_limit smallint not null default 3 check(review_limit between 1 and 20),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_maxim_states (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  maxim_id uuid not null references public.family_maxims(id) on delete restrict,
  language text not null check(language in ('zh','en')),
  stage smallint not null default 0 check(stage between 0 and 5),
  due_on date,
  total_attempts integer not null default 0,
  independent_days integer not null default 0,
  last_independent_on date,
  last_downgrade_on date,
  last_result text check(last_result in ('read','prompted','independent','again')),
  last_practiced_at timestamptz,
  primary key(learner_id,maxim_id,language)
);
create index if not exists family_maxim_states_due_idx on public.family_maxim_states(learner_id,language,due_on);

create table if not exists public.family_maxim_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  maxim_id uuid not null references public.family_maxims(id) on delete restrict,
  language text not null check(language in ('zh','en')),
  result text not null check(result in ('read','prompted','independent','again')),
  assisted boolean not null default false,
  stage_before smallint not null,
  stage_after smallint not null,
  practiced_local_date date not null,
  practiced_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id) on delete restrict
);
create index if not exists family_maxim_attempts_history_idx on public.family_maxim_attempts(learner_id,maxim_id,language,practiced_at desc);
create index if not exists family_maxim_attempts_date_idx on public.family_maxim_attempts(learner_id,practiced_local_date);

create table if not exists public.family_maxim_shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.learning_workspaces(id) on delete restrict,
  source_maxim_id uuid not null references public.family_maxims(id) on delete restrict,
  source_family_id uuid not null references public.families(id) on delete restrict,
  published_by uuid not null references auth.users(id) on delete restrict,
  text_zh text not null,
  text_en text not null,
  source_title text not null default '',
  source_detail text not null default '',
  translation_version text not null default '',
  explanation_zh text not null default '',
  fingerprint text not null,
  status text not null default 'pending' check(status in ('pending','approved','rejected','withdrawn')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists family_maxim_shares_feed_idx on public.family_maxim_shares(workspace_id,status,created_at desc);
create unique index if not exists family_maxim_shares_one_live_idx on public.family_maxim_shares(source_maxim_id) where status in ('pending','approved');
alter table public.family_maxims add constraint family_maxims_imported_from_share_fk foreign key(imported_from_share_id) references public.family_maxim_shares(id) on delete set null;

create or replace function public.family_maxim_integrity_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare shared public.family_maxim_shares%rowtype;
begin
  if tg_op='UPDATE' then
    if row(new.id,new.workspace_id,new.family_id,new.created_by,new.imported_from_share_id)
       is distinct from row(old.id,old.workspace_id,old.family_id,old.created_by,old.imported_from_share_id) then raise exception '箴言归属和来源不能修改'; end if;
  elsif new.imported_from_share_id is not null then
    select * into shared from public.family_maxim_shares where id=new.imported_from_share_id;
    if shared.id is null or shared.status<>'approved' or shared.workspace_id<>new.workspace_id
       or row(new.text_zh,new.text_en,new.source_title,new.source_detail,new.translation_version,new.explanation_zh,new.fingerprint)
          is distinct from row(shared.text_zh,shared.text_en,shared.source_title,shared.source_detail,shared.translation_version,shared.explanation_zh,shared.fingerprint) then
      raise exception '只能收入仍在共享区、内容未改动的箴言';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.family_maxim_integrity_guard() from public,anon,authenticated;
drop trigger if exists family_maxim_integrity_guard_trg on public.family_maxims;
create trigger family_maxim_integrity_guard_trg before insert or update on public.family_maxims for each row execute function public.family_maxim_integrity_guard();

create or replace function private.can_study_family_maxim(p_learner_id uuid,p_maxim_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.learner_profiles learner
    join public.family_maxims maxim on maxim.family_id=learner.family_id
    join public.learner_family_maxims assignment on assignment.learner_id=learner.id and assignment.maxim_id=maxim.id
    join public.learner_module_access child_access on child_access.learner_id=learner.id and child_access.module_key='family_maxims'
    where learner.id=p_learner_id and maxim.id=p_maxim_id and maxim.archived_at is null
      and assignment.active and child_access.enabled and private.can_use_family_maxims(learner.family_id)
  );
$$;
revoke all on function private.can_study_family_maxim(uuid,uuid) from public,anon;
grant execute on function private.can_study_family_maxim(uuid,uuid) to authenticated;

alter table public.family_maxims enable row level security;
alter table public.family_maxim_reflections enable row level security;
alter table public.learner_family_maxims enable row level security;
alter table public.family_maxim_learning_settings enable row level security;
alter table public.family_maxim_states enable row level security;
alter table public.family_maxim_attempts enable row level security;
alter table public.family_maxim_shares enable row level security;
revoke all on public.family_maxims,public.family_maxim_reflections,public.learner_family_maxims,public.family_maxim_learning_settings,public.family_maxim_states,public.family_maxim_attempts,public.family_maxim_shares from public,anon,authenticated;
grant select,insert,update on public.family_maxims,public.family_maxim_reflections,public.learner_family_maxims,public.family_maxim_learning_settings to authenticated;
grant select on public.family_maxim_states,public.family_maxim_attempts to authenticated;
grant select,insert,update on public.family_maxim_shares to authenticated;

create policy family_maxims_read on public.family_maxims for select to authenticated using (private.can_use_family_maxims(family_id));
create policy family_maxims_insert on public.family_maxims for insert to authenticated with check (
  private.can_use_family_maxims(family_id) and created_by=(select auth.uid()) and
  exists(select 1 from public.families f where f.id=family_id and f.workspace_id=family_maxims.workspace_id)
);
create policy family_maxims_update on public.family_maxims for update to authenticated
using(private.can_use_family_maxims(family_id))
with check(private.can_use_family_maxims(family_id) and exists(select 1 from public.families f where f.id=family_id and f.workspace_id=family_maxims.workspace_id));

create policy family_reflections_read on public.family_maxim_reflections for select to authenticated using (
  exists(select 1 from public.family_maxims m where m.id=maxim_id and private.can_use_family_maxims(m.family_id))
);
create policy family_reflections_insert on public.family_maxim_reflections for insert to authenticated with check (
  author_user_id=(select auth.uid()) and exists(select 1 from public.family_maxims m where m.id=maxim_id and m.archived_at is null and private.can_use_family_maxims(m.family_id))
);
create policy family_reflections_update on public.family_maxim_reflections for update to authenticated
using(author_user_id=(select auth.uid()) and exists(select 1 from public.family_maxims m where m.id=maxim_id and private.can_use_family_maxims(m.family_id)))
with check(author_user_id=(select auth.uid()) and exists(select 1 from public.family_maxims m where m.id=maxim_id and private.can_use_family_maxims(m.family_id)));

create policy family_assignments_read on public.learner_family_maxims for select to authenticated using (
  exists(select 1 from public.family_maxims m join public.learner_profiles l on l.family_id=m.family_id where m.id=maxim_id and l.id=learner_id and private.can_use_family_maxims(m.family_id))
);
create policy family_assignments_insert on public.learner_family_maxims for insert to authenticated with check(
  exists(select 1 from public.family_maxims m join public.learner_profiles l on l.family_id=m.family_id
    join public.learner_module_access ca on ca.learner_id=l.id and ca.module_key='family_maxims' and ca.enabled
    where m.id=maxim_id and m.archived_at is null and l.id=learner_id and private.can_use_family_maxims(m.family_id))
);
create policy family_assignments_update on public.learner_family_maxims for update to authenticated
using(exists(select 1 from public.family_maxims m join public.learner_profiles l on l.family_id=m.family_id where m.id=maxim_id and l.id=learner_id and private.can_use_family_maxims(m.family_id)))
with check(exists(select 1 from public.family_maxims m join public.learner_profiles l on l.family_id=m.family_id join public.learner_module_access ca on ca.learner_id=l.id and ca.module_key='family_maxims' and ca.enabled where m.id=maxim_id and l.id=learner_id and private.can_use_family_maxims(m.family_id)));

create policy family_settings_read on public.family_maxim_learning_settings for select to authenticated using (
  exists(select 1 from public.learner_profiles l where l.id=learner_id and private.can_use_family_maxims(l.family_id))
);
create policy family_settings_insert on public.family_maxim_learning_settings for insert to authenticated with check (
  exists(select 1 from public.learner_profiles l join public.learner_module_access ca on ca.learner_id=l.id and ca.module_key='family_maxims' and ca.enabled where l.id=learner_id and private.can_use_family_maxims(l.family_id))
);
create policy family_settings_update on public.family_maxim_learning_settings for update to authenticated
using(exists(select 1 from public.learner_profiles l where l.id=learner_id and private.can_use_family_maxims(l.family_id)))
with check(exists(select 1 from public.learner_profiles l join public.learner_module_access ca on ca.learner_id=l.id and ca.module_key='family_maxims' and ca.enabled where l.id=learner_id and private.can_use_family_maxims(l.family_id)));

create policy family_states_read on public.family_maxim_states for select to authenticated using (
  exists(select 1 from public.family_maxims m join public.learner_profiles l on l.family_id=m.family_id where m.id=maxim_id and l.id=learner_id and private.can_use_family_maxims(m.family_id))
);
create policy family_attempts_read on public.family_maxim_attempts for select to authenticated using (
  exists(select 1 from public.family_maxims m join public.learner_profiles l on l.family_id=m.family_id where m.id=maxim_id and l.id=learner_id and private.can_use_family_maxims(m.family_id))
);

create policy family_shares_read on public.family_maxim_shares for select to authenticated using (
  (status='approved' and private.is_workspace_member(workspace_id) and private.can_use_account_module(workspace_id,'family_maxims'))
  or private.can_use_family_maxims(source_family_id)
  or private.is_workspace_admin(workspace_id)
);
create policy family_shares_insert on public.family_maxim_shares for insert to authenticated with check (
  published_by=(select auth.uid()) and status='pending' and private.can_use_family_maxims(source_family_id)
  and exists(select 1 from public.family_maxims m where m.id=source_maxim_id and m.family_id=source_family_id and m.workspace_id=family_maxim_shares.workspace_id and m.archived_at is null)
);
create policy family_shares_update on public.family_maxim_shares for update to authenticated
using(private.is_workspace_admin(workspace_id) or private.can_use_family_maxims(source_family_id))
with check(private.is_workspace_admin(workspace_id) or private.can_use_family_maxims(source_family_id));

-- 一次 CSV 请求只有一个事务：如果某行或感悟写入失败，整份文件回滚。
create or replace function public.import_family_maxims(p_family_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item jsonb; inserted_id uuid; workspace uuid; added integer:=0; skipped integer:=0;
begin
  if not private.can_use_family_maxims(p_family_id) then raise exception '没有这个家庭的箴言录入权限' using errcode='42501'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>200 then raise exception '一次只能导入 1～200 条'; end if;
  select f.workspace_id into workspace from public.families f where f.id=p_family_id;
  for item in select value from jsonb_array_elements(p_rows) loop
    if coalesce(item->>'text_zh','')='' or coalesce(item->>'text_en','')='' or char_length(coalesce(item->>'fingerprint',''))<>64 then raise exception '导入内容缺少中英文或标识'; end if;
    insert into public.family_maxims(workspace_id,family_id,text_zh,text_en,source_title,source_detail,translation_version,explanation_zh,child_explanation_zh,tags,fingerprint,created_by)
    values(workspace,p_family_id,item->>'text_zh',item->>'text_en',coalesce(item->>'source_title',''),coalesce(item->>'source_detail',''),coalesce(item->>'translation_version',''),coalesce(item->>'explanation_zh',''),coalesce(item->>'child_explanation_zh',''),coalesce(item->>'tags',''),item->>'fingerprint',(select auth.uid()))
    on conflict(family_id,fingerprint) do nothing returning id into inserted_id;
    if inserted_id is null then skipped=skipped+1;
    else
      added=added+1;
      if nullif(btrim(coalesce(item->>'reflection','')),'') is not null then
        insert into public.family_maxim_reflections(maxim_id,author_user_id,body,show_to_child)
        values(inserted_id,(select auth.uid()),item->>'reflection',false);
      end if;
    end if;
    inserted_id=null;
  end loop;
  return jsonb_build_object('added',added,'skipped',skipped);
end; $$;
revoke all on function public.import_family_maxims(uuid,jsonb) from public,anon;
grant execute on function public.import_family_maxims(uuid,jsonb) to authenticated;

-- 只允许家长撤回、管理员审核；正文快照必须来自源条目，不能从 API 换成私人备注。
create or replace function public.family_maxim_share_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare source_row public.family_maxims%rowtype;
begin
  if tg_op='INSERT' then
    select * into source_row from public.family_maxims where id=new.source_maxim_id;
    if source_row.id is null or source_row.family_id<>new.source_family_id or source_row.workspace_id<>new.workspace_id then raise exception '分享来源无效'; end if;
    if new.text_zh<>source_row.text_zh or new.text_en<>source_row.text_en or new.source_title<>source_row.source_title or new.source_detail<>source_row.source_detail or new.translation_version<>source_row.translation_version or new.fingerprint<>source_row.fingerprint then raise exception '分享内容必须与源条目一致'; end if;
    if new.explanation_zh<>'' and new.explanation_zh<>source_row.explanation_zh then raise exception '公开解释必须来自源条目'; end if;
  else
    if row(new.id,new.created_at,new.workspace_id,new.source_maxim_id,new.source_family_id,new.published_by,new.text_zh,new.text_en,new.source_title,new.source_detail,new.translation_version,new.explanation_zh,new.fingerprint)
       is distinct from row(old.id,old.created_at,old.workspace_id,old.source_maxim_id,old.source_family_id,old.published_by,old.text_zh,old.text_en,old.source_title,old.source_detail,old.translation_version,old.explanation_zh,old.fingerprint) then raise exception '分享快照不能修改，请重新分享'; end if;
    if private.can_use_family_maxims(old.source_family_id) and old.status in ('pending','approved') and new.status='withdrawn' then
      new.reviewed_by=old.reviewed_by; new.reviewed_at=old.reviewed_at;
    elsif private.is_workspace_admin(old.workspace_id) and old.status='pending' and new.status in ('approved','rejected') then
      new.reviewed_by=(select auth.uid()); new.reviewed_at=now();
    else raise exception '只有管理员可审核，分享者只能撤回'; end if;
  end if;
  return new;
end; $$;
revoke all on function public.family_maxim_share_guard() from public,anon,authenticated;
drop trigger if exists family_maxim_share_guard_trg on public.family_maxim_shares;
create trigger family_maxim_share_guard_trg before insert or update on public.family_maxim_shares for each row execute function public.family_maxim_share_guard();

-- 每次背诵写一条不可变事实；同一天可以多次练，记忆阶段一天最多上/下一次。
create or replace function public.record_family_maxim_attempt(p_learner_id uuid,p_maxim_id uuid,p_language text,p_result text,p_assisted boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.family_maxim_states%rowtype; v_day date; v_before int; v_after int; v_due date; v_result text; v_timezone text;
begin
  if (select auth.uid()) is null or not private.can_study_family_maxim(p_learner_id,p_maxim_id) then raise exception '没有这条箴言的学习权限' using errcode='42501'; end if;
  if p_language not in ('zh','en') or p_result not in ('read','prompted','independent','again') or p_request_id is null then raise exception '背诵参数无效'; end if;
  if exists(select 1 from public.family_maxim_attempts where request_id=p_request_id) then return jsonb_build_object('idempotent',true); end if;
  select learner.timezone into v_timezone from public.learner_profiles learner where learner.id=p_learner_id;
  v_day=(now() at time zone coalesce(v_timezone,'Asia/Shanghai'))::date;
  insert into public.family_maxim_states(learner_id,maxim_id,language) values(p_learner_id,p_maxim_id,p_language) on conflict do nothing;
  select * into s from public.family_maxim_states where learner_id=p_learner_id and maxim_id=p_maxim_id and language=p_language for update;
  if exists(select 1 from public.family_maxim_attempts where request_id=p_request_id) then return jsonb_build_object('idempotent',true); end if;
  v_before=s.stage;
  v_result=case when p_result='independent' and p_assisted then 'prompted' else p_result end;
  v_after=s.stage;
  if v_result='independent' and s.last_independent_on is distinct from v_day then
    v_after=least(5,s.stage+1);
  elsif v_result='again' and s.last_downgrade_on is distinct from v_day and s.last_independent_on is distinct from v_day then
    v_after=greatest(0,s.stage-1);
  end if;
  v_due=case when v_result='independent' then v_day + (array[1,1,3,7,14,30])[v_after+1] else v_day+1 end;
  update public.family_maxim_states set stage=v_after,due_on=v_due,total_attempts=s.total_attempts+1,
    independent_days=s.independent_days+case when v_result='independent' and s.last_independent_on is distinct from v_day then 1 else 0 end,
    last_independent_on=case when v_result='independent' then v_day else s.last_independent_on end,
    last_downgrade_on=case when v_result='again' then v_day else s.last_downgrade_on end,
    last_result=v_result,last_practiced_at=now()
  where learner_id=p_learner_id and maxim_id=p_maxim_id and language=p_language;
  insert into public.family_maxim_attempts(request_id,learner_id,maxim_id,language,result,assisted,stage_before,stage_after,practiced_local_date,recorded_by)
  values(p_request_id,p_learner_id,p_maxim_id,p_language,v_result,p_assisted,v_before,v_after,v_day,(select auth.uid()));
  return jsonb_build_object('stage',v_after,'due_on',v_due,'result',v_result,'idempotent',false);
end; $$;
revoke all on function public.record_family_maxim_attempt(uuid,uuid,text,text,boolean,uuid) from public,anon;
grant execute on function public.record_family_maxim_attempt(uuid,uuid,text,text,boolean,uuid) to authenticated;

commit;
