-- 018｜诗境守卫战：游戏场次、逐题事实、逐句状态与人工背诵评分
-- 依赖：008_poem_recitation_mvp.sql、012_reward_sticker_module.sql、015_multi_family_admin.sql
-- 可重复运行；不修改原诗词打卡、汉字、音乐或问答数据。

create table if not exists public.poem_game_maps (
  id uuid primary key default gen_random_uuid(),
  poem_id uuid not null references public.poems(id) on delete cascade,
  prompt_version text not null default 'v1',
  blueprint jsonb not null,
  generator text not null default 'procedural' check (generator in ('procedural', 'azure_openai')),
  model text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (poem_id, prompt_version)
);

create table if not exists public.poem_game_sessions (
  id uuid primary key default gen_random_uuid(),
  client_session_id uuid not null unique,
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  poem_id uuid not null references public.poems(id) on delete cascade,
  played_by uuid not null references auth.users(id) on delete restrict,
  mode text not null check (mode in ('desktop', 'mobile')),
  duration_seconds integer not null default 0 check (duration_seconds between 0 and 3600),
  completed_stage text not null check (completed_stage in ('warmup', 'exposure', 'choice', 'order', 'boss', 'mobile')),
  is_completed boolean not null default false,
  correct_count integer not null default 0 check (correct_count >= 0),
  wrong_count integer not null default 0 check (wrong_count >= 0),
  first_try_correct_count integer not null default 0 check (first_try_correct_count >= 0),
  boss_hits integer not null default 0 check (boss_hits >= 0),
  recitation_score smallint check (recitation_score between 1 and 10),
  recitation_attempt_id uuid references public.poem_recitation_attempts(id) on delete set null,
  played_at timestamptz not null default now(),
  played_local_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.poem_game_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.poem_game_sessions(id) on delete cascade,
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  poem_id uuid not null references public.poems(id) on delete cascade,
  event_index integer not null check (event_index between 0 and 500),
  stage text not null check (stage in ('warmup', 'exposure', 'choice', 'order', 'boss', 'mobile')),
  line_index integer check (line_index between 0 and 50),
  prompt_text text not null check (char_length(prompt_text) between 1 and 500),
  expected_text text not null check (char_length(expected_text) between 1 and 500),
  selected_text text not null check (char_length(selected_text) between 1 and 500),
  is_correct boolean not null,
  is_first_try boolean not null default false,
  response_ms integer not null default 0 check (response_ms between 0 and 600000),
  occurred_at timestamptz not null default now(),
  unique (session_id, event_index)
);

create table if not exists public.learner_poem_line_states (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  poem_id uuid not null references public.poems(id) on delete cascade,
  line_index integer not null check (line_index between 0 and 50),
  line_text_snapshot text not null check (char_length(line_text_snapshot) between 1 and 500),
  exposure_count integer not null default 0 check (exposure_count >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  wrong_count integer not null default 0 check (wrong_count >= 0),
  first_try_correct_count integer not null default 0 check (first_try_correct_count >= 0),
  mastery_score smallint not null default 0 check (mastery_score between 0 and 100),
  last_seen_at timestamptz,
  next_due_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (learner_id, poem_id, line_index)
);

create index if not exists poem_game_sessions_learner_date_idx on public.poem_game_sessions (learner_id, played_at desc);
create index if not exists poem_game_sessions_poem_date_idx on public.poem_game_sessions (poem_id, played_at desc);
create index if not exists poem_game_attempts_session_idx on public.poem_game_attempts (session_id, event_index);
create index if not exists poem_game_attempts_learner_poem_idx on public.poem_game_attempts (learner_id, poem_id, occurred_at desc);
create index if not exists learner_poem_line_states_due_idx on public.learner_poem_line_states (learner_id, next_due_at, mastery_score);

alter table public.poem_game_maps enable row level security;
alter table public.poem_game_sessions enable row level security;
alter table public.poem_game_attempts enable row level security;
alter table public.learner_poem_line_states enable row level security;

drop policy if exists "assigned families read poem game maps" on public.poem_game_maps;
create policy "assigned families read poem game maps" on public.poem_game_maps for select to authenticated
using (
  exists (
    select 1
    from public.learner_poem_collections assignment
    join public.poem_collection_items collection_item on collection_item.collection_id = assignment.collection_id
    where collection_item.poem_id = poem_game_maps.poem_id
      and assignment.assignment_status = 'active'
      and private.can_access_learner(assignment.learner_id)
  )
);

drop policy if exists "assigned families create poem game maps" on public.poem_game_maps;
create policy "assigned families create poem game maps" on public.poem_game_maps for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1
    from public.learner_poem_collections assignment
    join public.poem_collection_items collection_item on collection_item.collection_id = assignment.collection_id
    where collection_item.poem_id = poem_game_maps.poem_id
      and assignment.assignment_status = 'active'
      and private.can_access_learner(assignment.learner_id)
  )
);

drop policy if exists "creators update poem game maps" on public.poem_game_maps;
create policy "creators update poem game maps" on public.poem_game_maps for update to authenticated
using (created_by = (select auth.uid()))
with check (created_by = (select auth.uid()));

drop policy if exists "families read poem game sessions" on public.poem_game_sessions;
create policy "families read poem game sessions" on public.poem_game_sessions for select to authenticated
using (private.can_access_learner(learner_id));

drop policy if exists "families read poem game attempts" on public.poem_game_attempts;
create policy "families read poem game attempts" on public.poem_game_attempts for select to authenticated
using (private.can_access_learner(learner_id));

drop policy if exists "families read poem line states" on public.learner_poem_line_states;
create policy "families read poem line states" on public.learner_poem_line_states for select to authenticated
using (private.can_access_learner(learner_id));

-- 单个入口原子保存：浏览器只交事实，熟练度和下次复习时间由数据库计算。
create or replace function public.record_poem_game_result(
  p_client_session_id uuid,
  p_learner_id uuid,
  p_poem_id uuid,
  p_mode text,
  p_duration_seconds integer,
  p_completed_stage text,
  p_is_completed boolean,
  p_attempts jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_timezone text;
  v_local_date date;
  v_session_id uuid;
  v_attempt jsonb;
  v_event_index integer;
  v_stage text;
  v_line_index integer;
  v_prompt text;
  v_expected text;
  v_selected text;
  v_correct boolean;
  v_first_try boolean;
  v_response_ms integer;
  v_delta integer;
  v_correct_count integer := 0;
  v_wrong_count integer := 0;
  v_first_try_count integer := 0;
  v_boss_hits integer := 0;
begin
  if v_user_id is null then
    raise exception '请先登录家长账号' using errcode = '42501';
  end if;
  if not private.can_access_learner(p_learner_id) then
    raise exception '无权记录这个孩子的游戏' using errcode = '42501';
  end if;
  if p_mode not in ('desktop', 'mobile')
    or p_completed_stage not in ('warmup', 'exposure', 'choice', 'order', 'boss', 'mobile')
    or p_duration_seconds < 0 or p_duration_seconds > 3600 then
    raise exception '游戏结果参数无效' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_attempts, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_attempts, '[]'::jsonb)) > 500 then
    raise exception '游戏作答记录格式无效' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.learner_poem_collections assignment
    join public.poem_collection_items collection_item on collection_item.collection_id = assignment.collection_id
    join public.poem_collections collection on collection.id = assignment.collection_id
    where assignment.learner_id = p_learner_id
      and assignment.assignment_status = 'active'
      and collection_item.poem_id = p_poem_id
      and collection.status = 'published'
      and collection.review_status = 'approved'
  ) then
    raise exception '这首诗没有分配给该孩子' using errcode = '42501';
  end if;

  select profile.timezone into v_timezone from public.learner_profiles profile where profile.id = p_learner_id;
  v_local_date := (now() at time zone coalesce(nullif(v_timezone, ''), 'Asia/Shanghai'))::date;

  for v_attempt in select value from jsonb_array_elements(coalesce(p_attempts, '[]'::jsonb))
  loop
    v_correct := coalesce((v_attempt->>'isCorrect')::boolean, false);
    v_first_try := coalesce((v_attempt->>'isFirstTry')::boolean, false);
    v_stage := coalesce(v_attempt->>'stage', 'mobile');
    if v_stage not in ('warmup', 'exposure', 'choice', 'order', 'boss', 'mobile') then
      raise exception '包含无效的游戏阶段' using errcode = '22023';
    end if;
    v_correct_count := v_correct_count + case when v_correct then 1 else 0 end;
    v_wrong_count := v_wrong_count + case when v_correct then 0 else 1 end;
    v_first_try_count := v_first_try_count + case when v_correct and v_first_try then 1 else 0 end;
    v_boss_hits := v_boss_hits + case when v_correct and v_stage = 'boss' then 1 else 0 end;
  end loop;

  insert into public.poem_game_sessions (
    client_session_id, learner_id, poem_id, played_by, mode, duration_seconds,
    completed_stage, is_completed, correct_count, wrong_count, first_try_correct_count,
    boss_hits, played_local_date
  ) values (
    p_client_session_id, p_learner_id, p_poem_id, v_user_id, p_mode, p_duration_seconds,
    p_completed_stage, coalesce(p_is_completed, false), v_correct_count, v_wrong_count,
    v_first_try_count, v_boss_hits, v_local_date
  )
  on conflict (client_session_id) do nothing
  returning id into v_session_id;

  if v_session_id is null then
    select session.id into v_session_id
    from public.poem_game_sessions session
    where session.client_session_id = p_client_session_id
      and session.learner_id = p_learner_id
      and session.played_by = v_user_id;
    if v_session_id is null then
      raise exception '这个游戏记录编号已经被使用' using errcode = '23505';
    end if;
    return jsonb_build_object('session_id', v_session_id, 'duplicate', true);
  end if;

  for v_attempt in select value from jsonb_array_elements(coalesce(p_attempts, '[]'::jsonb))
  loop
    v_event_index := greatest(0, least(500, coalesce((v_attempt->>'eventIndex')::integer, 0)));
    v_stage := coalesce(v_attempt->>'stage', 'mobile');
    v_line_index := case when v_attempt ? 'lineIndex' and v_attempt->>'lineIndex' is not null then (v_attempt->>'lineIndex')::integer else null end;
    v_prompt := left(coalesce(nullif(v_attempt->>'promptText', ''), '诗句练习'), 500);
    v_expected := left(coalesce(nullif(v_attempt->>'expectedText', ''), '诗句'), 500);
    v_selected := left(coalesce(nullif(v_attempt->>'selectedText', ''), '未选择'), 500);
    v_correct := coalesce((v_attempt->>'isCorrect')::boolean, false);
    v_first_try := coalesce((v_attempt->>'isFirstTry')::boolean, false);
    v_response_ms := greatest(0, least(600000, coalesce((v_attempt->>'responseMs')::integer, 0)));

    insert into public.poem_game_attempts (
      session_id, learner_id, poem_id, event_index, stage, line_index,
      prompt_text, expected_text, selected_text, is_correct, is_first_try, response_ms
    ) values (
      v_session_id, p_learner_id, p_poem_id, v_event_index, v_stage, v_line_index,
      v_prompt, v_expected, v_selected, v_correct, v_first_try, v_response_ms
    );

    if v_line_index is not null and v_line_index between 0 and 50 then
      v_delta := case when v_correct and v_first_try then 12 when v_correct then 6 else -10 end;
      insert into public.learner_poem_line_states (
        learner_id, poem_id, line_index, line_text_snapshot, exposure_count,
        correct_count, wrong_count, first_try_correct_count, mastery_score,
        last_seen_at, next_due_at, updated_at
      ) values (
        p_learner_id, p_poem_id, v_line_index, v_expected, 1,
        case when v_correct then 1 else 0 end,
        case when v_correct then 0 else 1 end,
        case when v_correct and v_first_try then 1 else 0 end,
        greatest(0, least(100, 20 + v_delta)), now(),
        now() + case when v_correct then interval '2 days' else interval '1 day' end, now()
      )
      on conflict (learner_id, poem_id, line_index) do update set
        line_text_snapshot = excluded.line_text_snapshot,
        exposure_count = public.learner_poem_line_states.exposure_count + 1,
        correct_count = public.learner_poem_line_states.correct_count + case when v_correct then 1 else 0 end,
        wrong_count = public.learner_poem_line_states.wrong_count + case when v_correct then 0 else 1 end,
        first_try_correct_count = public.learner_poem_line_states.first_try_correct_count + case when v_correct and v_first_try then 1 else 0 end,
        mastery_score = greatest(0, least(100, public.learner_poem_line_states.mastery_score + v_delta)),
        last_seen_at = now(),
        next_due_at = now() + case
          when not v_correct then interval '1 day'
          when greatest(0, least(100, public.learner_poem_line_states.mastery_score + v_delta)) < 35 then interval '2 days'
          when greatest(0, least(100, public.learner_poem_line_states.mastery_score + v_delta)) < 60 then interval '4 days'
          when greatest(0, least(100, public.learner_poem_line_states.mastery_score + v_delta)) < 80 then interval '7 days'
          else interval '14 days'
        end,
        updated_at = now();
    end if;
  end loop;

  return jsonb_build_object('session_id', v_session_id, 'duplicate', false);
end;
$$;

-- 家长在游戏结束后单独评分；游戏自动保存与人工评分互不阻塞。
create or replace function public.rate_poem_game_session(
  p_session_id uuid,
  p_score smallint,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_session public.poem_game_sessions%rowtype;
  v_attempt_id uuid;
begin
  if v_user_id is null then
    raise exception '请先登录家长账号' using errcode = '42501';
  end if;
  if p_score is null or p_score < 1 or p_score > 10 then
    raise exception '掌握评分必须是 1–10 分' using errcode = '22023';
  end if;

  select session.* into v_session
  from public.poem_game_sessions session
  where session.id = p_session_id
  for update;
  if not found or not private.can_access_learner(v_session.learner_id) then
    raise exception '找不到可评分的游戏记录' using errcode = '42501';
  end if;
  if v_session.recitation_attempt_id is not null then
    return jsonb_build_object('session_id', v_session.id, 'recitation_attempt_id', v_session.recitation_attempt_id, 'duplicate', true);
  end if;

  insert into public.poem_recitation_attempts (
    learner_id, poem_id, recorded_by, recited_local_date, score, note
  ) values (
    v_session.learner_id, v_session.poem_id, v_user_id, v_session.played_local_date,
    p_score, left(coalesce(nullif(trim(p_note), ''), '诗词游戏结束后的家长背诵评分'), 300)
  ) returning id into v_attempt_id;

  update public.poem_game_sessions
  set recitation_score = p_score, recitation_attempt_id = v_attempt_id
  where id = v_session.id;

  return jsonb_build_object('session_id', v_session.id, 'recitation_attempt_id', v_attempt_id, 'duplicate', false);
end;
$$;

revoke all on public.poem_game_maps, public.poem_game_sessions, public.poem_game_attempts, public.learner_poem_line_states from anon;
revoke all on public.poem_game_maps, public.poem_game_sessions, public.poem_game_attempts, public.learner_poem_line_states from authenticated;
grant select, insert, update on public.poem_game_maps to authenticated;
grant select on public.poem_game_sessions, public.poem_game_attempts, public.learner_poem_line_states to authenticated;

revoke all on function public.record_poem_game_result(uuid, uuid, uuid, text, integer, text, boolean, jsonb) from public;
revoke all on function public.rate_poem_game_session(uuid, smallint, text) from public;
grant execute on function public.record_poem_game_result(uuid, uuid, uuid, text, integer, text, boolean, jsonb) to authenticated;
grant execute on function public.rate_poem_game_session(uuid, smallint, text) to authenticated;

