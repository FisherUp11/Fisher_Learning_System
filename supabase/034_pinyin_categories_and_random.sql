-- 字芽 034：选学复韵母/整体认读音节、随机新拼音（首次加入不重复）、孩子专用口诀。
-- 前置：029_pinyin_learning.sql 与 024 模块权限已运行。
-- 整份运行，可重复执行；不删除历史、不修改现有记忆阶段/间隔/汉字数据。
begin;

alter table public.pinyin_units drop constraint if exists pinyin_units_category_check;
alter table public.pinyin_units add constraint pinyin_units_category_check
  check(category in ('final','initial','compound','front_nasal','back_nasal','whole'));
alter table public.pinyin_units add column if not exists mnemonic text not null default '';
alter table public.pinyin_units drop constraint if exists pinyin_units_mnemonic_length;
alter table public.pinyin_units add constraint pinyin_units_mnemonic_length check(char_length(mnemonic)<=160);

-- er 是特殊韵母，便于选学放在复韵母组；卡片单独标注“特殊韵母”。
insert into public.pinyin_units(code,category,sort_order,example_hanzi,example_pinyin) values
('ai','compound',30,'爱','ài'),('ei','compound',31,'诶','ēi'),('ui','compound',32,'灰','huī'),
('ao','compound',33,'凹','āo'),('ou','compound',34,'欧','ōu'),('iu','compound',35,'牛','niú'),
('ie','compound',36,'贴','tiē'),('üe','compound',37,'月','yuè'),('er','compound',38,'二','èr'),
('zhi','whole',39,'知','zhī'),('chi','whole',40,'吃','chī'),('shi','whole',41,'诗','shī'),
('ri','whole',42,'日','rì'),('zi','whole',43,'字','zì'),('ci','whole',44,'次','cì'),('si','whole',45,'思','sī'),
('yi','whole',46,'衣','yī'),('wu','whole',47,'乌','wū'),('yu','whole',48,'鱼','yú'),
('ye','whole',49,'夜','yè'),('yue','whole',50,'月','yuè'),('yuan','whole',51,'圆','yuán'),
('yin','whole',52,'音','yīn'),('yun','whole',53,'云','yún'),('ying','whole',54,'鹰','yīng')
on conflict(code) do update set category=excluded.category,sort_order=excluded.sort_order,
  example_hanzi=excluded.example_hanzi,example_pinyin=excluded.example_pinyin;

-- 由家长提供的 14 条口诀；不冒充未验证的斑马教材内容。
update public.pinyin_units u set mnemonic=v.mnemonic from (values
('b','像个哨子bbb'),('p','网兜飘飘ppp'),('m','两个门洞mmm'),('f','一根拐杖fff'),
('d','鼓槌敲鼓ddd'),('t','小小伞把ttt'),('n','一个门洞nnn'),('l','一根小棒lll'),
('g','小小电话ggg'),('k','长长水枪kkk'),('h','我爱喝水hhh'),('j','球杆顶球jjj'),
('q','气球扯线qqq'),('x','小溪交叉xxx')) v(code,mnemonic)
where u.code=v.code and u.mnemonic='';

-- 只在首次增加字段时从旧 mode 转换，重复运行不覆盖新设置。
do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public'
    and table_name='pinyin_settings' and column_name='enabled_categories') then
    alter table public.pinyin_settings add column enabled_categories text[] not null default '{}';
    update public.pinyin_settings set enabled_categories=case mode
      when 'finals' then array['final'] when 'initials' then array['initial']
      when 'both' then array['final','initial'] else '{}'::text[] end;
  end if;
end; $$;
alter table public.pinyin_settings add column if not exists new_order text not null default 'sequential';
alter table public.pinyin_settings drop constraint if exists pinyin_settings_categories_check;
alter table public.pinyin_settings add constraint pinyin_settings_categories_check
  check(enabled_categories <@ array['final','initial','compound','front_nasal','back_nasal','whole']::text[] and array_position(enabled_categories,null) is null);
alter table public.pinyin_settings drop constraint if exists pinyin_settings_new_order_check;
alter table public.pinyin_settings add constraint pinyin_settings_new_order_check check(new_order in ('sequential','random'));
alter table public.pinyin_daily_sessions add column if not exists categories_snapshot text[];
alter table public.pinyin_daily_sessions add column if not exists new_order_snapshot text not null default 'sequential';
update public.pinyin_daily_sessions set categories_snapshot=case mode_snapshot
  when 'finals' then array['final'] when 'initials' then array['initial']
  when 'both' then array['final','initial'] else '{}'::text[] end where categories_snapshot is null;
alter table public.pinyin_daily_sessions alter column categories_snapshot set default '{}';
alter table public.pinyin_daily_sessions alter column categories_snapshot set not null;

create table if not exists public.pinyin_introductions (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  unit_code text not null references public.pinyin_units(code),
  first_session_id uuid references public.pinyin_daily_sessions(id) on delete set null,
  introduced_date date not null,
  introduced_at timestamptz not null default now(),
  primary key(learner_id,unit_code)
);
create index if not exists pinyin_introductions_session_idx on public.pinyin_introductions(first_session_id);
create index if not exists pinyin_introductions_unit_idx on public.pinyin_introductions(unit_code);
create table if not exists public.pinyin_mnemonics (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  unit_code text not null references public.pinyin_units(code),
  mnemonic text not null default '' check(char_length(mnemonic)<=160),
  updated_at timestamptz not null default now(),
  primary key(learner_id,unit_code)
);
create index if not exists pinyin_mnemonics_unit_idx on public.pinyin_mnemonics(unit_code);
alter table public.pinyin_introductions enable row level security;
alter table public.pinyin_mnemonics enable row level security;
drop policy if exists "pinyin introductions read" on public.pinyin_introductions;
create policy "pinyin introductions read" on public.pinyin_introductions for select to authenticated
  using(private.can_access_learner(learner_id));
drop policy if exists "pinyin mnemonic manage" on public.pinyin_mnemonics;
create policy "pinyin mnemonic manage" on public.pinyin_mnemonics for all to authenticated
  using(private.can_use_learner_module(learner_id,'hanzi')) with check(private.can_use_learner_module(learner_id,'hanzi'));
revoke all on public.pinyin_introductions,public.pinyin_mnemonics from public,anon,authenticated;
grant select on public.pinyin_introductions to authenticated;
grant select,insert,update,delete on public.pinyin_mnemonics to authenticated;

-- 已经排过、没答过的单元也属于“已首次加入”，不能重新随机作新卡。
insert into public.pinyin_introductions(learner_id,unit_code,first_session_id,introduced_date,introduced_at)
select distinct on(s.learner_id,p.unit_code) s.learner_id,p.unit_code,s.id,s.date_local,s.created_at
from public.pinyin_daily_progress p join public.pinyin_daily_sessions s on s.id=p.session_id
order by s.learner_id,p.unit_code,s.date_local,s.created_at on conflict(learner_id,unit_code) do nothing;
insert into public.pinyin_introductions(learner_id,unit_code,introduced_date,introduced_at)
select st.learner_id,st.unit_code,(coalesce(st.last_practiced_at,now()) at time zone l.timezone)::date,
  coalesce(st.last_practiced_at,now()) from public.pinyin_states st join public.learner_profiles l on l.id=st.learner_id
on conflict(learner_id,unit_code) do nothing;

-- 内部纯选卡：仅未引入/未练过的单元会成为 new；random 只改变新单元的先后。
-- 不暴露此函数，不给 authenticated 执行权限；写队列只能经过下面的鉴权 RPC。
create or replace function private.pinyin_plan_units(p_learner_id uuid,p_categories text[],p_limit integer,p_order text,p_now timestamptz)
returns table(unit_code text,kind text,stage smallint)
language sql volatile security invoker set search_path='' as $$
  select u.code,case when st.unit_code is null and intro.unit_code is null then 'new' else 'review' end,
    coalesce(st.stage,0)::smallint
  from public.pinyin_units u
  left join public.pinyin_states st on st.learner_id=p_learner_id and st.unit_code=u.code
  left join public.pinyin_introductions intro on intro.learner_id=p_learner_id and intro.unit_code=u.code
  where u.category=any(p_categories) and (st.unit_code is null or st.due_at<=p_now)
  order by case when st.unit_code is null and intro.unit_code is null then 1 else 0 end,
    case when st.unit_code is not null then st.due_at when intro.unit_code is not null then intro.introduced_at else null end nulls last,
    case when st.unit_code is null and intro.unit_code is null and p_order='random' then random() else 0 end,u.sort_order
  limit greatest(0,least(5,p_limit));
$$;
revoke all on function private.pinyin_plan_units(uuid,text[],integer,text,timestamptz) from public,anon,authenticated;

-- 保留旧每日上限、到期优先、抽查及双确认规则；已生成的计划不因刷新/改顺序重洗。
create or replace function public.pinyin_get_today(p_learner_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_mode text; v_limit smallint; v_order text; v_categories text[]; v_day date; v_timezone text;
  v_session uuid; v_count integer; v_next integer; v_unit record; v_items jsonb;
begin
  if not private.can_use_learner_module(p_learner_id,'hanzi') then raise exception '无权查看该孩子拼音' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pinyin-plan:'||p_learner_id::text,0));
  select coalesce(s.mode,'off'),coalesce(s.daily_limit,4),coalesce(s.new_order,'sequential'),
    case when coalesce(s.mode,'off')='off' then '{}'::text[] else coalesce(s.enabled_categories,'{}'::text[]) end,l.timezone
    into v_mode,v_limit,v_order,v_categories,v_timezone from public.learner_profiles l
    left join public.pinyin_settings s on s.learner_id=l.id where l.id=p_learner_id;
  if cardinality(v_categories)=0 then return jsonb_build_object('mode','off','selected_categories',v_categories,'items','[]'::jsonb,'total',0,'passed',0); end if;
  v_day:=(now() at time zone v_timezone)::date;
  insert into public.pinyin_daily_sessions(learner_id,date_local,mode_snapshot,limit_snapshot,categories_snapshot,new_order_snapshot)
    values(p_learner_id,v_day,v_mode,v_limit,v_categories,v_order) on conflict(learner_id,date_local) do nothing;
  select s.id into v_session from public.pinyin_daily_sessions s where s.learner_id=p_learner_id and s.date_local=v_day for update;
  select count(*) into v_count from public.pinyin_daily_progress p where p.session_id=v_session;
  if v_count=0 then
    update public.pinyin_daily_sessions set mode_snapshot=v_mode,limit_snapshot=v_limit,categories_snapshot=v_categories,new_order_snapshot=v_order where id=v_session;
    v_next:=0;
    for v_unit in select * from private.pinyin_plan_units(p_learner_id,v_categories,v_limit,v_order,now()) loop
      v_next:=v_next+1;
      insert into public.pinyin_daily_items(session_id,unit_code,queue_kind,queue_position) values(v_session,v_unit.unit_code,v_unit.kind,v_next);
      insert into public.pinyin_daily_progress(session_id,unit_code,starting_stage,required_confirmations)
        values(v_session,v_unit.unit_code,v_unit.stage,case when v_unit.kind='new' or v_unit.stage<=2 then 2 else 1 end);
      insert into public.pinyin_introductions(learner_id,unit_code,first_session_id,introduced_date)
        values(p_learner_id,v_unit.unit_code,v_session,v_day) on conflict(learner_id,unit_code) do nothing;
    end loop;
    if v_next<v_limit then
      for v_unit in
        select u.code,st.stage from public.pinyin_units u join public.pinyin_states st on st.unit_code=u.code and st.learner_id=p_learner_id
        where u.category=any(v_categories) and not exists(select 1 from public.pinyin_daily_progress p where p.session_id=v_session and p.unit_code=u.code)
        order by st.spot_checked_at nulls first,st.last_practiced_at nulls first,u.sort_order limit(v_limit-v_next)
      loop
        v_next:=v_next+1;
        insert into public.pinyin_daily_items(session_id,unit_code,queue_kind,queue_position) values(v_session,v_unit.code,'spot',v_next);
        insert into public.pinyin_daily_progress(session_id,unit_code,starting_stage,is_spot_check,required_confirmations) values(v_session,v_unit.code,v_unit.stage,true,1);
      end loop;
    end if;
  end if;
  -- 取消勾选立即隐藏/暂停当前卡片，但不销毁会话或历史。重新勾选可继续原卡。
  select coalesce(jsonb_agg(jsonb_build_object('item_id',i.id,'unit_code',i.unit_code,'category',u.category,
    'example_hanzi',u.example_hanzi,'example_pinyin',u.example_pinyin,'mnemonic',coalesce(m.mnemonic,u.mnemonic),
    'kind',i.queue_kind,'stage',p.starting_stage,'clean_streak',p.clean_streak,'required_confirmations',p.required_confirmations,'attempts',p.attempts)
    order by i.queue_position),'[]'::jsonb) into v_items
  from public.pinyin_daily_items i join public.pinyin_units u on u.code=i.unit_code
  join public.pinyin_daily_progress p on p.session_id=i.session_id and p.unit_code=i.unit_code
  left join public.pinyin_mnemonics m on m.learner_id=p_learner_id and m.unit_code=i.unit_code
  where i.session_id=v_session and i.status='pending' and u.category=any(v_categories);
  return jsonb_build_object('mode',v_mode,'selected_categories',v_categories,'items',v_items,
    'total',(select count(*) from public.pinyin_daily_progress p join public.pinyin_units u on u.code=p.unit_code where p.session_id=v_session and u.category=any(v_categories)),
    'passed',(select count(*) from public.pinyin_daily_progress p join public.pinyin_units u on u.code=p.unit_code where p.session_id=v_session and p.passed_at is not null and u.category=any(v_categories)));
end; $$;

-- pinyin_answer 在同一文件下方替换；评分真值表不变，仅补充模块和选学权限检查。
create or replace function public.pinyin_answer(p_learner_id uuid,p_item_id uuid,p_result text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_item record; v_progress public.pinyin_daily_progress%rowtype; v_state public.pinyin_states%rowtype;
  v_day date; v_timezone text; v_stage smallint; v_due timestamptz; v_clean smallint; v_adjusted boolean;
  v_passed boolean:=false; v_position integer;
begin
  if p_result is null or p_result not in ('known','again','helped') then raise exception '无效回答' using errcode='22023'; end if;
  if not private.can_use_learner_module(p_learner_id,'hanzi') then raise exception '无权记录该孩子拼音' using errcode='42501'; end if;
  select l.timezone into v_timezone from public.learner_profiles l where l.id=p_learner_id;
  v_day := (now() at time zone v_timezone)::date;
  if exists(select 1 from public.pinyin_attempts a where a.request_id=p_request_id and a.learner_id=p_learner_id) then return jsonb_build_object('idempotent',true); end if;
  select i.*,s.date_local,s.learner_id into v_item from public.pinyin_daily_items i
    join public.pinyin_daily_sessions s on s.id=i.session_id
    where i.id=p_item_id and s.learner_id=p_learner_id for update of i;
  if not found then raise exception '拼音卡不存在' using errcode='42501'; end if;
  if not exists(select 1 from public.pinyin_settings setting join public.pinyin_units unit on unit.code=v_item.unit_code
    where setting.learner_id=p_learner_id and setting.mode<>'off' and unit.category=any(setting.enabled_categories)) then
    raise exception '这类拼音已暂停，请重新加载' using errcode='22023';
  end if;
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


revoke execute on function public.pinyin_get_today(uuid),public.pinyin_answer(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.pinyin_get_today(uuid),public.pinyin_answer(uuid,uuid,text,uuid) to authenticated;
drop policy if exists "pinyin settings write" on public.pinyin_settings;
drop policy if exists "pinyin settings insert" on public.pinyin_settings;
drop policy if exists "pinyin settings update" on public.pinyin_settings;
create policy "pinyin settings insert" on public.pinyin_settings for insert to authenticated
  with check(private.can_use_learner_module(learner_id,'hanzi'));
create policy "pinyin settings update" on public.pinyin_settings for update to authenticated
  using(private.can_use_learner_module(learner_id,'hanzi')) with check(private.can_use_learner_module(learner_id,'hanzi'));
notify pgrst,'reload schema';
commit;
