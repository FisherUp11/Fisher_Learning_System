-- 青蛙跳字岛：独立于正式汉字学习队列的听音选字游戏。
-- 已运行 001–029 的项目：备份后在 Supabase SQL Editor 整段执行；可重复执行。
begin;

create table if not exists public.hanzi_frog_sessions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  played_by uuid not null references auth.users(id) on delete cascade,
  difficulty text not null check (difficulty in ('easy','normal','challenge')),
  question_count smallint not null check (question_count between 4 and 18),
  first_touch_correct smallint not null,
  wrong_count smallint not null,
  replay_count smallint not null,
  duration_ms integer not null check (duration_ms between 0 and 3600000),
  played_at timestamptz not null default now(),
  check (first_touch_correct between 0 and question_count)
);

create table if not exists public.hanzi_frog_taps (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.hanzi_frog_sessions(id) on delete cascade,
  question_index smallint not null,
  touch_index smallint not null,
  target_character_id uuid not null references public.characters(id) on delete cascade,
  selected_character_id uuid not null references public.characters(id) on delete cascade,
  correct boolean not null,
  elapsed_ms integer not null,
  replay_count smallint not null,
  unique (session_id,question_index,touch_index)
);

create index if not exists hanzi_frog_sessions_learner_recent_idx on public.hanzi_frog_sessions(learner_id,played_at desc);
create index if not exists hanzi_frog_taps_session_idx on public.hanzi_frog_taps(session_id,question_index,touch_index);
alter table public.hanzi_frog_sessions enable row level security;
alter table public.hanzi_frog_taps enable row level security;

drop policy if exists "frog sessions family read" on public.hanzi_frog_sessions;
create policy "frog sessions family read" on public.hanzi_frog_sessions for select to authenticated
  using (private.can_access_learner(learner_id));
drop policy if exists "frog taps family read" on public.hanzi_frog_taps;
create policy "frog taps family read" on public.hanzi_frog_taps for select to authenticated
  using (exists(select 1 from public.hanzi_frog_sessions s where s.id=session_id and private.can_access_learner(s.learner_id)));
revoke all on public.hanzi_frog_sessions,public.hanzi_frog_taps from anon,authenticated;
grant select on public.hanzi_frog_sessions,public.hanzi_frog_taps to authenticated;

-- 只读候选：到期字在前，其余已学字用于少量补足；从不新建每日学习任务。
create or replace function public.get_hanzi_frog_pool(p_learner_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rows jsonb;
begin
  if not private.can_use_learner_module(p_learner_id,'hanzi') then
    raise exception '无权使用这位孩子的汉字游戏' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(pool) order by pool.due_first desc,pool.due_at,pool.character_id),'[]'::jsonb)
    into v_rows
  from (
    select * from (
    select distinct on (c.id) c.id as character_id,c.character as hanzi,c.pinyin_marked,
      c.word_one,s.stage,s.due_at,(s.due_at<=now()) as due_first
    from public.learning_states s
    join public.characters c on c.id=s.character_id
    join public.package_characters pc on pc.character_id=c.id
    join public.learner_content_packages a on a.package_id=pc.package_id
      and a.learner_id=p_learner_id and a.assignment_status='active'
    join public.content_packages p on p.id=a.package_id
      and p.status='published' and p.review_status='approved'
    where s.learner_id=p_learner_id
    order by c.id
    ) available order by due_first desc,due_at,character_id limit 180
  ) pool;
  return coalesce(v_rows,'[]'::jsonb);
end;
$$;

-- 每局一次原子提交：服务端重新核对字属于孩子当前字册，并从逐次点选计算成绩。
-- 本函数绝不写 learning_states、daily_sessions、learning_attempts 或贴纸表。
create or replace function public.save_hanzi_frog_game(
  p_request_id uuid,p_learner_id uuid,p_difficulty text,p_rounds jsonb,p_duration_ms integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_session public.hanzi_frog_sessions%rowtype;
  v_round jsonb; v_touch jsonb; v_options jsonb; v_target uuid; v_selected uuid;
  v_question_index integer:=0; v_touch_index integer; v_first integer:=0;
  v_wrong integer:=0; v_replays integer:=0; v_touch_count integer; v_option_count integer;
begin
  if (select auth.uid()) is null or not private.can_use_learner_module(p_learner_id,'hanzi') then
    raise exception '无权保存这位孩子的游戏记录' using errcode='42501';
  end if;
  if p_request_id is null then raise exception '缺少请求编号'; end if;
  select * into v_session from public.hanzi_frog_sessions where request_id=p_request_id;
  if found then
    if v_session.learner_id<>p_learner_id or v_session.played_by<>(select auth.uid()) then
      raise exception '请求编号已经被使用' using errcode='42501';
    end if;
    return jsonb_build_object('session_id',v_session.id,'question_count',v_session.question_count,
      'first_touch_correct',v_session.first_touch_correct,'wrong_count',v_session.wrong_count,
      'replay_count',v_session.replay_count);
  end if;
  if p_difficulty not in ('easy','normal','challenge') or p_duration_ms not between 0 and 3600000
    or jsonb_typeof(p_rounds)<>'array' or jsonb_array_length(p_rounds) not between 4 and 18 then
    raise exception '游戏数据不完整';
  end if;
  -- 锁定这个孩子，防止同一人重复提交同一请求编号时并发插入。
  perform 1 from public.learner_profiles where id=p_learner_id for update;
  select * into v_session from public.hanzi_frog_sessions where request_id=p_request_id;
  if found then
    if v_session.learner_id<>p_learner_id or v_session.played_by<>(select auth.uid()) then
      raise exception '请求编号已经被使用' using errcode='42501';
    end if;
    return jsonb_build_object('session_id',v_session.id,'question_count',v_session.question_count,
      'first_touch_correct',v_session.first_touch_correct,'wrong_count',v_session.wrong_count,
      'replay_count',v_session.replay_count);
  end if;
  insert into public.hanzi_frog_sessions(request_id,learner_id,played_by,difficulty,question_count,
    first_touch_correct,wrong_count,replay_count,duration_ms)
  values(p_request_id,p_learner_id,(select auth.uid()),p_difficulty,jsonb_array_length(p_rounds),0,0,0,p_duration_ms)
  returning * into v_session;
  for v_round in select value from jsonb_array_elements(p_rounds) loop
    v_question_index:=v_question_index+1;
    v_target:=(v_round->>'targetId')::uuid;
    v_options:=v_round->'options';
    if jsonb_typeof(v_options)<>'array' then raise exception '候选字格式错误'; end if;
    v_option_count:=jsonb_array_length(v_options);
    if v_option_count not between 4 and 6 or
      (select count(distinct value) from jsonb_array_elements_text(v_options))<>v_option_count or
      not(v_options ? v_target::text) then raise exception '候选字数量或内容错误'; end if;
    if not exists(
      select 1 from public.learning_states state
      join public.package_characters pc on pc.character_id=state.character_id
      join public.learner_content_packages a on a.package_id=pc.package_id and a.learner_id=p_learner_id and a.assignment_status='active'
      join public.content_packages p on p.id=a.package_id and p.status='published' and p.review_status='approved'
      where state.learner_id=p_learner_id and state.character_id=v_target
    ) then raise exception '游戏题目不在孩子已学字册中' using errcode='42501'; end if;
    if exists(
      select 1 from jsonb_array_elements_text(v_options) opt
      where not exists(
        select 1 from public.learning_states state
        join public.package_characters pc on pc.character_id=state.character_id
        join public.learner_content_packages a on a.package_id=pc.package_id and a.learner_id=p_learner_id and a.assignment_status='active'
        join public.content_packages p on p.id=a.package_id and p.status='published' and p.review_status='approved'
        where state.learner_id=p_learner_id and state.character_id=opt.value::uuid
      )
    ) then raise exception '候选字不在孩子已学字册中' using errcode='42501'; end if;
    if jsonb_typeof(v_round->'taps')<>'array' then raise exception '缺少点选记录'; end if;
    v_touch_count:=jsonb_array_length(v_round->'taps');
    if v_touch_count not between 1 and 6 then raise exception '点选次数超出范围'; end if;
    v_touch_index:=0;
    for v_touch in select value from jsonb_array_elements(v_round->'taps') loop
      v_touch_index:=v_touch_index+1;
      v_selected:=(v_touch->>'selectedId')::uuid;
      if not(v_options ? v_selected::text) or
        coalesce((v_touch->>'elapsedMs')::integer,-1) not between 0 and 600000 or
        coalesce((v_touch->>'replayCount')::integer,-1) not between 0 and 50 then
        raise exception '点选数据无效';
      end if;
      if v_touch_index=1 and v_selected=v_target then v_first:=v_first+1; end if;
      if v_selected<>v_target then v_wrong:=v_wrong+1; end if;
      insert into public.hanzi_frog_taps(session_id,question_index,touch_index,target_character_id,
        selected_character_id,correct,elapsed_ms,replay_count)
      values(v_session.id,v_question_index,v_touch_index,v_target,v_selected,v_selected=v_target,
        (v_touch->>'elapsedMs')::integer,(v_touch->>'replayCount')::smallint);
    end loop;
    v_replays:=v_replays+coalesce((v_round->>'replayCount')::integer,0);
  end loop;
  update public.hanzi_frog_sessions set first_touch_correct=v_first,wrong_count=v_wrong,replay_count=v_replays
    where id=v_session.id;
  return jsonb_build_object('session_id',v_session.id,'question_count',v_question_index,
    'first_touch_correct',v_first,'wrong_count',v_wrong,'replay_count',v_replays);
end;
$$;

revoke all on function public.get_hanzi_frog_pool(uuid) from public,anon;
revoke all on function public.save_hanzi_frog_game(uuid,uuid,text,jsonb,integer) from public,anon;
grant execute on function public.get_hanzi_frog_pool(uuid) to authenticated;
grant execute on function public.save_hanzi_frog_game(uuid,uuid,text,jsonb,integer) to authenticated;
commit;
