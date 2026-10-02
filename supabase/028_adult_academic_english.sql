-- 028 | 父母专业英语。先运行 019、020；保留会议英语和既有掌握记录。
-- 在 Supabase SQL Editor 整份执行一次；脚本可重复运行，不会清空数据。
begin;

alter table public.adult_ai_jobs drop constraint if exists adult_ai_jobs_kind_check;
alter table public.adult_ai_jobs add constraint adult_ai_jobs_kind_check
  check (kind in ('lesson','feedback','transcription','audio','academic'));

create table if not exists public.adult_academic_courses (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (owner_id,title), unique (id,owner_id)
);
create table if not exists public.adult_academic_sources (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), course_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 80 and 150000),
  content_hash text not null check (char_length(content_hash)=64),
  archived boolean not null default false, published_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (course_id,owner_id) references public.adult_academic_courses(id,owner_id) on delete cascade,
  unique (owner_id,content_hash), unique (id,owner_id), unique (id,course_id,owner_id)
);
create table if not exists public.adult_academic_chunks (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid(), source_id uuid not null,
  ordinal integer not null check (ordinal between 1 and 200),
  excerpt text not null check (char_length(excerpt) between 1 and 12000),
  status text not null default 'pending' check (status in ('pending','running','complete','failed')),
  candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(candidates)='array'),
  error text, updated_at timestamptz not null default now(),
  foreign key (source_id,owner_id) references public.adult_academic_sources(id,owner_id) on delete cascade,
  unique (source_id,ordinal), unique (id,source_id,owner_id)
);
-- One canonical academic sense can link to many lectures; the existing meeting concept is reused when appropriate.
create table if not exists public.adult_academic_terms (
  owner_id uuid not null default auth.uid(), canonical_key text not null check (char_length(canonical_key) between 1 and 300),
  concept_id uuid not null, category text not null default 'word' check (category in ('word','phrase','sentence')),
  foreign key (concept_id,owner_id) references public.adult_english_concepts(id,owner_id) on delete cascade,
  primary key (owner_id,canonical_key)
);
create table if not exists public.adult_academic_source_concepts (
  owner_id uuid not null default auth.uid(), source_id uuid not null, concept_id uuid not null,
  chunk_ordinal integer not null, source_quote text not null check (char_length(source_quote) between 10 and 1000),
  translation text not null default '' check (char_length(translation)<=1000),
  created_at timestamptz not null default now(),
  foreign key (source_id,owner_id) references public.adult_academic_sources(id,owner_id) on delete cascade,
  foreign key (concept_id,owner_id) references public.adult_english_concepts(id,owner_id) on delete cascade,
  primary key (source_id,concept_id)
);
create table if not exists public.adult_academic_settings (
  owner_id uuid not null default auth.uid(), profile_id uuid primary key,
  daily_new integer not null default 6 check (daily_new between 0 and 20),
  daily_review integer not null default 12 check (daily_review between 1 and 50),
  focus_course_id uuid,
  foreign key (profile_id,owner_id) references public.adult_profiles(id,owner_id) on delete cascade,
  foreign key (focus_course_id,owner_id) references public.adult_academic_courses(id,owner_id) on delete set null (focus_course_id)
);
create table if not exists public.adult_academic_daily_items (
  owner_id uuid not null default auth.uid(), profile_id uuid not null, local_date date not null, concept_id uuid not null,
  queue_kind text not null check (queue_kind in ('new','review')),
  confirmations integer not null default 0 check (confirmations between 0 and 2),
  had_failure boolean not null default false, attempt_count integer not null default 0,
  last_answered_at timestamptz, completed_at timestamptz,
  foreign key (profile_id,owner_id) references public.adult_profiles(id,owner_id) on delete cascade,
  foreign key (concept_id,owner_id) references public.adult_english_concepts(id,owner_id) on delete cascade,
  primary key (profile_id,local_date,concept_id),
  unique (profile_id,local_date,concept_id,owner_id)
);
create table if not exists public.adult_academic_attempts (
  id uuid primary key, owner_id uuid not null default auth.uid(), profile_id uuid not null,
  local_date date not null, concept_id uuid not null,
  result text not null check (result in ('known','again')),
  stage_before integer not null, stage_after integer not null,
  created_at timestamptz not null default now(),
  foreign key (profile_id,local_date,concept_id,owner_id) references public.adult_academic_daily_items(profile_id,local_date,concept_id,owner_id) on delete cascade
);

do $$ declare t text; begin
  foreach t in array array['adult_academic_courses','adult_academic_sources','adult_academic_chunks','adult_academic_terms','adult_academic_source_concepts','adult_academic_settings','adult_academic_daily_items','adult_academic_attempts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('drop policy if exists account_private on public.%I',t);
    execute format('create policy account_private on public.%I for all to authenticated using (owner_id=(select auth.uid())) with check (owner_id=(select auth.uid()))',t);
    execute format('create index if not exists %I on public.%I(owner_id)',t||'_owner_idx',t);
  end loop;
end $$;
create index if not exists adult_academic_sources_course_idx on public.adult_academic_sources(course_id,created_at);
create index if not exists adult_academic_chunks_source_idx on public.adult_academic_chunks(source_id,ordinal);
create index if not exists adult_academic_links_concept_idx on public.adult_academic_source_concepts(concept_id);
create index if not exists adult_academic_daily_due_idx on public.adult_academic_daily_items(profile_id,local_date,completed_at,last_answered_at);
create index if not exists adult_academic_attempts_profile_date_idx on public.adult_academic_attempts(profile_id,local_date);

-- Publish only server-saved AI candidates. A repeated request merely links another source; it never resets memory.
create or replace function public.adult_academic_publish(p_source uuid,p_selected jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_source public.adult_academic_sources; v_choice jsonb; v_chunk public.adult_academic_chunks;
  v_item jsonb; v_phrase text; v_meaning text; v_key text; v_concept uuid; v_matching uuid;
  v_added integer:=0; v_reused integer:=0; v_linked integer:=0; v_new_link integer;
begin
  select * into v_source from public.adult_academic_sources where id=p_source and owner_id=auth.uid() for update;
  if v_source.id is null then raise exception '讲义不存在或无权限'; end if;
  if exists(select 1 from public.adult_academic_chunks where source_id=p_source and status<>'complete') then raise exception '请先完成全部段落的提取'; end if;
  if jsonb_typeof(p_selected) is distinct from 'array' or jsonb_array_length(p_selected) not between 1 and 1000 then raise exception '请选择 1～1000 条候选'; end if;
  for v_choice in select value from jsonb_array_elements(p_selected) loop
    select * into v_chunk from public.adult_academic_chunks where id=(v_choice->>'chunk_id')::uuid and source_id=p_source and owner_id=auth.uid();
    if v_chunk.id is null then raise exception '候选段落不属于这份讲义'; end if;
    v_item:=v_chunk.candidates->((v_choice->>'index')::integer);
    if v_item is null then raise exception '候选编号无效'; end if;
    v_phrase:=btrim(v_item->>'phrase'); v_meaning:=btrim(v_item->>'meaning');
    v_key:=lower(regexp_replace(v_phrase,'\s+',' ','g'));
    if char_length(v_key) not between 2 and 200 then raise exception '词条无效'; end if;
    if coalesce((v_choice->>'new_sense')::boolean,false) then v_key:=v_key||'::'||left(md5(lower(v_meaning)),12); end if;
    select concept_id into v_concept from public.adult_academic_terms where owner_id=auth.uid() and canonical_key=v_key;
    if v_concept is null then
      v_matching:=null;
      if not coalesce((v_choice->>'new_sense')::boolean,false) and v_choice ? 'match_id' and nullif(v_choice->>'match_id','') is not null then
        select id into v_matching from public.adult_english_concepts where id=(v_choice->>'match_id')::uuid and owner_id=auth.uid()
          and lower(regexp_replace(btrim(phrase),'\s+',' ','g'))=lower(regexp_replace(v_phrase,'\s+',' ','g'));
        if v_matching is null then raise exception '复用词条无效'; end if;
      elsif not coalesce((v_choice->>'new_sense')::boolean,false) then
        select id into v_matching from public.adult_english_concepts
          where owner_id=auth.uid() and lower(regexp_replace(btrim(phrase),'\s+',' ','g'))=lower(regexp_replace(v_phrase,'\s+',' ','g'))
            and lower(regexp_replace(btrim(meaning),'\s+',' ','g'))=lower(regexp_replace(v_meaning,'\s+',' ','g'))
          order by id limit 1;
      end if;
      if v_matching is not null then v_concept:=v_matching; v_reused:=v_reused+1;
      else
        insert into public.adult_english_concepts(phrase,meaning,example,concept_key)
          values(v_phrase,v_meaning,v_item->>'source_quote','academic:'||md5(v_key))
          on conflict(owner_id,concept_key) do nothing returning id into v_concept;
        if v_concept is null then
          select id into v_concept from public.adult_english_concepts where owner_id=auth.uid() and concept_key='academic:'||md5(v_key);
          v_reused:=v_reused+1;
        else v_added:=v_added+1; end if;
      end if;
      insert into public.adult_academic_terms(canonical_key,concept_id,category) values(v_key,v_concept,v_item->>'category') on conflict(owner_id,canonical_key) do nothing;
      select concept_id into v_concept from public.adult_academic_terms where owner_id=auth.uid() and canonical_key=v_key;
    else v_reused:=v_reused+1;
    end if;
    insert into public.adult_academic_source_concepts(source_id,concept_id,chunk_ordinal,source_quote,translation)
      values(p_source,v_concept,v_chunk.ordinal,v_item->>'source_quote',coalesce(v_item->>'translation','')) on conflict do nothing;
    get diagnostics v_new_link = row_count;
    if v_new_link>0 then v_linked:=v_linked+1; end if;
  end loop;
  update public.adult_academic_sources set published_at=coalesce(published_at,now()) where id=p_source;
  return jsonb_build_object('new_terms',v_added,'reused_terms',v_reused,'source_links',v_linked);
end $$;

create or replace function public.adult_academic_start_day(p_profile uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare v_today date:=(now() at time zone 'Asia/Shanghai')::date; v_settings public.adult_academic_settings; v_count integer;
begin
  if auth.uid() is null or not exists(select 1 from public.adult_profiles where id=p_profile and owner_id=auth.uid() and not archived) then raise exception '成人档案不存在或无权限'; end if;
  insert into public.adult_academic_settings(profile_id) values(p_profile) on conflict do nothing;
  select * into v_settings from public.adult_academic_settings where profile_id=p_profile for update;
  if exists(select 1 from public.adult_academic_daily_items where profile_id=p_profile and local_date=v_today) then
    select count(*) into v_count from public.adult_academic_daily_items where profile_id=p_profile and local_date=v_today and completed_at is null;
    return v_count;
  end if;
  insert into public.adult_academic_daily_items(profile_id,local_date,concept_id,queue_kind)
  select p_profile,v_today,t.concept_id,'review' from public.adult_academic_terms t
  join public.adult_english_word_states st on st.concept_id=t.concept_id and st.profile_id=p_profile
  where t.owner_id=auth.uid() and st.due_date<=v_today and exists (
    select 1 from public.adult_academic_source_concepts l join public.adult_academic_sources src on src.id=l.source_id
    where l.concept_id=t.concept_id and src.owner_id=auth.uid() and not src.archived and src.published_at is not null)
  order by st.priority desc,st.due_date,st.stage,t.concept_id limit v_settings.daily_review;
  insert into public.adult_academic_daily_items(profile_id,local_date,concept_id,queue_kind)
  select p_profile,v_today,t.concept_id,'new' from public.adult_academic_terms t
  left join public.adult_english_word_states st on st.concept_id=t.concept_id and st.profile_id=p_profile
  where t.owner_id=auth.uid() and st.concept_id is null and exists (
    select 1 from public.adult_academic_source_concepts l join public.adult_academic_sources src on src.id=l.source_id
    where l.concept_id=t.concept_id and src.owner_id=auth.uid() and not src.archived and src.published_at is not null)
  order by (case when v_settings.focus_course_id is not null and exists (
    select 1 from public.adult_academic_source_concepts l join public.adult_academic_sources src on src.id=l.source_id
    where l.concept_id=t.concept_id and src.course_id=v_settings.focus_course_id and not src.archived) then 0 else 1 end),
    (select min(src.created_at) from public.adult_academic_source_concepts l join public.adult_academic_sources src on src.id=l.source_id where l.concept_id=t.concept_id),t.concept_id
  limit v_settings.daily_new;
  select count(*) into v_count from public.adult_academic_daily_items where profile_id=p_profile and local_date=v_today and completed_at is null;
  return v_count;
end $$;

create or replace function public.adult_academic_answer(p_request uuid,p_profile uuid,p_concept uuid,p_result text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_today date:=(now() at time zone 'Asia/Shanghai')::date; v_item public.adult_academic_daily_items;
  v_state public.adult_english_word_states; v_prior public.adult_academic_attempts;
  v_stage integer; v_due date; v_confirm integer; v_failed boolean; v_complete boolean:=false;
begin
  if p_result is null or p_result not in ('known','again') then raise exception '请选择记得或再学一次'; end if;
  select * into v_item from public.adult_academic_daily_items where profile_id=p_profile and local_date=v_today and concept_id=p_concept and owner_id=auth.uid() for update;
  if v_item.profile_id is null then raise exception '词条不在今天的任务中'; end if;
  select * into v_prior from public.adult_academic_attempts where id=p_request and owner_id=auth.uid();
  if v_prior.id is not null then
    if v_prior.profile_id<>p_profile or v_prior.concept_id<>p_concept or v_prior.result<>p_result then raise exception '请求编号与原记录不匹配'; end if;
    return jsonb_build_object('stage',v_prior.stage_after,'idempotent',true,'completed',v_item.completed_at is not null);
  end if;
  if v_item.completed_at is not null then raise exception '本词今天已经完成'; end if;
  insert into public.adult_english_word_states(profile_id,concept_id,due_date) values(p_profile,p_concept,v_today) on conflict do nothing;
  select * into v_state from public.adult_english_word_states where profile_id=p_profile and concept_id=p_concept for update;
  v_stage:=v_state.stage; v_due:=v_state.due_date; v_confirm:=v_item.confirmations; v_failed:=v_item.had_failure;
  if p_result='again' then
    v_confirm:=0;
    if not v_failed then v_stage:=greatest(0,v_stage-1); end if;
    v_failed:=true; v_due:=v_today;
  else
    v_confirm:=least(2,v_confirm+1);
    if v_item.queue_kind='review' and not v_failed and v_item.attempt_count=0 then v_complete:=true;
    elsif v_confirm>=2 then v_complete:=true; end if;
    if v_complete then
      if not v_failed and v_state.last_success_date is distinct from v_today and v_state.last_failure_date is distinct from v_today then
        v_stage:=least(5,v_stage+1); v_due:=v_today+(array[1,3,7,14,30])[v_stage];
      elsif v_failed then v_due:=v_today+1;
      end if;
    end if;
  end if;
  update public.adult_academic_daily_items set confirmations=v_confirm,had_failure=v_failed,
    attempt_count=attempt_count+1,last_answered_at=now(),completed_at=case when v_complete then now() else null end
  where profile_id=p_profile and local_date=v_today and concept_id=p_concept;
  update public.adult_english_word_states set stage=v_stage,due_date=v_due,attempts=attempts+1,
    independent_days=independent_days+case when v_complete and not v_failed and last_success_date is distinct from v_today and last_failure_date is distinct from v_today then 1 else 0 end,
    spaced_success=case when p_result='again' then false else spaced_success or (v_complete and not v_failed and last_success_date is not null and v_today-last_success_date>=7) end,
    last_success_date=case when v_complete and not v_failed then v_today else last_success_date end,
    last_failure_date=case when p_result='again' then v_today else last_failure_date end
  where profile_id=p_profile and concept_id=p_concept;
  insert into public.adult_academic_attempts(id,profile_id,local_date,concept_id,result,stage_before,stage_after)
    values(p_request,p_profile,v_today,p_concept,p_result,v_state.stage,v_stage);
  return jsonb_build_object('stage',v_stage,'due_date',v_due,'completed',v_complete,'confirmations',v_confirm,'remaining',
    (select count(*) from public.adult_academic_daily_items where profile_id=p_profile and local_date=v_today and completed_at is null));
end $$;

revoke all on function public.adult_academic_publish(uuid,jsonb) from public,anon;
revoke all on function public.adult_academic_start_day(uuid) from public,anon;
revoke all on function public.adult_academic_answer(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.adult_academic_publish(uuid,jsonb) to authenticated;
grant execute on function public.adult_academic_start_day(uuid) to authenticated;
grant execute on function public.adult_academic_answer(uuid,uuid,uuid,text) to authenticated;
commit;
