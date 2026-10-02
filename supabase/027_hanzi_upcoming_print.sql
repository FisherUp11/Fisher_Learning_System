-- 027 · 未来 7／14 天预计新字打印（只读，不预先生成或改变每日任务）。
-- 前置：已运行 026。请在 Supabase SQL Editor 整份运行。
begin;

create or replace function public.get_hanzi_upcoming_print_sheet(
  p_learner_id uuid, p_days integer default 7
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_timezone text;
  v_today date;
  v_daily_goal integer;
  v_slots integer;
  v_result jsonb;
begin
  if not private.can_use_learner_module(p_learner_id, 'hanzi') then
    raise exception '没有查看这位孩子汉字计划的权限' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (7, 14) then
    raise exception '只支持预览未来 7 天或 14 天' using errcode = '22023';
  end if;

  select learner.timezone, learner.daily_new_limit
  into v_timezone, v_daily_goal
  from public.learner_profiles learner
  where learner.id = p_learner_id;
  v_today := (now() at time zone coalesce(v_timezone, 'Asia/Shanghai'))::date;
  v_slots := least(700, v_daily_goal * p_days);

  -- 与现有队列一致：重点字先按勾选时间，普通字按分配/导入顺序。
  -- 排除已有学习状态和今天已安排的字；不创建明天的 daily_session。
  with available as (
    select linked.character_id,
      min(assignment.assignment_order) as assignment_order,
      min(assignment.linked_at) as linked_at,
      min(linked.sequence) as sequence
    from public.learner_content_packages assignment
    join public.content_packages package on package.id = assignment.package_id
      and package.status = 'published' and package.review_status = 'approved'
    join public.package_characters linked on linked.package_id = package.id
    where assignment.learner_id = p_learner_id
      and assignment.assignment_status = 'active'
      and not exists (
        select 1 from public.learning_states state
        where state.learner_id = p_learner_id and state.character_id = linked.character_id
      )
      and not exists (
        select 1 from public.daily_sessions session
        join public.daily_session_items item on item.session_id = session.id
        where session.learner_id = p_learner_id and session.date_local = v_today
          and item.character_id = linked.character_id
      )
    group by linked.character_id
  ), ordered as (
    select word.id, word.character as hanzi, word.pinyin_marked,
      (priority.character_id is not null) as is_priority,
      row_number() over (
        order by (priority.character_id is not null) desc,
          priority.selected_at nulls last,
          available.assignment_order, available.linked_at,
          available.sequence, available.character_id
      )::integer as planned_order
    from available
    join public.characters word on word.id = available.character_id
    left join public.learner_character_priorities priority
      on priority.learner_id = p_learner_id and priority.character_id = word.id
  ), selected as (
    select * from ordered item where item.planned_order <= v_slots
  )
  select jsonb_build_object(
    'as_of', v_today,
    'starts_on', v_today + 1,
    'ends_on', v_today + p_days,
    'days', p_days,
    'daily_goal', v_daily_goal,
    'potential_slots', v_slots,
    'available_total', (select count(*) from ordered),
    'selected_total', count(*),
    'priority_total', count(*) filter (where item.is_priority),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', item.id,
      'hanzi', item.hanzi,
      'pinyin_marked', item.pinyin_marked,
      'is_priority', item.is_priority,
      'planned_order', item.planned_order
    ) order by item.planned_order), '[]'::jsonb)
  ) into v_result
  from selected item;

  return v_result;
end;
$$;

revoke all on function public.get_hanzi_upcoming_print_sheet(uuid,integer) from public, anon;
grant execute on function public.get_hanzi_upcoming_print_sheet(uuid,integer) to authenticated;

commit;
