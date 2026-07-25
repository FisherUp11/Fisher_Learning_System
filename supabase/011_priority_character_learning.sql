-- 字芽 MVP：孩子级“重点字”与优先学习队列。
-- 前置：请先依次运行 001、004、005、006、007。
-- 本脚本不会删除、重置或降级任何已有字库、学习状态和回答历史。
-- 重点标记只改变“到期复习 / 未学新字”的候选顺序，不改变 answer_queue_item 的记忆算法。

begin;

create table if not exists public.learner_character_priorities (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  character_id uuid not null references public.characters(id) on delete cascade,
  selected_at timestamptz not null default now(),
  primary key (learner_id, character_id)
);

create index if not exists learner_character_priorities_order_idx
  on public.learner_character_priorities (learner_id, selected_at, character_id);
create index if not exists learner_character_priorities_character_idx
  on public.learner_character_priorities (character_id);

alter table public.learner_character_priorities enable row level security;

drop policy if exists "parent reads character priorities" on public.learner_character_priorities;
drop policy if exists "parent inserts character priorities" on public.learner_character_priorities;
drop policy if exists "parent deletes character priorities" on public.learner_character_priorities;

create policy "parent reads character priorities"
on public.learner_character_priorities
for select
to authenticated
using (
  exists (
    select 1
    from public.learner_profiles l
    where l.id = learner_id
      and l.parent_user_id = (select auth.uid())
  )
);

create policy "parent inserts character priorities"
on public.learner_character_priorities
for insert
to authenticated
with check (
  exists (
    select 1
    from public.learner_profiles l
    where l.id = learner_id
      and l.parent_user_id = (select auth.uid())
  )
  and (learner_id, character_id) in (
    select lp.learner_id, pc.character_id
    from public.learner_content_packages lp
    join public.content_packages p
      on p.id = lp.package_id
     and p.status = 'published'
     and p.created_by = (select auth.uid())
    join public.package_characters pc
      on pc.package_id = lp.package_id
  )
);

create policy "parent deletes character priorities"
on public.learner_character_priorities
for delete
to authenticated
using (
  exists (
    select 1
    from public.learner_profiles l
    where l.id = learner_id
      and l.parent_user_id = (select auth.uid())
  )
);

revoke all on public.learner_character_priorities from anon;
grant select, insert, delete on public.learner_character_priorities to authenticated;

-- 保存当前字库页的勾选结果。一次调用在同一数据库事务内完成增加和取消，
-- 避免浏览器连续发几十个请求，也避免部分保存后页面状态不清楚。
drop function if exists public.set_character_priorities(uuid, uuid[], uuid[]);
create function public.set_character_priorities(
  p_learner_id uuid,
  p_scope_character_ids uuid[],
  p_priority_character_ids uuid[]
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_scope_ids uuid[] := coalesce(p_scope_character_ids, array[]::uuid[]);
  v_priority_ids uuid[] := coalesce(p_priority_character_ids, array[]::uuid[]);
  v_saved_count integer := 0;
begin
  if not exists (
    select 1
    from public.learner_profiles l
    where l.id = p_learner_id
      and l.parent_user_id = (select auth.uid())
  ) then
    raise exception '无权管理该孩子的重点字' using errcode = '42501';
  end if;

  if cardinality(v_scope_ids) > 100 or cardinality(v_priority_ids) > 100 then
    raise exception '单次最多管理 100 个汉字' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(v_priority_ids) as chosen(character_id)
    where not chosen.character_id = any(v_scope_ids)
  ) then
    raise exception '重点字必须来自当前管理范围' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(v_scope_ids) as scoped(character_id)
    where not exists (
      select 1
      from public.learner_content_packages lp
      join public.content_packages p
        on p.id = lp.package_id
       and p.status = 'published'
       and p.created_by = (select auth.uid())
      join public.package_characters pc
        on pc.package_id = lp.package_id
       and pc.character_id = scoped.character_id
      where lp.learner_id = p_learner_id
    )
  ) then
    raise exception '所选汉字不属于该孩子的已发布字库' using errcode = '42501';
  end if;

  delete from public.learner_character_priorities pr
  where pr.learner_id = p_learner_id
    and pr.character_id = any(v_scope_ids)
    and not pr.character_id = any(v_priority_ids);

  insert into public.learner_character_priorities (learner_id, character_id)
  select p_learner_id, chosen.character_id
  from unnest(v_priority_ids) as chosen(character_id)
  on conflict (learner_id, character_id) do nothing;

  select count(*)::integer into v_saved_count
  from public.learner_character_priorities pr
  where pr.learner_id = p_learner_id;

  return v_saved_count;
end;
$$;

revoke execute on function public.set_character_priorities(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.set_character_priorities(uuid, uuid[], uuid[]) to authenticated;

-- 队列规则：
-- 1. 旧日未答完卡片仍最先带入；
-- 2. 到期重点字排在到期普通字之前，但重点字不会在 due_at 前提前出现；
-- 3. 每日新字名额先取跨全部已关联字册的未学重点字；
-- 4. 剩余新字名额仍从 active_package_id 按原 CSV sequence 补齐。
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
    update public.daily_session_items
    set status = 'carried'
    where id = v_pending.id;

    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position)
    values (v_session_id, v_pending.character_id, 'carry', v_position)
    on conflict (session_id, character_id, queue_kind) do nothing;
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

-- 重点筛选与统计直接由数据库分页函数返回，避免把 1000+ 个字全部下载到手机。
drop function if exists public.get_library_rows(uuid, text, text, text, uuid, integer, integer);
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
  character_id uuid,
  hanzi text,
  pinyin_marked text,
  meaning text,
  word_one text,
  word_two text,
  example_sentence text,
  sequence integer,
  source_package_ids uuid[],
  source_package_titles text,
  attempt_count integer,
  known_count integer,
  again_count integer,
  stage smallint,
  due_at timestamptz,
  last_result text,
  consecutive_known integer,
  mastered_at timestamptz,
  last_answered_at timestamptz,
  needs_review boolean,
  is_priority boolean,
  priority_selected_at timestamptz,
  total_count integer,
  filtered_count integer,
  learned_total integer,
  stable_total integer,
  due_total integer,
  priority_total integer,
  priority_unstarted_total integer,
  priority_learning_total integer,
  priority_stable_total integer
)
language sql
security definer
set search_path = ''
as $$
  with authorized as (
    select l.id
    from public.learner_profiles l
    where l.id = p_learner_id
      and l.parent_user_id = (select auth.uid())
  ),
  attempts as (
    select
      a.character_id,
      count(*)::integer as attempt_count,
      count(*) filter (where a.result = 'known')::integer as known_count,
      count(*) filter (where a.result = 'again')::integer as again_count,
      max(a.answered_at) as last_answered_at
    from public.learning_attempts a
    where a.learner_id = p_learner_id
    group by a.character_id
  ),
  base as (
    select
      c.id as character_id,
      c.character as hanzi,
      c.pinyin_marked,
      c.meaning,
      c.word_one,
      c.word_two,
      c.example_sentence,
      min(pc.sequence) as sequence,
      array_agg(p.id order by p.created_at) as source_package_ids,
      string_agg(p.title, ' · ' order by p.created_at) as source_package_titles,
      coalesce(a.attempt_count, 0) as attempt_count,
      coalesce(a.known_count, 0) as known_count,
      coalesce(a.again_count, 0) as again_count,
      coalesce(s.stage, 0::smallint) as stage,
      s.due_at,
      s.last_result,
      coalesce(s.consecutive_known, 0) as consecutive_known,
      s.mastered_at,
      a.last_answered_at,
      coalesce(s.due_at <= now(), false) as needs_review,
      (pr.character_id is not null) as is_priority,
      pr.selected_at as priority_selected_at
    from authorized au
    join public.learner_content_packages lp on lp.learner_id = au.id
    join public.content_packages p
      on p.id = lp.package_id
     and p.status = 'published'
     and p.created_by = (select auth.uid())
    join public.package_characters pc on pc.package_id = p.id
    join public.characters c on c.id = pc.character_id
    left join public.learning_states s
      on s.learner_id = p_learner_id
     and s.character_id = c.id
    left join attempts a on a.character_id = c.id
    left join public.learner_character_priorities pr
      on pr.learner_id = p_learner_id
     and pr.character_id = c.id
    where p_package_id is null
       or p.id = p_package_id
    group by
      c.id,
      c.character,
      c.pinyin_marked,
      c.meaning,
      c.word_one,
      c.word_two,
      c.example_sentence,
      a.attempt_count,
      a.known_count,
      a.again_count,
      s.stage,
      s.due_at,
      s.last_result,
      s.consecutive_known,
      s.mastered_at,
      a.last_answered_at,
      pr.character_id,
      pr.selected_at
  ),
  filtered as (
    select *
    from base b
    where (
      case p_status
        when 'unstarted' then b.attempt_count = 0
        when 'learning' then b.attempt_count > 0 and b.stage < 5
        when 'learned' then b.stage >= 5
        when 'stable' then b.stage between 5 and 6
        when 'mastered' then b.stage >= 7
        when 'due' then b.attempt_count > 0 and b.needs_review
        else true
      end
    )
    and (
      case p_attempts
        when 'never' then b.attempt_count = 0
        when '1-2' then b.attempt_count between 1 and 2
        when '3-5' then b.attempt_count between 3 and 5
        when '6+' then b.attempt_count >= 6
        else true
      end
    )
    and (
      case p_priority
        when 'priority' then b.is_priority
        when 'priority_unstarted' then b.is_priority and b.attempt_count = 0
        when 'priority_learning' then b.is_priority and b.attempt_count > 0 and b.stage < 5
        when 'priority_stable' then b.is_priority and b.stage >= 5
        else true
      end
    )
    and (
      coalesce(nullif(btrim(p_query), ''), '') = ''
      or b.hanzi ilike '%' || p_query || '%'
      or b.pinyin_marked ilike '%' || p_query || '%'
      or b.meaning ilike '%' || p_query || '%'
      or coalesce(b.word_one, '') ilike '%' || p_query || '%'
      or coalesce(b.word_two, '') ilike '%' || p_query || '%'
      or coalesce(b.example_sentence, '') ilike '%' || p_query || '%'
    )
  ),
  metrics as (
    select
      count(*)::integer as total_count,
      count(*) filter (where attempt_count > 0)::integer as learned_total,
      count(*) filter (where stage >= 5)::integer as stable_total,
      count(*) filter (where needs_review)::integer as due_total,
      count(*) filter (where is_priority)::integer as priority_total,
      count(*) filter (where is_priority and attempt_count = 0)::integer as priority_unstarted_total,
      count(*) filter (where is_priority and attempt_count > 0 and stage < 5)::integer as priority_learning_total,
      count(*) filter (where is_priority and stage >= 5)::integer as priority_stable_total
    from base
  ),
  filtered_metrics as (
    select count(*)::integer as filtered_count
    from filtered
  )
  select
    f.character_id,
    f.hanzi,
    f.pinyin_marked,
    f.meaning,
    f.word_one,
    f.word_two,
    f.example_sentence,
    f.sequence,
    f.source_package_ids,
    f.source_package_titles,
    f.attempt_count,
    f.known_count,
    f.again_count,
    f.stage,
    f.due_at,
    f.last_result,
    f.consecutive_known,
    f.mastered_at,
    f.last_answered_at,
    f.needs_review,
    f.is_priority,
    f.priority_selected_at,
    m.total_count,
    fm.filtered_count,
    m.learned_total,
    m.stable_total,
    m.due_total,
    m.priority_total,
    m.priority_unstarted_total,
    m.priority_learning_total,
    m.priority_stable_total
  from filtered f
  cross join metrics m
  cross join filtered_metrics fm
  order by
    f.is_priority desc,
    f.priority_selected_at nulls last,
    f.sequence,
    f.hanzi
  limit least(greatest(coalesce(p_page_size, 48), 1), 100)
  offset (
    (least(greatest(coalesce(p_page, 1), 1), 100000) - 1)
    * least(greatest(coalesce(p_page_size, 48), 1), 100)
  );
$$;

revoke execute on function public.get_library_rows(uuid, text, text, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.get_library_rows(uuid, text, text, text, text, uuid, integer, integer) to authenticated;

commit;
