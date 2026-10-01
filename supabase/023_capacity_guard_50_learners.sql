-- Run after 021 and 022 in Supabase SQL Editor, before deploying the matching app version.
-- Keeps the existing learning rules intact. All 50 children are counted, including children
-- in suspended families, so a family status change cannot silently bypass the ceiling.
begin;

create or replace function private.enforce_workspace_learner_ceiling()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid;
  v_count integer;
begin
  if tg_op = 'UPDATE' then
    if old.family_id = new.family_id then return new; end if;
  end if;
  select family.workspace_id into v_workspace from public.families family where family.id = new.family_id;
  if v_workspace is null then raise exception '孩子必须属于一个有效家庭' using errcode = '23503'; end if;
  -- Serialize inserts/moves within one workspace; a client-side count alone has a race.
  perform pg_catalog.pg_advisory_xact_lock(7101, pg_catalog.hashtext(v_workspace::text));
  select count(*) into v_count
  from public.learner_profiles learner
  join public.families family on family.id = learner.family_id
  where family.workspace_id = v_workspace and learner.id is distinct from new.id;
  if v_count >= 50 then
    raise exception '当前学习空间已达到 50 个孩子档案的上限。请联系 owner 评估容量。' using errcode = 'P0001';
  end if;
  return new;
end; $$;

drop trigger if exists enforce_workspace_learner_ceiling on public.learner_profiles;
create trigger enforce_workspace_learner_ceiling
before insert or update of family_id on public.learner_profiles
for each row execute function private.enforce_workspace_learner_ceiling();

-- A denied paid call is separate from provider usage: it must not be priced as a call.
create table if not exists public.service_guard_denials (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.learning_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null check (service in ('text', 'image', 'tts', 'stt')),
  reason text not null check (reason in ('workspace_minute', 'account_minute', 'workspace_day', 'account_day', 'workspace_units_day', 'account_units_day')),
  created_at timestamptz not null default now()
);
create index if not exists service_guard_denials_workspace_time
  on public.service_guard_denials (workspace_id, created_at desc);
alter table public.service_guard_denials enable row level security;
revoke all on public.service_guard_denials from public, anon, authenticated;
grant select on public.service_guard_denials to authenticated;
grant select, insert on public.service_guard_denials to service_role;
drop policy if exists "workspace admins read guard denials" on public.service_guard_denials;
create policy "workspace admins read guard denials" on public.service_guard_denials
for select to authenticated using (private.is_workspace_admin(workspace_id));

create index if not exists service_usage_workspace_service_time
  on public.service_usage_events (workspace_id, service, created_at desc);

-- Called only by the server-side Secret key. The lock makes check + reservation atomic
-- across every Vercel instance; the paid HTTP call happens after this transaction.
create or replace function public.reserve_metered_service_call(
  p_id uuid, p_workspace_id uuid, p_user_id uuid, p_learner_id uuid,
  p_feature text, p_service text, p_model text, p_characters integer, p_audio_seconds numeric,
  p_workspace_minute_limit integer, p_account_minute_limit integer,
  p_workspace_day_limit integer, p_account_day_limit integer,
  p_workspace_unit_day_limit integer, p_account_unit_day_limit integer
) returns text language plpgsql security invoker set search_path = '' as $$
declare
  v_minute timestamptz := now() - interval '60 seconds';
  v_day timestamptz := ((now() at time zone 'Asia/Shanghai')::date)::timestamp at time zone 'Asia/Shanghai';
  v_workspace_minute integer;
  v_account_minute integer;
  v_workspace_day integer;
  v_account_day integer;
  v_workspace_units numeric;
  v_account_units numeric;
  v_requested_units numeric;
  v_reason text;
begin
  if p_service is null or p_service not in ('text','image','tts','stt') or
     least(p_workspace_minute_limit, p_account_minute_limit, p_workspace_day_limit, p_account_day_limit) < 1 then
    raise exception '用量限制配置不正确' using errcode = '22023';
  end if;
  if not exists (select 1 from public.workspace_members m
                 where m.workspace_id = p_workspace_id and m.user_id = p_user_id and m.status = 'active') then
    raise exception '账号无权使用此空间的付费服务' using errcode = '42501';
  end if;
  if p_learner_id is not null and not exists (
    select 1 from public.learner_profiles l join public.families f on f.id = l.family_id
    where l.id = p_learner_id and f.workspace_id = p_workspace_id
  ) then raise exception '孩子不属于此空间' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(7102, pg_catalog.hashtext(p_workspace_id::text));
  select
    count(*) filter (where e.created_at >= v_minute),
    count(*) filter (where e.created_at >= v_minute and e.user_id = p_user_id),
    count(*) filter (where e.created_at >= v_day),
    count(*) filter (where e.created_at >= v_day and e.user_id = p_user_id),
    coalesce(sum(case when e.created_at >= v_day then
      case when p_service = 'tts' then e.characters::numeric else e.audio_seconds end else 0 end),0),
    coalesce(sum(case when e.created_at >= v_day and e.user_id = p_user_id then
      case when p_service = 'tts' then e.characters::numeric else e.audio_seconds end else 0 end),0)
  into v_workspace_minute, v_account_minute, v_workspace_day, v_account_day, v_workspace_units, v_account_units
  from public.service_usage_events e
  where e.workspace_id = p_workspace_id and e.service = p_service
    and e.created_at >= least(v_day, v_minute);
  v_requested_units := case when p_service = 'tts' then greatest(coalesce(p_characters,0),0) else greatest(coalesce(p_audio_seconds,0),0) end;

  v_reason := case
    when v_workspace_minute >= p_workspace_minute_limit then 'workspace_minute'
    when v_account_minute >= p_account_minute_limit then 'account_minute'
    when v_workspace_day >= p_workspace_day_limit then 'workspace_day'
    when v_account_day >= p_account_day_limit then 'account_day'
    when p_workspace_unit_day_limit is not null and v_workspace_units + v_requested_units > p_workspace_unit_day_limit then 'workspace_units_day'
    when p_account_unit_day_limit is not null and v_account_units + v_requested_units > p_account_unit_day_limit then 'account_units_day'
    else null end;
  if v_reason is not null then
    insert into public.service_guard_denials (workspace_id,user_id,service,reason)
    values (p_workspace_id,p_user_id,p_service,v_reason);
    return v_reason;
  end if;
  insert into public.service_usage_events
    (id,workspace_id,user_id,learner_id,feature,service,model,characters,audio_seconds)
  values
    (p_id,p_workspace_id,p_user_id,p_learner_id,p_feature,p_service,p_model,
     greatest(coalesce(p_characters,0),0),greatest(coalesce(p_audio_seconds,0),0));
  return 'allowed';
end; $$;
revoke all on function public.reserve_metered_service_call(uuid,uuid,uuid,uuid,text,text,text,integer,numeric,integer,integer,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.reserve_metered_service_call(uuid,uuid,uuid,uuid,text,text,text,integer,numeric,integer,integer,integer,integer,integer,integer) to service_role;

-- In-app signals. These are application events, NOT live platform billing metrics.
create or replace function public.workspace_capacity_snapshot(p_workspace_id uuid)
returns table(service text, minute_calls bigint, day_calls bigint, day_characters bigint, day_audio_seconds numeric, day_denials bigint,
              day_provider_429 bigint, last_denied_at timestamptz, last_provider_429_at timestamptz, day_peak_minute_calls bigint)
language sql stable security invoker set search_path = '' as $$
  with usage as (
    select e.service,
      count(*) filter (where e.created_at >= now() - interval '60 seconds') as minute_calls,
      count(*) as day_calls,
      coalesce(sum(e.characters),0) as day_characters,
      coalesce(sum(e.audio_seconds),0) as day_audio_seconds,
      count(*) filter (where e.http_status = 429) as day_provider_429,
      max(e.created_at) filter (where e.http_status = 429) as last_provider_429_at
    from public.service_usage_events e
    where e.workspace_id = p_workspace_id
      and e.created_at >= ((now() at time zone 'Asia/Shanghai')::date)::timestamp at time zone 'Asia/Shanghai'
    group by e.service
  ), denied as (
    select d.service, count(*) as day_denials, max(d.created_at) as last_denied_at
    from public.service_guard_denials d
    where d.workspace_id = p_workspace_id
      and d.created_at >= ((now() at time zone 'Asia/Shanghai')::date)::timestamp at time zone 'Asia/Shanghai'
    group by d.service
  ), peak as (
    select bucket.service, max(bucket.calls) as day_peak_minute_calls
    from (
      select e.service, date_trunc('minute', e.created_at) as minute_bucket, count(*) as calls
      from public.service_usage_events e
      where e.workspace_id = p_workspace_id
        and e.created_at >= ((now() at time zone 'Asia/Shanghai')::date)::timestamp at time zone 'Asia/Shanghai'
      group by e.service, date_trunc('minute', e.created_at)
    ) bucket
    group by bucket.service
  )
  select kind.service, coalesce(usage.minute_calls,0), coalesce(usage.day_calls,0),
         coalesce(usage.day_characters,0), coalesce(usage.day_audio_seconds,0),
         coalesce(denied.day_denials,0), coalesce(usage.day_provider_429,0),
         denied.last_denied_at, usage.last_provider_429_at, coalesce(peak.day_peak_minute_calls,0)
  from (values ('text'::text),('image'::text),('tts'::text),('stt'::text)) as kind(service)
  left join usage on usage.service = kind.service
  left join denied on denied.service = kind.service
  left join peak on peak.service = kind.service
  where private.is_workspace_admin(p_workspace_id);
$$;
revoke all on function public.workspace_capacity_snapshot(uuid) from public, anon;
grant execute on function public.workspace_capacity_snapshot(uuid) to authenticated;

create or replace function public.workspace_today_remaining(p_workspace_id uuid)
returns table(learner_id uuid, remaining bigint)
language sql stable security definer set search_path = '' as $$
  select learner.id, count(progress.character_id) filter (where progress.passed_at is null)
  from public.learner_profiles learner
  join public.families family on family.id = learner.family_id
  left join public.daily_sessions session on session.learner_id = learner.id
    and session.date_local = (now() at time zone learner.timezone)::date
  left join public.daily_character_progress progress on progress.session_id = session.id
  where family.workspace_id = p_workspace_id and private.is_workspace_admin(p_workspace_id)
  group by learner.id;
$$;
revoke all on function public.workspace_today_remaining(uuid) from public, anon;
grant execute on function public.workspace_today_remaining(uuid) to authenticated;

-- One exact, learner-scoped dashboard result instead of transferring every state to
-- Next.js (PostgREST's default row cap would otherwise truncate large character books).
create or replace function public.learner_dashboard_snapshot(p_learner_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
  v_result jsonb;
begin
  if not private.can_access_learner(p_learner_id) then
    raise exception '无权查看孩子概况' using errcode = '42501';
  end if;
  select (now() at time zone learner.timezone)::date into v_today
  from public.learner_profiles learner where learner.id = p_learner_id;

  with active_packages as (
    select link.package_id from public.learner_content_packages link
    join public.content_packages pack on pack.id = link.package_id
    where link.learner_id = p_learner_id and link.assignment_status = 'active'
      and pack.status = 'published' and pack.review_status = 'approved'
  ), active_characters as (
    select distinct item.character_id from public.package_characters item
    join active_packages pack on pack.package_id = item.package_id
  ), hanzi as (
    select count(*) as started, count(*) filter (where state.stage >= 5) as stable,
      count(*) filter (where state.stage >= 7) as mastered,
      count(*) filter (where state.due_at <= now()) as due
    from public.learning_states state
    join active_characters character on character.character_id = state.character_id
    where state.learner_id = p_learner_id
  ), recent as (
    select count(*) as attempts,
      count(*) filter (where attempt.result = 'known' and not attempt.assisted) as known
    from public.learning_attempts attempt
    join active_characters character on character.character_id = attempt.character_id
    where attempt.learner_id = p_learner_id and attempt.attempt_number = 1
      and attempt.answered_at >= now() - interval '7 days'
  ), progress as (
    select count(*) filter (where item.passed_at is not null) as answered,
      count(*) filter (where item.passed_at is null) as remaining
    from public.daily_sessions session
    join public.daily_character_progress item on item.session_id = session.id
    where session.learner_id = p_learner_id and session.date_local = v_today
  ), active_music as (
    select link.item_id from public.learner_music_items link
    join public.music_items item on item.id = link.item_id
    where link.learner_id = p_learner_id and link.assignment_status = 'active'
      and item.status = 'published' and item.review_status = 'approved'
  ), active_catechism as (
    select distinct item.id from public.learner_catechism_collections link
    join public.catechism_collections collection on collection.id = link.collection_id
    join public.catechism_items item on item.collection_id = link.collection_id and item.status = 'active'
    where link.learner_id = p_learner_id and link.assignment_status = 'active'
      and collection.status = 'published' and collection.review_status = 'approved'
  )
  select pg_catalog.jsonb_build_object(
    'started', hanzi.started, 'stable', hanzi.stable, 'mastered', hanzi.mastered, 'due', hanzi.due,
    'firstAttemptCount', recent.attempts,
    'firstAttemptRate', case when recent.attempts = 0 then null else round(recent.known * 100.0 / recent.attempts)::integer end,
    'todayAnswered', progress.answered, 'todayRemaining', progress.remaining,
    'assignedPackages', (select count(*) from active_packages),
    'assignedPoemCollections', (select count(*) from public.learner_poem_collections link
      join public.poem_collections collection on collection.id = link.collection_id
      where link.learner_id = p_learner_id and link.assignment_status = 'active'
        and collection.status = 'published' and collection.review_status = 'approved'),
    'assignedMusicItems', (select count(*) from active_music),
    'assignedCatechismCollections', (select count(distinct item.collection_id) from public.catechism_items item
      join active_catechism active on active.id = item.id),
    'musicDue', (select count(*) from public.music_learning_states state
      join active_music active on active.item_id = state.item_id
      where state.learner_id = p_learner_id and state.due_at <= now()),
    'catechismDue', (select count(*) from public.catechism_learning_states state
      join active_catechism active on active.id = state.item_id
      where state.learner_id = p_learner_id and state.next_review_date <= v_today)
  ) into v_result from hanzi cross join recent cross join progress;
  return v_result;
end; $$;
revoke all on function public.learner_dashboard_snapshot(uuid) from public, anon;
grant execute on function public.learner_dashboard_snapshot(uuid) to authenticated;

-- A parent may record activity only for a child they can actually access, not just
-- any child in the same workspace. Other 022 behavior remains unchanged.
create or replace function public.record_app_activity(p_learner_id uuid, p_seconds integer, p_new_visit boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_workspace uuid;
  v_learner uuid;
  v_seconds integer := least(greatest(coalesce(p_seconds, 0), 0), 90);
begin
  if v_user is null then return; end if;
  select member.workspace_id into v_workspace from public.workspace_members member
  where member.user_id = v_user and member.status = 'active' limit 1;
  if v_workspace is null then return; end if;
  if p_learner_id is not null and private.can_access_learner(p_learner_id)
     and private.learner_workspace_id(p_learner_id) = v_workspace then v_learner := p_learner_id; end if;
  insert into public.app_activity_days as activity_day (workspace_id, user_id, learner_id, activity_date, active_seconds, visits)
  values (v_workspace, v_user, v_learner, (now() at time zone 'Asia/Shanghai')::date, v_seconds, case when p_new_visit then 1 else 0 end)
  on conflict (user_id, activity_date, (coalesce(learner_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update set
    active_seconds = least(86400, activity_day.active_seconds + least(excluded.active_seconds, greatest(0, extract(epoch from now() - activity_day.last_seen_at)::integer + 5))),
    visits = activity_day.visits + excluded.visits,
    last_seen_at = now();
end; $$;
revoke all on function public.record_app_activity(uuid, integer, boolean) from public, anon;
grant execute on function public.record_app_activity(uuid, integer, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
