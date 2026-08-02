-- 字芽：汉字动态双确认与当天循环重试。
--
-- 已确认的学习规则：
--   1. 新字、stage 0–2：连续两次“独立认出”才算今日通过。
--   2. stage 3–7：到期复习时第一次独立认出即可通过。
--   3. 任何字一旦没有独立认出（答“再学一次”或使用提示），改为需要连续两次独立认出。
--   4. 同一个字同一天最多降级一次；后续答错只清空确认进度并继续排到队尾。
--   5. 柔和降级：0→0、1→0、2→1、3→1、4→2、5→3、6→4、7→5。
--   6. 当天重试答对只完成今日任务，不恢复刚刚降掉的阶段；第二天再独立验证。
--
-- 本脚本不会删除孩子、字库、学习状态、回答历史或奖励流水。
-- 已在今天按旧规则完成的字继续视为完成；仍有 pending 卡片的字从 0 次确认开始。
-- 前置：已经按顺序运行 001–013。

begin;

-- 每个队列项仍只回答一次；retry_no 让同一汉字可以在同一天生成不限次数的重试卡。
alter table public.daily_session_items
  add column if not exists retry_no integer not null default 0;

alter table public.daily_session_items
  drop constraint if exists daily_session_items_retry_no_check;
alter table public.daily_session_items
  add constraint daily_session_items_retry_no_check check (retry_no >= 0);

alter table public.daily_session_items
  drop constraint if exists daily_session_items_queue_kind_check;
alter table public.daily_session_items
  add constraint daily_session_items_queue_kind_check check (
    queue_kind in (
      'new', 'review', 'carry',
      'new_reinforcement', 'error_reinforcement', 'same_day_retry'
    )
  );

alter table public.daily_session_items
  drop constraint if exists daily_session_items_session_id_character_id_queue_kind_key;
alter table public.daily_session_items
  drop constraint if exists daily_session_items_session_character_kind_retry_key;
alter table public.daily_session_items
  add constraint daily_session_items_session_character_kind_retry_key
  unique (session_id, character_id, queue_kind, retry_no);

-- 一天一个字一行：把“今日通过”与跨天 learning_states 分开。
create table if not exists public.daily_character_progress (
  session_id uuid not null references public.daily_sessions(id) on delete cascade,
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  initial_queue_kind text not null check (
    initial_queue_kind in (
      'new', 'review', 'carry',
      'new_reinforcement', 'error_reinforcement', 'same_day_retry'
    )
  ),
  starting_stage smallint not null check (starting_stage between 0 and 7),
  required_confirmations smallint not null check (required_confirmations in (1, 2)),
  clean_streak smallint not null default 0 check (clean_streak between 0 and 2),
  failed_streak smallint not null default 0 check (failed_streak between 0 and 3),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  known_count integer not null default 0 check (known_count >= 0),
  again_count integer not null default 0 check (again_count >= 0),
  assisted_count integer not null default 0 check (assisted_count >= 0),
  first_result text check (first_result in ('known', 'again')),
  stage_adjusted boolean not null default false,
  passed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, character_id)
);

create index if not exists daily_character_progress_learner_session_idx
  on public.daily_character_progress (learner_id, session_id, passed_at);

alter table public.daily_character_progress enable row level security;

drop policy if exists "parent reads daily character progress" on public.daily_character_progress;
create policy "parent reads daily character progress"
on public.daily_character_progress
for select
to authenticated
using (
  exists (
    select 1
    from public.learner_profiles learner
    where learner.id = learner_id
      and learner.parent_user_id = (select auth.uid())
  )
);

revoke all on public.daily_character_progress from public, anon;
grant select on public.daily_character_progress to authenticated;

-- 每次历史回答补充“是否得到帮助、当天第几次、确认进度与是否今日通过”。
alter table public.learning_attempts
  add column if not exists assisted boolean not null default false,
  add column if not exists attempt_number integer not null default 1,
  add column if not exists clean_streak_after smallint not null default 0,
  add column if not exists daily_passed boolean not null default false,
  add column if not exists stage_adjusted_today boolean not null default false;

alter table public.learning_attempts
  drop constraint if exists learning_attempts_attempt_number_check;
alter table public.learning_attempts
  add constraint learning_attempts_attempt_number_check check (attempt_number > 0);
alter table public.learning_attempts
  drop constraint if exists learning_attempts_clean_streak_after_check;
alter table public.learning_attempts
  add constraint learning_attempts_clean_streak_after_check check (clean_streak_after between 0 and 2);

-- 返回今日队列，同时返回每个字的确认状态和今日“不同汉字”的完成进度。
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
  due_at timestamptz,
  attempt_count integer,
  again_count integer,
  clean_streak smallint,
  failed_streak smallint,
  required_confirmations smallint,
  today_total integer,
  today_passed integer,
  today_remaining integer
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
  v_today_total integer := 0;
  v_today_passed integer := 0;
  v_pending record;
  v_candidate record;
begin
  select learner.active_package_id, learner.timezone, learner.daily_new_limit
  into v_package_id, v_timezone, v_daily_new_limit
  from public.learner_profiles learner
  join public.content_packages package
    on package.id = learner.active_package_id
   and package.created_by = learner.parent_user_id
   and package.status = 'published'
  where learner.id = p_learner_id
    and learner.parent_user_id = (select auth.uid());

  if not found then
    raise exception '未找到可用的孩子档案或已发布学习包' using errcode = '42501';
  end if;

  v_today := (now() at time zone v_timezone)::date;

  insert into public.daily_sessions (learner_id, date_local)
  values (p_learner_id, v_today)
  on conflict (learner_id, date_local) do nothing;

  select session.id
  into v_session_id
  from public.daily_sessions session
  where session.learner_id = p_learner_id
    and session.date_local = v_today;

  select coalesce(max(item.queue_position), 0)
  into v_position
  from public.daily_session_items item
  where item.session_id = v_session_id;

  -- 昨日没有完成的字只带入一张；昨天的确认进度不跨天继承。
  for v_pending in
    select distinct on (item.character_id) item.id, item.character_id
    from public.daily_session_items item
    join public.daily_sessions session on session.id = item.session_id
    where session.learner_id = p_learner_id
      and session.date_local < v_today
      and item.status = 'pending'
    order by item.character_id, session.date_local asc, item.queue_position asc
  loop
    v_position := v_position + 1;

    update public.daily_session_items item
    set status = 'carried'
    where item.id = v_pending.id;

    insert into public.daily_session_items (
      session_id, character_id, queue_kind, queue_position, retry_no
    )
    values (v_session_id, v_pending.character_id, 'carry', v_position, 0)
    on conflict on constraint daily_session_items_session_character_kind_retry_key
    do nothing;
  end loop;

  select count(*)
  into v_review_count
  from public.daily_session_items item
  where item.session_id = v_session_id
    and item.queue_kind in ('review', 'carry');

  -- 到期重点字在普通到期字前，沿用 011 的优先顺序。
  for v_candidate in
    select state.character_id
    from public.learning_states state
    left join public.learner_character_priorities priority
      on priority.learner_id = state.learner_id
     and priority.character_id = state.character_id
    where state.learner_id = p_learner_id
      and state.due_at <= now()
      and not exists (
        select 1
        from public.daily_session_items item
        where item.session_id = v_session_id
          and item.character_id = state.character_id
      )
    order by
      (priority.character_id is not null) desc,
      state.due_at asc,
      state.stage asc
    limit greatest(0, 15 - v_review_count)
  loop
    v_position := v_position + 1;
    insert into public.daily_session_items (
      session_id, character_id, queue_kind, queue_position, retry_no
    )
    values (v_session_id, v_candidate.character_id, 'review', v_position, 0);
  end loop;

  select count(*)
  into v_new_count
  from public.daily_session_items item
  where item.session_id = v_session_id
    and item.queue_kind = 'new';

  -- 跨全部已关联字册的未学重点字先占用当天新字名额。
  for v_candidate in
    select
      priority.character_id,
      priority.selected_at,
      min(linked.linked_at) as first_linked_at,
      min(package_character.sequence) as first_sequence
    from public.learner_character_priorities priority
    join public.learner_content_packages linked
      on linked.learner_id = priority.learner_id
    join public.content_packages package
      on package.id = linked.package_id
     and package.status = 'published'
     and package.created_by = (select auth.uid())
    join public.package_characters package_character
      on package_character.package_id = linked.package_id
     and package_character.character_id = priority.character_id
    where priority.learner_id = p_learner_id
      and not exists (
        select 1
        from public.learning_states state
        where state.learner_id = p_learner_id
          and state.character_id = priority.character_id
      )
      and not exists (
        select 1
        from public.daily_session_items item
        where item.session_id = v_session_id
          and item.character_id = priority.character_id
      )
    group by priority.character_id, priority.selected_at
    order by priority.selected_at, first_linked_at, first_sequence, priority.character_id
    limit greatest(0, v_daily_new_limit - v_new_count)
  loop
    v_position := v_position + 1;
    insert into public.daily_session_items (
      session_id, character_id, queue_kind, queue_position, retry_no
    )
    values (v_session_id, v_candidate.character_id, 'new', v_position, 0);
  end loop;

  select count(*)
  into v_new_count
  from public.daily_session_items item
  where item.session_id = v_session_id
    and item.queue_kind = 'new';

  -- 普通新字继续使用当前字册的 CSV 顺序。
  for v_candidate in
    select package_character.character_id
    from public.package_characters package_character
    where package_character.package_id = v_package_id
      and not exists (
        select 1
        from public.learning_states state
        where state.learner_id = p_learner_id
          and state.character_id = package_character.character_id
      )
      and not exists (
        select 1
        from public.daily_session_items item
        where item.session_id = v_session_id
          and item.character_id = package_character.character_id
      )
    order by package_character.sequence
    limit greatest(0, v_daily_new_limit - v_new_count)
  loop
    v_position := v_position + 1;
    insert into public.daily_session_items (
      session_id, character_id, queue_kind, queue_position, retry_no
    )
    values (v_session_id, v_candidate.character_id, 'new', v_position, 0);
  end loop;

  -- 为今天所有不同汉字创建进度。旧规则下今天已经答完且没有 pending 的字保持完成。
  with first_items as (
    select distinct on (item.character_id)
      item.character_id,
      item.queue_kind,
      item.queue_position
    from public.daily_session_items item
    where item.session_id = v_session_id
    order by item.character_id, item.queue_position
  ),
  normalized as (
    select
      first_item.character_id,
      first_item.queue_kind,
      coalesce((
        select attempt.previous_stage
        from public.learning_attempts attempt
        join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id
        where attempt_item.session_id = v_session_id
          and attempt.character_id = first_item.character_id
        order by attempt.answered_at, attempt.id
        limit 1
      ), state.stage, 0::smallint)::smallint as starting_stage,
      (select count(*)::integer
       from public.learning_attempts attempt
       join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id
       where attempt_item.session_id = v_session_id
         and attempt.character_id = first_item.character_id) as legacy_attempt_count,
      (select count(*) filter (where attempt.result = 'known')::integer
       from public.learning_attempts attempt
       join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id
       where attempt_item.session_id = v_session_id
         and attempt.character_id = first_item.character_id) as legacy_known_count,
      (select count(*) filter (where attempt.result = 'again')::integer
       from public.learning_attempts attempt
       join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id
       where attempt_item.session_id = v_session_id
         and attempt.character_id = first_item.character_id) as legacy_again_count,
      (select attempt.result
       from public.learning_attempts attempt
       join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id
       where attempt_item.session_id = v_session_id
         and attempt.character_id = first_item.character_id
       order by attempt.answered_at, attempt.id
       limit 1) as legacy_first_result,
      (select max(attempt.answered_at)
       from public.learning_attempts attempt
       join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id
       where attempt_item.session_id = v_session_id
         and attempt.character_id = first_item.character_id) as legacy_last_answered_at,
      exists (
        select 1
        from public.learning_attempts attempt
        join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id
        where attempt_item.session_id = v_session_id
          and attempt.character_id = first_item.character_id
          and attempt.next_stage < attempt.previous_stage
      ) as legacy_stage_adjusted,
      exists (
        select 1
        from public.daily_session_items pending_item
        where pending_item.session_id = v_session_id
          and pending_item.character_id = first_item.character_id
          and pending_item.status = 'pending'
      ) as has_pending
    from first_items first_item
    left join public.learning_states state
      on state.learner_id = p_learner_id
     and state.character_id = first_item.character_id
  )
  insert into public.daily_character_progress (
    session_id,
    learner_id,
    character_id,
    initial_queue_kind,
    starting_stage,
    required_confirmations,
    clean_streak,
    attempt_count,
    known_count,
    again_count,
    assisted_count,
    first_result,
    stage_adjusted,
    passed_at
  )
  select
    v_session_id,
    p_learner_id,
    normalized.character_id,
    normalized.queue_kind,
    normalized.starting_stage,
    case when normalized.queue_kind = 'new' or normalized.starting_stage <= 2 then 2 else 1 end,
    case
      when not normalized.has_pending and normalized.legacy_attempt_count > 0
        then case when normalized.queue_kind = 'new' or normalized.starting_stage <= 2 then 2 else 1 end
      when normalized.has_pending
        and normalized.legacy_first_result = 'known'
        and not normalized.legacy_stage_adjusted
        then 1
      else 0
    end,
    normalized.legacy_attempt_count,
    normalized.legacy_known_count,
    normalized.legacy_again_count,
    0,
    normalized.legacy_first_result,
    normalized.legacy_stage_adjusted,
    case
      when not normalized.has_pending and normalized.legacy_attempt_count > 0
        then normalized.legacy_last_answered_at
      else null
    end
  from normalized
  on conflict on constraint daily_character_progress_pkey do nothing;

  select
    count(*)::integer,
    count(*) filter (where progress.passed_at is not null)::integer
  into v_today_total, v_today_passed
  from public.daily_character_progress progress
  where progress.session_id = v_session_id;

  return query
  select
    item.id,
    v_session_id,
    item.queue_position,
    item.queue_kind,
    character.id,
    character.character,
    character.pinyin_marked,
    character.meaning,
    character.word_one,
    character.word_two,
    character.example_sentence,
    coalesce(state.stage, 0::smallint),
    state.due_at,
    progress.attempt_count,
    progress.again_count,
    progress.clean_streak,
    progress.failed_streak,
    progress.required_confirmations,
    v_today_total,
    v_today_passed,
    greatest(0, v_today_total - v_today_passed)
  from public.daily_session_items item
  join public.characters character on character.id = item.character_id
  join public.daily_character_progress progress
    on progress.session_id = item.session_id
   and progress.character_id = item.character_id
  left join public.learning_states state
    on state.learner_id = p_learner_id
   and state.character_id = item.character_id
  where item.session_id = v_session_id
    and item.status = 'pending'
    and progress.passed_at is null
  order by item.queue_position;
end;
$$;

revoke execute on function public.get_today_queue(uuid) from public, anon;
grant execute on function public.get_today_queue(uuid) to authenticated;

-- 一个事务完成：判定独立认出、每日一次降级、更新阶段、记录历史、追加重试和返回进度。
drop function if exists public.answer_queue_item(uuid, uuid, text, uuid);
drop function if exists public.answer_queue_item(uuid, uuid, text, uuid, boolean);
create function public.answer_queue_item(
  p_learner_id uuid,
  p_session_item_id uuid,
  p_result text,
  p_request_id uuid,
  p_assisted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_state public.learning_states%rowtype;
  v_progress public.daily_character_progress%rowtype;
  v_timezone text;
  v_today date;
  v_previous_stage smallint;
  v_next_stage smallint;
  v_next_due_at timestamptz;
  v_clean boolean;
  v_clean_streak smallint;
  v_failed_streak smallint;
  v_required smallint;
  v_stage_adjusted boolean;
  v_daily_passed boolean := false;
  v_retry_added boolean := false;
  v_attempt_number integer;
  v_position integer;
  v_pending_count integer := 0;
  v_today_total integer := 0;
  v_today_passed integer := 0;
  v_mastered_at timestamptz;
begin
  if p_result not in ('known', 'again') then
    raise exception 'result 只能是 known 或 again' using errcode = '22023';
  end if;

  select learner.timezone
  into v_timezone
  from public.learner_profiles learner
  where learner.id = p_learner_id
    and learner.parent_user_id = (select auth.uid());

  if not found then
    raise exception '无权操作该孩子档案' using errcode = '42501';
  end if;

  v_today := (now() at time zone v_timezone)::date;

  if exists (
    select 1
    from public.learning_attempts attempt
    where attempt.request_id = p_request_id
  ) then
    return jsonb_build_object('idempotent', true);
  end if;

  select item.*, session.learner_id, session.date_local
  into v_item
  from public.daily_session_items item
  join public.daily_sessions session on session.id = item.session_id
  where item.id = p_session_item_id
    and session.learner_id = p_learner_id
  for update of item;

  if not found then
    raise exception '找不到待回答的学习卡' using errcode = '42501';
  end if;

  if v_item.date_local <> v_today then
    raise exception '这张学习卡已经跨日，请重新加载今日任务' using errcode = '22023';
  end if;

  if v_item.status <> 'pending' then
    return jsonb_build_object('idempotent', true);
  end if;

  -- 同一孩子同一天的队列追加按 session 串行，避免两个并发回答争用 queue_position。
  perform 1
  from public.daily_sessions session
  where session.id = v_item.session_id
  for update;

  insert into public.learning_states (learner_id, character_id, stage, due_at)
  values (p_learner_id, v_item.character_id, 0, now())
  on conflict (learner_id, character_id) do nothing;

  select *
  into v_state
  from public.learning_states state
  where state.learner_id = p_learner_id
    and state.character_id = v_item.character_id
  for update;

  insert into public.daily_character_progress (
    session_id,
    learner_id,
    character_id,
    initial_queue_kind,
    starting_stage,
    required_confirmations
  )
  values (
    v_item.session_id,
    p_learner_id,
    v_item.character_id,
    v_item.queue_kind,
    v_state.stage,
    case when v_item.queue_kind = 'new' or v_state.stage <= 2 then 2 else 1 end
  )
  on conflict (session_id, character_id) do nothing;

  select *
  into v_progress
  from public.daily_character_progress progress
  where progress.session_id = v_item.session_id
    and progress.character_id = v_item.character_id
  for update;

  if v_progress.passed_at is not null then
    update public.daily_session_items item
    set status = 'answered', answered_at = coalesce(item.answered_at, now())
    where item.id = v_item.id;
    return jsonb_build_object('idempotent', true, 'daily_passed', true);
  end if;

  v_previous_stage := v_state.stage;
  v_next_stage := v_state.stage;
  v_next_due_at := v_state.due_at;
  v_mastered_at := v_state.mastered_at;
  v_required := v_progress.required_confirmations;
  v_stage_adjusted := v_progress.stage_adjusted;
  v_attempt_number := v_progress.attempt_count + 1;
  v_clean := p_result = 'known' and not p_assisted;

  if v_clean then
    v_clean_streak := least(2, v_progress.clean_streak + 1);
    v_failed_streak := 0;

    if v_clean_streak >= v_required then
      v_daily_passed := true;

      if not v_stage_adjusted then
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

      update public.learning_states state
      set stage = v_next_stage,
          due_at = v_next_due_at,
          last_result = 'known',
          consecutive_known = state.consecutive_known + 1,
          mastered_at = case when v_next_stage < 7 then null else v_mastered_at end,
          updated_at = now()
      where state.id = v_state.id;
    else
      -- 第一次干净认出只累计当天确认，不提前推进跨天阶段。
      update public.learning_states state
      set last_result = 'known',
          updated_at = now()
      where state.id = v_state.id;
    end if;
  else
    v_clean_streak := 0;
    v_failed_streak := case
      when p_assisted and v_progress.failed_streak >= 3 then 0
      else least(3, v_progress.failed_streak + 1)
    end;
    v_required := 2;

    if not v_stage_adjusted then
      v_next_stage := case v_state.stage
        when 0 then 0
        when 1 then 0
        when 2 then 1
        else v_state.stage - 2
      end;
      v_stage_adjusted := true;
    end if;

    v_next_due_at := now() + interval '1 day';
    v_mastered_at := case when v_next_stage < 7 then null else v_mastered_at end;

    update public.learning_states state
    set stage = v_next_stage,
        due_at = v_next_due_at,
        last_result = 'again',
        consecutive_known = 0,
        mastered_at = v_mastered_at,
        updated_at = now()
    where state.id = v_state.id;
  end if;

  update public.daily_character_progress progress
  set required_confirmations = v_required,
      clean_streak = v_clean_streak,
      failed_streak = v_failed_streak,
      attempt_count = progress.attempt_count + 1,
      known_count = progress.known_count + case when v_clean then 1 else 0 end,
      again_count = progress.again_count + case when v_clean then 0 else 1 end,
      assisted_count = progress.assisted_count + case when p_assisted then 1 else 0 end,
      first_result = coalesce(progress.first_result, case when v_clean then 'known' else 'again' end),
      stage_adjusted = v_stage_adjusted,
      passed_at = case when v_daily_passed then now() else progress.passed_at end,
      updated_at = now()
  where progress.session_id = v_item.session_id
    and progress.character_id = v_item.character_id;

  update public.daily_session_items item
  set status = 'answered', answered_at = now()
  where item.id = v_item.id;

  insert into public.learning_attempts (
    request_id,
    learner_id,
    character_id,
    state_id,
    session_item_id,
    result,
    queue_kind,
    previous_stage,
    next_stage,
    next_due_at,
    assisted,
    attempt_number,
    clean_streak_after,
    daily_passed,
    stage_adjusted_today
  )
  values (
    p_request_id,
    p_learner_id,
    v_item.character_id,
    v_state.id,
    v_item.id,
    case when v_clean then 'known' else 'again' end,
    v_item.queue_kind,
    v_previous_stage,
    v_next_stage,
    v_next_due_at,
    p_assisted,
    v_attempt_number,
    v_clean_streak,
    v_daily_passed,
    v_stage_adjusted
  );

  if not v_daily_passed then
    select coalesce(max(item.queue_position), 0) + 1
    into v_position
    from public.daily_session_items item
    where item.session_id = v_item.session_id;

    insert into public.daily_session_items (
      session_id,
      character_id,
      queue_kind,
      queue_position,
      retry_no
    )
    values (
      v_item.session_id,
      v_item.character_id,
      'same_day_retry',
      v_position,
      v_attempt_number
    );

    v_retry_added := true;
  end if;

  select count(*)::integer
  into v_pending_count
  from public.daily_session_items item
  where item.session_id = v_item.session_id
    and item.status = 'pending';

  select
    count(*)::integer,
    count(*) filter (where progress.passed_at is not null)::integer
  into v_today_total, v_today_passed
  from public.daily_character_progress progress
  where progress.session_id = v_item.session_id;

  return jsonb_build_object(
    'next_stage', v_next_stage,
    'next_due_at', v_next_due_at,
    'retry_added', v_retry_added,
    'reinforcement_added', v_retry_added,
    'pending_count', v_pending_count,
    'attempt_number', v_attempt_number,
    'clean_streak', v_clean_streak,
    'failed_streak', v_failed_streak,
    'required_confirmations', v_required,
    'daily_passed', v_daily_passed,
    'assisted', p_assisted,
    'stage_adjusted_today', v_stage_adjusted,
    'today_total', v_today_total,
    'today_passed', v_today_passed,
    'today_remaining', greatest(0, v_today_total - v_today_passed)
  );
end;
$$;

revoke execute on function public.answer_queue_item(uuid, uuid, text, uuid, boolean) from public, anon;
grant execute on function public.answer_queue_item(uuid, uuid, text, uuid, boolean) to authenticated;

commit;

-- 快速验证：应返回 1 张进度表、get_today_queue 和 5 参数 answer_queue_item。
select
  (select count(*)
   from information_schema.tables
   where table_schema = 'public'
     and table_name = 'daily_character_progress') as progress_table_count,
  (select count(*)
   from information_schema.routines
   where routine_schema = 'public'
     and routine_name = 'get_today_queue') as queue_function_count,
  (select count(*)
   from pg_proc procedure
   join pg_namespace namespace on namespace.oid = procedure.pronamespace
   where namespace.nspname = 'public'
     and procedure.proname = 'answer_queue_item'
     and procedure.pronargs = 5) as answer_function_count;
