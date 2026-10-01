-- 024 · 模块开通与儿童英语。先运行 001–023；请在 SQL Editor 整段执行。
-- 只回填迁移前已有账号/孩子；新加入的账号、孩子默认不开通模块。
begin;

create table if not exists public.account_module_access (
  workspace_id uuid not null references public.learning_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  module_key text not null check (module_key in ('hanzi','poem','music','catechism','kids_english','adult_english','exercise')),
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id,user_id,module_key),
  foreign key (workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
create index if not exists account_module_access_user_idx on public.account_module_access(user_id,workspace_id,enabled);

create table if not exists public.learner_module_access (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  module_key text not null check (module_key in ('hanzi','poem','music','catechism','kids_english')),
  enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (learner_id,module_key)
);
create index if not exists learner_module_access_module_idx on public.learner_module_access(module_key,enabled,learner_id);

insert into public.account_module_access(workspace_id,user_id,module_key,enabled)
select member.workspace_id,member.user_id,keys.module_key,true
from public.workspace_members member
cross join (values ('hanzi'),('poem'),('music'),('catechism'),('adult_english'),('exercise')) keys(module_key)
where member.status='active'
on conflict do nothing;
insert into public.account_module_access(workspace_id,user_id,module_key,enabled)
select member.workspace_id,member.user_id,'kids_english',true
from public.workspace_members member where member.role='owner' and member.status='active'
on conflict do nothing;
insert into public.learner_module_access(learner_id,module_key,enabled)
select learner.id,keys.module_key,true from public.learner_profiles learner
cross join (values ('hanzi'),('poem'),('music'),('catechism')) keys(module_key)
on conflict do nothing;

create or replace function private.can_use_account_module(p_workspace_id uuid,p_module_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.workspace_members member
    join public.account_module_access access on access.workspace_id=member.workspace_id and access.user_id=member.user_id
    where member.workspace_id=p_workspace_id and member.user_id=(select auth.uid())
      and member.status='active' and access.module_key=p_module_key and access.enabled
  );
$$;
create or replace function private.can_use_learner_module(p_learner_id uuid,p_module_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_access_learner(p_learner_id) and exists (
    select 1 from public.learner_profiles learner
    join public.families family on family.id=learner.family_id
    join public.learner_module_access child_access on child_access.learner_id=learner.id
    where learner.id=p_learner_id and child_access.module_key=p_module_key and child_access.enabled
      and private.can_use_account_module(family.workspace_id,p_module_key)
  );
$$;
revoke all on function private.can_use_account_module(uuid,text) from public,anon;
revoke all on function private.can_use_learner_module(uuid,text) from public,anon;
grant execute on function private.can_use_account_module(uuid,text) to authenticated;
grant execute on function private.can_use_learner_module(uuid,text) to authenticated;

create or replace function private.can_use_own_adult_module(p_module_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.workspace_members member
    join public.account_module_access access on access.workspace_id=member.workspace_id and access.user_id=member.user_id
    where member.user_id=(select auth.uid()) and member.status='active' and access.module_key=p_module_key and access.enabled
  );
$$;
revoke all on function private.can_use_own_adult_module(text) from public,anon;
grant execute on function private.can_use_own_adult_module(text) to authenticated;

-- 成人记录由直接表写入：额外用 restrictive policy 锁住被关闭的模块。
do $$ declare table_name text; begin
  foreach table_name in array array['adult_exercise_goals','adult_goal_versions','adult_exercise_logs'] loop
    execute format('create policy module_write_guard on public.%I as restrictive for all to authenticated using (private.can_use_own_adult_module(''exercise'')) with check (private.can_use_own_adult_module(''exercise''))',table_name);
  end loop;
  foreach table_name in array array['adult_english_sources','adult_english_sections','adult_english_lessons','adult_english_concepts','adult_english_lesson_concepts','adult_english_plans','adult_english_attempts','adult_english_states','adult_ai_jobs','adult_listening_sessions','adult_listening_attempts','adult_english_word_states'] loop
    execute format('create policy module_write_guard on public.%I as restrictive for all to authenticated using (private.can_use_own_adult_module(''adult_english'')) with check (private.can_use_own_adult_module(''adult_english''))',table_name);
  end loop;
end $$;
create policy module_write_guard on public.adult_profiles as restrictive for all to authenticated
using (private.can_use_own_adult_module('exercise') or private.can_use_own_adult_module('adult_english'))
with check (private.can_use_own_adult_module('exercise') or private.can_use_own_adult_module('adult_english'));
create policy poem_module_insert_guard on public.poem_recitation_attempts as restrictive for insert to authenticated
with check(private.can_use_learner_module(learner_id,'poem'));

-- 旧版 SECURITY DEFINER 学习 RPC 会绕过表 RLS；写入时再检查模块，避免直调旧 RPC 继续记成绩。
create or replace function private.enforce_child_module_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_learner_id uuid;
begin
  if tg_table_name = 'daily_session_items' then
    select session.learner_id into v_learner_id
    from public.daily_sessions session where session.id = new.session_id;
  else
    v_learner_id := new.learner_id;
  end if;
  if not private.can_use_learner_module(v_learner_id,tg_argv[0]) then
    raise exception '此孩子的学习模块尚未开通' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_child_module_write() from public,anon,authenticated;
do $$ declare table_name text; begin
  foreach table_name in array array['daily_sessions','daily_session_items','daily_character_progress','learning_states','learning_attempts'] loop
    execute format('create trigger enforce_child_module_write before insert or update on public.%I for each row execute function private.enforce_child_module_write(%L)',table_name,'hanzi');
  end loop;
  foreach table_name in array array['poem_recitation_attempts','poem_game_sessions','poem_game_attempts','learner_poem_line_states'] loop
    execute format('create trigger enforce_child_module_write before insert or update on public.%I for each row execute function private.enforce_child_module_write(%L)',table_name,'poem');
  end loop;
  foreach table_name in array array['music_learning_states','music_practice_attempts'] loop
    execute format('create trigger enforce_child_module_write before insert or update on public.%I for each row execute function private.enforce_child_module_write(%L)',table_name,'music');
  end loop;
  foreach table_name in array array['catechism_learning_states','catechism_attempts'] loop
    execute format('create trigger enforce_child_module_write before insert or update on public.%I for each row execute function private.enforce_child_module_write(%L)',table_name,'catechism');
  end loop;
end $$;

alter table public.account_module_access enable row level security;
alter table public.learner_module_access enable row level security;
create policy "members see own or owner account access" on public.account_module_access for select to authenticated
using (user_id=(select auth.uid()) or exists (select 1 from public.workspace_members member where member.workspace_id=account_module_access.workspace_id and member.user_id=(select auth.uid()) and member.role='owner' and member.status='active'));
create policy "owner manages account access" on public.account_module_access for all to authenticated
using (exists (select 1 from public.workspace_members member where member.workspace_id=account_module_access.workspace_id and member.user_id=(select auth.uid()) and member.role='owner' and member.status='active'))
with check (exists (select 1 from public.workspace_members member where member.workspace_id=account_module_access.workspace_id and member.user_id=(select auth.uid()) and member.role='owner' and member.status='active'));
create policy "family sees child access" on public.learner_module_access for select to authenticated using (private.can_access_learner(learner_id));
create policy "owner manages child access" on public.learner_module_access for all to authenticated
using (exists (select 1 from public.workspace_members member where member.workspace_id=private.learner_workspace_id(learner_id) and member.user_id=(select auth.uid()) and member.role='owner' and member.status='active'))
with check (exists (select 1 from public.workspace_members member where member.workspace_id=private.learner_workspace_id(learner_id) and member.user_id=(select auth.uid()) and member.role='owner' and member.status='active'));
revoke insert,update,delete on public.account_module_access,public.learner_module_access from authenticated;

create or replace function public.owner_set_module_access(p_workspace_id uuid,p_user_id uuid,p_learner_id uuid,p_module_key text,p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.workspace_members member where member.workspace_id=p_workspace_id and member.user_id=(select auth.uid()) and member.role='owner' and member.status='active') then
    raise exception '只有 owner 可以开通模块' using errcode='42501';
  end if;
  if p_learner_id is null then
    if p_module_key not in ('hanzi','poem','music','catechism','kids_english','adult_english','exercise') then raise exception '模块无效'; end if;
    if not exists(select 1 from public.workspace_members member where member.workspace_id=p_workspace_id and member.user_id=p_user_id) then raise exception '账号不属于当前空间'; end if;
    if p_user_id=(select auth.uid()) and not p_enabled then raise exception 'owner 不能关闭自己的模块'; end if;
    insert into public.account_module_access(workspace_id,user_id,module_key,enabled,updated_by,updated_at)
    values(p_workspace_id,p_user_id,p_module_key,p_enabled,(select auth.uid()),now())
    on conflict(workspace_id,user_id,module_key) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now();
  else
    if p_module_key not in ('hanzi','poem','music','catechism','kids_english') then raise exception '孩子模块无效'; end if;
    if not exists(select 1 from public.learner_profiles learner join public.families family on family.id=learner.family_id where learner.id=p_learner_id and family.workspace_id=p_workspace_id) then raise exception '孩子不属于当前空间'; end if;
    insert into public.learner_module_access(learner_id,module_key,enabled,updated_by,updated_at)
    values(p_learner_id,p_module_key,p_enabled,(select auth.uid()),now())
    on conflict(learner_id,module_key) do update set enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=now();
  end if;
  insert into public.workspace_audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id,details)
  values(p_workspace_id,(select auth.uid()),'module.access.changed',case when p_learner_id is null then 'account' else 'learner' end,coalesce(p_learner_id,p_user_id),jsonb_build_object('module',p_module_key,'enabled',p_enabled));
end; $$;
revoke all on function public.owner_set_module_access(uuid,uuid,uuid,text,boolean) from public,anon;
grant execute on function public.owner_set_module_access(uuid,uuid,uuid,text,boolean) to authenticated;

-- 儿童英语：内容、视频、分配和学习历史全部独立于汉字。
create table if not exists public.kids_english_books (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.learning_workspaces(id) on delete restrict,
 title text not null check(char_length(title) between 1 and 120), created_by uuid not null references auth.users(id) on delete restrict,
 submitted_for_learner_id uuid references public.learner_profiles(id) on delete set null,
 status text not null default 'draft' check(status in ('draft','published','archived')),
 review_status text not null default 'pending_review' check(review_status in ('pending_review','approved','rejected')),
 fingerprint text not null, approved_by uuid references auth.users(id) on delete set null,approved_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists kids_books_workspace_idx on public.kids_english_books(workspace_id,status,review_status,created_at desc);
create unique index if not exists kids_books_fingerprint_idx on public.kids_english_books(workspace_id,fingerprint) where status<>'archived';
create table if not exists public.kids_english_words (
 id uuid primary key default gen_random_uuid(),book_id uuid not null references public.kids_english_books(id) on delete restrict,
 word text not null check(char_length(word) between 1 and 100),phonetic text not null check(char_length(phonetic) between 1 and 100),
 meaning_zh text not null check(char_length(meaning_zh) between 1 and 300),example_en text not null check(char_length(example_en) between 1 and 500),
 example_zh text,part_of_speech text,sequence integer not null check(sequence between 1 and 100000),created_at timestamptz not null default now(),
 unique(book_id,sequence),unique(book_id,word)
);
create index if not exists kids_words_book_idx on public.kids_english_words(book_id,sequence);
create table if not exists public.learner_kids_english_books (
 learner_id uuid not null references public.learner_profiles(id) on delete cascade,
 book_id uuid not null references public.kids_english_books(id) on delete restrict,
 assignment_status text not null default 'active' check(assignment_status in ('active','inactive')),
 assigned_by uuid references auth.users(id) on delete set null,assigned_at timestamptz not null default now(),unassigned_at timestamptz,
 primary key(learner_id,book_id)
);
create index if not exists learner_kids_books_book_idx on public.learner_kids_english_books(book_id,assignment_status);
create table if not exists public.kids_english_videos (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.learning_workspaces(id) on delete restrict,
 title text not null check(char_length(title) between 1 and 120),object_key text not null unique,
 original_name text not null,content_type text not null,byte_size bigint not null check(byte_size between 1 and 209715200),
 created_by uuid not null references auth.users(id) on delete restrict,created_at timestamptz not null default now()
);
create index if not exists kids_videos_workspace_idx on public.kids_english_videos(workspace_id,created_at desc);
create table if not exists public.kids_english_word_videos (
 word_id uuid not null references public.kids_english_words(id) on delete cascade,
 video_id uuid not null references public.kids_english_videos(id) on delete cascade,
 primary key(word_id,video_id)
);
create index if not exists kids_word_videos_video_idx on public.kids_english_word_videos(video_id);

create table if not exists public.kids_english_states (
 learner_id uuid not null references public.learner_profiles(id) on delete cascade,
 word_id uuid not null references public.kids_english_words(id) on delete restrict,
 stage smallint not null default 0 check(stage between 0 and 7),due_at timestamptz,
 total_attempts integer not null default 0,known_count integer not null default 0,again_count integer not null default 0,
 last_result text,mastered_at timestamptz,updated_at timestamptz not null default now(),
 primary key(learner_id,word_id)
);
create index if not exists kids_states_due_idx on public.kids_english_states(learner_id,due_at,stage);
create index if not exists kids_states_word_idx on public.kids_english_states(word_id);
create table if not exists public.kids_english_daily_items (
 learner_id uuid not null references public.learner_profiles(id) on delete cascade,
 local_date date not null,word_id uuid not null references public.kids_english_words(id) on delete restrict,
 queue_kind text not null check(queue_kind in ('new','review')),
 required_confirmations smallint not null default 2,clean_streak smallint not null default 0,
 attempt_count integer not null default 0,stage_adjusted boolean not null default false,
 passed_at timestamptz,created_at timestamptz not null default now(),
 primary key(learner_id,local_date,word_id)
);
create index if not exists kids_daily_pending_idx on public.kids_english_daily_items(learner_id,local_date,passed_at);
create table if not exists public.kids_english_attempts (
 id uuid primary key default gen_random_uuid(),learner_id uuid not null references public.learner_profiles(id) on delete cascade,
 word_id uuid not null references public.kids_english_words(id) on delete restrict,request_id uuid not null,
 result text not null check(result in ('known','again')),assisted boolean not null default false,
 stage_before smallint not null,stage_after smallint not null,created_at timestamptz not null default now(),
 unique(learner_id,request_id)
);
create index if not exists kids_attempts_history_idx on public.kids_english_attempts(learner_id,word_id,created_at desc);

alter table public.kids_english_books enable row level security;
alter table public.kids_english_words enable row level security;
alter table public.learner_kids_english_books enable row level security;
alter table public.kids_english_videos enable row level security;
alter table public.kids_english_word_videos enable row level security;
alter table public.kids_english_states enable row level security;
alter table public.kids_english_daily_items enable row level security;
alter table public.kids_english_attempts enable row level security;
revoke all on public.account_module_access,public.learner_module_access,
  public.kids_english_books,public.kids_english_words,public.learner_kids_english_books,
  public.kids_english_videos,public.kids_english_word_videos,public.kids_english_states,
  public.kids_english_daily_items,public.kids_english_attempts from anon,authenticated;
grant select on public.account_module_access,public.learner_module_access,
  public.kids_english_books,public.kids_english_words,public.learner_kids_english_books,
  public.kids_english_videos,public.kids_english_word_videos,public.kids_english_states,
  public.kids_english_daily_items,public.kids_english_attempts to authenticated;
grant insert,update on public.kids_english_books,public.kids_english_words,public.learner_kids_english_books to authenticated;
grant insert,delete on public.kids_english_videos,public.kids_english_word_videos to authenticated;
create policy "member reads approved or own books" on public.kids_english_books for select to authenticated using(private.is_workspace_member(workspace_id) and (review_status='approved' or created_by=(select auth.uid()) or private.is_workspace_admin(workspace_id)));
create policy "member submits books" on public.kids_english_books for insert to authenticated with check(private.is_workspace_member(workspace_id) and created_by=(select auth.uid()) and status='draft');
create policy "admin reviews books" on public.kids_english_books for update to authenticated using(private.is_workspace_admin(workspace_id)) with check(private.is_workspace_admin(workspace_id));
create policy "member reads words" on public.kids_english_words for select to authenticated using(exists(select 1 from public.kids_english_books book where book.id=book_id and private.is_workspace_member(book.workspace_id) and (book.review_status='approved' or book.created_by=(select auth.uid()) or private.is_workspace_admin(book.workspace_id))));
create policy "author inserts words" on public.kids_english_words for insert to authenticated with check(exists(select 1 from public.kids_english_books book where book.id=book_id and book.created_by=(select auth.uid()) and book.status='draft'));
create policy "admin edits words" on public.kids_english_words for update to authenticated using(exists(select 1 from public.kids_english_books book where book.id=book_id and private.is_workspace_admin(book.workspace_id))) with check(exists(select 1 from public.kids_english_books book where book.id=book_id and private.is_workspace_admin(book.workspace_id)));
create policy "family reads kids book assignments" on public.learner_kids_english_books for select to authenticated using(private.can_access_learner(learner_id));
create policy "admin assigns kids books" on public.learner_kids_english_books for all to authenticated using(private.is_workspace_admin(private.learner_workspace_id(learner_id))) with check(private.is_workspace_admin(private.learner_workspace_id(learner_id)) and (assignment_status='inactive' or exists(select 1 from public.kids_english_books book where book.id=book_id and book.workspace_id=private.learner_workspace_id(learner_id) and book.status='published' and book.review_status='approved')));
create policy "workspace reads kids videos" on public.kids_english_videos for select to authenticated using(private.is_workspace_member(workspace_id));
create policy "admin uploads kids videos" on public.kids_english_videos for insert to authenticated with check(private.is_workspace_admin(workspace_id) and created_by=(select auth.uid()));
create policy "admin deletes kids videos" on public.kids_english_videos for delete to authenticated using(private.is_workspace_admin(workspace_id));
create policy "workspace reads kids video links" on public.kids_english_word_videos for select to authenticated using(exists(select 1 from public.kids_english_words word join public.kids_english_books book on book.id=word.book_id where word.id=word_id and private.is_workspace_member(book.workspace_id)));
create policy "admin manages kids video links" on public.kids_english_word_videos for all to authenticated using(exists(select 1 from public.kids_english_words word join public.kids_english_books book on book.id=word.book_id where word.id=word_id and private.is_workspace_admin(book.workspace_id))) with check(exists(select 1 from public.kids_english_words word join public.kids_english_books book on book.id=word.book_id join public.kids_english_videos video on video.id=video_id and video.workspace_id=book.workspace_id where word.id=word_id and private.is_workspace_admin(book.workspace_id)));
create policy "family reads kids states" on public.kids_english_states for select to authenticated using(private.can_use_learner_module(learner_id,'kids_english'));
create policy "family reads kids daily queue" on public.kids_english_daily_items for select to authenticated using(private.can_use_learner_module(learner_id,'kids_english'));
create policy "family reads kids attempts" on public.kids_english_attempts for select to authenticated using(private.can_use_learner_module(learner_id,'kids_english'));
revoke insert,update,delete on public.kids_english_states,public.kids_english_daily_items,public.kids_english_attempts from authenticated;

create or replace function public.import_kids_english_book(p_workspace_id uuid,p_learner_id uuid,p_title text,p_fingerprint text,p_rows jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_book_id uuid;v_admin boolean;v_count integer;
begin
 if not private.is_workspace_member(p_workspace_id) then raise exception '不属于当前学习空间' using errcode='42501'; end if;
 v_admin:=private.is_workspace_admin(p_workspace_id);
 if not v_admin and not private.can_use_account_module(p_workspace_id,'kids_english') then raise exception '账号尚未开通儿童英语' using errcode='42501'; end if;
 if p_learner_id is not null and not exists(select 1 from public.learner_profiles learner join public.families family on family.id=learner.family_id where learner.id=p_learner_id and family.workspace_id=p_workspace_id and (v_admin or private.can_access_learner(learner.id))) then raise exception '无权选择这个孩子'; end if;
 if char_length(trim(p_title)) not between 1 and 120 or p_fingerprint !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_rows)<>'array' then raise exception '字册参数无效'; end if;
 v_count:=jsonb_array_length(p_rows);
 if v_count not between 1 and 500 then raise exception '每份字册须有 1 到 500 个单词'; end if;
 if exists(select 1 from public.kids_english_books book where book.workspace_id=p_workspace_id and book.fingerprint=p_fingerprint and book.status<>'archived') then raise exception '同一份字册已经导入，请勿重复提交' using errcode='23505'; end if;
 insert into public.kids_english_books(workspace_id,title,created_by,submitted_for_learner_id,status,review_status,fingerprint,approved_by,approved_at)
 values(p_workspace_id,trim(p_title),(select auth.uid()),p_learner_id,case when v_admin then 'published' else 'draft' end,case when v_admin then 'approved' else 'pending_review' end,p_fingerprint,case when v_admin then (select auth.uid()) else null end,case when v_admin then now() else null end)
 returning id into v_book_id;
 insert into public.kids_english_words(book_id,word,phonetic,meaning_zh,example_en,example_zh,part_of_speech,sequence)
 select v_book_id,trim(entry.word),trim(entry.phonetic),trim(entry.meaning_zh),trim(entry.example_en),nullif(trim(entry.example_zh),''),nullif(trim(entry.part_of_speech),''),entry.sequence
 from jsonb_to_recordset(p_rows) as entry(word text,phonetic text,meaning_zh text,example_en text,example_zh text,part_of_speech text,sequence integer);
 if (select count(*) from public.kids_english_words word where word.book_id=v_book_id)<>v_count then raise exception '字册行数不一致'; end if;
 if v_admin and p_learner_id is not null then
   insert into public.learner_kids_english_books(learner_id,book_id,assignment_status,assigned_by) values(p_learner_id,v_book_id,'active',(select auth.uid()));
 end if;
 return v_book_id;
end; $$;
revoke all on function public.import_kids_english_book(uuid,uuid,text,text,jsonb) from public,anon;
grant execute on function public.import_kids_english_book(uuid,uuid,text,text,jsonb) to authenticated;

create or replace function public.get_kids_english_queue(p_learner_id uuid)
returns table(word_id uuid,word text,phonetic text,meaning_zh text,example_en text,example_zh text,part_of_speech text,queue_kind text,stage smallint,attempt_count integer,clean_streak smallint,required_confirmations smallint,today_remaining integer)
language plpgsql security definer set search_path = '' as $$
declare v_today date; v_timezone text;
begin
 if not private.can_use_learner_module(p_learner_id,'kids_english') then raise exception '未开通儿童英语' using errcode='42501'; end if;
 select learner.timezone into v_timezone from public.learner_profiles learner where learner.id=p_learner_id;
 v_today:=(now() at time zone coalesce(v_timezone,'Asia/Shanghai'))::date;
 perform pg_advisory_xact_lock(hashtextextended(p_learner_id::text||v_today::text,0));
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
   insert into public.kids_english_daily_items(learner_id,local_date,word_id,queue_kind)
   select p_learner_id,v_today,candidate.word_id,'new' from (
     select word.id word_id from public.kids_english_words word join public.kids_english_books book on book.id=word.book_id
     join public.learner_kids_english_books assignment on assignment.book_id=book.id and assignment.learner_id=p_learner_id and assignment.assignment_status='active'
     where book.status='published' and book.review_status='approved'
       and not exists(select 1 from public.kids_english_states state where state.learner_id=p_learner_id and state.word_id=word.id)
     order by book.created_at,word.sequence limit 3
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
create or replace function public.answer_kids_english_word(p_learner_id uuid,p_word_id uuid,p_result text,p_assisted boolean,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_today date;v_timezone text;v_item public.kids_english_daily_items%rowtype;v_state public.kids_english_states%rowtype;v_next smallint;v_clean boolean;v_pass boolean;v_due timestamptz;
begin
 if p_result not in ('known','again') or p_request_id is null then raise exception '回答参数无效'; end if;
 if not private.can_use_learner_module(p_learner_id,'kids_english') then raise exception '未开通儿童英语' using errcode='42501'; end if;
 select learner.timezone into v_timezone from public.learner_profiles learner where learner.id=p_learner_id;
 v_today:=(now() at time zone coalesce(v_timezone,'Asia/Shanghai'))::date;
 if exists(select 1 from public.kids_english_attempts attempt where attempt.learner_id=p_learner_id and attempt.request_id=p_request_id) then return jsonb_build_object('idempotent',true); end if;
 select * into v_item from public.kids_english_daily_items item where item.learner_id=p_learner_id and item.local_date=v_today and item.word_id=p_word_id for update;
 if not found or v_item.passed_at is not null then raise exception '这张卡片不是今天待学习的内容'; end if;
 if not exists(select 1 from public.kids_english_words word join public.kids_english_books book on book.id=word.book_id join public.learner_kids_english_books assignment on assignment.book_id=book.id and assignment.learner_id=p_learner_id and assignment.assignment_status='active' where word.id=p_word_id and book.status='published' and book.review_status='approved') then raise exception '字册没有分配给孩子'; end if;
 insert into public.kids_english_states(learner_id,word_id,stage,due_at) values(p_learner_id,p_word_id,0,now()) on conflict do nothing;
 select * into v_state from public.kids_english_states state where state.learner_id=p_learner_id and state.word_id=p_word_id for update;
 v_clean:=p_result='known' and not p_assisted;
 v_pass:=v_clean and v_item.clean_streak+1>=v_item.required_confirmations;
 v_next:=v_state.stage;
 if v_pass and not v_item.stage_adjusted then v_next:=least(7,v_state.stage+1)::smallint; end if;
 if not v_clean and not v_item.stage_adjusted then v_next:=(case v_state.stage when 0 then 0 when 1 then 0 when 2 then 1 else v_state.stage-2 end)::smallint; end if;
 -- 用孩子所在地的“目标日期零点”，避免今天晚上学习后明早因不足 24 小时被漏掉。
 v_due:=case when v_pass then ((v_today+case v_next when 1 then 1 when 2 then 3 when 3 then 7 when 4 then 14 when 5 then 30 when 6 then 60 else 90 end)::timestamp at time zone coalesce(v_timezone,'Asia/Shanghai'))
   when not v_clean then ((v_today+1)::timestamp at time zone coalesce(v_timezone,'Asia/Shanghai')) else v_state.due_at end;
 update public.kids_english_daily_items item set attempt_count=item.attempt_count+1,clean_streak=case when v_clean then item.clean_streak+1 else 0 end,
   required_confirmations=case when v_clean then item.required_confirmations else 2 end,
   stage_adjusted=item.stage_adjusted or v_pass or not v_clean,
   passed_at=case when v_pass then now() else null end
 where item.learner_id=p_learner_id and item.local_date=v_today and item.word_id=p_word_id;
 update public.kids_english_states state set stage=v_next,due_at=v_due,total_attempts=state.total_attempts+1,
   known_count=state.known_count+case when v_clean then 1 else 0 end,again_count=state.again_count+case when v_clean then 0 else 1 end,
   last_result=case when v_clean then 'known' else 'again' end,mastered_at=case when v_next=7 then coalesce(state.mastered_at,now()) else null end,updated_at=now()
 where state.learner_id=p_learner_id and state.word_id=p_word_id;
 insert into public.kids_english_attempts(learner_id,word_id,request_id,result,assisted,stage_before,stage_after)
 values(p_learner_id,p_word_id,p_request_id,p_result,p_assisted,v_state.stage,v_next);
 return jsonb_build_object('passed',v_pass,'stage',v_next,'remaining',(select count(*) from public.kids_english_daily_items item where item.learner_id=p_learner_id and item.local_date=v_today and item.passed_at is null));
end; $$;
revoke all on function public.get_kids_english_queue(uuid) from public,anon;
revoke all on function public.answer_kids_english_word(uuid,uuid,text,boolean,uuid) from public,anon;
grant execute on function public.get_kids_english_queue(uuid) to authenticated;
grant execute on function public.answer_kids_english_word(uuid,uuid,text,boolean,uuid) to authenticated;
commit;
