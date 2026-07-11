-- 字芽 MVP：字库学习进度汇总。
-- 请在已运行 001_hanzi_mvp.sql（及需要时 002_fix_get_today_queue.sql）后，
-- 于 Supabase Dashboard → SQL Editor 整段运行。本迁移不会改动任何学习记录。

begin;

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
    count(a.id)::integer as attempt_count,
    count(a.id) filter (where a.result = 'known')::integer as known_count,
    count(a.id) filter (where a.result = 'again')::integer as again_count,
    s.stage,
    s.due_at,
    s.last_result,
    s.consecutive_known,
    s.mastered_at,
    max(a.answered_at) as last_answered_at,
    (s.due_at <= now()) as needs_review
  from public.learning_states s
  left join public.learning_attempts a
    on a.learner_id = s.learner_id
    and a.character_id = s.character_id
  where s.learner_id = p_learner_id
    and exists (select 1 from authorized)
  group by s.character_id, s.stage, s.due_at, s.last_result, s.consecutive_known, s.mastered_at;
$$;

revoke execute on function public.get_library_progress(uuid) from public, anon;
grant execute on function public.get_library_progress(uuid) to authenticated;

commit;
