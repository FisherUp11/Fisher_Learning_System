-- 019｜成人运动与会议英语。独立增量脚本，可在 Supabase SQL Editor 完整运行。
-- 不修改旧模块表/RPC；账号私有，不继承儿童管理的 admin/owner 跨家庭读取权。
begin;
create table if not exists public.adult_profiles (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  daily_new integer not null default 5 check (daily_new between 0 and 5),
  daily_review integer not null default 10 check (daily_review between 1 and 20),
  level text not null default 'supported' check (level in ('supported','practical','advanced')),
  archived boolean not null default false, created_at timestamptz not null default now(),
  unique(owner_id,name), unique(id,owner_id)
);
create table if not exists public.adult_exercise_goals (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), profile_id uuid not null,
  name text not null check (char_length(name) between 1 and 50),
  unit text not null check (unit in ('sets','reps','minutes','km')), created_at timestamptz not null default now(),
  foreign key(profile_id,owner_id) references public.adult_profiles(id,owner_id) on delete cascade,
  unique(id,owner_id), unique(id,profile_id,owner_id)
);
create table if not exists public.adult_goal_versions (
  owner_id uuid not null default auth.uid(), goal_id uuid not null, effective_date date not null,
  target numeric(10,2) not null check(target > 0 and target <= 10000), weekdays integer[] not null default '{1,2,3,4,5,6,0}',
  active boolean not null default true, created_at timestamptz not null default now(),
  check(cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6]),
  foreign key(goal_id,owner_id) references public.adult_exercise_goals(id,owner_id) on delete cascade,
  primary key(goal_id,effective_date)
);
create table if not exists public.adult_exercise_logs (
  id uuid primary key, owner_id uuid not null default auth.uid(), profile_id uuid not null, goal_id uuid not null,
  local_date date not null, amount numeric(10,2) not null check(amount > 0 and amount <= 10000),
  reps integer check(reps between 0 and 10000), minutes numeric(10,2) check(minutes between 0 and 1440), km numeric(10,2) check(km between 0 and 1000),
  note text not null default '' check(char_length(note) <= 500), created_at timestamptz not null default now(), voided_at timestamptz,
  foreign key(goal_id,profile_id,owner_id) references public.adult_exercise_goals(id,profile_id,owner_id) on delete cascade
);
create table if not exists public.adult_english_sources (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check(char_length(title) between 1 and 120), body text not null check(char_length(body) between 20 and 30000),
  content_hash text not null, meeting_date date not null, priority boolean not null default false,
  archived boolean not null default false, created_at timestamptz not null default now(), unique(owner_id,content_hash), unique(id,owner_id)
);
create table if not exists public.adult_english_lessons (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), source_id uuid not null,
  status text not null default 'generating' check(status in ('generating','draft','published','failed','archived')),
  level text not null check(level in ('supported','practical','advanced')), content jsonb,
  error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(source_id,owner_id) references public.adult_english_sources(id,owner_id) on delete cascade, unique(id,owner_id)
);
create table if not exists public.adult_english_concepts (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  phrase text not null, meaning text not null, example text not null, concept_key text not null,
  unique(owner_id,concept_key), unique(id,owner_id)
);
create table if not exists public.adult_english_lesson_concepts (
  owner_id uuid not null default auth.uid(), lesson_id uuid not null, concept_id uuid not null,
  foreign key(lesson_id,owner_id) references public.adult_english_lessons(id,owner_id) on delete cascade,
  foreign key(concept_id,owner_id) references public.adult_english_concepts(id,owner_id) on delete cascade,
  primary key(lesson_id,concept_id)
);
create table if not exists public.adult_english_plans (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), profile_id uuid not null,
  local_date date not null, mode text not null check(mode in ('standard','short','weekly')), tasks jsonb not null check(jsonb_typeof(tasks)='array'),
  created_at timestamptz not null default now(), foreign key(profile_id,owner_id) references public.adult_profiles(id,owner_id) on delete cascade,
  unique(profile_id,local_date), unique(id,profile_id,owner_id)
);
create table if not exists public.adult_english_attempts (
  id uuid primary key, owner_id uuid not null default auth.uid(), profile_id uuid not null, plan_id uuid not null,
  task_id text not null, response text not null check(char_length(response) between 1 and 3000),
  result text not null check(result in ('correct','partial','again')), evaluator text not null check(evaluator in ('ai','self')),
  hinted boolean not null default false, mode text not null check(mode in ('speech','text','corrected','self')),
  feedback text not null, local_date date not null, created_at timestamptz not null default now(),
  foreign key(plan_id,profile_id,owner_id) references public.adult_english_plans(id,profile_id,owner_id) on delete cascade
);
create table if not exists public.adult_english_states (
  owner_id uuid not null default auth.uid(), profile_id uuid not null, concept_id uuid not null,
  skill text not null check(skill in ('listening','speaking')), stage integer not null default 0 check(stage between 0 and 5),
  attempts integer not null default 0, independent_days integer not null default 0, spaced_success boolean not null default false,
  last_success_date date, due_date date not null, last_date date not null,
  foreign key(profile_id,owner_id) references public.adult_profiles(id,owner_id) on delete cascade,
  foreign key(concept_id,owner_id) references public.adult_english_concepts(id,owner_id) on delete cascade,
  primary key(profile_id,concept_id,skill)
);
create table if not exists public.adult_ai_jobs (
  id uuid primary key, owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check(kind in ('lesson','feedback','transcription','audio')), status text not null default 'running' check(status in ('running','complete','failed')),
  result jsonb, model text, usage jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,owner_id)
);
-- All owner columns indexed, and composite FKs prevent forged ownership across accounts.
do $$ declare t text; begin
  foreach t in array array['adult_profiles','adult_exercise_goals','adult_goal_versions','adult_exercise_logs','adult_english_sources','adult_english_lessons','adult_english_concepts','adult_english_lesson_concepts','adult_english_plans','adult_english_attempts','adult_english_states','adult_ai_jobs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('drop policy if exists account_private on public.%I',t);
    execute format('create policy account_private on public.%I to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()))',t);
    execute format('create index if not exists %I on public.%I(owner_id)',t||'_owner_idx',t);
  end loop;
end $$;
create index if not exists adult_exercise_logs_profile_date_idx on public.adult_exercise_logs(profile_id,local_date);
create index if not exists adult_english_attempts_profile_date_idx on public.adult_english_attempts(profile_id,local_date);
create index if not exists adult_english_attempts_plan_task_idx on public.adult_english_attempts(plan_id,task_id);
create index if not exists adult_english_states_due_idx on public.adult_english_states(profile_id,due_date);
create index if not exists adult_english_lessons_source_idx on public.adult_english_lessons(source_id);
create index if not exists adult_english_lesson_concepts_concept_idx on public.adult_english_lesson_concepts(concept_id);

-- Atomic goal creation/revision. Existing day's target is immutable; revisions start tomorrow.
create or replace function public.adult_save_goal(p_profile uuid,p_goal uuid,p_name text,p_unit text,p_target numeric,p_days integer[],p_active boolean)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_date date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if auth.uid() is null or not exists(select 1 from public.adult_profiles where id=p_profile and owner_id=auth.uid() and not archived) then raise exception '档案不存在或无权限'; end if;
  perform 1 from public.adult_profiles where id=p_profile for update;
  if p_goal is null then
    insert into public.adult_exercise_goals(profile_id,name,unit) values(p_profile,btrim(p_name),p_unit) returning id into v_id;
  else
    select id into v_id from public.adult_exercise_goals where id=p_goal and profile_id=p_profile and owner_id=auth.uid();
    if v_id is null then raise exception '运动项目不存在'; end if;
    v_date := v_date+1;
  end if;
  insert into public.adult_goal_versions(goal_id,effective_date,target,weekdays,active) values(v_id,v_date,p_target,p_days,p_active)
  on conflict(goal_id,effective_date) do update set target=excluded.target,weekdays=excluded.weekdays,active=excluded.active;
  return v_id;
end $$;

create or replace function public.adult_log_exercise(p_id uuid,p_profile uuid,p_goal uuid,p_date date,p_amount numeric,p_reps integer,p_minutes numeric,p_km numeric,p_note text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Shanghai')::date; v_created date;
begin
  if auth.uid() is null then raise exception '请先登录'; end if;
  select (created_at at time zone 'Asia/Shanghai')::date into v_created from public.adult_exercise_goals where id=p_goal and profile_id=p_profile and owner_id=auth.uid();
  if v_created is null or p_date<v_created or p_date>v_today or p_date<v_today-30 then raise exception '只能记录项目创建后、近 30 天内的运动'; end if;
  if not exists(select 1 from public.adult_profiles where id=p_profile and not archived) then raise exception '该档案已归档'; end if;
  insert into public.adult_exercise_logs(id,profile_id,goal_id,local_date,amount,reps,minutes,km,note)
  values(p_id,p_profile,p_goal,p_date,p_amount,p_reps,p_minutes,p_km,coalesce(p_note,'')) on conflict(id) do nothing;
  return p_id;
end $$;

-- Publish draft + link reusable expressions in one transaction. Published versions are immutable in UI.
create or replace function public.adult_publish_lesson(p_lesson uuid,p_content jsonb,p_expressions jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_status text; v_e jsonb; v_concept uuid;
begin
  select status into v_status from public.adult_english_lessons where id=p_lesson and owner_id=auth.uid() for update;
  if v_status='published' then return; end if;
  if v_status is distinct from 'draft' then raise exception '只有草稿可发布'; end if;
  if jsonb_typeof(p_expressions)<>'array' or jsonb_array_length(p_expressions) not between 1 and 5 then raise exception '重点表达不正确'; end if;
  for v_e in select value from jsonb_array_elements(p_expressions) loop
    insert into public.adult_english_concepts(phrase,meaning,example,concept_key)
    values(v_e->>'phrase',v_e->>'meaning',v_e->>'example',v_e->>'key')
    on conflict(owner_id,concept_key) do update set concept_key=excluded.concept_key returning id into v_concept;
    insert into public.adult_english_lesson_concepts(lesson_id,concept_id) values(p_lesson,v_concept) on conflict do nothing;
  end loop;
  update public.adult_english_lessons set content=p_content,status='published',updated_at=now() where id=p_lesson;
end $$;

-- Lock plan before idempotency check: concurrent retry saves exactly once, including state updates.
create or replace function public.adult_record_attempt(p_id uuid,p_plan uuid,p_task text,p_response text,p_result text,p_evaluator text,p_hinted boolean,p_mode text,p_feedback text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_plan public.adult_english_plans; v_task jsonb; v_state public.adult_english_states; v_concept uuid;
v_today date := (now() at time zone 'Asia/Shanghai')::date; v_independent boolean; v_stage integer; v_due date;
begin
  select * into v_plan from public.adult_english_plans where id=p_plan and owner_id=auth.uid() for update;
  if v_plan.id is null then raise exception '练习计划不存在或无权限'; end if;
  if exists(select 1 from public.adult_english_attempts where id=p_id and owner_id=auth.uid()) then return p_id; end if;
  if v_plan.local_date <> v_today then raise exception '已经进入新的一天，请重新加载并开始今日计划'; end if;
  select value into v_task from jsonb_array_elements(v_plan.tasks) where value->>'id'=p_task;
  if v_task is null then raise exception '任务不属于该计划'; end if;
  insert into public.adult_english_attempts(id,profile_id,plan_id,task_id,response,result,evaluator,hinted,mode,feedback,local_date)
  values(p_id,v_plan.profile_id,p_plan,p_task,p_response,p_result,p_evaluator,p_hinted,p_mode,p_feedback,v_today);
  v_concept := (v_task->>'concept_id')::uuid;
  if v_concept is not null then
    insert into public.adult_english_states(profile_id,concept_id,skill,due_date,last_date)
    values(v_plan.profile_id,v_concept,v_task->>'skill',v_today,v_today) on conflict do nothing;
    select * into v_state from public.adult_english_states where profile_id=v_plan.profile_id and concept_id=v_concept and skill=v_task->>'skill' for update;
    v_independent := p_result='correct' and p_evaluator='ai' and not p_hinted and p_mode not in ('self','corrected') and (v_task->>'skill'<>'speaking' or p_mode='speech');
    v_stage := v_state.stage;
    v_due := v_state.due_date;
    if v_independent and v_state.last_success_date is distinct from v_today then
      v_stage := least(5,v_stage+1); v_due := v_today + (array[1,3,7,14,30])[v_stage];
    elsif p_result='again' then v_stage := greatest(0,v_stage-1); v_due := v_today;
    elsif not v_independent then v_due := least(v_due,v_today+1);
    end if;
    update public.adult_english_states set attempts=attempts+1,stage=v_stage,due_date=v_due,last_date=v_today,
      independent_days=independent_days+case when v_independent and last_success_date is distinct from v_today then 1 else 0 end,
      spaced_success=case when not v_independent and p_result='again' then false else spaced_success or (v_independent and last_success_date is not null and v_today-last_success_date>=7) end,
      last_success_date=case when v_independent then v_today else last_success_date end
      where profile_id=v_plan.profile_id and concept_id=v_concept and skill=v_task->>'skill';
  end if;
  return p_id;
end $$;

create or replace function public.adult_delete_source(p_source uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.adult_english_sources where id=p_source and owner_id=auth.uid() for update;
  if not found then raise exception '资料不存在或无权限'; end if;
  delete from public.adult_english_plans p where p.owner_id=auth.uid() and exists (
    select 1 from jsonb_array_elements(p.tasks) t join public.adult_english_lessons l on l.id::text=t->>'lesson_id' where l.source_id=p_source
  );
  delete from public.adult_english_sources where id=p_source and owner_id=auth.uid();
  delete from public.adult_english_concepts c where c.owner_id=auth.uid() and not exists(select 1 from public.adult_english_lesson_concepts lc where lc.concept_id=c.id);
  delete from public.adult_ai_jobs where owner_id=auth.uid();
end $$;

revoke all on function public.adult_save_goal(uuid,uuid,text,text,numeric,integer[],boolean) from public,anon;
revoke all on function public.adult_log_exercise(uuid,uuid,uuid,date,numeric,integer,numeric,numeric,text) from public,anon;
revoke all on function public.adult_publish_lesson(uuid,jsonb,jsonb) from public,anon;
revoke all on function public.adult_record_attempt(uuid,uuid,text,text,text,text,boolean,text,text) from public,anon;
grant execute on function public.adult_save_goal(uuid,uuid,text,text,numeric,integer[],boolean) to authenticated;
grant execute on function public.adult_log_exercise(uuid,uuid,uuid,date,numeric,integer,numeric,numeric,text) to authenticated;
grant execute on function public.adult_publish_lesson(uuid,jsonb,jsonb) to authenticated;
grant execute on function public.adult_record_attempt(uuid,uuid,text,text,text,text,boolean,text,text) to authenticated;
revoke all on function public.adult_delete_source(uuid) from public,anon;
grant execute on function public.adult_delete_source(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
