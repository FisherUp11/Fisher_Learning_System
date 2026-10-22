-- 字芽 039：固定汉字每日实际字单，完成后同日不再自动补字。
-- 前置：001–038 已运行。可重复运行；不批量修改历史学习/奖励记录。
-- 老计划在真实用户下一次加载时安全接纳，仍受家庭、模块和有效期校验。
begin;
alter table public.daily_sessions add column if not exists plan_frozen_at timestamptz;
comment on column public.daily_sessions.plan_frozen_at is '当天实际字单生成/接纳时间；同日不再补入新候选，原字同日强化不受影响';
-- 客户端只能读取会话；计划/完成元数据仅由带权限检查的事务 RPC 写入。
revoke insert, update, delete on public.daily_sessions from authenticated, anon;

create or replace function private.get_frozen_hanzi_queue(p_learner_id uuid)
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
  v_plan_frozen_at timestamptz;
  v_finished_at timestamptz;
  v_rewarded_at timestamptz;
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
  if not private.can_access_learner(p_learner_id)
     or not private.can_use_learner_module(p_learner_id, 'hanzi') then
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

  select session.id, session.plan_frozen_at, session.finished_at
  into v_session_id, v_plan_frozen_at, v_finished_at
  from public.daily_sessions session
  where session.learner_id = p_learner_id
    and session.date_local = v_today
  for update;

  -- 旧版已经发出当天贴纸：接纳完成，不伪造补入卡的学习结果。
  -- 遗留未答卡留作以后按原 carry/due 规则安排，不再要求当天完成。
  select min(ledger.created_at) into v_rewarded_at
  from public.reward_ledger ledger
  where ledger.learner_id = p_learner_id and ledger.event_type = 'hanzi_daily'
    and ledger.dedupe_key = 'hanzi:' || v_today::text
    and ledger.reference_id = v_session_id and ledger.amount > 0;

  if v_finished_at is not null or v_rewarded_at is not null then
    update public.daily_sessions session
    set finished_at = coalesce(session.finished_at, v_rewarded_at),
        plan_frozen_at = coalesce(session.plan_frozen_at, session.started_at)
    where session.id = v_session_id
      and (session.finished_at is null or session.plan_frozen_at is null);
    return;
  end if;

  -- 升级中的进行中旧计划接纳已有字单，绝不重新补足名额。
  if v_plan_frozen_at is null and exists (
    select 1 from public.daily_session_items item where item.session_id = v_session_id
  ) then
    update public.daily_sessions set plan_frozen_at = now() where id = v_session_id;
    v_plan_frozen_at := now();
  end if;

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

  -- 实际字单只生成一次；原字的 same_day_retry 仍由回答 RPC 正常追加。
  if v_plan_frozen_at is null then
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

  update public.daily_sessions set plan_frozen_at = now() where id = v_session_id;
  end if;

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

  if v_today_total > 0 and v_today_total = v_today_passed then
    update public.daily_sessions set finished_at = coalesce(finished_at, now()) where id = v_session_id;
    return;
  end if;

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

create or replace function public.get_today_queue(p_learner_id uuid)
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
language sql security invoker set search_path = '' as $$
  select * from private.get_frozen_hanzi_queue(p_learner_id);
$$;
revoke all on function private.get_frozen_hanzi_queue(uuid) from public, anon;
revoke all on function public.get_today_queue(uuid) from public, anon;
grant execute on function private.get_frozen_hanzi_queue(uuid), public.get_today_queue(uuid) to authenticated;

-- 最后一次真实回答与完成标记同事务提交，不依赖后续浏览器请求。
-- BEFORE 拒绝旧页面提交已完成日的遗留卡，回滚该次 RPC 的所有前置更新。
create or replace function private.guard_and_finish_hanzi_day()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_session public.daily_sessions%rowtype;
begin
  select session.* into v_session
  from public.daily_sessions session join public.daily_session_items item on item.session_id = session.id
  where item.id = new.session_item_id and session.learner_id = new.learner_id for update of session;
  if not found or not private.can_access_learner(new.learner_id)
      or not private.can_use_learner_module(new.learner_id, 'hanzi') then
    raise exception '无权提交该孩子的汉字任务' using errcode = '42501';
  end if;
  if tg_when = 'BEFORE' then
    if v_session.finished_at is not null or exists (
      select 1 from public.reward_ledger ledger
      where ledger.learner_id = new.learner_id and ledger.event_type = 'hanzi_daily'
        and ledger.dedupe_key = 'hanzi:' || v_session.date_local::text
        and ledger.reference_id = v_session.id and ledger.amount > 0
    ) then
      raise exception '今天的汉字任务已经完成，请刷新今日状态' using errcode = 'PZ039';
    end if;
  elsif new.daily_passed
      and exists (select 1 from public.daily_character_progress p where p.session_id = v_session.id)
      and not exists (select 1 from public.daily_character_progress p where p.session_id = v_session.id and p.passed_at is null)
      and not exists (select 1 from public.daily_session_items item where item.session_id = v_session.id and item.status = 'pending') then
    update public.daily_sessions session
    set finished_at = coalesce(session.finished_at, new.answered_at),
        plan_frozen_at = coalesce(session.plan_frozen_at, session.started_at)
    where session.id = v_session.id;
  end if;
  return new;
end; $$;
revoke all on function private.guard_and_finish_hanzi_day() from public, anon, authenticated;
drop trigger if exists hanzi_day_guard_before_attempt on public.learning_attempts;
create trigger hanzi_day_guard_before_attempt before insert on public.learning_attempts
for each row execute function private.guard_and_finish_hanzi_day();
drop trigger if exists hanzi_day_finish_after_attempt on public.learning_attempts;
create trigger hanzi_day_finish_after_attempt after insert on public.learning_attempts
for each row execute function private.guard_and_finish_hanzi_day();

create or replace function private.claim_frozen_hanzi_reward(p_learner_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_today date;
  v_session_id uuid;
  v_pending_count integer;
  v_answered_count integer;
  v_account public.reward_accounts%rowtype;
  v_ledger_id uuid;
  v_balance integer;
  v_positive_count integer;
  v_sticker_code text;
begin
  select learner.timezone
  into v_timezone
  from public.learner_profiles learner
  where learner.id = p_learner_id
    and learner.parent_user_id = (select auth.uid());

  if not found then
    raise exception '无权操作该孩子档案' using errcode = '42501';
  end if;

  if not private.can_use_learner_module(p_learner_id, 'hanzi') then
    raise exception '汉字模块未开通或已到期' using errcode = '42501';
  end if;

  -- 同时需要两个锁时，统一先 session，再 reward account。
  v_today := (now() at time zone v_timezone)::date;
  select session.id into v_session_id from public.daily_sessions session
  where session.learner_id = p_learner_id and session.date_local = v_today for update;

  insert into public.reward_accounts (learner_id)
  values (p_learner_id)
  on conflict (learner_id) do nothing;

  select *
  into v_account
  from public.reward_accounts account
  where account.learner_id = p_learner_id
  for update;

  if v_session_id is null then
    select coalesce(sum(ledger.amount), 0)::integer
    into v_balance
    from public.reward_ledger ledger
    where ledger.learner_id = p_learner_id;

    return jsonb_build_object(
      'eligible', false,
      'awarded', false,
      'reason', 'no_session',
      'balance', v_balance,
      'progress', v_account.growth_points,
      'goal', v_account.sticker_goal
    );
  end if;

  select
    count(*) filter (where item.status = 'pending')::integer,
    count(*) filter (where item.status = 'answered')::integer
  into v_pending_count, v_answered_count
  from public.daily_session_items item
  where item.session_id = v_session_id;

  if not exists (
    select 1 from public.reward_ledger ledger
    where ledger.learner_id = p_learner_id and ledger.dedupe_key = 'hanzi:' || v_today::text
      and ledger.event_type = 'hanzi_daily' and ledger.reference_id = v_session_id and ledger.amount > 0
  ) and (v_answered_count = 0 or v_pending_count > 0
    or not exists (select 1 from public.daily_character_progress p where p.session_id = v_session_id)
    or exists (select 1 from public.daily_character_progress p where p.session_id = v_session_id and p.passed_at is null)
  ) then
    select coalesce(sum(ledger.amount), 0)::integer
    into v_balance
    from public.reward_ledger ledger
    where ledger.learner_id = p_learner_id;

    return jsonb_build_object(
      'eligible', false,
      'awarded', false,
      'reason', case when v_answered_count = 0 then 'no_answered_items' else 'pending_items' end,
      'balance', v_balance,
      'progress', v_account.growth_points,
      'goal', v_account.sticker_goal
    );
  end if;

  update public.daily_sessions session
  set finished_at = coalesce(session.finished_at, (
        select min(ledger.created_at) from public.reward_ledger ledger
        where ledger.learner_id = p_learner_id and ledger.dedupe_key = 'hanzi:' || v_today::text
          and ledger.event_type = 'hanzi_daily' and ledger.reference_id = v_session_id and ledger.amount > 0
      ), now()),
      plan_frozen_at = coalesce(session.plan_frozen_at, session.started_at)
  where session.id = v_session_id;

  select count(*)::integer
  into v_positive_count
  from public.reward_ledger ledger
  where ledger.learner_id = p_learner_id
    and ledger.amount > 0;

  v_sticker_code := (array[
    'sprout', 'sun', 'rabbit', 'whale', 'star',
    'flower', 'rocket', 'rainbow', 'bear', 'moon'
  ]::text[])[1 + (v_positive_count % 10)];

  insert into public.reward_ledger (
    learner_id,
    event_type,
    amount,
    title,
    note,
    sticker_code,
    local_date,
    dedupe_key,
    reference_id,
    created_by
  )
  values (
    p_learner_id,
    'hanzi_daily',
    1,
    '完成今天的汉字学习',
    '今日全部汉字卡片已经完成',
    v_sticker_code,
    v_today,
    'hanzi:' || v_today::text,
    v_session_id,
    (select auth.uid())
  )
  on conflict (learner_id, dedupe_key) do nothing
  returning id into v_ledger_id;

  select coalesce(sum(ledger.amount), 0)::integer
  into v_balance
  from public.reward_ledger ledger
  where ledger.learner_id = p_learner_id;

  return jsonb_build_object(
    'eligible', true,
    'awarded', v_ledger_id is not null,
    'duplicate', v_ledger_id is null,
    'reason', case when v_ledger_id is null then 'already_claimed' else 'awarded' end,
    'balance', v_balance,
    'progress', v_account.growth_points,
    'goal', v_account.sticker_goal,
    'sticker_code', case when v_ledger_id is null then null else v_sticker_code end,
    'title', '识字小达人'
  );
end;
$$;

create or replace function public.claim_hanzi_daily_reward(p_learner_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.claim_frozen_hanzi_reward(p_learner_id);
$$;
revoke all on function private.claim_frozen_hanzi_reward(uuid) from public, anon;
revoke all on function public.claim_hanzi_daily_reward(uuid) from public, anon;
grant execute on function private.claim_frozen_hanzi_reward(uuid), public.claim_hanzi_daily_reward(uuid) to authenticated;

create or replace function private.frozen_workspace_today_remaining(p_workspace_id uuid)
returns table(learner_id uuid, remaining bigint)
language sql stable security definer set search_path = '' as $$
  select learner.id, count(progress.character_id) filter (where progress.passed_at is null and session.finished_at is null
    and not exists (select 1 from public.reward_ledger ledger
      where ledger.learner_id = learner.id and ledger.dedupe_key = 'hanzi:' || session.date_local::text
        and ledger.event_type = 'hanzi_daily' and ledger.reference_id = session.id and ledger.amount > 0))
  from public.learner_profiles learner
  join public.families family on family.id = learner.family_id
  left join public.daily_sessions session on session.learner_id = learner.id
    and session.date_local = (now() at time zone learner.timezone)::date
  left join public.daily_character_progress progress on progress.session_id = session.id
  where family.workspace_id = p_workspace_id and private.is_workspace_admin(p_workspace_id)
  group by learner.id;
$$;

create or replace function private.frozen_learner_dashboard_snapshot(p_learner_id uuid)
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
      count(*) filter (where item.passed_at is null and session.finished_at is null
        and not exists (select 1 from public.reward_ledger ledger
          where ledger.learner_id = p_learner_id and ledger.dedupe_key = 'hanzi:' || session.date_local::text
            and ledger.event_type = 'hanzi_daily' and ledger.reference_id = session.id and ledger.amount > 0)) as remaining
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

create or replace function public.workspace_today_remaining(p_workspace_id uuid)
returns table(learner_id uuid, remaining bigint)
language sql stable security invoker set search_path = '' as $$
  select * from private.frozen_workspace_today_remaining(p_workspace_id);
$$;
create or replace function public.learner_dashboard_snapshot(p_learner_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.frozen_learner_dashboard_snapshot(p_learner_id);
$$;
revoke all on function private.frozen_workspace_today_remaining(uuid), private.frozen_learner_dashboard_snapshot(uuid), public.workspace_today_remaining(uuid), public.learner_dashboard_snapshot(uuid) from public, anon;
grant execute on function private.frozen_workspace_today_remaining(uuid), private.frozen_learner_dashboard_snapshot(uuid), public.workspace_today_remaining(uuid), public.learner_dashboard_snapshot(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
