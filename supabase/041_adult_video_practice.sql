-- 041 | 视频跟读。依赖 019、020 与 024；不重建现有成人词库与进度。
begin;

create table if not exists public.adult_video_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  youtube_id text not null check(youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  title text not null check(char_length(title) between 1 and 120),
  created_at timestamptz not null default now(),
  unique(owner_id,youtube_id), unique(id,owner_id)
);
create table if not exists public.adult_video_terms (
  owner_id uuid not null,
  video_id uuid not null,
  concept_id uuid not null,
  pronunciation text not null default '' check(char_length(pronunciation)<=80),
  example text not null default '' check(char_length(example)<=500),
  start_second integer check(start_second between 0 and 86399),
  ordinal integer not null check(ordinal>0),
  primary key(video_id,concept_id),
  foreign key(video_id,owner_id) references public.adult_video_sources(id,owner_id) on delete cascade,
  foreign key(concept_id,owner_id) references public.adult_english_concepts(id,owner_id) on delete cascade
);
create table if not exists public.adult_video_settings (
  owner_id uuid not null,
  profile_id uuid primary key,
  focus_video_id uuid,
  daily_new integer not null default 5 check(daily_new between 0 and 20),
  foreign key(profile_id,owner_id) references public.adult_profiles(id,owner_id) on delete cascade,
  foreign key(focus_video_id,owner_id) references public.adult_video_sources(id,owner_id) on delete set null(focus_video_id)
);
create table if not exists public.adult_video_review_terms (
  owner_id uuid not null,
  profile_id uuid not null,
  concept_id uuid not null,
  added_at timestamptz not null default now(),
  primary key(profile_id,concept_id),
  foreign key(profile_id,owner_id) references public.adult_profiles(id,owner_id) on delete cascade,
  foreign key(concept_id,owner_id) references public.adult_english_concepts(id,owner_id) on delete cascade
);
create table if not exists public.adult_video_checkins (
  id uuid primary key,
  owner_id uuid not null,
  profile_id uuid not null,
  video_id uuid not null,
  local_date date not null,
  created_at timestamptz not null default now(),
  foreign key(profile_id,owner_id) references public.adult_profiles(id,owner_id) on delete cascade,
  foreign key(video_id,owner_id) references public.adult_video_sources(id,owner_id) on delete cascade
);
create table if not exists public.adult_video_daily_items (
  owner_id uuid not null,
  profile_id uuid not null,
  local_date date not null,
  concept_id uuid not null,
  queue_kind text not null check(queue_kind in ('new','review')),
  ordinal integer not null,
  confirmations integer not null default 0 check(confirmations between 0 and 2),
  had_failure boolean not null default false,
  attempt_count integer not null default 0,
  last_answered_at timestamptz, completed_at timestamptz,
  primary key(profile_id,local_date,concept_id),
  unique(profile_id,local_date,concept_id,owner_id),
  foreign key(profile_id,owner_id) references public.adult_profiles(id,owner_id) on delete cascade,
  foreign key(concept_id,owner_id) references public.adult_english_concepts(id,owner_id) on delete cascade
);
create table if not exists public.adult_video_answers (
  id uuid primary key,
  owner_id uuid not null,
  profile_id uuid not null,
  local_date date not null,
  concept_id uuid not null,
  result text not null check(result in ('known','again')),
  outcome jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(profile_id,local_date,concept_id,owner_id)
    references public.adult_video_daily_items(profile_id,local_date,concept_id,owner_id) on delete cascade
);
create index if not exists adult_video_sources_owner_created on public.adult_video_sources(owner_id,created_at desc,id);
create index if not exists adult_video_terms_order on public.adult_video_terms(video_id,ordinal,concept_id);
create index if not exists adult_video_terms_concept on public.adult_video_terms(concept_id);
create index if not exists adult_video_settings_focus on public.adult_video_settings(focus_video_id);
create index if not exists adult_video_review_concept on public.adult_video_review_terms(concept_id);
create index if not exists adult_video_checkins_recent on public.adult_video_checkins(profile_id,video_id,created_at desc,id);
create index if not exists adult_video_checkins_video on public.adult_video_checkins(video_id);
create index if not exists adult_video_daily_concept on public.adult_video_daily_items(concept_id);
create index if not exists adult_video_answers_item on public.adult_video_answers(profile_id,local_date,concept_id);
-- 哈希只是索引和新条目标识；复用时仍逐项核对英文和释义。
create index if not exists adult_video_concept_match on public.adult_english_concepts(
  owner_id, md5(lower(btrim(regexp_replace(normalize(phrase,NFKC),'\s+',' ','g'))))
);

create or replace function private.adult_video_enabled()
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.workspace_members m join public.learning_workspaces w on w.id=m.workspace_id
    where m.user_id=(select auth.uid()) and m.status='active' and w.status='active'
      and private.can_use_account_module(m.workspace_id,'adult_english'));
$$;
revoke all on function private.adult_video_enabled() from public,anon;
grant execute on function private.adult_video_enabled() to authenticated;
do $$ declare t text; begin
  foreach t in array array['adult_video_sources','adult_video_terms','adult_video_settings','adult_video_review_terms',
    'adult_video_checkins','adult_video_daily_items','adult_video_answers'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('drop policy if exists adult_video_read_own on public.%I',t);
    execute format('create policy adult_video_read_own on public.%I for select to authenticated using(owner_id=(select auth.uid()) and (select private.adult_video_enabled()))',t);
  end loop;
end $$;

create or replace function private.adult_video_command(p_profile uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  who uuid:=(select auth.uid());
  today date:=(now() at time zone 'Asia/Shanghai')::date;
  options public.adult_video_settings;
  vid uuid; concept uuid; req uuid; item jsonb;
  c public.adult_video_daily_items; st public.adult_english_word_states;
  prior_answer public.adult_video_answers; prior_checkin public.adult_video_checkins;
  label text; spelling text; meaning text; sample text; phonetic text; yid text;
  norm_word text; norm_meaning text; concept_hash text;
  sec integer; ord integer; lim integer; due_count integer; n integer; reviewed integer;
  new_terms integer:=0; new_links integer:=0; reused integer:=0;
  answer text; stage_now integer; due date; confirms integer; v_had_failure boolean; complete boolean; advance boolean;
  outcome jsonb;
begin
  if who is null or not private.adult_video_enabled() or not exists(
    select 1 from public.adult_profiles where id=p_profile and owner_id=who and not archived
  ) then raise exception '成人档案不存在或父母英语未开通' using errcode='42501'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception '操作参数无效'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_profile::text,4101));
  -- Recheck under the lock so profile changes cannot cut across a write.
  perform 1 from public.adult_profiles where id=p_profile and owner_id=who and not archived for share;
  if not found then raise exception '成人档案已停用或无法访问' using errcode='42501'; end if;
  if p_action='import' then
    yid:=p_data->>'youtube_id'; label:=btrim(p_data->>'title');
    if yid is null or yid !~ '^[A-Za-z0-9_-]{11}$' or coalesce(char_length(label),0) not between 1 and 120 then raise exception '视频标题或链接无效'; end if;
    if jsonb_typeof(p_data->'rows') is distinct from 'array' then raise exception '词表为空'; end if;
    if jsonb_array_length(p_data->'rows') not between 1 and 200 then raise exception '每次导入 1～200 个词句'; end if;
    -- 同账号不同成人档案也共用词条和视频；串行处理导入的复用及顺序。
    perform pg_advisory_xact_lock(hashtextextended(who::text,4102));
    insert into public.adult_video_sources(owner_id,youtube_id,title) values(who,yid,label)
      on conflict(owner_id,youtube_id) do nothing;
    select id into vid from public.adult_video_sources where owner_id=who and youtube_id=yid;
    select coalesce(max(ordinal),0) into ord from public.adult_video_terms where video_id=vid;
    for item in select value from jsonb_array_elements(p_data->'rows') loop
      spelling:=btrim(item->>'word'); meaning:=btrim(item->>'meaning');
      sample:=btrim(coalesce(item->>'example','')); phonetic:=btrim(coalesce(item->>'pronunciation',''));
      sec:=(item->>'timestamp')::integer;
      if coalesce(char_length(spelling),0) not between 1 and 160 or spelling !~ '[A-Za-z]'
        or coalesce(char_length(meaning),0) not between 1 and 240 or char_length(sample)>500 or char_length(phonetic)>80
        or (sec is not null and sec not between 0 and 86399)
        or (item ? 'track' and jsonb_typeof(item->'track') is distinct from 'boolean') then raise exception '词表字段无效，本次没有写入'; end if;
      norm_word:=lower(btrim(regexp_replace(normalize(spelling,NFKC),'\s+',' ','g')));
      norm_meaning:=lower(btrim(regexp_replace(normalize(meaning,NFKC),'\s+',' ','g')));
      -- Same key as new meeting expressions; old and academic keys still match by text.
      concept_hash:=encode(sha256(convert_to(norm_word||chr(10)||norm_meaning,'UTF8')),'hex');
      select e.id into concept from public.adult_english_concepts e where e.owner_id=who
        and md5(lower(btrim(regexp_replace(normalize(e.phrase,NFKC),'\s+',' ','g'))))=md5(norm_word)
        and lower(btrim(regexp_replace(normalize(e.phrase,NFKC),'\s+',' ','g')))=norm_word
        and lower(btrim(regexp_replace(normalize(e.meaning,NFKC),'\s+',' ','g')))=norm_meaning
        order by exists(select 1 from public.adult_video_terms l where l.concept_id=e.id) desc,
          coalesce((select s.attempts from public.adult_english_word_states s where s.concept_id=e.id and s.profile_id=p_profile),0) desc,e.id
        limit 1;
      if concept is null then
        insert into public.adult_english_concepts(owner_id,phrase,meaning,example,concept_key)
          values(who,spelling,meaning,sample,concept_hash)
          on conflict(owner_id,concept_key) do nothing returning id into concept;
        if concept is not null then new_terms:=new_terms+1; end if;
        if concept is null then
          select id into concept from public.adult_english_concepts where owner_id=who and concept_key=concept_hash;
          reused:=reused+1;
        end if;
      else reused:=reused+1; end if;
      if not exists(select 1 from public.adult_video_terms where video_id=vid and concept_id=concept) then
        ord:=ord+1; new_links:=new_links+1;
      end if;
      insert into public.adult_video_terms as existing(owner_id,video_id,concept_id,pronunciation,example,start_second,ordinal)
        values(who,vid,concept,phonetic,sample,sec,greatest(1,ord))
        on conflict(video_id,concept_id) do update set
          pronunciation=coalesce(nullif(existing.pronunciation,''),excluded.pronunciation),
          example=coalesce(nullif(existing.example,''),excluded.example),
          start_second=coalesce(existing.start_second,excluded.start_second)
        where (existing.pronunciation='' and excluded.pronunciation<>'')
          or (existing.example='' and excluded.example<>'') or (existing.start_second is null and excluded.start_second is not null);
      if item->'track'='true'::jsonb then
        insert into public.adult_video_review_terms(owner_id,profile_id,concept_id) values(who,p_profile,concept) on conflict do nothing;
      end if;
    end loop;
    insert into public.adult_video_settings as s(owner_id,profile_id,focus_video_id) values(who,p_profile,vid)
      on conflict(profile_id) do update set focus_video_id=excluded.focus_video_id where s.focus_video_id is null;
    return jsonb_build_object('video_id',vid,'new_terms',new_terms,'new_links',new_links,'reused',reused);
  elsif p_action in ('focus','checkin','edit_timestamp') then
    vid:=(p_data->>'video_id')::uuid;
    if not exists(select 1 from public.adult_video_sources where id=vid and owner_id=who) then raise exception '视频不存在或无权限' using errcode='42501'; end if;
    if p_action='focus' then
      insert into public.adult_video_settings(owner_id,profile_id,focus_video_id) values(who,p_profile,vid)
        on conflict(profile_id) do update set focus_video_id=excluded.focus_video_id;
      return jsonb_build_object('video_id',vid);
    elsif p_action='edit_timestamp' then
      update public.adult_video_terms set start_second=(p_data->>'timestamp')::integer
        where video_id=vid and owner_id=who and concept_id=(p_data->>'concept_id')::uuid;
      if not found then raise exception '该视频词句不存在'; end if;
      return '{}'::jsonb;
    end if;
    req:=(p_data->>'request_id')::uuid;
    if req is null then raise exception '缺少打卡请求编号'; end if;
    insert into public.adult_video_checkins(id,owner_id,profile_id,video_id,local_date)
      values(req,who,p_profile,vid,today) on conflict(id) do nothing;
    get diagnostics n=row_count;
    select * into prior_checkin from public.adult_video_checkins where id=req and owner_id=who;
    if prior_checkin.id is null or prior_checkin.profile_id<>p_profile or prior_checkin.video_id<>vid then raise exception '打卡编号与原记录不匹配'; end if;
    return jsonb_build_object('duplicate',n=0,'count',(select count(*) from public.adult_video_checkins where profile_id=p_profile and video_id=vid));
  elsif p_action='track' then
    concept:=(p_data->>'concept_id')::uuid;
    if not exists(select 1 from public.adult_video_terms where owner_id=who and concept_id=concept)
      or jsonb_typeof(p_data->'enabled') is distinct from 'boolean' then raise exception '词句不在视频词表中'; end if;
    if p_data->'enabled'='true'::jsonb then
      insert into public.adult_video_review_terms(owner_id,profile_id,concept_id) values(who,p_profile,concept) on conflict do nothing;
    else delete from public.adult_video_review_terms where profile_id=p_profile and concept_id=concept;
    end if;
    return '{}'::jsonb;
  elsif p_action='settings' then
    insert into public.adult_video_settings(owner_id,profile_id,daily_new) values(who,p_profile,(p_data->>'daily_new')::integer)
      on conflict(profile_id) do update set daily_new=excluded.daily_new;
    return '{}'::jsonb;
  elsif p_action='start' then
    select * into options from public.adult_video_settings where profile_id=p_profile;
    if not exists(select 1 from public.adult_video_daily_items where profile_id=p_profile and local_date=today) then
      if options.focus_video_id is null then
        select id into options.focus_video_id from public.adult_video_sources where owner_id=who order by created_at desc,id limit 1;
      end if;
      select count(*) into due_count from (
        select 1 from public.adult_english_word_states s join public.adult_video_review_terms r using(profile_id,concept_id)
          where s.profile_id=p_profile and s.due_date<=today and exists(select 1 from public.adult_video_terms t where t.concept_id=s.concept_id)
          limit 11
      ) due_batch;
      insert into public.adult_video_daily_items(owner_id,profile_id,local_date,concept_id,queue_kind,ordinal)
        select who,p_profile,today,s.concept_id,'review',row_number() over(order by s.priority desc,s.due_date,s.stage,s.concept_id)
          from public.adult_english_word_states s join public.adult_video_review_terms r using(profile_id,concept_id)
          where s.profile_id=p_profile and s.due_date<=today and exists(select 1 from public.adult_video_terms t where t.concept_id=s.concept_id)
          order by s.priority desc,s.due_date,s.stage,s.concept_id limit 10;
      get diagnostics reviewed=row_count;
      lim:=case when due_count>10 then 0 else coalesce(options.daily_new,5) end;
      if lim>0 then
        insert into public.adult_video_daily_items(owner_id,profile_id,local_date,concept_id,queue_kind,ordinal)
          select who,p_profile,today,r.concept_id,'new',reviewed+row_number() over(order by (f.concept_id is not null) desc,f.ordinal,r.added_at,r.concept_id)
            from public.adult_video_review_terms r
            left join public.adult_video_terms f on f.video_id=options.focus_video_id and f.concept_id=r.concept_id
            left join public.adult_english_word_states s on s.profile_id=r.profile_id and s.concept_id=r.concept_id
            where r.profile_id=p_profile and s.concept_id is null and exists(select 1 from public.adult_video_terms t where t.concept_id=r.concept_id)
            order by (f.concept_id is not null) desc,f.ordinal,r.added_at,r.concept_id limit lim;
      end if;
    end if;
    return jsonb_build_object('remaining',(select count(*) from public.adult_video_daily_items where profile_id=p_profile and local_date=today and completed_at is null));
  elsif p_action='answer' then
    concept:=(p_data->>'concept_id')::uuid; req:=(p_data->>'request_id')::uuid; answer:=p_data->>'result';
    if req is null or answer is null or answer not in ('known','again') then raise exception '请确认词卡作答'; end if;
    select * into prior_answer from public.adult_video_answers where id=req and owner_id=who;
    if found then
      if prior_answer.profile_id<>p_profile or prior_answer.concept_id is distinct from concept or prior_answer.result<>answer then raise exception '作答编号与原记录不匹配'; end if;
      return prior_answer.outcome||jsonb_build_object('duplicate',true);
    end if;
    if (p_data->>'day')::date is distinct from today then raise exception '已进入新的一天，请刷新后继续今天的练习'; end if;
    select * into c from public.adult_video_daily_items where profile_id=p_profile and local_date=today and concept_id=concept and completed_at is null for update;
    if not found then raise exception '词卡已完成或不在今日队列，请刷新'; end if;
    insert into public.adult_english_word_states(owner_id,profile_id,concept_id,due_date) values(who,p_profile,concept,today) on conflict do nothing;
    select * into st from public.adult_english_word_states where profile_id=p_profile and concept_id=concept for update;
    stage_now:=st.stage; due:=st.due_date; v_had_failure:=c.had_failure; confirms:=c.confirmations;
    complete:=false; advance:=false;
    if answer='again' then
      confirms:=0; v_had_failure:=true; due:=today;
      if st.last_failure_date is distinct from today then stage_now:=greatest(0,stage_now-1); end if;
    else
      confirms:=least(2,confirms+1);
      complete:=(c.queue_kind='review' and c.attempt_count=0) or confirms>=2;
      advance:=complete and not v_had_failure and st.last_success_date is distinct from today and st.last_failure_date is distinct from today;
      if advance then stage_now:=least(5,stage_now+1); due:=today+(array[1,3,7,14,30])[stage_now];
      elsif complete and (v_had_failure or st.last_failure_date=today) then due:=today+1; end if;
    end if;
    update public.adult_video_daily_items set confirmations=confirms,had_failure=v_had_failure,
      attempt_count=attempt_count+1,last_answered_at=clock_timestamp(),completed_at=case when complete then now() end
      where profile_id=p_profile and local_date=today and concept_id=concept;
    update public.adult_english_word_states set stage=stage_now,due_date=due,attempts=attempts+1,
      independent_days=independent_days+case when advance then 1 else 0 end,
      spaced_success=case when answer='again' then false else spaced_success or (advance and coalesce(today-last_success_date>=7,false)) end,
      last_success_date=case when advance then today else last_success_date end,
      last_failure_date=case when answer='again' then today else last_failure_date end
      where profile_id=p_profile and concept_id=concept;
    outcome:=jsonb_build_object('completed',complete,'stage',stage_now,'due_date',due,'confirmations',confirms);
    insert into public.adult_video_answers(id,owner_id,profile_id,concept_id,local_date,result,outcome)
      values(req,who,p_profile,concept,today,answer,outcome);
    return outcome;
  end if;
  raise exception '不支持的视频跟读操作';
end $$;
revoke all on function private.adult_video_command(uuid,text,jsonb) from public,anon;
grant execute on function private.adult_video_command(uuid,text,jsonb) to authenticated;
create or replace function public.adult_video_command(p_profile uuid,p_action text,p_data jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.adult_video_command(p_profile,p_action,p_data);
$$;
revoke all on function public.adult_video_command(uuid,text,jsonb) from public,anon;
grant execute on function public.adult_video_command(uuid,text,jsonb) to authenticated;

-- 每次只取一页视频、一页选中词表和当前词卡，不把全年材料搬到浏览器。
create or replace function public.adult_video_snapshot(p_profile uuid,p_video uuid,p_video_page integer,p_word_page integer)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
  who uuid:=(select auth.uid()); today date:=(now() at time zone 'Asia/Shanghai')::date;
  opt public.adult_video_settings; focus uuid; selected uuid;
  vp integer:=greatest(1,least(coalesce(p_video_page,1),10000));
  wp integer:=greatest(1,least(coalesce(p_word_page,1),10000));
  total_videos integer; total_terms integer; tracked integer;
  videos jsonb; words jsonb; item jsonb; history jsonb; selected_video jsonb; focus_video jsonb;
begin
  if who is null or not private.adult_video_enabled() or not exists(
    select 1 from public.adult_profiles where id=p_profile and owner_id=who and not archived
  ) then raise exception '成人档案不存在或父母英语未开通' using errcode='42501'; end if;
  select * into opt from public.adult_video_settings where profile_id=p_profile;
  focus:=opt.focus_video_id;
  if focus is null then select id into focus from public.adult_video_sources where owner_id=who order by created_at desc,id limit 1; end if;
  if p_video is null then selected:=focus;
  else select id into selected from public.adult_video_sources where id=p_video and owner_id=who;
    if not found then raise exception '视频不存在或无权限' using errcode='42501'; end if;
  end if;
  select count(*) into total_videos from public.adult_video_sources where owner_id=who;
  vp:=least(vp,greatest(1,(total_videos+11)/12));
  with page as (
    select id,youtube_id,title,created_at from public.adult_video_sources
      where owner_id=who order by created_at desc,id limit 12 offset (vp-1)*12
  ), display as (select * from page union select id,youtube_id,title,created_at from public.adult_video_sources where id in (focus,selected)),
  decorated as (
    select v.*, (select count(*) from public.adult_video_terms where video_id=v.id) as word_count,
      a.practice_count,a.last_on from display v cross join lateral(
        select count(*) as practice_count,max(local_date) as last_on from public.adult_video_checkins where profile_id=p_profile and video_id=v.id
      ) a
  )
  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at desc,d.id) filter(where d.id in(select id from page)),'[]'),
    (jsonb_agg(to_jsonb(d)) filter(where d.id=selected))->0,(jsonb_agg(to_jsonb(d)) filter(where d.id=focus))->0
    into videos,selected_video,focus_video from decorated d;
  select count(*) into total_terms from public.adult_video_terms where video_id=selected;
  wp:=least(wp,greatest(1,(total_terms+29)/30));
  select coalesce(jsonb_agg(to_jsonb(v) order by v.ordinal,v.concept_id),'[]') into words from (
    select t.concept_id,t.pronunciation,t.example,t.start_second,t.ordinal,c.phrase,c.meaning,
      r.concept_id is not null as tracked,st.stage,st.attempts,st.due_date
      from public.adult_video_terms t join public.adult_english_concepts c on c.id=t.concept_id
      left join public.adult_video_review_terms r on r.concept_id=t.concept_id and r.profile_id=p_profile
      left join public.adult_english_word_states st on st.concept_id=t.concept_id and st.profile_id=p_profile
      where t.video_id=selected order by t.ordinal,t.concept_id limit 30 offset (wp-1)*30
  ) v;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id),'[]') into history from (
    select id,local_date,created_at from public.adult_video_checkins where profile_id=p_profile and video_id=selected order by created_at desc,id limit 12
  ) h;
  select count(*) into tracked from public.adult_video_review_terms where profile_id=p_profile;
  select jsonb_build_object('concept_id',c.id,'phrase',c.phrase,'meaning',c.meaning,'queue_kind',q.queue_kind,
    'attempt_count',q.attempt_count,'confirmations',q.confirmations,'had_failure',q.had_failure,
    'origins',coalesce((
      select jsonb_agg(jsonb_build_object('id',v.id,'title',v.title,'youtube_id',v.youtube_id,'start_second',t.start_second,
        'example',t.example,'pronunciation',t.pronunciation) order by (v.id=focus) desc,(t.start_second is not null) desc,v.created_at desc,v.id)
      from public.adult_video_terms t join public.adult_video_sources v on v.id=t.video_id where t.concept_id=c.id
    ),'[]')) into item
  from public.adult_video_daily_items q join public.adult_english_concepts c on c.id=q.concept_id
  where q.profile_id=p_profile and q.local_date=today and q.completed_at is null
  order by q.last_answered_at nulls first,q.ordinal,q.concept_id limit 1;
  return jsonb_build_object('today',today,'daily_new',coalesce(opt.daily_new,5),'tracked',tracked,'focus',focus_video,
    'videos',videos,'selected',selected_video,'history',history,'words',words,'video_page',vp,'word_page',wp,
    'total_videos',total_videos,'total_words',total_terms,'current',item,
    'total_today',(select count(*) from public.adult_video_daily_items where profile_id=p_profile and local_date=today),
    'remaining',(select count(*) from public.adult_video_daily_items where profile_id=p_profile and local_date=today and completed_at is null),
    'due',(select count(*) from public.adult_english_word_states s join public.adult_video_review_terms r using(profile_id,concept_id)
      where s.profile_id=p_profile and s.due_date<=today and exists(select 1 from public.adult_video_terms where concept_id=s.concept_id)));
end $$;
revoke all on function public.adult_video_snapshot(uuid,uuid,integer,integer) from public,anon;
grant execute on function public.adult_video_snapshot(uuid,uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
