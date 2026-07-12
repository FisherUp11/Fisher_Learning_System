-- 字芽 MVP：一个孩子可保留多次导入的字册，并在“册”中汇总查看。
-- 请在已运行 001、004、005 后，于 Supabase SQL Editor 整段执行。
-- 脚本不会删除任何学习记录或字库内容。

begin;

create table if not exists public.learner_content_packages (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  package_id uuid not null references public.content_packages(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (learner_id, package_id)
);

alter table public.learner_content_packages enable row level security;

drop policy if exists "parent reads learner packages" on public.learner_content_packages;
drop policy if exists "parent writes learner packages" on public.learner_content_packages;
create policy "parent reads learner packages" on public.learner_content_packages for select to authenticated using (
  exists (
    select 1 from public.learner_profiles l
    where l.id = learner_id and l.parent_user_id = (select auth.uid())
  )
);
create policy "parent writes learner packages" on public.learner_content_packages for all to authenticated using (
  exists (
    select 1 from public.learner_profiles l
    where l.id = learner_id and l.parent_user_id = (select auth.uid())
  )
) with check (
  exists (
    select 1 from public.learner_profiles l
    where l.id = learner_id and l.parent_user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.content_packages p
    where p.id = package_id and p.created_by = (select auth.uid())
  )
);

grant select, insert, update, delete on public.learner_content_packages to authenticated;

-- 1) 已标记为“当前字册”的包，必然属于对应孩子。
insert into public.learner_content_packages (learner_id, package_id)
select l.id, l.active_package_id
from public.learner_profiles l
where l.active_package_id is not null
on conflict do nothing;

-- 2) 历史学习记录与某个字册有交集时，归给学习记录最多的孩子。
with package_usage as (
  select
    pc.package_id,
    ls.learner_id,
    count(*) as matched_states
  from public.package_characters pc
  join public.learning_states ls on ls.character_id = pc.character_id
  join public.learner_profiles l on l.id = ls.learner_id
  join public.content_packages p on p.id = pc.package_id and p.created_by = l.parent_user_id
  group by pc.package_id, ls.learner_id
), ranked_usage as (
  select *, row_number() over (partition by package_id order by matched_states desc, learner_id) as rank_number
  from package_usage
)
insert into public.learner_content_packages (learner_id, package_id)
select learner_id, package_id
from ranked_usage r
where r.rank_number = 1
  and not exists (select 1 from public.learner_content_packages lp where lp.package_id = r.package_id)
on conflict do nothing;

-- 3) 只有一个孩子的家长账号，剩余的历史包也可安全归给该孩子。
insert into public.learner_content_packages (learner_id, package_id)
select l.id, p.id
from public.content_packages p
join public.learner_profiles l on l.parent_user_id = p.created_by
where not exists (
  select 1 from public.learner_profiles sibling
  where sibling.parent_user_id = l.parent_user_id and sibling.id <> l.id
)
and not exists (select 1 from public.learner_content_packages lp where lp.package_id = p.id)
on conflict do nothing;

drop function if exists public.get_library_rows(uuid, text, text, text, integer, integer);
drop function if exists public.get_library_rows(uuid, text, text, text, uuid, integer, integer);
create function public.get_library_rows(
  p_learner_id uuid,
  p_query text default '',
  p_status text default 'all',
  p_attempts text default 'all',
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
    select l.id
    from public.learner_profiles l
    where l.id = p_learner_id and l.parent_user_id = (select auth.uid())
  ),
  attempts as (
    select a.character_id, count(*)::integer as attempt_count,
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
      coalesce(s.due_at <= now(), false) as needs_review
    from authorized au
    join public.learner_content_packages lp on lp.learner_id = au.id
    join public.content_packages p on p.id = lp.package_id and p.status = 'published'
    join public.package_characters pc on pc.package_id = p.id
    join public.characters c on c.id = pc.character_id
    left join public.learning_states s on s.learner_id = p_learner_id and s.character_id = c.id
    left join attempts a on a.character_id = c.id
    where p_package_id is null or p.id = p_package_id
    group by c.id, c.character, c.pinyin_marked, c.meaning, c.word_one, c.word_two, c.example_sentence,
      a.attempt_count, a.known_count, a.again_count, s.stage, s.due_at, s.last_result, s.consecutive_known,
      s.mastered_at, a.last_answered_at
  ),
  filtered as (
    select * from base b
    where (case p_status
      when 'unstarted' then b.attempt_count = 0
      when 'learning' then b.attempt_count > 0 and b.stage < 5
      when 'learned' then b.stage >= 5
      when 'stable' then b.stage between 5 and 6
      when 'mastered' then b.stage >= 7
      when 'due' then b.attempt_count > 0 and b.needs_review
      else true end)
    and (case p_attempts
      when 'never' then b.attempt_count = 0
      when '1-2' then b.attempt_count between 1 and 2
      when '3-5' then b.attempt_count between 3 and 5
      when '6+' then b.attempt_count >= 6
      else true end)
    and (coalesce(nullif(btrim(p_query), ''), '') = ''
      or b.hanzi ilike '%' || p_query || '%'
      or b.pinyin_marked ilike '%' || p_query || '%'
      or b.meaning ilike '%' || p_query || '%'
      or coalesce(b.word_one, '') ilike '%' || p_query || '%'
      or coalesce(b.word_two, '') ilike '%' || p_query || '%'
      or coalesce(b.example_sentence, '') ilike '%' || p_query || '%')
  ),
  metrics as (
    select count(*)::integer as total_count,
      count(*) filter (where attempt_count > 0)::integer as learned_total,
      count(*) filter (where stage >= 5)::integer as stable_total,
      count(*) filter (where needs_review)::integer as due_total
    from base
  ),
  filtered_metrics as (select count(*)::integer as filtered_count from filtered)
  select
    f.character_id, f.hanzi, f.pinyin_marked, f.meaning, f.word_one, f.word_two, f.example_sentence, f.sequence,
    f.source_package_ids, f.source_package_titles, f.attempt_count, f.known_count, f.again_count, f.stage, f.due_at,
    f.last_result, f.consecutive_known, f.mastered_at, f.last_answered_at, f.needs_review,
    m.total_count, fm.filtered_count, m.learned_total, m.stable_total, m.due_total
  from filtered f cross join metrics m cross join filtered_metrics fm
  order by f.sequence, f.hanzi
  limit least(greatest(coalesce(p_page_size, 48), 12), 100)
  offset ((least(greatest(coalesce(p_page, 1), 1), 100000) - 1) * least(greatest(coalesce(p_page_size, 48), 12), 100));
$$;

revoke execute on function public.get_library_rows(uuid, text, text, text, uuid, integer, integer) from public, anon;
grant execute on function public.get_library_rows(uuid, text, text, text, uuid, integer, integer) to authenticated;

commit;
