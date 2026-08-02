-- 字芽：修复 get_today_queue 在带入昨日未完成卡片时的 session_id 歧义。
--
-- 现象：
--   column reference "session_id" is ambiguous
--
-- 原因：
--   get_today_queue 的返回列包含 session_id / character_id / queue_kind，
--   PL/pgSQL 会把 ON CONFLICT (session_id, character_id, queue_kind)
--   同时解释为返回变量和表字段。
--
-- 修复：
--   继续沿用 011 的重点字和跨字册队列逻辑，只把冲突目标改为明确的
--   daily_session_items_session_id_character_id_queue_kind_key 约束。
--
-- 本脚本不会删除或改写孩子、字库、学习状态、每日队列或回答历史。
-- 前置：已经按顺序运行 001–012。

begin;

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
  join public.content_packages p
    on p.id = l.active_package_id
   and p.created_by = l.parent_user_id
   and p.status = 'published'
  where l.id = p_learner_id
    and l.parent_user_id = (select auth.uid());

  if not found then
    raise exception '未找到可用的孩子档案或已发布学习包' using errcode = '42501';
  end if;

  v_today := (now() at time zone v_timezone)::date;
  insert into public.daily_sessions (learner_id, date_local)
  values (p_learner_id, v_today)
  on conflict (learner_id, date_local) do nothing;

  select s.id into v_session_id
  from public.daily_sessions s
  where s.learner_id = p_learner_id
    and s.date_local = v_today;

  select coalesce(max(i.queue_position), 0) into v_position
  from public.daily_session_items i
  where i.session_id = v_session_id;

  for v_pending in
    select distinct on (i.character_id) i.id, i.character_id
    from public.daily_session_items i
    join public.daily_sessions s on s.id = i.session_id
    where s.learner_id = p_learner_id
      and s.date_local < v_today
      and i.status = 'pending'
    order by i.character_id, s.date_local asc, i.queue_position asc
  loop
    v_position := v_position + 1;
    update public.daily_session_items item
    set status = 'carried'
    where item.id = v_pending.id;

    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position)
    values (v_session_id, v_pending.character_id, 'carry', v_position)
    on conflict on constraint daily_session_items_session_id_character_id_queue_kind_key
    do nothing;
  end loop;

  select count(*) into v_review_count
  from public.daily_session_items i
  where i.session_id = v_session_id
    and i.queue_kind in ('review', 'carry');

  for v_candidate in
    select ls.character_id
    from public.learning_states ls
    left join public.learner_character_priorities pr
      on pr.learner_id = ls.learner_id
     and pr.character_id = ls.character_id
    where ls.learner_id = p_learner_id
      and ls.due_at <= now()
      and not exists (
        select 1
        from public.daily_session_items i
        where i.session_id = v_session_id
          and i.character_id = ls.character_id
      )
    order by
      (pr.character_id is not null) desc,
      ls.due_at asc,
      ls.stage asc
    limit greatest(0, 15 - v_review_count)
  loop
    v_position := v_position + 1;
    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position)
    values (v_session_id, v_candidate.character_id, 'review', v_position);
  end loop;

  select count(*) into v_new_count
  from public.daily_session_items i
  where i.session_id = v_session_id
    and i.queue_kind = 'new';

  for v_candidate in
    select
      pr.character_id,
      pr.selected_at,
      min(lp.linked_at) as first_linked_at,
      min(pc.sequence) as first_sequence
    from public.learner_character_priorities pr
    join public.learner_content_packages lp
      on lp.learner_id = pr.learner_id
    join public.content_packages p
      on p.id = lp.package_id
     and p.status = 'published'
     and p.created_by = (select auth.uid())
    join public.package_characters pc
      on pc.package_id = lp.package_id
     and pc.character_id = pr.character_id
    where pr.learner_id = p_learner_id
      and not exists (
        select 1
        from public.learning_states ls
        where ls.learner_id = p_learner_id
          and ls.character_id = pr.character_id
      )
      and not exists (
        select 1
        from public.daily_session_items i
        where i.session_id = v_session_id
          and i.character_id = pr.character_id
      )
    group by pr.character_id, pr.selected_at
    order by pr.selected_at, first_linked_at, first_sequence, pr.character_id
    limit greatest(0, v_daily_new_limit - v_new_count)
  loop
    v_position := v_position + 1;
    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position)
    values (v_session_id, v_candidate.character_id, 'new', v_position);
  end loop;

  select count(*) into v_new_count
  from public.daily_session_items i
  where i.session_id = v_session_id
    and i.queue_kind = 'new';

  for v_candidate in
    select pc.character_id
    from public.package_characters pc
    where pc.package_id = v_package_id
      and not exists (
        select 1
        from public.learning_states ls
        where ls.learner_id = p_learner_id
          and ls.character_id = pc.character_id
      )
      and not exists (
        select 1
        from public.daily_session_items i
        where i.session_id = v_session_id
          and i.character_id = pc.character_id
      )
    order by pc.sequence
    limit greatest(0, v_daily_new_limit - v_new_count)
  loop
    v_position := v_position + 1;
    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position)
    values (v_session_id, v_candidate.character_id, 'new', v_position);
  end loop;

  return query
  select
    i.id,
    v_session_id,
    i.queue_position,
    i.queue_kind,
    c.id,
    c.character,
    c.pinyin_marked,
    c.meaning,
    c.word_one,
    c.word_two,
    c.example_sentence,
    coalesce(ls.stage, 0::smallint),
    ls.due_at
  from public.daily_session_items i
  join public.characters c on c.id = i.character_id
  left join public.learning_states ls
    on ls.learner_id = p_learner_id
   and ls.character_id = i.character_id
  where i.session_id = v_session_id
    and i.status = 'pending'
  order by i.queue_position;
end;
$$;

revoke execute on function public.get_today_queue(uuid) from public, anon;
grant execute on function public.get_today_queue(uuid) to authenticated;

commit;

-- 快速验证：应返回 1 行，routine_name 为 get_today_queue。
select routine_name, routine_type, data_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'get_today_queue';
