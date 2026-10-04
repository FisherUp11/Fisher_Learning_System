-- 字芽 029：汉字内嵌拼音练习 + 汉字提示中性记录。
-- 前置：至少 001–016 的汉字/多家庭迁移已运行；建议现有项目按编号运行至 028。
-- 请在 Supabase SQL Editor 整段执行；不清空任何既有学习记录。
begin;

create table if not exists public.pinyin_units (
  code text primary key,
  category text not null check (category in ('final', 'initial')),
  sort_order smallint not null unique,
  example_hanzi text not null,
  example_pinyin text not null
);
insert into public.pinyin_units(code,category,sort_order,example_hanzi,example_pinyin) values
('a','final',1,'啊','ā'),('o','final',2,'哦','ó'),('e','final',3,'鹅','é'),
('i','final',4,'衣','yī'),('u','final',5,'乌','wū'),('ü','final',6,'鱼','yú'),
('b','initial',7,'波','bō'),('p','initial',8,'坡','pō'),('m','initial',9,'妈','mā'),
('f','initial',10,'发','fā'),('d','initial',11,'大','dà'),('t','initial',12,'天','tiān'),
('n','initial',13,'你','nǐ'),('l','initial',14,'来','lái'),('g','initial',15,'哥','gē'),
('k','initial',16,'开','kāi'),('h','initial',17,'喝','hē'),('j','initial',18,'鸡','jī'),
('q','initial',19,'七','qī'),('x','initial',20,'西','xī'),('zh','initial',21,'知','zhī'),
('ch','initial',22,'吃','chī'),('sh','initial',23,'诗','shī'),('r','initial',24,'日','rì'),
('z','initial',25,'字','zì'),('c','initial',26,'次','cì'),('s','initial',27,'思','sī'),
('y','initial',28,'衣','yī'),('w','initial',29,'乌','wū')
on conflict (code) do update set category=excluded.category,sort_order=excluded.sort_order,
  example_hanzi=excluded.example_hanzi,example_pinyin=excluded.example_pinyin;

create table if not exists public.pinyin_settings (
  learner_id uuid primary key references public.learner_profiles(id) on delete cascade,
  mode text not null default 'off' check (mode in ('off','finals','initials','both')),
  daily_limit smallint not null default 4 check (daily_limit between 3 and 5),
  updated_at timestamptz not null default now()
);
create table if not exists public.pinyin_states (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  unit_code text not null references public.pinyin_units(code),
  stage smallint not null default 0 check (stage between 0 and 7),
  due_at timestamptz not null default now(),
  last_result text check (last_result in ('known','again')),
  total_attempts integer not null default 0,
  known_count integer not null default 0,
  again_count integer not null default 0,
  helped_count integer not null default 0,
  last_practiced_at timestamptz,
  spot_checked_at timestamptz,
  mastered_at timestamptz,
  primary key (learner_id,unit_code)
);
create index if not exists pinyin_states_due_idx on public.pinyin_states(learner_id,due_at,stage);
create table if not exists public.pinyin_daily_sessions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  date_local date not null,
  mode_snapshot text not null,
  limit_snapshot smallint not null,
  created_at timestamptz not null default now(),
  unique(learner_id,date_local)
);
create index if not exists pinyin_daily_sessions_learner_date_idx on public.pinyin_daily_sessions(learner_id,date_local desc);
create table if not exists public.pinyin_daily_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.pinyin_daily_sessions(id) on delete cascade,
  unit_code text not null references public.pinyin_units(code),
  queue_kind text not null check (queue_kind in ('new','review','spot','retry')),
  queue_position integer not null check (queue_position > 0),
  status text not null default 'pending' check (status in ('pending','answered')),
  answered_at timestamptz,
  unique(session_id,queue_position)
);
create index if not exists pinyin_daily_items_queue_idx on public.pinyin_daily_items(session_id,status,queue_position);
create table if not exists public.pinyin_daily_progress (
  session_id uuid not null references public.pinyin_daily_sessions(id) on delete cascade,
  unit_code text not null references public.pinyin_units(code),
  starting_stage smallint not null,
  is_spot_check boolean not null default false,
  required_confirmations smallint not null check (required_confirmations in (1,2)),
  clean_streak smallint not null default 0 check (clean_streak between 0 and 2),
  stage_adjusted boolean not null default false,
  attempts integer not null default 0,
  passed_at timestamptz,
  primary key(session_id,unit_code)
);
create table if not exists public.pinyin_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  unit_code text not null references public.pinyin_units(code),
  item_id uuid not null unique references public.pinyin_daily_items(id) on delete cascade,
  result text not null check (result in ('known','again','helped')),
  previous_stage smallint not null,
  next_stage smallint not null,
  answered_at timestamptz not null default now()
);
create index if not exists pinyin_attempts_history_idx on public.pinyin_attempts(learner_id,unit_code,answered_at desc);

alter table public.pinyin_units enable row level security;
alter table public.pinyin_settings enable row level security;
alter table public.pinyin_states enable row level security;
alter table public.pinyin_daily_sessions enable row level security;
alter table public.pinyin_daily_items enable row level security;
alter table public.pinyin_daily_progress enable row level security;
alter table public.pinyin_attempts enable row level security;
drop policy if exists "pinyin catalog read" on public.pinyin_units;
drop policy if exists "pinyin settings read" on public.pinyin_settings;
drop policy if exists "pinyin settings write" on public.pinyin_settings;
drop policy if exists "pinyin states read" on public.pinyin_states;
drop policy if exists "pinyin sessions read" on public.pinyin_daily_sessions;
drop policy if exists "pinyin items read" on public.pinyin_daily_items;
drop policy if exists "pinyin progress read" on public.pinyin_daily_progress;
drop policy if exists "pinyin attempts read" on public.pinyin_attempts;
create policy "pinyin catalog read" on public.pinyin_units for select to authenticated using (true);
create policy "pinyin settings read" on public.pinyin_settings for select to authenticated using (private.can_access_learner(learner_id));
create policy "pinyin settings write" on public.pinyin_settings for all to authenticated
  using (private.can_access_learner(learner_id)) with check (private.can_access_learner(learner_id));
create policy "pinyin states read" on public.pinyin_states for select to authenticated using (private.can_access_learner(learner_id));
create policy "pinyin sessions read" on public.pinyin_daily_sessions for select to authenticated using (private.can_access_learner(learner_id));
create policy "pinyin items read" on public.pinyin_daily_items for select to authenticated using (
  exists(select 1 from public.pinyin_daily_sessions s where s.id=session_id and private.can_access_learner(s.learner_id)));
create policy "pinyin progress read" on public.pinyin_daily_progress for select to authenticated using (
  exists(select 1 from public.pinyin_daily_sessions s where s.id=session_id and private.can_access_learner(s.learner_id)));
create policy "pinyin attempts read" on public.pinyin_attempts for select to authenticated using (private.can_access_learner(learner_id));
revoke all on public.pinyin_units,public.pinyin_settings,public.pinyin_states,public.pinyin_daily_sessions,
  public.pinyin_daily_items,public.pinyin_daily_progress,public.pinyin_attempts from anon;
revoke all on public.pinyin_units,public.pinyin_settings,public.pinyin_states,public.pinyin_daily_sessions,
  public.pinyin_daily_items,public.pinyin_daily_progress,public.pinyin_attempts from authenticated;
grant select on public.pinyin_units,public.pinyin_states,public.pinyin_daily_sessions,public.pinyin_daily_items,
  public.pinyin_daily_progress,public.pinyin_attempts to authenticated;
grant select,insert,update on public.pinyin_settings to authenticated;

-- 一次性准备当天卡片；会话锁防止多设备同时初始化而重复发卡。
create or replace function public.pinyin_get_today(p_learner_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_mode text; v_limit smallint; v_day date; v_timezone text; v_session uuid;
  v_count integer; v_next integer; v_unit record; v_items jsonb;
begin
  if not private.can_access_learner(p_learner_id) then raise exception '无权查看该孩子拼音' using errcode='42501'; end if;
  select coalesce(s.mode,'off'),coalesce(s.daily_limit,4),l.timezone
    into v_mode,v_limit,v_timezone from public.learner_profiles l
    left join public.pinyin_settings s on s.learner_id=l.id where l.id=p_learner_id;
  if v_mode='off' then return jsonb_build_object('mode','off','items','[]'::jsonb,'total',0,'passed',0); end if;
  v_day := (now() at time zone v_timezone)::date;
  insert into public.pinyin_daily_sessions(learner_id,date_local,mode_snapshot,limit_snapshot)
    values(p_learner_id,v_day,v_mode,v_limit) on conflict(learner_id,date_local) do nothing;
  select s.id into v_session from public.pinyin_daily_sessions s
    where s.learner_id=p_learner_id and s.date_local=v_day for update;
  select count(*) into v_count from public.pinyin_daily_progress p where p.session_id=v_session;
  if v_count=0 then
    v_next := 0;
    -- 到期优先，随后新拼音；不把仅仅出现的拼音提前算为学过。
    for v_unit in
      select u.code,case when st.unit_code is null then 'new' else 'review' end as kind,
        coalesce(st.stage,0) as stage,coalesce(st.due_at,now()) as due_at
      from public.pinyin_units u left join public.pinyin_states st
        on st.unit_code=u.code and st.learner_id=p_learner_id
      where (v_mode='both' or (v_mode='finals' and u.category='final') or (v_mode='initials' and u.category='initial'))
        and (st.unit_code is null or st.due_at<=now())
      order by case when st.unit_code is null then 1 else 0 end,coalesce(st.due_at,now()),u.sort_order
      limit v_limit
    loop
      v_next:=v_next+1;
      insert into public.pinyin_daily_items(session_id,unit_code,queue_kind,queue_position)
        values(v_session,v_unit.code,v_unit.kind,v_next);
      insert into public.pinyin_daily_progress(session_id,unit_code,starting_stage,required_confirmations)
        values(v_session,v_unit.code,v_unit.stage,case when v_unit.kind='new' or v_unit.stage<=2 then 2 else 1 end);
    end loop;
    -- 全部已认识且未到期时，轮流抽查；抽查答对不推进间隔。
    if v_next<v_limit then
      for v_unit in
        select u.code,st.stage from public.pinyin_units u join public.pinyin_states st
          on st.unit_code=u.code and st.learner_id=p_learner_id
        where (v_mode='both' or (v_mode='finals' and u.category='final') or (v_mode='initials' and u.category='initial'))
          and not exists(select 1 from public.pinyin_daily_progress p where p.session_id=v_session and p.unit_code=u.code)
        order by st.spot_checked_at nulls first,st.last_practiced_at nulls first,u.sort_order
        limit (v_limit-v_next)
      loop
        v_next:=v_next+1;
        insert into public.pinyin_daily_items(session_id,unit_code,queue_kind,queue_position)
          values(v_session,v_unit.code,'spot',v_next);
        insert into public.pinyin_daily_progress(session_id,unit_code,starting_stage,is_spot_check,required_confirmations)
          values(v_session,v_unit.code,v_unit.stage,true,1);
      end loop;
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id',i.id,'unit_code',i.unit_code,'category',u.category,'example_hanzi',u.example_hanzi,
    'example_pinyin',u.example_pinyin,'kind',i.queue_kind,'stage',p.starting_stage,
    'clean_streak',p.clean_streak,'required_confirmations',p.required_confirmations,'attempts',p.attempts)
    order by i.queue_position),'[]'::jsonb) into v_items
    from public.pinyin_daily_items i join public.pinyin_units u on u.code=i.unit_code
    join public.pinyin_daily_progress p on p.session_id=i.session_id and p.unit_code=i.unit_code
    where i.session_id=v_session and i.status='pending';
  return jsonb_build_object('mode',v_mode,'items',v_items,
    'total',(select count(*) from public.pinyin_daily_progress p where p.session_id=v_session),
    'passed',(select count(*) from public.pinyin_daily_progress p where p.session_id=v_session and p.passed_at is not null));
end; $$;

create or replace function public.pinyin_answer(p_learner_id uuid,p_item_id uuid,p_result text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item record; v_progress public.pinyin_daily_progress%rowtype; v_state public.pinyin_states%rowtype;
  v_day date; v_timezone text; v_stage smallint; v_due timestamptz; v_clean smallint; v_adjusted boolean;
  v_passed boolean:=false; v_position integer;
begin
  if p_result not in ('known','again','helped') then raise exception '无效回答' using errcode='22023'; end if;
  if not private.can_access_learner(p_learner_id) then raise exception '无权记录该孩子拼音' using errcode='42501'; end if;
  select l.timezone into v_timezone from public.learner_profiles l where l.id=p_learner_id;
  v_day := (now() at time zone v_timezone)::date;
  if exists(select 1 from public.pinyin_attempts a where a.request_id=p_request_id) then return jsonb_build_object('idempotent',true); end if;
  select i.*,s.date_local,s.learner_id into v_item from public.pinyin_daily_items i
    join public.pinyin_daily_sessions s on s.id=i.session_id
    where i.id=p_item_id and s.learner_id=p_learner_id for update of i;
  if not found then raise exception '拼音卡不存在' using errcode='42501'; end if;
  if v_item.date_local<>v_day then raise exception '已跨日，请重新加载拼音' using errcode='22023'; end if;
  if v_item.status<>'pending' then return jsonb_build_object('idempotent',true); end if;
  perform 1 from public.pinyin_daily_sessions s where s.id=v_item.session_id for update;
  select * into v_progress from public.pinyin_daily_progress p
    where p.session_id=v_item.session_id and p.unit_code=v_item.unit_code for update;
  insert into public.pinyin_states(learner_id,unit_code) values(p_learner_id,v_item.unit_code)
    on conflict(learner_id,unit_code) do nothing;
  select * into v_state from public.pinyin_states st
    where st.learner_id=p_learner_id and st.unit_code=v_item.unit_code for update;
  v_stage:=v_state.stage; v_due:=v_state.due_at; v_adjusted:=v_progress.stage_adjusted;
  v_clean:=case when p_result='known' then least(2,v_progress.clean_streak+1) else 0 end;
  if p_result='known' and v_clean>=v_progress.required_confirmations then
    v_passed:=true;
    if not v_progress.is_spot_check and not v_adjusted then
      v_stage:=least(7,v_state.stage+1);
      v_due:=now()+case v_stage when 1 then interval '1 day' when 2 then interval '3 days'
        when 3 then interval '7 days' when 4 then interval '14 days' when 5 then interval '30 days'
        when 6 then interval '60 days' when 7 then
          case when v_state.stage=7 then interval '180 days' else interval '90 days' end end;
    end if;
  elsif p_result='again' then
    if not v_adjusted then
      v_stage:=case v_state.stage when 0 then 0 when 1 then 0 when 2 then 1 else v_state.stage-2 end;
      v_adjusted:=true;
    end if;
    v_due:=now()+interval '1 day';
  end if;
  update public.pinyin_states st set stage=v_stage,due_at=v_due,
    last_result=case when p_result='helped' then st.last_result else p_result end,
    total_attempts=st.total_attempts+1,known_count=st.known_count+(p_result='known')::integer,
    again_count=st.again_count+(p_result='again')::integer,helped_count=st.helped_count+(p_result='helped')::integer,
    last_practiced_at=now(),spot_checked_at=case when v_progress.is_spot_check then now() else st.spot_checked_at end,
    mastered_at=case when v_stage=7 then coalesce(st.mastered_at,now()) else null end
    where st.learner_id=p_learner_id and st.unit_code=v_item.unit_code;
  update public.pinyin_daily_progress p set clean_streak=v_clean,
    required_confirmations=case when p_result='known' then p.required_confirmations else 2 end,
    stage_adjusted=v_adjusted,attempts=p.attempts+1,
    passed_at=case when v_passed then now() else p.passed_at end
    where p.session_id=v_item.session_id and p.unit_code=v_item.unit_code;
  update public.pinyin_daily_items i set status='answered',answered_at=now() where i.id=v_item.id;
  insert into public.pinyin_attempts(request_id,learner_id,unit_code,item_id,result,previous_stage,next_stage)
    values(p_request_id,p_learner_id,v_item.unit_code,v_item.id,p_result,v_state.stage,v_stage);
  if not v_passed then
    select coalesce(max(i.queue_position),0)+1 into v_position from public.pinyin_daily_items i where i.session_id=v_item.session_id;
    insert into public.pinyin_daily_items(session_id,unit_code,queue_kind,queue_position)
      values(v_item.session_id,v_item.unit_code,'retry',v_position);
  end if;
  return jsonb_build_object('passed',v_passed,'stage',v_stage,'due_at',v_due,'adjusted',v_adjusted);
end; $$;

-- 汉字提示是第三种结果：保留原阶段/到期时间，只在同日队列尾部安排重新独立认识。
alter table public.learning_attempts drop constraint if exists learning_attempts_result_check;
alter table public.learning_attempts add constraint learning_attempts_result_check check(result in ('known','again','helped'));
alter table public.daily_character_progress drop constraint if exists daily_character_progress_first_result_check;
alter table public.daily_character_progress add constraint daily_character_progress_first_result_check
  check(first_result in ('known','again','helped'));
create or replace function public.record_hanzi_hint_retry(p_learner_id uuid,p_session_item_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item record; v_state public.learning_states%rowtype; v_progress public.daily_character_progress%rowtype;
  v_today date; v_timezone text; v_position integer; v_total integer; v_passed integer;
begin
  if not private.can_access_learner(p_learner_id) then raise exception '无权记录该孩子汉字' using errcode='42501'; end if;
  select l.timezone into v_timezone from public.learner_profiles l where l.id=p_learner_id;
  v_today := (now() at time zone v_timezone)::date;
  if exists(select 1 from public.learning_attempts a where a.request_id=p_request_id) then return jsonb_build_object('idempotent',true); end if;
  select i.*,s.date_local into v_item from public.daily_session_items i join public.daily_sessions s on s.id=i.session_id
    where i.id=p_session_item_id and s.learner_id=p_learner_id for update of i;
  if not found then raise exception '汉字卡不存在' using errcode='42501'; end if;
  if v_item.date_local<>v_today then raise exception '已跨日，请重新加载汉字' using errcode='22023'; end if;
  if v_item.status<>'pending' then return jsonb_build_object('idempotent',true); end if;
  perform 1 from public.daily_sessions s where s.id=v_item.session_id for update;
  insert into public.learning_states(learner_id,character_id,stage,due_at)
    values(p_learner_id,v_item.character_id,0,now()) on conflict(learner_id,character_id) do nothing;
  select * into v_state from public.learning_states st
    where st.learner_id=p_learner_id and st.character_id=v_item.character_id for update;
  insert into public.daily_character_progress(session_id,learner_id,character_id,initial_queue_kind,starting_stage,required_confirmations)
    values(v_item.session_id,p_learner_id,v_item.character_id,v_item.queue_kind,v_state.stage,2)
    on conflict(session_id,character_id) do nothing;
  select * into v_progress from public.daily_character_progress p
    where p.session_id=v_item.session_id and p.character_id=v_item.character_id for update;
  if v_progress.passed_at is not null then
    update public.daily_session_items i set status='answered',answered_at=coalesce(i.answered_at,now()) where i.id=v_item.id;
    return jsonb_build_object('idempotent',true,'daily_passed',true);
  end if;
  update public.daily_character_progress p set clean_streak=0,required_confirmations=2,
    failed_streak=case when p.failed_streak>=3 then 0 else p.failed_streak end,
    attempt_count=p.attempt_count+1,assisted_count=p.assisted_count+1,
    first_result=coalesce(p.first_result,'helped'),updated_at=now()
    where p.session_id=v_item.session_id and p.character_id=v_item.character_id;
  update public.daily_session_items i set status='answered',answered_at=now() where i.id=v_item.id;
  insert into public.learning_attempts(request_id,learner_id,character_id,state_id,session_item_id,result,
    queue_kind,previous_stage,next_stage,next_due_at,assisted,attempt_number,clean_streak_after,daily_passed,stage_adjusted_today)
  values(p_request_id,p_learner_id,v_item.character_id,v_state.id,v_item.id,'helped',v_item.queue_kind,
    v_state.stage,v_state.stage,v_state.due_at,true,v_progress.attempt_count+1,0,false,v_progress.stage_adjusted);
  select coalesce(max(i.queue_position),0)+1 into v_position from public.daily_session_items i where i.session_id=v_item.session_id;
  insert into public.daily_session_items(session_id,character_id,queue_kind,queue_position,retry_no)
    values(v_item.session_id,v_item.character_id,'same_day_retry',v_position,v_progress.attempt_count+1);
  select count(*),count(*) filter(where p.passed_at is not null) into v_total,v_passed
    from public.daily_character_progress p where p.session_id=v_item.session_id;
  return jsonb_build_object('daily_passed',false,'assisted',true,'next_stage',v_state.stage,
    'next_due_at',v_state.due_at,'today_total',v_total,'today_passed',v_passed,
    'today_remaining',greatest(0,v_total-v_passed));
end; $$;
revoke execute on function public.pinyin_get_today(uuid),public.pinyin_answer(uuid,uuid,text,uuid),
  public.record_hanzi_hint_retry(uuid,uuid,uuid) from public,anon;
grant execute on function public.pinyin_get_today(uuid),public.pinyin_answer(uuid,uuid,text,uuid),
  public.record_hanzi_hint_retry(uuid,uuid,uuid) to authenticated;
commit;
