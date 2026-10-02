-- 026 · 汉字学习表与儿童英语每日新词数量。
-- 先完整运行 001–025。本文件在 SQL Editor 整段运行；不修改既有学习记录。
begin;

create table if not exists public.kids_english_learning_settings (
  learner_id uuid primary key references public.learner_profiles(id) on delete cascade,
  daily_new_limit smallint not null default 3 check (daily_new_limit between 1 and 20),
  pending_daily_new_limit smallint check (pending_daily_new_limit between 1 and 20),
  pending_effective_on date,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint kids_english_pending_pair check (
    (pending_daily_new_limit is null and pending_effective_on is null)
    or (pending_daily_new_limit is not null and pending_effective_on is not null)
  )
);
alter table public.kids_english_learning_settings enable row level security;
revoke all on public.kids_english_learning_settings from public, anon, authenticated;
grant select on public.kids_english_learning_settings to authenticated;
drop policy if exists "family reads kids english settings" on public.kids_english_learning_settings;
create policy "family reads kids english settings"
on public.kids_english_learning_settings for select to authenticated
using (private.can_use_learner_module(learner_id, 'kids_english'));

-- 与“册”的 100 条分页不同，打印以单行 JSON 返回筛选后的完整快照；
-- 汇总全部有真实作答历史的字；当前字册只用于排序，已解除分配的历史也保留。
-- 同一个字跨册只算一次。
create or replace function public.get_hanzi_print_sheet(
  p_learner_id uuid, p_mode text default 'all', p_only_unmastered boolean default false
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_timezone text; v_today date; v_result jsonb;
begin
  if not private.can_use_learner_module(p_learner_id, 'hanzi') then
    raise exception '没有查看这位孩子汉字记录的权限' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('all', 'recent30', 'recent60', 'ongoing') then
    raise exception '打印范围无效' using errcode = '22023';
  end if;
  select learner.timezone into v_timezone from public.learner_profiles learner where learner.id = p_learner_id;
  v_today := (now() at time zone coalesce(v_timezone, 'Asia/Shanghai'))::date;
  with assigned as (
    select link.character_id, min(assignment.assignment_order) as package_order,
      min(link.sequence) as sequence
    from public.learner_content_packages assignment
    join public.content_packages book on book.id = assignment.package_id
      and book.status = 'published' and book.review_status = 'approved'
    join public.package_characters link on link.package_id = book.id
    where assignment.learner_id = p_learner_id and assignment.assignment_status = 'active'
    group by link.character_id
  ), practiced as (
    select attempt.character_id, count(*)::integer as attempt_count,
      max(attempt.answered_at) as last_answered_at
    from public.learning_attempts attempt
    where attempt.learner_id = p_learner_id
    group by attempt.character_id
  ), ranked as (
    select word.id, word.character as hanzi,
      sum(practiced.attempt_count) over (partition by word.character)::integer as attempt_count,
      practiced.last_answered_at, coalesce(state.stage, 0)::smallint as stage,
      state.due_at,
      min(assigned.package_order) over (partition by word.character) as package_order,
      min(assigned.sequence) over (partition by word.character) as sequence,
      row_number() over (partition by word.character order by practiced.last_answered_at desc, word.id) as rank_number
    from practiced
    join public.characters word on word.id = practiced.character_id
    left join assigned on assigned.character_id = word.id
    left join public.learning_states state
      on state.learner_id = p_learner_id and state.character_id = word.id
  ), base as (
    select ranked.id, ranked.hanzi, ranked.attempt_count, ranked.last_answered_at,
      ranked.stage, ranked.due_at, ranked.package_order, ranked.sequence
    from ranked where ranked.rank_number = 1
  ), filtered as (
    select * from base item where
      (p_mode = 'all'
        or (p_mode = 'recent30' and (item.last_answered_at at time zone coalesce(v_timezone, 'Asia/Shanghai'))::date >= v_today - 29)
        or (p_mode = 'recent60' and (item.last_answered_at at time zone coalesce(v_timezone, 'Asia/Shanghai'))::date >= v_today - 59)
        or (p_mode = 'ongoing' and item.stage < 7))
      and (not p_only_unmastered or item.stage < 7)
  )
  select jsonb_build_object(
    'printed_on', v_today,
    'learned_total', (select count(*) from base),
    'selected_total', count(*),
    'stable_total', count(*) filter (where item.stage between 5 and 6),
    'mastered_total', count(*) filter (where item.stage = 7),
    'due_total', count(*) filter (where item.due_at <= now()),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', item.id, 'hanzi', item.hanzi, 'stage', item.stage,
      'attempt_count', item.attempt_count, 'due', coalesce(item.due_at <= now(), false),
      'last_answered_at', item.last_answered_at
    ) order by item.package_order, item.sequence, item.hanzi), '[]'::jsonb)
  ) into v_result from filtered item;
  return v_result;
end;
$$;
revoke all on function public.get_hanzi_print_sheet(uuid,text,boolean) from public,anon;
grant execute on function public.get_hanzi_print_sheet(uuid,text,boolean) to authenticated;

-- 每次读取都按孩子当地日期判断哪份设置生效；已经安排的卡片不会被删除。
-- 如果家长在当天把 3 改成 10，下面的补差额查询只新增未在今天出现的 7 个新词。
create or replace function public.get_kids_english_queue(p_learner_id uuid)
returns table(word_id uuid,word text,phonetic text,meaning_zh text,example_en text,example_zh text,part_of_speech text,queue_kind text,stage smallint,attempt_count integer,clean_streak smallint,required_confirmations smallint,today_remaining integer)
language plpgsql security definer set search_path = '' as $$
declare v_today date; v_timezone text; v_new_limit integer; v_already_new integer;
begin
 if not private.can_use_learner_module(p_learner_id,'kids_english') then raise exception '未开通儿童英语' using errcode='42501'; end if;
 select learner.timezone into v_timezone from public.learner_profiles learner where learner.id=p_learner_id;
 v_today:=(now() at time zone coalesce(v_timezone,'Asia/Shanghai'))::date;
 perform pg_advisory_xact_lock(hashtextextended(p_learner_id::text||v_today::text,0));
 select case when settings.pending_effective_on<=v_today then settings.pending_daily_new_limit else settings.daily_new_limit end
 into v_new_limit from public.kids_english_learning_settings settings where settings.learner_id=p_learner_id;
 v_new_limit:=coalesce(v_new_limit,3);
 if not exists(select 1 from public.kids_english_daily_items item where item.learner_id=p_learner_id and item.local_date=v_today) then
   insert into public.kids_english_daily_items(learner_id,local_date,word_id,queue_kind,required_confirmations)
   select p_learner_id,v_today,candidate.word_id,'review',case when candidate.stage<=2 then 2 else 1 end
   from (
     select distinct on(word.id) word.id word_id,state.stage,state.due_at
     from public.kids_english_words word join public.kids_english_books book on book.id=word.book_id
     join public.learner_kids_english_books assignment on assignment.book_id=book.id and assignment.learner_id=p_learner_id and assignment.assignment_status='active'
     join public.kids_english_states state on state.word_id=word.id and state.learner_id=p_learner_id
     where book.status='published' and book.review_status='approved' and state.due_at<=now()
     order by word.id,state.due_at
   ) candidate order by candidate.due_at,candidate.stage limit 10;
 end if;
 select count(*)::integer into v_already_new from public.kids_english_daily_items item
 where item.learner_id=p_learner_id and item.local_date=v_today and item.queue_kind='new';
 if v_already_new<v_new_limit then
   insert into public.kids_english_daily_items(learner_id,local_date,word_id,queue_kind)
   select p_learner_id,v_today,candidate.word_id,'new' from (
     select word.id word_id from public.kids_english_words word join public.kids_english_books book on book.id=word.book_id
     join public.learner_kids_english_books assignment on assignment.book_id=book.id and assignment.learner_id=p_learner_id and assignment.assignment_status='active'
     where book.status='published' and book.review_status='approved'
       and not exists(select 1 from public.kids_english_states state where state.learner_id=p_learner_id and state.word_id=word.id)
       and not exists(select 1 from public.kids_english_daily_items existing where existing.learner_id=p_learner_id and existing.local_date=v_today and existing.word_id=word.id)
     order by book.created_at,word.sequence,word.id limit (v_new_limit-v_already_new)
   ) candidate on conflict do nothing;
 end if;
 return query select item.word_id,entry.word,entry.phonetic,entry.meaning_zh,entry.example_en,entry.example_zh,entry.part_of_speech,item.queue_kind,coalesce(state.stage,0)::smallint,item.attempt_count,item.clean_streak,item.required_confirmations,
   (select count(*)::integer from public.kids_english_daily_items pending where pending.learner_id=p_learner_id and pending.local_date=v_today and pending.passed_at is null)
 from public.kids_english_daily_items item join public.kids_english_words entry on entry.id=item.word_id
 join public.kids_english_books book on book.id=entry.book_id
 join public.learner_kids_english_books assignment on assignment.book_id=book.id and assignment.learner_id=p_learner_id and assignment.assignment_status='active'
 left join public.kids_english_states state on state.word_id=item.word_id and state.learner_id=p_learner_id
 where item.learner_id=p_learner_id and item.local_date=v_today and item.passed_at is null and book.status='published' and book.review_status='approved'
 order by item.created_at,item.word_id;
end; $$;
revoke all on function public.get_kids_english_queue(uuid) from public,anon;
grant execute on function public.get_kids_english_queue(uuid) to authenticated;

create or replace function public.set_kids_english_daily_limit(
  p_learner_id uuid, p_daily_new_limit integer, p_effective text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_today date; v_timezone text; v_current integer; v_before integer; v_after integer;
begin
 if not private.can_use_learner_module(p_learner_id,'kids_english') then raise exception '没有修改这位孩子学习节奏的权限' using errcode='42501'; end if;
 if p_daily_new_limit is null or p_daily_new_limit not between 1 and 20
   or p_effective is null or p_effective not in ('today','tomorrow') then
   raise exception '每天新词应为 1～20 个，并选择生效时间' using errcode='22023';
 end if;
 select learner.timezone into v_timezone from public.learner_profiles learner where learner.id=p_learner_id;
 v_today:=(now() at time zone coalesce(v_timezone,'Asia/Shanghai'))::date;
 perform pg_advisory_xact_lock(hashtextextended(p_learner_id::text||v_today::text,0));
 select count(*)::integer into v_before from public.kids_english_daily_items item
 where item.learner_id=p_learner_id and item.local_date=v_today and item.queue_kind='new';
 select case when settings.pending_effective_on<=v_today then settings.pending_daily_new_limit else settings.daily_new_limit end
 into v_current from public.kids_english_learning_settings settings where settings.learner_id=p_learner_id;
 v_current:=coalesce(v_current,3);
 if p_effective='today' then
   insert into public.kids_english_learning_settings(learner_id,daily_new_limit,pending_daily_new_limit,pending_effective_on,updated_by,updated_at)
   values(p_learner_id,p_daily_new_limit,null,null,(select auth.uid()),now())
   on conflict(learner_id) do update set daily_new_limit=excluded.daily_new_limit,
     pending_daily_new_limit=null,pending_effective_on=null,updated_by=excluded.updated_by,updated_at=now();
   -- 同一事务内调用现有队列入口，补入差额并保持复习上限、答题状态不变。
   perform public.get_kids_english_queue(p_learner_id);
 else
   insert into public.kids_english_learning_settings(learner_id,daily_new_limit,pending_daily_new_limit,pending_effective_on,updated_by,updated_at)
   values(p_learner_id,v_current,p_daily_new_limit,v_today+1,(select auth.uid()),now())
   on conflict(learner_id) do update set daily_new_limit=excluded.daily_new_limit,
     pending_daily_new_limit=excluded.pending_daily_new_limit,pending_effective_on=excluded.pending_effective_on,
     updated_by=excluded.updated_by,updated_at=now();
 end if;
 select count(*)::integer into v_after from public.kids_english_daily_items item
 where item.learner_id=p_learner_id and item.local_date=v_today and item.queue_kind='new';
 return jsonb_build_object('effective',p_effective,'today_limit',case when p_effective='today' then p_daily_new_limit else v_current end,
   'tomorrow_limit',p_daily_new_limit,
   'today_assigned',v_after,'added_today',v_after-v_before,'local_date',v_today);
end; $$;
revoke all on function public.set_kids_english_daily_limit(uuid,integer,text) from public,anon;
grant execute on function public.set_kids_english_daily_limit(uuid,integer,text) to authenticated;

commit;
