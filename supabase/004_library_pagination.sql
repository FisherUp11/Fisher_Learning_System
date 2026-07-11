-- 字芽 MVP：字库服务端筛选与分页。
-- 请在已运行 001、002（如需要）和 003 后，于 Supabase SQL Editor 整段执行。
-- 该脚本仅新增读取函数，不会改动已有孩子、字库或学习记录。

begin;

drop function if exists public.get_library_rows(uuid, text, text, text, integer, integer);
create function public.get_library_rows(
  p_learner_id uuid,
  p_query text default '',
  p_status text default 'all',
  p_attempts text default 'all',
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
  total_count integer,
  filtered_count integer,
  learned_total integer,
  stable_total integer,
  due_total integer
)
language sql
security definer
set search_path = ''
as $$
  with authorized as (
    select l.active_package_id
    from public.learner_profiles l
    where l.id = p_learner_id
      and l.parent_user_id = (select auth.uid())
      and l.active_package_id is not null
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
      pc.sequence,
      coalesce(a.attempt_count, 0) as attempt_count,
      coalesce(a.known_count, 0) as known_count,
      coalesce(a.again_count, 0) as again_count,
      coalesce(s.stage, 0::smallint) as stage,
      s.due_at,
      s.last_result,
      coalesce(s.consecutive_known, 0) as consecutive_known,
      s.mastered_at,
      a.last_answered_at,
      coalesce(s.due_at <= now(), false) as needs_review
    from authorized ap
    join public.package_characters pc on pc.package_id = ap.active_package_id
    join public.characters c on c.id = pc.character_id
    left join public.learning_states s on s.learner_id = p_learner_id and s.character_id = c.id
    left join attempts a on a.character_id = c.id
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
      count(*) filter (where needs_review)::integer as due_total
    from base
  ),
  filtered_metrics as (
    select count(*)::integer as filtered_count from filtered
  )
  select
    f.character_id, f.hanzi, f.pinyin_marked, f.meaning, f.word_one, f.word_two, f.example_sentence, f.sequence,
    f.attempt_count, f.known_count, f.again_count, f.stage, f.due_at, f.last_result, f.consecutive_known,
    f.mastered_at, f.last_answered_at, f.needs_review,
    m.total_count, fm.filtered_count, m.learned_total, m.stable_total, m.due_total
  from filtered f
  cross join metrics m
  cross join filtered_metrics fm
  order by f.sequence
  limit least(greatest(coalesce(p_page_size, 48), 12), 100)
  offset (
    (least(greatest(coalesce(p_page, 1), 1), 100000) - 1)
    * least(greatest(coalesce(p_page_size, 48), 12), 100)
  );
$$;

revoke execute on function public.get_library_rows(uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.get_library_rows(uuid, text, text, text, integer, integer) to authenticated;

commit;
