-- 仅修复 get_today_queue 的返回类型；适用于已成功运行 001_hanzi_mvp.sql 的项目。
-- 在 Supabase Dashboard → SQL Editor 中整段执行。不会删除任何孩子、字库或学习记录。

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

revoke execute on function public.get_today_queue(uuid) from public, anon;
grant execute on function public.get_today_queue(uuid) to authenticated;

commit;
