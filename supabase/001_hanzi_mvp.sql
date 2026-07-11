-- 字芽 MVP：在 Supabase Dashboard → SQL Editor 中整段执行。
-- 运行前请确认：此项目启用了 Email Auth；不要把 service_role 写进前端环境变量。

begin;

create extension if not exists pgcrypto;

create table if not exists public.content_packages (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  code text not null,
  title text not null check (char_length(title) between 1 and 60),
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, code)
);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  character text not null check (char_length(character) = 1),
  pinyin_marked text not null check (char_length(pinyin_marked) between 1 and 40),
  meaning text not null check (char_length(meaning) between 1 and 100),
  word_one text,
  word_two text,
  example_sentence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, character)
);

create table if not exists public.learner_profiles (
  id uuid primary key default gen_random_uuid(),
  parent_user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 24),
  daily_new_limit integer not null default 5 check (daily_new_limit between 1 and 50),
  timezone text not null default 'Asia/Shanghai',
  active_package_id uuid references public.content_packages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.package_characters (
  package_id uuid not null references public.content_packages(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  created_at timestamptz not null default now(),
  primary key (package_id, character_id),
  unique (package_id, sequence)
);

create table if not exists public.learning_states (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  stage smallint not null default 0 check (stage between 0 and 7),
  due_at timestamptz not null default now(),
  last_result text check (last_result in ('known', 'again')),
  reinforced_on date,
  consecutive_known integer not null default 0,
  mastered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id, character_id)
);

create table if not exists public.daily_sessions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  date_local date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (learner_id, date_local)
);

create table if not exists public.daily_session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.daily_sessions(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  queue_kind text not null check (queue_kind in ('new', 'review', 'carry', 'new_reinforcement', 'error_reinforcement')),
  queue_position integer not null check (queue_position > 0),
  status text not null default 'pending' check (status in ('pending', 'answered', 'carried')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  unique (session_id, character_id, queue_kind),
  unique (session_id, queue_position)
);

create table if not exists public.learning_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  state_id uuid not null references public.learning_states(id) on delete cascade,
  session_item_id uuid not null unique references public.daily_session_items(id) on delete cascade,
  result text not null check (result in ('known', 'again')),
  queue_kind text not null,
  previous_stage smallint not null check (previous_stage between 0 and 7),
  next_stage smallint not null check (next_stage between 0 and 7),
  next_due_at timestamptz not null,
  answered_at timestamptz not null default now()
);

create index if not exists learning_states_due_idx on public.learning_states (learner_id, due_at);
create index if not exists learning_attempts_history_idx on public.learning_attempts (learner_id, character_id, answered_at desc);
create index if not exists daily_items_session_status_idx on public.daily_session_items (session_id, status, queue_position);
create index if not exists daily_sessions_learner_date_idx on public.daily_sessions (learner_id, date_local desc);

-- SQL Editor 建表不会自动保证 RLS；这里显式开启，并且只授予 authenticated 最小权限。
alter table public.content_packages enable row level security;
alter table public.characters enable row level security;
alter table public.learner_profiles enable row level security;
alter table public.package_characters enable row level security;
alter table public.learning_states enable row level security;
alter table public.daily_sessions enable row level security;
alter table public.daily_session_items enable row level security;
alter table public.learning_attempts enable row level security;

drop policy if exists "package owner reads" on public.content_packages;
drop policy if exists "package owner writes" on public.content_packages;
create policy "package owner reads" on public.content_packages for select to authenticated using (created_by = (select auth.uid()));
create policy "package owner writes" on public.content_packages for all to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

drop policy if exists "character owner reads" on public.characters;
drop policy if exists "character owner writes" on public.characters;
create policy "character owner reads" on public.characters for select to authenticated using (created_by = (select auth.uid()));
create policy "character owner writes" on public.characters for all to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

drop policy if exists "parent reads learners" on public.learner_profiles;
drop policy if exists "parent writes learners" on public.learner_profiles;
create policy "parent reads learners" on public.learner_profiles for select to authenticated using (parent_user_id = (select auth.uid()));
create policy "parent writes learners" on public.learner_profiles for all to authenticated using (parent_user_id = (select auth.uid())) with check (parent_user_id = (select auth.uid()));

drop policy if exists "package character owner reads" on public.package_characters;
drop policy if exists "package character owner writes" on public.package_characters;
create policy "package character owner reads" on public.package_characters for select to authenticated using (
  exists (select 1 from public.content_packages p where p.id = package_id and p.created_by = (select auth.uid()))
);
create policy "package character owner writes" on public.package_characters for all to authenticated using (
  exists (select 1 from public.content_packages p where p.id = package_id and p.created_by = (select auth.uid()))
) with check (
  exists (select 1 from public.content_packages p where p.id = package_id and p.created_by = (select auth.uid()))
  and exists (select 1 from public.characters c where c.id = character_id and c.created_by = (select auth.uid()))
);

drop policy if exists "parent reads states" on public.learning_states;
drop policy if exists "parent writes states" on public.learning_states;
create policy "parent reads states" on public.learning_states for select to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
);
create policy "parent writes states" on public.learning_states for all to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
) with check (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
);

drop policy if exists "parent reads sessions" on public.daily_sessions;
drop policy if exists "parent writes sessions" on public.daily_sessions;
create policy "parent reads sessions" on public.daily_sessions for select to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
);
create policy "parent writes sessions" on public.daily_sessions for all to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
) with check (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
);

drop policy if exists "parent reads session items" on public.daily_session_items;
drop policy if exists "parent writes session items" on public.daily_session_items;
create policy "parent reads session items" on public.daily_session_items for select to authenticated using (
  exists (
    select 1 from public.daily_sessions s join public.learner_profiles l on l.id = s.learner_id
    where s.id = session_id and l.parent_user_id = (select auth.uid())
  )
);
create policy "parent writes session items" on public.daily_session_items for all to authenticated using (
  exists (
    select 1 from public.daily_sessions s join public.learner_profiles l on l.id = s.learner_id
    where s.id = session_id and l.parent_user_id = (select auth.uid())
  )
) with check (
  exists (
    select 1 from public.daily_sessions s join public.learner_profiles l on l.id = s.learner_id
    where s.id = session_id and l.parent_user_id = (select auth.uid())
  )
);

drop policy if exists "parent reads attempts" on public.learning_attempts;
drop policy if exists "parent writes attempts" on public.learning_attempts;
create policy "parent reads attempts" on public.learning_attempts for select to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
);
create policy "parent writes attempts" on public.learning_attempts for all to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
) with check (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
);

revoke all on public.content_packages, public.characters, public.learner_profiles, public.package_characters, public.learning_states, public.daily_sessions, public.daily_session_items, public.learning_attempts from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.content_packages, public.characters, public.learner_profiles, public.package_characters, public.learning_states, public.daily_sessions, public.daily_session_items, public.learning_attempts to authenticated;

drop function if exists public.get_today_queue(uuid);
create function public.get_today_queue(p_learner_id uuid)
returns table (
  session_item_id uuid,
  session_id uuid,
  queue_position integer,
  queue_kind text,
  character_id uuid,
  hanzi text,
  pinyin_marked text,
  meaning text,
  word_one text,
  word_two text,
  example_sentence text,
  stage smallint,
  due_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package_id uuid;
  v_timezone text;
  v_today date;
  v_session_id uuid;
  v_position integer := 0;
  v_review_count integer := 0;
  v_new_count integer := 0;
  v_daily_new_limit integer;
  v_pending record;
  v_candidate record;
begin
  select l.active_package_id, l.timezone, l.daily_new_limit
  into v_package_id, v_timezone, v_daily_new_limit
  from public.learner_profiles l
  join public.content_packages p on p.id = l.active_package_id and p.created_by = l.parent_user_id and p.status = 'published'
  where l.id = p_learner_id and l.parent_user_id = (select auth.uid());

  if not found then
    raise exception '未找到可用的孩子档案或已发布学习包' using errcode = '42501';
  end if;

  v_today := (now() at time zone v_timezone)::date;
  insert into public.daily_sessions (learner_id, date_local)
  values (p_learner_id, v_today)
  on conflict (learner_id, date_local) do nothing;

  select id into v_session_id from public.daily_sessions where learner_id = p_learner_id and date_local = v_today;
  select coalesce(max(i.queue_position), 0) into v_position
  from public.daily_session_items i
  where i.session_id = v_session_id;

  -- 昨日未答的内容先带入今天；旧项标为 carried，避免重复记一次回答。
  for v_pending in
    select distinct on (i.character_id) i.id, i.character_id
    from public.daily_session_items i
    join public.daily_sessions s on s.id = i.session_id
    where s.learner_id = p_learner_id and s.date_local < v_today and i.status = 'pending'
    order by i.character_id, s.date_local asc, i.queue_position asc
  loop
    v_position := v_position + 1;
    update public.daily_session_items set status = 'carried' where id = v_pending.id;
    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position)
    values (v_session_id, v_pending.character_id, 'carry', v_position)
    on conflict (session_id, character_id, queue_kind) do nothing;
  end loop;

  select count(*) into v_review_count
  from public.daily_session_items i
  where i.session_id = v_session_id and i.queue_kind in ('review', 'carry');

  for v_candidate in
    select ls.character_id
    from public.learning_states ls
    where ls.learner_id = p_learner_id and ls.due_at <= now()
      and not exists (select 1 from public.daily_session_items i where i.session_id = v_session_id and i.character_id = ls.character_id)
    order by ls.due_at asc, ls.stage asc
    limit greatest(0, 15 - v_review_count)
  loop
    v_position := v_position + 1;
    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position)
    values (v_session_id, v_candidate.character_id, 'review', v_position);
  end loop;

  select count(*) into v_new_count
  from public.daily_session_items i
  where i.session_id = v_session_id and i.queue_kind = 'new';
  for v_candidate in
    select pc.character_id
    from public.package_characters pc
    where pc.package_id = v_package_id
      and not exists (select 1 from public.learning_states ls where ls.learner_id = p_learner_id and ls.character_id = pc.character_id)
      and not exists (select 1 from public.daily_session_items i where i.session_id = v_session_id and i.character_id = pc.character_id)
    order by pc.sequence
    limit greatest(0, v_daily_new_limit - v_new_count)
  loop
    v_position := v_position + 1;
    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position)
    values (v_session_id, v_candidate.character_id, 'new', v_position);
  end loop;

  return query
  select i.id, v_session_id, i.queue_position, i.queue_kind, c.id, c.character, c.pinyin_marked, c.meaning, c.word_one, c.word_two, c.example_sentence,
    coalesce(ls.stage, 0::smallint), ls.due_at
  from public.daily_session_items i
  join public.characters c on c.id = i.character_id
  left join public.learning_states ls on ls.learner_id = p_learner_id and ls.character_id = i.character_id
  where i.session_id = v_session_id and i.status = 'pending'
  order by i.queue_position;
end;
$$;

drop function if exists public.answer_queue_item(uuid, uuid, text, uuid);
create function public.answer_queue_item(
  p_learner_id uuid,
  p_session_item_id uuid,
  p_result text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_state public.learning_states%rowtype;
  v_today date;
  v_timezone text;
  v_previous_stage smallint;
  v_next_stage smallint;
  v_next_due_at timestamptz;
  v_append_kind text := null;
  v_reinforcement_added boolean := false;
  v_position integer;
  v_mastered_at timestamptz;
begin
  if p_result not in ('known', 'again') then
    raise exception 'result 只能是 known 或 again' using errcode = '22023';
  end if;

  select l.timezone into v_timezone from public.learner_profiles l
  where l.id = p_learner_id and l.parent_user_id = (select auth.uid());
  if not found then raise exception '无权操作该孩子档案' using errcode = '42501'; end if;
  v_today := (now() at time zone v_timezone)::date;

  if exists (select 1 from public.learning_attempts a where a.request_id = p_request_id) then
    return jsonb_build_object('idempotent', true);
  end if;

  select i.*, s.learner_id into v_item
  from public.daily_session_items i
  join public.daily_sessions s on s.id = i.session_id
  where i.id = p_session_item_id and s.learner_id = p_learner_id
  for update of i;
  if not found then raise exception '找不到待回答的学习卡' using errcode = '42501'; end if;
  if v_item.status <> 'pending' then return jsonb_build_object('idempotent', true); end if;

  insert into public.learning_states (learner_id, character_id, stage, due_at)
  values (p_learner_id, v_item.character_id, 0, now())
  on conflict (learner_id, character_id) do nothing;
  select * into v_state from public.learning_states where learner_id = p_learner_id and character_id = v_item.character_id for update;
  v_previous_stage := v_state.stage;
  v_mastered_at := v_state.mastered_at;

  if v_item.queue_kind = 'new' then
    -- 初次接触无论答对/错都只停在 stage 0；用当天一次强化确认。
    v_next_stage := 0;
    v_next_due_at := now();
    v_append_kind := 'new_reinforcement';
  elsif v_item.queue_kind = 'new_reinforcement' then
    if p_result = 'known' then
      v_next_stage := 1;
      v_next_due_at := now() + interval '1 day';
    else
      v_next_stage := 0;
      v_next_due_at := now() + interval '1 day';
    end if;
  elsif v_item.queue_kind = 'error_reinforcement' then
    -- 重点：强化答对也保持“答错后已降级”的阶段，次日优先复查。
    v_next_stage := v_state.stage;
    v_next_due_at := now() + interval '1 day';
  elsif p_result = 'again' then
    v_next_stage := greatest(0, v_state.stage - 2);
    v_next_due_at := now();
    v_append_kind := 'error_reinforcement';
    v_mastered_at := null;
  else
    if v_state.stage = 7 then
      v_next_stage := 7;
      v_next_due_at := now() + interval '180 days';
      v_mastered_at := coalesce(v_state.mastered_at, now());
    else
      v_next_stage := v_state.stage + 1;
      v_next_due_at := now() + case v_next_stage
        when 1 then interval '1 day'
        when 2 then interval '3 days'
        when 3 then interval '7 days'
        when 4 then interval '14 days'
        when 5 then interval '30 days'
        when 6 then interval '60 days'
        when 7 then interval '90 days'
      end;
    end if;
  end if;

  if v_append_kind is not null and v_state.reinforced_on is distinct from v_today then
    select coalesce(max(i.queue_position), 0) + 1 into v_position
    from public.daily_session_items i
    where i.session_id = v_item.session_id;
    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position)
    values (v_item.session_id, v_item.character_id, v_append_kind, v_position)
    on conflict (session_id, character_id, queue_kind) do nothing;
    v_reinforcement_added := true;
  end if;

  update public.learning_states
  set stage = v_next_stage,
      due_at = v_next_due_at,
      last_result = p_result,
      reinforced_on = case when v_reinforcement_added then v_today else reinforced_on end,
      consecutive_known = case when p_result = 'known' then consecutive_known + 1 else 0 end,
      mastered_at = case when v_next_stage < 7 then null else v_mastered_at end,
      updated_at = now()
  where id = v_state.id;

  update public.daily_session_items set status = 'answered', answered_at = now() where id = v_item.id;
  insert into public.learning_attempts (request_id, learner_id, character_id, state_id, session_item_id, result, queue_kind, previous_stage, next_stage, next_due_at)
  values (p_request_id, p_learner_id, v_item.character_id, v_state.id, v_item.id, p_result, v_item.queue_kind, v_previous_stage, v_next_stage, v_next_due_at);

  return jsonb_build_object('next_stage', v_next_stage, 'next_due_at', v_next_due_at, 'reinforcement_added', v_reinforcement_added);
end;
$$;

drop function if exists public.get_library_progress(uuid);
create function public.get_library_progress(p_learner_id uuid)
returns table (
  character_id uuid,
  attempt_count integer,
  known_count integer,
  again_count integer,
  stage smallint,
  due_at timestamptz,
  last_result text,
  consecutive_known integer,
  mastered_at timestamptz,
  last_answered_at timestamptz,
  needs_review boolean
)
language sql
security definer
set search_path = ''
as $$
  with authorized as (
    select 1
    from public.learner_profiles l
    where l.id = p_learner_id
      and l.parent_user_id = (select auth.uid())
  )
  select
    s.character_id,
    count(a.id)::integer,
    count(a.id) filter (where a.result = 'known')::integer,
    count(a.id) filter (where a.result = 'again')::integer,
    s.stage,
    s.due_at,
    s.last_result,
    s.consecutive_known,
    s.mastered_at,
    max(a.answered_at),
    (s.due_at <= now())
  from public.learning_states s
  left join public.learning_attempts a
    on a.learner_id = s.learner_id
    and a.character_id = s.character_id
  where s.learner_id = p_learner_id
    and exists (select 1 from authorized)
  group by s.character_id, s.stage, s.due_at, s.last_result, s.consecutive_known, s.mastered_at;
$$;

revoke execute on function public.get_today_queue(uuid) from public, anon;
revoke execute on function public.answer_queue_item(uuid, uuid, text, uuid) from public, anon;
revoke execute on function public.get_library_progress(uuid) from public, anon;
grant execute on function public.get_today_queue(uuid) to authenticated;
grant execute on function public.answer_queue_item(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.get_library_progress(uuid) to authenticated;

commit;
