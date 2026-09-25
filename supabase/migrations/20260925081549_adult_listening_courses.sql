-- 020｜会议英语：长纪要、分节听力、选择题、独立词句复习。
-- 先运行 019；整份在 SQL Editor 运行，可重复执行。保留所有旧课程/口语/运动数据。
begin;
alter table public.adult_english_sources drop constraint if exists adult_english_sources_body_check;
alter table public.adult_english_sources add constraint adult_english_sources_body_check check(char_length(body) between 20 and 150000);

create table if not exists public.adult_english_sections (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), source_id uuid not null,
  ordinal integer not null check(ordinal between 1 and 150), title text not null, excerpt text not null check(char_length(excerpt) between 1 and 12000),
  word_count integer not null check(word_count>=0), created_at timestamptz not null default now(),
  foreign key(source_id,owner_id) references public.adult_english_sources(id,owner_id) on delete cascade,
  unique(source_id,ordinal), unique(id,owner_id), unique(id,source_id,owner_id)
);
alter table public.adult_english_lessons add column if not exists format_version integer not null default 1 check(format_version in (1,2));
alter table public.adult_english_lessons add column if not exists section_id uuid;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='adult_lesson_section_owner_fk') then
  alter table public.adult_english_lessons add constraint adult_lesson_section_owner_fk foreign key(section_id,source_id,owner_id) references public.adult_english_sections(id,source_id,owner_id) on delete cascade;
 end if;
end $$;
-- At most one editable/active generation per section; published history remains versioned.
create unique index if not exists adult_section_working_version on public.adult_english_lessons(section_id) where section_id is not null and status in ('generating','draft','failed');

create table if not exists public.adult_listening_sessions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), profile_id uuid not null,
  local_date date not null, lesson_id uuid, snapshot jsonb, review_words jsonb not null default '[]' check(jsonb_typeof(review_words)='array'),
  assisted boolean not null default false, completed_at timestamptz, created_at timestamptz not null default now(),
  foreign key(profile_id,owner_id) references public.adult_profiles(id,owner_id) on delete cascade,
  foreign key(lesson_id,owner_id) references public.adult_english_lessons(id,owner_id) on delete cascade,
  unique(profile_id,local_date), unique(id,profile_id,owner_id),
  check((lesson_id is null and snapshot is null) or (lesson_id is not null and jsonb_typeof(snapshot)='object'))
);
create table if not exists public.adult_listening_attempts (
 id uuid primary key, owner_id uuid not null default auth.uid(), profile_id uuid not null, session_id uuid not null,
 task_id text not null, kind text not null check(kind in ('listening','vocabulary')), concept_id uuid,
 selected integer check(selected between 0 and 3), rating text check(rating in ('known','again')),
 correct boolean not null, assisted boolean not null, local_date date not null, created_at timestamptz not null default now(),
 foreign key(session_id,profile_id,owner_id) references public.adult_listening_sessions(id,profile_id,owner_id) on delete cascade,
 foreign key(concept_id,owner_id) references public.adult_english_concepts(id,owner_id) on delete cascade
);
alter table public.adult_listening_sessions add column if not exists assisted_tasks text[] not null default '{}';
create table if not exists public.adult_english_word_states (
 owner_id uuid not null default auth.uid(), profile_id uuid not null, concept_id uuid not null,
 stage integer not null default 0 check(stage between 0 and 5), attempts integer not null default 0,
 independent_days integer not null default 0, spaced_success boolean not null default false,
 last_success_date date, last_failure_date date, due_date date not null, priority boolean not null default false,
 foreign key(profile_id,owner_id) references public.adult_profiles(id,owner_id) on delete cascade,
 foreign key(concept_id,owner_id) references public.adult_english_concepts(id,owner_id) on delete cascade,
 primary key(profile_id,concept_id)
);
do $$ declare t text; begin
 foreach t in array array['adult_english_sections','adult_listening_sessions','adult_listening_attempts','adult_english_word_states'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('drop policy if exists account_private on public.%I',t);
  execute format('create policy account_private on public.%I for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()))',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to authenticated',t);
  execute format('create index if not exists %I on public.%I(owner_id)',t||'_owner_idx',t);
 end loop;
end $$;
create index if not exists adult_listening_attempts_session_idx on public.adult_listening_attempts(session_id,task_id,created_at);
create index if not exists adult_listening_attempts_profile_date on public.adult_listening_attempts(profile_id,local_date);
create index if not exists adult_word_due on public.adult_english_word_states(profile_id,due_date);
create index if not exists adult_listening_lesson_idx on public.adult_listening_sessions(lesson_id);
create index if not exists adult_listening_attempts_concept_idx on public.adult_listening_attempts(concept_id);
create index if not exists adult_word_concept_idx on public.adult_english_word_states(concept_id);
create index if not exists adult_lesson_section_idx on public.adult_english_lessons(section_id);

create or replace function public.adult_split_source(p_source uuid,p_parts jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare v_body text; v_joined text; v_p jsonb; v_i integer:=0;
begin
 select body into v_body from public.adult_english_sources where id=p_source and owner_id=auth.uid() for update;
 if v_body is null then raise exception '资料不存在或无权限'; end if;
 if exists(select 1 from public.adult_english_sections where source_id=p_source) then return; end if;
 if jsonb_typeof(p_parts) is distinct from 'array' or jsonb_array_length(p_parts) not between 1 and 150 then raise exception '分节数量无效'; end if;
 select string_agg(value->>'excerpt',' ' order by ord) into v_joined from jsonb_array_elements(p_parts) with ordinality as t(value,ord);
 if regexp_replace(v_body,'\s','','g') <> regexp_replace(v_joined,'\s','','g') then raise exception '分节原文不完整，请重试'; end if;
 for v_p in select value from jsonb_array_elements(p_parts) loop
  v_i:=v_i+1;
  insert into public.adult_english_sections(source_id,ordinal,title,excerpt,word_count) values(p_source,v_i,'第 '||v_i||' 节',v_p->>'excerpt',(v_p->>'word_count')::integer);
 end loop;
end $$;

-- Extend publication only for V2; retain the V1 contract and historical records.
create or replace function public.adult_publish_lesson(p_lesson uuid,p_content jsonb,p_expressions jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare v_l public.adult_english_lessons; v_e jsonb; v_concept uuid;
begin
 select * into v_l from public.adult_english_lessons where id=p_lesson and owner_id=auth.uid() for update;
 if v_l.status='published' then return; end if;
 if v_l.status is distinct from 'draft' then raise exception '只有草稿可发布'; end if;
 if jsonb_typeof(p_expressions) is distinct from 'array' or jsonb_array_length(p_expressions) not between (case when v_l.format_version=2 then 4 else 1 end) and (case when v_l.format_version=2 then 6 else 5 end) then raise exception '重点表达不正确'; end if;
 for v_e in select value from jsonb_array_elements(p_expressions) loop
  insert into public.adult_english_concepts(phrase,meaning,example,concept_key) values(v_e->>'phrase',v_e->>'meaning',v_e->>'example',v_e->>'key')
  on conflict(owner_id,concept_key) do update set concept_key=excluded.concept_key returning id into v_concept;
  insert into public.adult_english_lesson_concepts(lesson_id,concept_id) values(p_lesson,v_concept) on conflict do nothing;
 end loop;
 update public.adult_english_lessons set content=p_content,status='published',updated_at=now() where id=p_lesson;
 if v_l.section_id is not null then update public.adult_english_sections set title=p_content->>'title' where id=v_l.section_id; end if;
end $$;

create or replace function public.adult_listening_hint(p_session uuid,p_task text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare v_s public.adult_listening_sessions; v_item jsonb;
begin
 select * into v_s from public.adult_listening_sessions where id=p_session and owner_id=auth.uid() for update;
 if v_s.id is null then raise exception '练习不存在或无权限'; end if;
 if p_task is null then
  update public.adult_listening_sessions set assisted=true where id=p_session;
 else
  if p_task ~ '^q:[0-2]$' then v_item:=v_s.snapshot->'questions'->split_part(p_task,':',2)::integer;
  elsif p_task ~ '^w:[0-9]+$' then v_item:=v_s.snapshot->'expressions'->split_part(p_task,':',2)::integer;
  elsif p_task ~ '^r:[0-9]+$' then v_item:=v_s.review_words->split_part(p_task,':',2)::integer;
  end if;
  if v_item is null then raise exception '题目不属于本次练习'; end if;
  if not p_task=any(v_s.assisted_tasks) then update public.adult_listening_sessions set assisted_tasks=array_append(assisted_tasks,p_task) where id=p_session; end if;
 end if;
end $$;

-- Grade against the persisted snapshot, not a score supplied by the browser. No paid AI call.
create or replace function public.adult_listening_answer(p_id uuid,p_session uuid,p_task text,p_selected integer,p_rating text,p_assisted boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_s public.adult_listening_sessions; v_a public.adult_listening_attempts; v_q jsonb; v_c uuid;
v_kind text; v_correct boolean; v_help boolean; v_state public.adult_english_word_states; v_today date:=(now() at time zone 'Asia/Shanghai')::date; v_stage integer; v_due date;
begin
 select * into v_s from public.adult_listening_sessions where id=p_session and owner_id=auth.uid() for update;
 if v_s.id is null then raise exception '练习不存在或无权限'; end if;
 select * into v_a from public.adult_listening_attempts where id=p_id and owner_id=auth.uid();
 if v_a.id is not null then
  if v_a.session_id<>p_session or v_a.task_id<>p_task then raise exception '请求编号不匹配'; end if;
  return to_jsonb(v_a);
 end if;
 if v_s.local_date<>v_today then raise exception '请重新加载，开始新一天的练习'; end if;
 if p_task ~ '^q:[0-2]$' then
  v_q:=v_s.snapshot->'questions'->split_part(p_task,':',2)::integer; v_kind:='listening';
 elsif p_task ~ '^[wr]:[0-9]+$' then
  if left(p_task,1)='w' then v_q:=v_s.snapshot->'expressions'->split_part(p_task,':',2)::integer;
  else v_q:=v_s.review_words->split_part(p_task,':',2)::integer; end if;
  v_kind:='vocabulary'; v_c:=(v_q->>'concept_id')::uuid;
 else raise exception '题目编号无效'; end if;
 if v_q is null then raise exception '题目不属于本次练习'; end if;
 if p_rating is not null and (v_kind<>'vocabulary' or p_rating not in ('known','again')) then raise exception '自评无效'; end if;
 if p_rating is null and (p_selected is null or p_selected not between 0 and 3) then raise exception '请选择一个选项'; end if;
 v_correct:=case when p_rating is not null then p_rating='known' else p_selected=(v_q->>'correct')::integer end;
 v_help:=coalesce(p_assisted,false) or p_rating is not null or p_task=any(v_s.assisted_tasks) or (v_kind='listening' and v_s.assisted) or exists(select 1 from public.adult_listening_attempts where session_id=p_session and task_id=p_task);
 insert into public.adult_listening_attempts(id,profile_id,session_id,task_id,kind,concept_id,selected,rating,correct,assisted,local_date)
 values(p_id,v_s.profile_id,p_session,p_task,v_kind,v_c,p_selected,p_rating,v_correct,v_help,v_today) returning * into v_a;
 if v_c is not null then
  insert into public.adult_english_word_states(profile_id,concept_id,due_date) values(v_s.profile_id,v_c,v_today) on conflict do nothing;
  select * into v_state from public.adult_english_word_states where profile_id=v_s.profile_id and concept_id=v_c for update;
  v_stage:=v_state.stage; v_due:=v_state.due_date;
  if v_correct and not v_help and v_state.last_success_date is distinct from v_today and v_state.last_failure_date is distinct from v_today then
   v_stage:=least(5,v_stage+1); v_due:=v_today+(array[1,3,7,14,30])[v_stage];
  elsif not v_correct then
   if v_state.last_failure_date is distinct from v_today then v_stage:=greatest(0,v_stage-1); end if;
   v_due:=v_today;
  elsif v_help then v_due:=least(v_due,v_today+1);
  end if;
  update public.adult_english_word_states set attempts=attempts+1,stage=v_stage,due_date=v_due,
   independent_days=independent_days+case when v_correct and not v_help and last_success_date is distinct from v_today and last_failure_date is distinct from v_today then 1 else 0 end,
   spaced_success=case when not v_correct then false else spaced_success or coalesce(v_correct and not v_help and v_today-last_success_date>=7,false) end,
   last_success_date=case when v_correct and not v_help then v_today else last_success_date end,
   last_failure_date=case when not v_correct then v_today else last_failure_date end
  where profile_id=v_s.profile_id and concept_id=v_c;
 end if;
 if (select count(distinct task_id) from public.adult_listening_attempts where session_id=p_session) >=
    coalesce(jsonb_array_length(v_s.snapshot->'questions'),0)+coalesce(jsonb_array_length(v_s.snapshot->'expressions'),0)+jsonb_array_length(v_s.review_words)
 then update public.adult_listening_sessions set completed_at=coalesce(completed_at,now()) where id=p_session; end if;
 return to_jsonb(v_a);
end $$;

create or replace function public.adult_delete_source(p_source uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.adult_english_sources where id=p_source and owner_id=auth.uid() for update;
 if not found then raise exception '资料不存在或无权限'; end if;
 delete from public.adult_listening_sessions s where s.owner_id=auth.uid() and exists(
  select 1 from jsonb_array_elements(s.review_words) w join public.adult_english_lessons l on l.id::text=w->>'lesson_id' where l.source_id=p_source
 );
 delete from public.adult_english_plans p where p.owner_id=auth.uid() and exists(
  select 1 from jsonb_array_elements(p.tasks) t join public.adult_english_lessons l on l.id::text=t->>'lesson_id' where l.source_id=p_source
 );
 delete from public.adult_english_sources where id=p_source and owner_id=auth.uid();
 delete from public.adult_english_concepts c where c.owner_id=auth.uid() and not exists(select 1 from public.adult_english_lesson_concepts lc where lc.concept_id=c.id);
 delete from public.adult_ai_jobs where owner_id=auth.uid();
end $$;
revoke all on function public.adult_split_source(uuid,jsonb) from public,anon;
revoke all on function public.adult_listening_hint(uuid,text) from public,anon;
grant execute on function public.adult_listening_hint(uuid,text) to authenticated;
revoke all on function public.adult_listening_answer(uuid,uuid,text,integer,text,boolean) from public,anon;
grant execute on function public.adult_split_source(uuid,jsonb) to authenticated;
grant execute on function public.adult_listening_answer(uuid,uuid,text,integer,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
