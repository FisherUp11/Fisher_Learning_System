-- 022｜音乐文件夹、使用时长、孩子概况与按孩子的用量/成本测算
-- 前置：015、018、021（现有项目建议先完成 001–021）。整份运行，可重跑。
-- 不删除任何学习记录；只新增表、列、索引、触发器和只读统计函数。
begin;

-- ========== 1. 音乐文件夹 ==========
create table if not exists public.music_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.learning_workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  title text not null check (char_length(title) between 1 and 60),
  description text check (description is null or char_length(description) <= 300),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, title)
);
alter table public.music_items add column if not exists folder_id uuid references public.music_folders(id) on delete set null;
-- 记录分配来源：文件夹取消分配时只收回由该文件夹带来的内容，手动单独分配的保留。
alter table public.learner_music_items add column if not exists assigned_via_folder_id uuid references public.music_folders(id) on delete set null;
create table if not exists public.learner_music_folders (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  folder_id uuid not null references public.music_folders(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assignment_status text not null default 'active' check (assignment_status in ('active', 'inactive')),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  primary key (learner_id, folder_id)
);
create index if not exists music_items_folder_idx on public.music_items (folder_id) where folder_id is not null;
create index if not exists learner_music_folders_folder_idx on public.learner_music_folders (folder_id, assignment_status);
create index if not exists learner_music_items_via_folder_idx on public.learner_music_items (assigned_via_folder_id) where assigned_via_folder_id is not null;

alter table public.music_folders enable row level security;
alter table public.learner_music_folders enable row level security;
drop policy if exists "workspace reads music folders" on public.music_folders;
create policy "workspace reads music folders" on public.music_folders for select to authenticated using (private.is_workspace_member(workspace_id));
drop policy if exists "admins manage music folders" on public.music_folders;
create policy "admins manage music folders" on public.music_folders for all to authenticated
using (private.is_workspace_admin(workspace_id)) with check (private.is_workspace_admin(workspace_id));
drop policy if exists "learner access reads music folder assignments" on public.learner_music_folders;
create policy "learner access reads music folder assignments" on public.learner_music_folders for select to authenticated using (private.can_access_learner(learner_id));
drop policy if exists "admins manage music folder assignments" on public.learner_music_folders;
create policy "admins manage music folder assignments" on public.learner_music_folders for all to authenticated
using (private.is_workspace_admin(private.learner_workspace_id(learner_id)))
with check (private.is_workspace_admin(private.learner_workspace_id(learner_id)) and exists (
  select 1 from public.music_folders folder where folder.id = learner_music_folders.folder_id and folder.workspace_id = private.learner_workspace_id(learner_id)
));
grant select, insert, update, delete on public.music_folders, public.learner_music_folders to authenticated;

-- 文件夹分配/取消 → 同步文件夹内已发布内容。
create or replace function private.sync_music_folder_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assignment_status = 'active' then
    insert into public.learner_music_items as assignment (learner_id, item_id, assigned_by, assignment_status, unassigned_at, assigned_via_folder_id)
    select new.learner_id, item.id, new.assigned_by, 'active', null, new.folder_id
    from public.music_items item
    join public.music_folders folder on folder.id = item.folder_id and folder.workspace_id = item.workspace_id
    join public.learner_profiles learner on learner.id = new.learner_id
    join public.families family on family.id = learner.family_id and family.workspace_id = item.workspace_id
    where item.folder_id = new.folder_id and item.status = 'published' and item.review_status = 'approved'
    on conflict (learner_id, item_id) do update
      set assignment_status = 'active', unassigned_at = null, assigned_by = excluded.assigned_by, assigned_via_folder_id = excluded.assigned_via_folder_id
      where assignment.assignment_status = 'inactive';
  elsif tg_op = 'UPDATE' and old.assignment_status = 'active' then
    update public.learner_music_items set assignment_status = 'inactive', unassigned_at = now()
    where learner_id = new.learner_id and assigned_via_folder_id = new.folder_id and assignment_status = 'active';
  end if;
  return new;
end; $$;
revoke all on function private.sync_music_folder_assignment() from public, anon, authenticated;
drop trigger if exists sync_music_folder_assignment on public.learner_music_folders;
create trigger sync_music_folder_assignment after insert or update on public.learner_music_folders
for each row execute function private.sync_music_folder_assignment();

-- 内容发布或移入文件夹 → 自动分配给已订阅该文件夹的孩子；移出文件夹 → 收回由旧文件夹带来的分配。
create or replace function private.sync_music_item_folder()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.folder_id is not null and new.folder_id is distinct from old.folder_id then
    update public.learner_music_items set assignment_status = 'inactive', unassigned_at = now()
    where item_id = new.id and assigned_via_folder_id = old.folder_id and assignment_status = 'active';
  end if;
  if new.folder_id is not null and new.status = 'published' and new.review_status = 'approved' then
    insert into public.learner_music_items as assignment (learner_id, item_id, assigned_by, assignment_status, unassigned_at, assigned_via_folder_id)
    select link.learner_id, new.id, link.assigned_by, 'active', null, new.folder_id
    from public.learner_music_folders link
    join public.music_folders folder on folder.id = link.folder_id and folder.workspace_id = new.workspace_id
    join public.learner_profiles learner on learner.id = link.learner_id
    join public.families family on family.id = learner.family_id and family.workspace_id = new.workspace_id
    where link.folder_id = new.folder_id and link.assignment_status = 'active'
    on conflict (learner_id, item_id) do update
      set assignment_status = 'active', unassigned_at = null, assigned_via_folder_id = excluded.assigned_via_folder_id
      where assignment.assignment_status = 'inactive';
  end if;
  return new;
end; $$;
revoke all on function private.sync_music_item_folder() from public, anon, authenticated;
drop trigger if exists sync_music_item_folder on public.music_items;
create trigger sync_music_item_folder after insert or update of folder_id, status, review_status on public.music_items
for each row execute function private.sync_music_item_folder();

-- ========== 2. AI/语音用量可归属到孩子 ==========
alter table public.service_usage_events add column if not exists learner_id uuid references public.learner_profiles(id) on delete set null;
create index if not exists service_usage_learner_time on public.service_usage_events (learner_id, created_at desc) where learner_id is not null;

-- ========== 3. App 使用时长（按账号 / 孩子 / 天汇总，不记录页面内容） ==========
create table if not exists public.app_activity_days (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.learning_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  learner_id uuid references public.learner_profiles(id) on delete cascade,
  activity_date date not null,
  active_seconds integer not null default 0 check (active_seconds between 0 and 86400),
  visits integer not null default 0 check (visits >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create unique index if not exists app_activity_days_unique
  on public.app_activity_days (user_id, activity_date, (coalesce(learner_id, '00000000-0000-0000-0000-000000000000'::uuid)));
create index if not exists app_activity_days_workspace_date on public.app_activity_days (workspace_id, activity_date desc);
create index if not exists app_activity_days_learner_date on public.app_activity_days (learner_id, activity_date desc) where learner_id is not null;
alter table public.app_activity_days enable row level security;
revoke all on public.app_activity_days from public, anon, authenticated;
grant select on public.app_activity_days to authenticated;
drop policy if exists "admins read activity" on public.app_activity_days;
create policy "admins read activity" on public.app_activity_days for select to authenticated using (private.is_workspace_admin(workspace_id));

create or replace function public.record_app_activity(p_learner_id uuid, p_seconds integer, p_new_visit boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_workspace uuid;
  v_learner uuid;
  v_seconds integer := least(greatest(coalesce(p_seconds, 0), 0), 90);
begin
  if v_user is null then return; end if;
  select member.workspace_id into v_workspace from public.workspace_members member
  where member.user_id = v_user and member.status = 'active' limit 1;
  if v_workspace is null then return; end if;
  if p_learner_id is not null and private.learner_workspace_id(p_learner_id) = v_workspace then v_learner := p_learner_id; end if;
  insert into public.app_activity_days as activity_day (workspace_id, user_id, learner_id, activity_date, active_seconds, visits)
  values (v_workspace, v_user, v_learner, (now() at time zone 'Asia/Shanghai')::date, v_seconds, case when p_new_visit then 1 else 0 end)
  on conflict (user_id, activity_date, (coalesce(learner_id, '00000000-0000-0000-0000-000000000000'::uuid))) do update set
    -- 不能比两次心跳的真实间隔更多，防止重复标签页或重放把时长刷高。
    active_seconds = least(86400, activity_day.active_seconds + least(excluded.active_seconds, greatest(0, extract(epoch from now() - activity_day.last_seen_at)::integer + 5))),
    visits = activity_day.visits + excluded.visits,
    last_seen_at = now();
end; $$;
revoke all on function public.record_app_activity(uuid, integer, boolean) from public, anon;
grant execute on function public.record_app_activity(uuid, integer, boolean) to authenticated;

-- ========== 4. 统计所需索引 ==========
create index if not exists learning_attempts_learner_time_idx on public.learning_attempts (learner_id, answered_at desc);
create index if not exists poem_recitation_learner_time_idx on public.poem_recitation_attempts (learner_id, recited_at desc);
create index if not exists music_attempts_learner_time_idx on public.music_practice_attempts (learner_id, practiced_at desc);
create index if not exists catechism_attempts_learner_time_idx on public.catechism_attempts (learner_id, practiced_at desc);

-- ========== 5. 管理员：孩子概况（一次查询替代每个孩子十几次查询） ==========
drop function if exists public.workspace_learner_overview(uuid);
create or replace function public.workspace_learner_overview(p_workspace_id uuid)
returns table (
  learner_id uuid, display_name text, family_id uuid, family_name text, family_status text, created_at timestamptz,
  hanzi_started bigint, hanzi_stable bigint, hanzi_due bigint,
  answers_7d bigint, first_try_7d bigint, first_try_known_7d bigint,
  poem_records_7d bigint, game_sessions_7d bigint, music_records_7d bigint, catechism_records_7d bigint,
  active_days_7d bigint, active_seconds_7d bigint, last_activity_at timestamptz, music_items_assigned bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_workspace_admin(p_workspace_id) then raise exception '只有空间管理员可以查看孩子概况' using errcode = '42501'; end if;
  return query
  with kids as (
    select learner.id, learner.display_name, learner.family_id, family.name, family.status, learner.created_at
    from public.learner_profiles learner join public.families family on family.id = learner.family_id
    where family.workspace_id = p_workspace_id
  ), hanzi as (
    select state.learner_id, count(*) as started, count(*) filter (where state.stage >= 5) as stable, count(*) filter (where state.due_at <= now()) as due
    from public.learning_states state
    where state.learner_id in (select kids.id from kids) and exists (
      select 1 from public.learner_content_packages link
      join public.content_packages package on package.id = link.package_id and package.status = 'published' and package.review_status = 'approved'
      join public.package_characters item on item.package_id = link.package_id and item.character_id = state.character_id
      where link.learner_id = state.learner_id and link.assignment_status = 'active')
    group by state.learner_id
  ), answers as (
    select attempt.learner_id, count(*) as total, count(*) filter (where attempt.attempt_number = 1) as first_try,
      count(*) filter (where attempt.attempt_number = 1 and attempt.result = 'known' and not attempt.assisted) as first_known
    from public.learning_attempts attempt
    where attempt.learner_id in (select kids.id from kids) and attempt.answered_at >= now() - interval '7 days'
    group by attempt.learner_id
  ), activity as (
    select ad.learner_id, count(distinct ad.activity_date) as days, sum(ad.active_seconds) as seconds
    from public.app_activity_days ad
    where ad.workspace_id = p_workspace_id and ad.learner_id is not null and ad.activity_date >= (now() at time zone 'Asia/Shanghai')::date - 6
    group by ad.learner_id
  )
  select kids.id, kids.display_name, kids.family_id, kids.name, kids.status, kids.created_at,
    coalesce(hanzi.started, 0), coalesce(hanzi.stable, 0), coalesce(hanzi.due, 0),
    coalesce(answers.total, 0), coalesce(answers.first_try, 0), coalesce(answers.first_known, 0),
    (select count(*) from public.poem_recitation_attempts r where r.learner_id = kids.id and r.recited_at >= now() - interval '7 days'),
    (select count(*) from public.poem_game_sessions g where g.learner_id = kids.id and g.played_at >= now() - interval '7 days'),
    (select count(*) from public.music_practice_attempts m where m.learner_id = kids.id and m.practiced_at >= now() - interval '7 days'),
    (select count(*) from public.catechism_attempts c where c.learner_id = kids.id and c.practiced_at >= now() - interval '7 days'),
    coalesce(activity.days, 0), coalesce(activity.seconds, 0)::bigint,
    greatest(
      (select max(a.answered_at) from public.learning_attempts a where a.learner_id = kids.id),
      (select max(r.recited_at) from public.poem_recitation_attempts r where r.learner_id = kids.id),
      (select max(g.played_at) from public.poem_game_sessions g where g.learner_id = kids.id),
      (select max(m.practiced_at) from public.music_practice_attempts m where m.learner_id = kids.id),
      (select max(c.practiced_at) from public.catechism_attempts c where c.learner_id = kids.id),
      (select max(d.last_seen_at) from public.app_activity_days d where d.learner_id = kids.id)
    ),
    (select count(*) from public.learner_music_items lm join public.music_items mi on mi.id = lm.item_id and mi.status = 'published' and mi.review_status = 'approved'
      where lm.learner_id = kids.id and lm.assignment_status = 'active')
  from kids
  left join hanzi on hanzi.learner_id = kids.id
  left join answers on answers.learner_id = kids.id
  left join activity on activity.learner_id = kids.id
  order by kids.name, kids.created_at;
end; $$;
revoke all on function public.workspace_learner_overview(uuid) from public, anon;
grant execute on function public.workspace_learner_overview(uuid) to authenticated;

-- ========== 6. 管理员：区间内使用量（时长 / 学习记录 / 付费服务） ==========
drop function if exists public.workspace_activity_summary(uuid, date, date);
create or replace function public.workspace_activity_summary(p_workspace_id uuid, p_from date, p_to date)
returns table (user_id uuid, learner_id uuid, active_days bigint, active_seconds bigint, visits bigint, last_seen_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_workspace_admin(p_workspace_id) then raise exception '只有空间管理员可以查看' using errcode = '42501'; end if;
  if p_to < p_from or p_to > p_from + 367 then raise exception '统计区间不正确'; end if;
  return query
  select ad.user_id, ad.learner_id, count(distinct ad.activity_date), sum(ad.active_seconds)::bigint, sum(ad.visits)::bigint, max(ad.last_seen_at)
  from public.app_activity_days ad
  where ad.workspace_id = p_workspace_id and ad.activity_date between p_from and p_to
  group by ad.user_id, ad.learner_id;
end; $$;
revoke all on function public.workspace_activity_summary(uuid, date, date) from public, anon;
grant execute on function public.workspace_activity_summary(uuid, date, date) to authenticated;

drop function if exists public.workspace_learner_usage(uuid, timestamptz, timestamptz);
create or replace function public.workspace_learner_usage(p_workspace_id uuid, p_from timestamptz, p_to timestamptz)
returns table (learner_id uuid, hanzi_answers bigint, poem_records bigint, game_sessions bigint, game_seconds bigint, music_records bigint, catechism_records bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_workspace_admin(p_workspace_id) then raise exception '只有空间管理员可以查看' using errcode = '42501'; end if;
  if p_to <= p_from or p_to > p_from + interval '367 days' then raise exception '统计区间不正确'; end if;
  return query
  select learner.id,
    (select count(*) from public.learning_attempts a where a.learner_id = learner.id and a.answered_at >= p_from and a.answered_at < p_to),
    (select count(*) from public.poem_recitation_attempts r where r.learner_id = learner.id and r.recited_at >= p_from and r.recited_at < p_to),
    (select count(*) from public.poem_game_sessions g where g.learner_id = learner.id and g.played_at >= p_from and g.played_at < p_to),
    (select coalesce(sum(g.duration_seconds), 0)::bigint from public.poem_game_sessions g where g.learner_id = learner.id and g.played_at >= p_from and g.played_at < p_to),
    (select count(*) from public.music_practice_attempts m where m.learner_id = learner.id and m.practiced_at >= p_from and m.practiced_at < p_to),
    (select count(*) from public.catechism_attempts c where c.learner_id = learner.id and c.practiced_at >= p_from and c.practiced_at < p_to)
  from public.learner_profiles learner join public.families family on family.id = learner.family_id
  where family.workspace_id = p_workspace_id;
end; $$;
revoke all on function public.workspace_learner_usage(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.workspace_learner_usage(uuid, timestamptz, timestamptz) to authenticated;

drop function if exists public.workspace_service_usage_v2(uuid, timestamptz, timestamptz);
create or replace function public.workspace_service_usage_v2(p_workspace_id uuid, p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, learner_id uuid, service text, model text, requests bigint, succeeded bigint, failed bigint, uncertain bigint,
  input_tokens numeric, output_tokens numeric, cached_input_tokens numeric, token_unknown bigint, characters bigint, images bigint, audio_seconds numeric)
language sql stable security invoker set search_path = '' as $$
  select e.user_id, e.learner_id, e.service, e.model, count(*), count(*) filter (where e.status = 'success'),
    count(*) filter (where e.status = 'error'), count(*) filter (where e.status in ('started', 'unknown')),
    sum(e.input_tokens), sum(e.output_tokens), sum(e.cached_input_tokens),
    count(*) filter (where e.service in ('text', 'image') and (e.input_tokens is null or e.output_tokens is null)),
    sum(e.characters), sum(e.images), sum(e.audio_seconds)
  from public.service_usage_events e
  where e.workspace_id = p_workspace_id and e.created_at >= p_from and e.created_at < p_to
    and p_to > p_from and p_to <= p_from + interval '367 days'
  group by e.user_id, e.learner_id, e.service, e.model;
$$;
revoke all on function public.workspace_service_usage_v2(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.workspace_service_usage_v2(uuid, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';
commit;
