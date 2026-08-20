-- 字芽：多家庭共享内容下的学习 RPC + 汉字自适应复习。
-- 前置：已经按顺序运行 001–015。
-- 本迁移不改变 014 的动态双确认、柔和降级和同日不限重试规则。

begin;

alter table public.learner_profiles
  drop constraint if exists learner_profiles_hanzi_review_limits_check;
alter table public.learner_profiles
  add constraint learner_profiles_hanzi_review_limits_check
  check (hanzi_max_review_limit >= hanzi_base_review_limit);

alter table public.daily_sessions
  add column if not exists review_mode_snapshot text
    check (review_mode_snapshot is null or review_mode_snapshot in ('adaptive', 'fixed')),
  add column if not exists planned_review_limit smallint
    check (planned_review_limit is null or planned_review_limit between 0 and 50),
  add column if not exists planned_new_limit smallint
    check (planned_new_limit is null or planned_new_limit between 0 and 50),
  add column if not exists due_backlog_at_start integer
    check (due_backlog_at_start is null or due_backlog_at_start >= 0),
  add column if not exists first_attempt_rate_snapshot numeric(5,4)
    check (first_attempt_rate_snapshot is null or first_attempt_rate_snapshot between 0 and 1);

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
  today_remaining integer,
  planned_review_limit smallint,
  planned_new_limit smallint,
  due_backlog integer,
  review_mode text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_today date;
  v_session_id uuid;
  v_position integer := 0;
  v_review_count integer := 0;
  v_new_count integer := 0;
  v_daily_new_limit integer;
  v_review_mode text;
  v_base_review_limit integer;
  v_max_review_limit integer;
  v_due_backlog integer := 0;
  v_review_target integer := 15;
  v_effective_new_limit integer := 0;
  v_first_attempt_total integer := 0;
  v_first_attempt_known integer := 0;
  v_first_attempt_rate numeric := null;
  v_today_total integer := 0;
  v_today_passed integer := 0;
  v_pending record;
  v_candidate record;
begin
  if not private.can_access_learner(p_learner_id) then
    raise exception '无权查看该孩子的今日任务' using errcode = '42501';
  end if;

  select
    learner.timezone,
    learner.daily_new_limit,
    learner.hanzi_review_mode,
    learner.hanzi_base_review_limit,
    learner.hanzi_max_review_limit
  into
    v_timezone,
    v_daily_new_limit,
    v_review_mode,
    v_base_review_limit,
    v_max_review_limit
  from public.learner_profiles learner
  where learner.id = p_learner_id;

  if not exists (
    select 1
    from public.learner_content_packages assignment
    join public.content_packages package on package.id = assignment.package_id
    where assignment.learner_id = p_learner_id
      and assignment.assignment_status = 'active'
      and package.status = 'published'
      and package.review_status = 'approved'
  ) then
    raise exception '未找到已分配且已发布的汉字字册' using errcode = '42501';
  end if;

  v_today := (now() at time zone v_timezone)::date;

  insert into public.daily_sessions (learner_id, date_local)
  values (p_learner_id, v_today)
  on conflict (learner_id, date_local) do nothing;

  select session.id
  into v_session_id
  from public.daily_sessions session
  where session.learner_id = p_learner_id
    and session.date_local = v_today
  for update;

  -- 只在当天第一次生成任务时拍下计划快照；家长当天改设置不会让队列跳动。
  if exists (
    select 1 from public.daily_sessions session
    where session.id = v_session_id and session.planned_review_limit is null
  ) then
    select count(distinct state.character_id)::integer
    into v_due_backlog
    from public.learning_states state
    where state.learner_id = p_learner_id
      and state.due_at <= now()
      and exists (
        select 1
        from public.learner_content_packages assignment
        join public.content_packages package on package.id = assignment.package_id
        join public.package_characters package_character
          on package_character.package_id = assignment.package_id
         and package_character.character_id = state.character_id
        where assignment.learner_id = p_learner_id
          and assignment.assignment_status = 'active'
          and package.status = 'published'
          and package.review_status = 'approved'
      );

    select
      count(*)::integer,
      count(*) filter (where attempt.result = 'known' and not attempt.assisted)::integer
    into v_first_attempt_total, v_first_attempt_known
    from public.learning_attempts attempt
    where attempt.learner_id = p_learner_id
      and attempt.answered_at >= now() - interval '7 days'
      and attempt.attempt_number = 1;

    if v_first_attempt_total > 0 then
      v_first_attempt_rate := v_first_attempt_known::numeric / v_first_attempt_total::numeric;
    end if;

    if v_review_mode = 'fixed' then
      v_review_target := v_base_review_limit;
      v_effective_new_limit := v_daily_new_limit;
    else
      v_review_target := case
        when v_due_backlog <= v_base_review_limit then v_base_review_limit
        when v_due_backlog <= 30 then least(v_max_review_limit, v_base_review_limit + 5)
        else v_max_review_limit
      end;

      v_effective_new_limit := case
        when v_due_backlog <= v_base_review_limit then v_daily_new_limit
        when v_due_backlog <= 30 then ceil(v_daily_new_limit / 2.0)::integer
        when v_due_backlog <= 60 then least(2, v_daily_new_limit)
        else 0
      end;

      -- 首次独立认出率明显偏低时，优先保证质量，不用大量卡片压孩子。
      if v_first_attempt_total >= 5 and v_first_attempt_rate < 0.60 then
        v_review_target := greatest(v_base_review_limit, least(v_review_target, 20));
        v_effective_new_limit := 0;
      end if;
    end if;

    update public.daily_sessions session
    set review_mode_snapshot = v_review_mode,
        planned_review_limit = v_review_target,
        planned_new_limit = v_effective_new_limit,
        due_backlog_at_start = v_due_backlog,
        first_attempt_rate_snapshot = v_first_attempt_rate
    where session.id = v_session_id;
  end if;

  select
    coalesce(session.review_mode_snapshot, v_review_mode),
    coalesce(session.planned_review_limit, v_base_review_limit),
    coalesce(session.planned_new_limit, v_daily_new_limit),
    coalesce(session.due_backlog_at_start, 0)
  into v_review_mode, v_review_target, v_effective_new_limit, v_due_backlog
  from public.daily_sessions session
  where session.id = v_session_id;

  select coalesce(max(item.queue_position), 0)
  into v_position
  from public.daily_session_items item
  where item.session_id = v_session_id;

  select count(*)
  into v_review_count
  from public.daily_session_items item
  where item.session_id = v_session_id
    and item.queue_kind in ('review', 'carry');

  -- 旧日未完成且已经产生学习状态的字先进入复习名额，但不再无限挤入当天。
  for v_pending in
    select distinct on (old_item.character_id)
      old_item.id,
      old_item.character_id,
      old_session.date_local,
      old_item.queue_position
    from public.daily_session_items old_item
    join public.daily_sessions old_session on old_session.id = old_item.session_id
    join public.learning_states state
      on state.learner_id = p_learner_id
     and state.character_id = old_item.character_id
    where old_session.learner_id = p_learner_id
      and old_session.date_local < v_today
      and old_item.status = 'pending'
      and not exists (
        select 1 from public.daily_session_items current_item
        where current_item.session_id = v_session_id
          and current_item.character_id = old_item.character_id
      )
    order by old_item.character_id, old_session.date_local, old_item.queue_position
    limit greatest(0, v_review_target - v_review_count)
  loop
    v_position := v_position + 1;
    update public.daily_session_items item set status = 'carried' where item.id = v_pending.id;
    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position, retry_no)
    values (v_session_id, v_pending.character_id, 'carry', v_position, 0)
    on conflict on constraint daily_session_items_session_character_kind_retry_key do nothing;
  end loop;

  -- 其余旧 pending 只关闭旧容器；有状态的会继续作为到期候选，未开始的仍会占用新字名额。
  update public.daily_session_items old_item
  set status = 'carried'
  from public.daily_sessions old_session
  where old_session.id = old_item.session_id
    and old_session.learner_id = p_learner_id
    and old_session.date_local < v_today
    and old_item.status = 'pending';

  select count(*) into v_review_count
  from public.daily_session_items item
  where item.session_id = v_session_id
    and item.queue_kind in ('review', 'carry');

  for v_candidate in
    select state.character_id
    from public.learning_states state
    left join public.learner_character_priorities priority
      on priority.learner_id = state.learner_id
     and priority.character_id = state.character_id
    where state.learner_id = p_learner_id
      and state.due_at <= now()
      and exists (
        select 1
        from public.learner_content_packages assignment
        join public.content_packages package on package.id = assignment.package_id
        join public.package_characters package_character
          on package_character.package_id = assignment.package_id
         and package_character.character_id = state.character_id
        where assignment.learner_id = p_learner_id
          and assignment.assignment_status = 'active'
          and package.status = 'published'
          and package.review_status = 'approved'
      )
      and not exists (
        select 1 from public.daily_session_items item
        where item.session_id = v_session_id and item.character_id = state.character_id
      )
    order by (priority.character_id is not null) desc, state.due_at, state.stage
    limit greatest(0, v_review_target - v_review_count)
  loop
    v_position := v_position + 1;
    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position, retry_no)
    values (v_session_id, v_candidate.character_id, 'review', v_position, 0);
  end loop;

  select count(*) into v_new_count
  from public.daily_session_items item
  where item.session_id = v_session_id and item.queue_kind = 'new';

  -- 未学重点字跨所有有效字册先占新字名额。
  for v_candidate in
    select
      priority.character_id,
      priority.selected_at,
      min(assignment.assignment_order) as first_assignment_order,
      min(assignment.linked_at) as first_linked_at,
      min(package_character.sequence) as first_sequence
    from public.learner_character_priorities priority
    join public.learner_content_packages assignment on assignment.learner_id = priority.learner_id
    join public.content_packages package on package.id = assignment.package_id
    join public.package_characters package_character
      on package_character.package_id = assignment.package_id
     and package_character.character_id = priority.character_id
    where priority.learner_id = p_learner_id
      and assignment.assignment_status = 'active'
      and package.status = 'published'
      and package.review_status = 'approved'
      and not exists (select 1 from public.learning_states state where state.learner_id = p_learner_id and state.character_id = priority.character_id)
      and not exists (select 1 from public.daily_session_items item where item.session_id = v_session_id and item.character_id = priority.character_id)
    group by priority.character_id, priority.selected_at
    order by priority.selected_at, first_assignment_order, first_linked_at, first_sequence, priority.character_id
    limit greatest(0, v_effective_new_limit - v_new_count)
  loop
    v_position := v_position + 1;
    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position, retry_no)
    values (v_session_id, v_candidate.character_id, 'new', v_position, 0);
  end loop;

  select count(*) into v_new_count
  from public.daily_session_items item
  where item.session_id = v_session_id and item.queue_kind = 'new';

  -- 普通新字按“孩子的字册顺序 + CSV 顺序”推进，同字跨字册只进一次。
  for v_candidate in
    select candidate.character_id
    from (
      select
        package_character.character_id,
        min(assignment.assignment_order) as first_assignment_order,
        min(assignment.linked_at) as first_linked_at,
        min(package_character.sequence) as first_sequence
      from public.learner_content_packages assignment
      join public.content_packages package on package.id = assignment.package_id
      join public.package_characters package_character on package_character.package_id = assignment.package_id
      where assignment.learner_id = p_learner_id
        and assignment.assignment_status = 'active'
        and package.status = 'published'
        and package.review_status = 'approved'
        and not exists (select 1 from public.learning_states state where state.learner_id = p_learner_id and state.character_id = package_character.character_id)
        and not exists (select 1 from public.daily_session_items item where item.session_id = v_session_id and item.character_id = package_character.character_id)
      group by package_character.character_id
    ) candidate
    order by candidate.first_assignment_order, candidate.first_linked_at, candidate.first_sequence, candidate.character_id
    limit greatest(0, v_effective_new_limit - v_new_count)
  loop
    v_position := v_position + 1;
    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position, retry_no)
    values (v_session_id, v_candidate.character_id, 'new', v_position, 0);
  end loop;

  -- 与 014 相同：为当天每个不同汉字建立确认进度。
  with first_items as (
    select distinct on (item.character_id) item.character_id, item.queue_kind, item.queue_position
    from public.daily_session_items item
    where item.session_id = v_session_id
    order by item.character_id, item.queue_position
  ), normalized as (
    select
      first_item.character_id,
      first_item.queue_kind,
      coalesce((
        select attempt.previous_stage
        from public.learning_attempts attempt
        join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id
        where attempt_item.session_id = v_session_id and attempt.character_id = first_item.character_id
        order by attempt.answered_at, attempt.id limit 1
      ), state.stage, 0::smallint)::smallint as starting_stage,
      (select count(*)::integer from public.learning_attempts attempt join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id where attempt_item.session_id = v_session_id and attempt.character_id = first_item.character_id) as legacy_attempt_count,
      (select count(*) filter (where attempt.result = 'known')::integer from public.learning_attempts attempt join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id where attempt_item.session_id = v_session_id and attempt.character_id = first_item.character_id) as legacy_known_count,
      (select count(*) filter (where attempt.result = 'again')::integer from public.learning_attempts attempt join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id where attempt_item.session_id = v_session_id and attempt.character_id = first_item.character_id) as legacy_again_count,
      (select attempt.result from public.learning_attempts attempt join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id where attempt_item.session_id = v_session_id and attempt.character_id = first_item.character_id order by attempt.answered_at, attempt.id limit 1) as legacy_first_result,
      (select max(attempt.answered_at) from public.learning_attempts attempt join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id where attempt_item.session_id = v_session_id and attempt.character_id = first_item.character_id) as legacy_last_answered_at,
      exists (select 1 from public.learning_attempts attempt join public.daily_session_items attempt_item on attempt_item.id = attempt.session_item_id where attempt_item.session_id = v_session_id and attempt.character_id = first_item.character_id and attempt.next_stage < attempt.previous_stage) as legacy_stage_adjusted,
      exists (select 1 from public.daily_session_items pending_item where pending_item.session_id = v_session_id and pending_item.character_id = first_item.character_id and pending_item.status = 'pending') as has_pending
    from first_items first_item
    left join public.learning_states state on state.learner_id = p_learner_id and state.character_id = first_item.character_id
  )
  insert into public.daily_character_progress (
    session_id, learner_id, character_id, initial_queue_kind, starting_stage,
    required_confirmations, clean_streak, attempt_count, known_count, again_count,
    assisted_count, first_result, stage_adjusted, passed_at
  )
  select
    v_session_id, p_learner_id, normalized.character_id, normalized.queue_kind, normalized.starting_stage,
    case when normalized.queue_kind = 'new' or normalized.starting_stage <= 2 then 2 else 1 end,
    case
      when not normalized.has_pending and normalized.legacy_attempt_count > 0 then case when normalized.queue_kind = 'new' or normalized.starting_stage <= 2 then 2 else 1 end
      when normalized.has_pending and normalized.legacy_first_result = 'known' and not normalized.legacy_stage_adjusted then 1
      else 0
    end,
    normalized.legacy_attempt_count, normalized.legacy_known_count, normalized.legacy_again_count, 0,
    normalized.legacy_first_result, normalized.legacy_stage_adjusted,
    case when not normalized.has_pending and normalized.legacy_attempt_count > 0 then normalized.legacy_last_answered_at else null end
  from normalized
  on conflict on constraint daily_character_progress_pkey do nothing;

  select count(*)::integer, count(*) filter (where progress.passed_at is not null)::integer
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
    greatest(0, v_today_total - v_today_passed),
    v_review_target::smallint,
    v_effective_new_limit::smallint,
    v_due_backlog,
    v_review_mode
  from public.daily_session_items item
  join public.characters character on character.id = item.character_id
  join public.daily_character_progress progress on progress.session_id = item.session_id and progress.character_id = item.character_id
  left join public.learning_states state on state.learner_id = p_learner_id and state.character_id = item.character_id
  where item.session_id = v_session_id
    and item.status = 'pending'
    and progress.passed_at is null
  order by item.queue_position;
end;
$$;

revoke execute on function public.get_today_queue(uuid) from public, anon;
grant execute on function public.get_today_queue(uuid) to authenticated;

-- 014 的回答规则原样保留，只把授权改为家庭成员/空间管理员。
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
  if not private.can_access_learner(p_learner_id) then
    raise exception '无权操作该孩子档案' using errcode = '42501';
  end if;

  select learner.timezone into v_timezone
  from public.learner_profiles learner
  where learner.id = p_learner_id;
  v_today := (now() at time zone v_timezone)::date;

  if exists (select 1 from public.learning_attempts attempt where attempt.request_id = p_request_id) then
    return jsonb_build_object('idempotent', true);
  end if;

  select item.*, session.learner_id, session.date_local
  into v_item
  from public.daily_session_items item
  join public.daily_sessions session on session.id = item.session_id
  where item.id = p_session_item_id and session.learner_id = p_learner_id
  for update of item;

  if not found then raise exception '找不到待回答的学习卡' using errcode = '42501'; end if;
  if v_item.date_local <> v_today then raise exception '这张学习卡已经跨日，请重新加载今日任务' using errcode = '22023'; end if;
  if v_item.status <> 'pending' then return jsonb_build_object('idempotent', true); end if;

  perform 1 from public.daily_sessions session where session.id = v_item.session_id for update;

  insert into public.learning_states (learner_id, character_id, stage, due_at)
  values (p_learner_id, v_item.character_id, 0, now())
  on conflict (learner_id, character_id) do nothing;

  select * into v_state
  from public.learning_states state
  where state.learner_id = p_learner_id and state.character_id = v_item.character_id
  for update;

  insert into public.daily_character_progress (
    session_id, learner_id, character_id, initial_queue_kind, starting_stage, required_confirmations
  ) values (
    v_item.session_id, p_learner_id, v_item.character_id, v_item.queue_kind, v_state.stage,
    case when v_item.queue_kind = 'new' or v_state.stage <= 2 then 2 else 1 end
  ) on conflict (session_id, character_id) do nothing;

  select * into v_progress
  from public.daily_character_progress progress
  where progress.session_id = v_item.session_id and progress.character_id = v_item.character_id
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
      update public.learning_states state set last_result = 'known', updated_at = now() where state.id = v_state.id;
    end if;
  else
    v_clean_streak := 0;
    v_failed_streak := case when p_assisted and v_progress.failed_streak >= 3 then 0 else least(3, v_progress.failed_streak + 1) end;
    v_required := 2;
    if not v_stage_adjusted then
      v_next_stage := case v_state.stage when 0 then 0 when 1 then 0 when 2 then 1 else v_state.stage - 2 end;
      v_stage_adjusted := true;
    end if;
    v_next_due_at := now() + interval '1 day';
    v_mastered_at := case when v_next_stage < 7 then null else v_mastered_at end;
    update public.learning_states state
    set stage = v_next_stage, due_at = v_next_due_at, last_result = 'again', consecutive_known = 0,
        mastered_at = v_mastered_at, updated_at = now()
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
  where progress.session_id = v_item.session_id and progress.character_id = v_item.character_id;

  update public.daily_session_items item set status = 'answered', answered_at = now() where item.id = v_item.id;

  insert into public.learning_attempts (
    request_id, learner_id, character_id, state_id, session_item_id, result, queue_kind,
    previous_stage, next_stage, next_due_at, assisted, attempt_number, clean_streak_after,
    daily_passed, stage_adjusted_today
  ) values (
    p_request_id, p_learner_id, v_item.character_id, v_state.id, v_item.id,
    case when v_clean then 'known' else 'again' end, v_item.queue_kind,
    v_previous_stage, v_next_stage, v_next_due_at, p_assisted, v_attempt_number,
    v_clean_streak, v_daily_passed, v_stage_adjusted
  );

  if not v_daily_passed then
    select coalesce(max(item.queue_position), 0) + 1 into v_position
    from public.daily_session_items item where item.session_id = v_item.session_id;
    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position, retry_no)
    values (v_item.session_id, v_item.character_id, 'same_day_retry', v_position, v_attempt_number);
    v_retry_added := true;
  end if;

  select count(*)::integer into v_pending_count
  from public.daily_session_items item where item.session_id = v_item.session_id and item.status = 'pending';
  select count(*)::integer, count(*) filter (where progress.passed_at is not null)::integer
  into v_today_total, v_today_passed
  from public.daily_character_progress progress where progress.session_id = v_item.session_id;

  return jsonb_build_object(
    'next_stage', v_next_stage, 'next_due_at', v_next_due_at,
    'retry_added', v_retry_added, 'reinforcement_added', v_retry_added,
    'pending_count', v_pending_count, 'attempt_number', v_attempt_number,
    'clean_streak', v_clean_streak, 'failed_streak', v_failed_streak,
    'required_confirmations', v_required, 'daily_passed', v_daily_passed,
    'assisted', p_assisted, 'stage_adjusted_today', v_stage_adjusted,
    'today_total', v_today_total, 'today_passed', v_today_passed,
    'today_remaining', greatest(0, v_today_total - v_today_passed)
  );
end;
$$;

revoke execute on function public.answer_queue_item(uuid, uuid, text, uuid, boolean) from public, anon;
grant execute on function public.answer_queue_item(uuid, uuid, text, uuid, boolean) to authenticated;

drop function if exists public.set_character_priorities(uuid, uuid[], uuid[]);
create function public.set_character_priorities(
  p_learner_id uuid,
  p_scope_character_ids uuid[],
  p_priority_character_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_ids uuid[] := coalesce(p_scope_character_ids, array[]::uuid[]);
  v_priority_ids uuid[] := coalesce(p_priority_character_ids, array[]::uuid[]);
  v_saved_count integer := 0;
begin
  if not private.can_access_learner(p_learner_id) then
    raise exception '无权管理该孩子的重点字' using errcode = '42501';
  end if;
  if cardinality(v_scope_ids) > 100 or cardinality(v_priority_ids) > 100 then
    raise exception '单次最多管理 100 个汉字' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_priority_ids) chosen(character_id) where not chosen.character_id = any(v_scope_ids)) then
    raise exception '重点字必须来自当前管理范围' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(v_scope_ids) scoped(character_id)
    where not exists (
      select 1
      from public.learner_content_packages assignment
      join public.content_packages package on package.id = assignment.package_id
      join public.package_characters package_character
        on package_character.package_id = assignment.package_id
       and package_character.character_id = scoped.character_id
      where assignment.learner_id = p_learner_id
        and assignment.assignment_status = 'active'
        and package.status = 'published'
        and package.review_status = 'approved'
    )
  ) then
    raise exception '所选汉字不属于该孩子的有效字库' using errcode = '42501';
  end if;

  delete from public.learner_character_priorities priority
  where priority.learner_id = p_learner_id
    and priority.character_id = any(v_scope_ids)
    and not priority.character_id = any(v_priority_ids);
  insert into public.learner_character_priorities (learner_id, character_id)
  select p_learner_id, chosen.character_id from unnest(v_priority_ids) chosen(character_id)
  on conflict (learner_id, character_id) do nothing;
  select count(*)::integer into v_saved_count
  from public.learner_character_priorities priority where priority.learner_id = p_learner_id;
  return v_saved_count;
end;
$$;

revoke execute on function public.set_character_priorities(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.set_character_priorities(uuid, uuid[], uuid[]) to authenticated;

drop function if exists public.get_library_rows(uuid, text, text, text, text, uuid, integer, integer);
create function public.get_library_rows(
  p_learner_id uuid,
  p_query text default '',
  p_status text default 'all',
  p_attempts text default 'all',
  p_priority text default 'all',
  p_package_id uuid default null,
  p_page integer default 1,
  p_page_size integer default 48
)
returns table (
  character_id uuid, hanzi text, pinyin_marked text, meaning text, word_one text,
  word_two text, example_sentence text, sequence integer, source_package_ids uuid[],
  source_package_titles text, attempt_count integer, known_count integer, again_count integer,
  stage smallint, due_at timestamptz, last_result text, consecutive_known integer,
  mastered_at timestamptz, last_answered_at timestamptz, needs_review boolean,
  is_priority boolean, priority_selected_at timestamptz, total_count integer,
  filtered_count integer, learned_total integer, stable_total integer, due_total integer,
  priority_total integer, priority_unstarted_total integer, priority_learning_total integer,
  priority_stable_total integer
)
language sql
security definer
set search_path = ''
as $$
  with authorized as (
    select learner.id from public.learner_profiles learner
    where learner.id = p_learner_id and private.can_access_learner(learner.id)
  ), attempts as (
    select attempt.character_id,
      count(*)::integer as attempt_count,
      count(*) filter (where attempt.result = 'known')::integer as known_count,
      count(*) filter (where attempt.result = 'again')::integer as again_count,
      max(attempt.answered_at) as last_answered_at
    from public.learning_attempts attempt
    where attempt.learner_id = p_learner_id
    group by attempt.character_id
  ), base as (
    select
      character.id as character_id,
      character.character as hanzi,
      character.pinyin_marked,
      character.meaning,
      character.word_one,
      character.word_two,
      character.example_sentence,
      min(package_character.sequence) as sequence,
      array_agg(package.id order by assignment.assignment_order, assignment.linked_at) as source_package_ids,
      string_agg(package.title, ' · ' order by assignment.assignment_order, assignment.linked_at) as source_package_titles,
      coalesce(attempts.attempt_count, 0) as attempt_count,
      coalesce(attempts.known_count, 0) as known_count,
      coalesce(attempts.again_count, 0) as again_count,
      coalesce(state.stage, 0::smallint) as stage,
      state.due_at,
      state.last_result,
      coalesce(state.consecutive_known, 0) as consecutive_known,
      state.mastered_at,
      attempts.last_answered_at,
      coalesce(state.due_at <= now(), false) as needs_review,
      (priority.character_id is not null) as is_priority,
      priority.selected_at as priority_selected_at
    from authorized
    join public.learner_content_packages assignment
      on assignment.learner_id = authorized.id and assignment.assignment_status = 'active'
    join public.content_packages package
      on package.id = assignment.package_id and package.status = 'published' and package.review_status = 'approved'
    join public.package_characters package_character on package_character.package_id = package.id
    join public.characters character on character.id = package_character.character_id
    left join public.learning_states state on state.learner_id = p_learner_id and state.character_id = character.id
    left join attempts on attempts.character_id = character.id
    left join public.learner_character_priorities priority on priority.learner_id = p_learner_id and priority.character_id = character.id
    where p_package_id is null or package.id = p_package_id
    group by character.id, character.character, character.pinyin_marked, character.meaning,
      character.word_one, character.word_two, character.example_sentence, attempts.attempt_count,
      attempts.known_count, attempts.again_count, state.stage, state.due_at, state.last_result,
      state.consecutive_known, state.mastered_at, attempts.last_answered_at,
      priority.character_id, priority.selected_at
  ), filtered as (
    select * from base base_row
    where (case p_status
      when 'unstarted' then base_row.attempt_count = 0
      when 'learning' then base_row.attempt_count > 0 and base_row.stage < 5
      when 'learned' then base_row.stage >= 5
      when 'stable' then base_row.stage between 5 and 6
      when 'mastered' then base_row.stage >= 7
      when 'due' then base_row.attempt_count > 0 and base_row.needs_review
      else true end)
    and (case p_attempts
      when 'never' then base_row.attempt_count = 0
      when '1-2' then base_row.attempt_count between 1 and 2
      when '3-5' then base_row.attempt_count between 3 and 5
      when '6+' then base_row.attempt_count >= 6
      else true end)
    and (case p_priority
      when 'priority' then base_row.is_priority
      when 'priority_unstarted' then base_row.is_priority and base_row.attempt_count = 0
      when 'priority_learning' then base_row.is_priority and base_row.attempt_count > 0 and base_row.stage < 5
      when 'priority_stable' then base_row.is_priority and base_row.stage >= 5
      else true end)
    and (
      coalesce(nullif(btrim(p_query), ''), '') = ''
      or base_row.hanzi ilike '%' || p_query || '%'
      or base_row.pinyin_marked ilike '%' || p_query || '%'
      or base_row.meaning ilike '%' || p_query || '%'
      or coalesce(base_row.word_one, '') ilike '%' || p_query || '%'
      or coalesce(base_row.word_two, '') ilike '%' || p_query || '%'
      or coalesce(base_row.example_sentence, '') ilike '%' || p_query || '%'
    )
  ), metrics as (
    select count(*)::integer as total_count,
      count(*) filter (where attempt_count > 0)::integer as learned_total,
      count(*) filter (where stage >= 5)::integer as stable_total,
      count(*) filter (where needs_review)::integer as due_total,
      count(*) filter (where is_priority)::integer as priority_total,
      count(*) filter (where is_priority and attempt_count = 0)::integer as priority_unstarted_total,
      count(*) filter (where is_priority and attempt_count > 0 and stage < 5)::integer as priority_learning_total,
      count(*) filter (where is_priority and stage >= 5)::integer as priority_stable_total
    from base
  ), filtered_metrics as (select count(*)::integer as filtered_count from filtered)
  select
    filtered_row.character_id, filtered_row.hanzi, filtered_row.pinyin_marked, filtered_row.meaning, filtered_row.word_one,
    filtered_row.word_two, filtered_row.example_sentence, filtered_row.sequence, filtered_row.source_package_ids,
    filtered_row.source_package_titles, filtered_row.attempt_count, filtered_row.known_count, filtered_row.again_count,
    filtered_row.stage, filtered_row.due_at, filtered_row.last_result, filtered_row.consecutive_known, filtered_row.mastered_at,
    filtered_row.last_answered_at, filtered_row.needs_review, filtered_row.is_priority, filtered_row.priority_selected_at,
    metrics.total_count, filtered_metrics.filtered_count, metrics.learned_total,
    metrics.stable_total, metrics.due_total, metrics.priority_total,
    metrics.priority_unstarted_total, metrics.priority_learning_total, metrics.priority_stable_total
  from filtered filtered_row cross join metrics cross join filtered_metrics
  order by filtered_row.is_priority desc, filtered_row.priority_selected_at nulls last, filtered_row.sequence, filtered_row.hanzi
  limit least(greatest(coalesce(p_page_size, 48), 1), 100)
  offset ((least(greatest(coalesce(p_page, 1), 1), 100000) - 1) * least(greatest(coalesce(p_page_size, 48), 1), 100));
$$;

revoke execute on function public.get_library_rows(uuid, text, text, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.get_library_rows(uuid, text, text, text, text, uuid, integer, integer) to authenticated;

drop function if exists public.record_music_practice(uuid, uuid, text, text, uuid);
create function public.record_music_practice(
  p_learner_id uuid,
  p_item_id uuid,
  p_result text,
  p_guess_note text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_item_type text;
  v_state public.music_learning_states%rowtype;
  v_previous_stage smallint;
  v_next_stage smallint;
  v_next_due_at timestamptz;
  v_interval interval;
  v_success boolean := false;
begin
  if not private.can_access_learner(p_learner_id) then
    raise exception '无权操作该孩子档案' using errcode = '42501';
  end if;
  if exists (select 1 from public.music_practice_attempts attempt where attempt.request_id = p_request_id) then
    return jsonb_build_object('idempotent', true);
  end if;
  select learner.timezone into v_timezone from public.learner_profiles learner where learner.id = p_learner_id;
  select item.item_type into v_item_type
  from public.music_items item
  join public.learner_music_items assignment
    on assignment.item_id = item.id and assignment.learner_id = p_learner_id
  where item.id = p_item_id
    and assignment.assignment_status = 'active'
    and item.status = 'published'
    and item.review_status = 'approved';
  if not found then raise exception '找不到已分配给孩子的音乐内容' using errcode = '42501'; end if;

  if (v_item_type = 'song' and p_result not in ('song_listened', 'song_sang_along', 'song_prompted', 'song_independent'))
    or (v_item_type = 'instrument' and p_result not in ('instrument_known', 'instrument_again'))
    or (v_item_type = 'rhythm' and p_result not in ('rhythm_known', 'rhythm_again')) then
    raise exception '练习结果与内容类型不匹配' using errcode = '22023';
  end if;

  insert into public.music_learning_states (learner_id, item_id, stage, due_at)
  values (p_learner_id, p_item_id, 0, now())
  on conflict (learner_id, item_id) do nothing;
  select * into v_state from public.music_learning_states state
  where state.learner_id = p_learner_id and state.item_id = p_item_id for update;
  v_previous_stage := v_state.stage;

  if p_result = 'song_listened' then
    v_next_stage := v_state.stage; v_next_due_at := now() + interval '1 day';
  elsif p_result = 'song_sang_along' then
    v_next_stage := greatest(1, v_state.stage); v_next_due_at := now() + interval '1 day';
  elsif p_result = 'song_prompted' then
    v_next_stage := least(7, greatest(2, v_state.stage + 1)); v_success := true;
  elsif p_result in ('song_independent', 'instrument_known', 'rhythm_known') then
    v_next_stage := least(7, v_state.stage + 1); v_success := true;
  else
    v_next_stage := greatest(0, v_state.stage - 2); v_next_due_at := now() + interval '1 day';
  end if;
  if v_next_due_at is null then
    v_interval := case v_next_stage
      when 0 then interval '1 day' when 1 then interval '1 day' when 2 then interval '3 days'
      when 3 then interval '7 days' when 4 then interval '14 days' when 5 then interval '30 days'
      when 6 then interval '60 days'
      else case when v_state.stage = 7 then interval '180 days' else interval '90 days' end
    end;
    v_next_due_at := now() + v_interval;
  end if;

  update public.music_learning_states state
  set stage = v_next_stage, due_at = v_next_due_at, last_result = p_result,
      consecutive_success = case when p_result = 'song_listened' then state.consecutive_success when v_success then state.consecutive_success + 1 else 0 end,
      updated_at = now()
  where state.id = v_state.id;
  insert into public.music_practice_attempts (
    request_id, learner_id, item_id, result, guess_note, previous_stage, next_stage,
    next_due_at, practiced_local_date
  ) values (
    p_request_id, p_learner_id, p_item_id, p_result,
    nullif(btrim(coalesce(p_guess_note, '')), ''), v_previous_stage, v_next_stage,
    v_next_due_at, (now() at time zone v_timezone)::date
  );
  return jsonb_build_object('next_stage', v_next_stage, 'next_due_at', v_next_due_at, 'idempotent', false);
end;
$$;

revoke execute on function public.record_music_practice(uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.record_music_practice(uuid, uuid, text, text, uuid) to authenticated;

create or replace function public.record_catechism_attempt(
  p_learner_id uuid,
  p_item_id uuid,
  p_result text,
  p_local_date date,
  p_request_id uuid,
  p_note text default null
)
returns table (
  next_stage integer, next_due_date date, attempt_total integer,
  recited_total integer, again_total integer, was_idempotent boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.catechism_learning_states%rowtype;
  v_stage_before smallint;
  v_next_stage smallint;
  v_next_date date;
  v_interval_days integer;
begin
  if not private.can_access_learner(p_learner_id) then raise exception '无权操作该孩子档案' using errcode = '42501'; end if;
  if p_result not in ('recited', 'again') then raise exception '练习结果无效'; end if;
  if p_local_date is null or p_local_date < current_date - 2 or p_local_date > current_date + 2 then raise exception '练习日期无效'; end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception '备注不能超过 500 个字'; end if;

  if not exists (
    select 1
    from public.learner_catechism_collections assignment
    join public.catechism_collections collection on collection.id = assignment.collection_id
    join public.catechism_items item on item.collection_id = collection.id
    where assignment.learner_id = p_learner_id
      and assignment.assignment_status = 'active'
      and item.id = p_item_id
      and item.status = 'active'
      and collection.status = 'published'
      and collection.review_status = 'approved'
  ) then
    raise exception '这个问题未发布或不属于所选孩子';
  end if;

  insert into public.catechism_learning_states (learner_id, item_id)
  values (p_learner_id, p_item_id) on conflict (learner_id, item_id) do nothing;
  select state.* into v_state from public.catechism_learning_states state
  where state.learner_id = p_learner_id and state.item_id = p_item_id for update;

  if exists (select 1 from public.catechism_attempts attempt where attempt.learner_id = p_learner_id and attempt.request_id = p_request_id) then
    return query select v_state.stage::integer, v_state.next_review_date, v_state.total_attempts,
      v_state.success_count, v_state.again_count, true;
    return;
  end if;

  v_stage_before := v_state.stage;
  if v_state.last_practiced_local_date = p_local_date and p_result = 'recited' then
    v_next_stage := v_state.stage; v_next_date := coalesce(v_state.next_review_date, p_local_date + 1);
  elsif v_state.last_practiced_local_date = p_local_date and p_result = 'again' and v_state.last_result = 'again' then
    v_next_stage := v_state.stage; v_next_date := coalesce(v_state.next_review_date, p_local_date + 1);
  elsif p_result = 'recited' then
    v_next_stage := least(v_state.stage + 1, 7);
    v_interval_days := case v_next_stage when 1 then 1 when 2 then 3 when 3 then 7 when 4 then 14 when 5 then 30 when 6 then 60 when 7 then case when v_state.stage = 7 then 180 else 90 end else 1 end;
    v_next_date := p_local_date + v_interval_days;
  else
    v_next_stage := greatest(v_state.stage - 2, 0); v_next_date := p_local_date + 1;
  end if;

  update public.catechism_learning_states state
  set stage = v_next_stage, next_review_date = v_next_date, last_result = p_result,
      total_attempts = state.total_attempts + 1,
      success_count = state.success_count + case when p_result = 'recited' then 1 else 0 end,
      again_count = state.again_count + case when p_result = 'again' then 1 else 0 end,
      first_practiced_local_date = coalesce(state.first_practiced_local_date, p_local_date),
      last_practiced_at = now(), last_practiced_local_date = p_local_date,
      mastered_at = case when p_result = 'again' then null when v_next_stage = 7 then coalesce(state.mastered_at, now()) else state.mastered_at end,
      updated_at = now()
  where state.learner_id = p_learner_id and state.item_id = p_item_id
  returning state.* into v_state;

  insert into public.catechism_attempts (
    learner_id, item_id, recorded_by, result, practiced_local_date,
    stage_before, stage_after, next_review_date, note, request_id
  ) values (
    p_learner_id, p_item_id, (select auth.uid()), p_result, p_local_date,
    v_stage_before, v_next_stage, v_next_date, nullif(btrim(p_note), ''), p_request_id
  );
  return query select v_state.stage::integer, v_state.next_review_date, v_state.total_attempts,
    v_state.success_count, v_state.again_count, false;
end;
$$;

revoke execute on function public.record_catechism_attempt(uuid, uuid, text, date, uuid, text) from public, anon;
grant execute on function public.record_catechism_attempt(uuid, uuid, text, date, uuid, text) to authenticated;

-- 共享资源也应该正常积累奖励：奖励只信任已写入的真实练习记录，不再要求资源创建人必须是当前家长。
create or replace function public.register_reward_activity(
  p_learner_id uuid,
  p_activity_type text,
  p_source_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope_id uuid;
  v_local_date date;
  v_music_type text;
  v_music_result text;
  v_account public.reward_accounts%rowtype;
  v_existing_counted boolean;
  v_daily_count integer;
  v_event_id uuid;
  v_new_growth_points integer;
  v_awarded boolean := false;
  v_balance integer;
  v_positive_count integer;
  v_sticker_code text;
begin
  if p_activity_type not in ('poem', 'song', 'instrument', 'rhythm') then
    raise exception '奖励活动类型不正确' using errcode = '22023';
  end if;
  if not private.can_access_learner(p_learner_id) then
    raise exception '无权操作该孩子档案' using errcode = '42501';
  end if;

  if p_activity_type = 'poem' then
    select attempt.poem_id, attempt.recited_local_date
    into v_scope_id, v_local_date
    from public.poem_recitation_attempts attempt
    where attempt.id = p_source_record_id
      and attempt.learner_id = p_learner_id;
    if not found then
      raise exception '找不到这次诗词练习记录' using errcode = '42501';
    end if;
  else
    select attempt.item_id, attempt.practiced_local_date, item.item_type, attempt.result
    into v_scope_id, v_local_date, v_music_type, v_music_result
    from public.music_practice_attempts attempt
    join public.music_items item on item.id = attempt.item_id
    where attempt.id = p_source_record_id
      and attempt.learner_id = p_learner_id;
    if not found then
      raise exception '找不到这次音乐练习记录' using errcode = '42501';
    end if;
    if v_music_type <> p_activity_type then
      raise exception '音乐练习类型与奖励活动不匹配' using errcode = '22023';
    end if;
    if p_activity_type = 'song' and v_music_result = 'song_listened' then
      select coalesce(sum(ledger.amount), 0)::integer into v_balance
      from public.reward_ledger ledger where ledger.learner_id = p_learner_id;
      return jsonb_build_object(
        'eligible', false, 'credited', false, 'awarded', false, 'reason', 'listen_only',
        'balance', v_balance,
        'progress', coalesce((select account.growth_points from public.reward_accounts account where account.learner_id = p_learner_id), 0)
      );
    end if;
  end if;

  insert into public.reward_accounts (learner_id) values (p_learner_id)
  on conflict (learner_id) do nothing;
  select * into v_account from public.reward_accounts account
  where account.learner_id = p_learner_id for update;

  select event.counted into v_existing_counted
  from public.reward_growth_events event
  where event.learner_id = p_learner_id
    and event.activity_type = p_activity_type
    and event.source_scope_id = v_scope_id
    and event.local_date = v_local_date;
  if found then
    select coalesce(sum(ledger.amount), 0)::integer into v_balance
    from public.reward_ledger ledger where ledger.learner_id = p_learner_id;
    return jsonb_build_object(
      'eligible', true, 'credited', false, 'awarded', false, 'duplicate', true,
      'reason', case when v_existing_counted then 'same_item_today' else 'daily_limit' end,
      'daily_limit_reached', not v_existing_counted, 'balance', v_balance,
      'progress', v_account.growth_points,
      'needed', v_account.growth_points_per_sticker - v_account.growth_points,
      'goal', v_account.sticker_goal
    );
  end if;

  select count(*) filter (where event.counted)::integer into v_daily_count
  from public.reward_growth_events event
  where event.learner_id = p_learner_id and event.local_date = v_local_date;
  if v_daily_count >= v_account.daily_growth_point_limit then
    insert into public.reward_growth_events (
      learner_id, activity_type, source_record_id, source_scope_id, local_date, points, counted, reason
    ) values (
      p_learner_id, p_activity_type, p_source_record_id, v_scope_id, v_local_date, 0, false, 'daily_limit'
    ) on conflict (learner_id, activity_type, source_scope_id, local_date) do nothing;
    select coalesce(sum(ledger.amount), 0)::integer into v_balance
    from public.reward_ledger ledger where ledger.learner_id = p_learner_id;
    return jsonb_build_object(
      'eligible', true, 'credited', false, 'awarded', false, 'reason', 'daily_limit',
      'daily_limit_reached', true, 'balance', v_balance, 'progress', v_account.growth_points,
      'needed', v_account.growth_points_per_sticker - v_account.growth_points,
      'goal', v_account.sticker_goal
    );
  end if;

  insert into public.reward_growth_events (
    learner_id, activity_type, source_record_id, source_scope_id, local_date, points, counted, reason
  ) values (
    p_learner_id, p_activity_type, p_source_record_id, v_scope_id, v_local_date, 1, true, 'credited'
  ) returning id into v_event_id;
  v_new_growth_points := v_account.growth_points + 1;

  if v_new_growth_points >= v_account.growth_points_per_sticker then
    v_new_growth_points := v_new_growth_points - v_account.growth_points_per_sticker;
    v_awarded := true;
    select count(*)::integer into v_positive_count
    from public.reward_ledger ledger
    where ledger.learner_id = p_learner_id and ledger.amount > 0;
    v_sticker_code := (array[
      'sprout', 'sun', 'rabbit', 'whale', 'star',
      'flower', 'rocket', 'rainbow', 'bear', 'moon'
    ]::text[])[1 + (v_positive_count % 10)];
    insert into public.reward_ledger (
      learner_id, event_type, amount, title, note, sticker_code, local_date,
      dedupe_key, reference_id, created_by
    ) values (
      p_learner_id, 'growth_bundle', 1, '集齐三颗成长小星星', '诗词或音乐练习积累兑换',
      v_sticker_code, v_local_date, 'growth:' || v_event_id::text, v_event_id, (select auth.uid())
    );
  end if;

  update public.reward_accounts account
  set growth_points = v_new_growth_points, updated_at = now()
  where account.learner_id = p_learner_id;
  select coalesce(sum(ledger.amount), 0)::integer into v_balance
  from public.reward_ledger ledger where ledger.learner_id = p_learner_id;
  return jsonb_build_object(
    'eligible', true, 'credited', true, 'awarded', v_awarded, 'duplicate', false,
    'reason', case when v_awarded then 'growth_sticker_awarded' else 'growth_point_credited' end,
    'daily_limit_reached', false, 'daily_credited', v_daily_count + 1,
    'balance', v_balance, 'progress', v_new_growth_points,
    'needed', v_account.growth_points_per_sticker - v_new_growth_points,
    'goal', v_account.sticker_goal,
    'sticker_code', case when v_awarded then v_sticker_code else null end,
    'title', case when v_awarded then '勇敢探索' else null end
  );
end;
$$;

revoke execute on function public.register_reward_activity(uuid, text, uuid) from public, anon;
grant execute on function public.register_reward_activity(uuid, text, uuid) to authenticated;

commit;
