-- 字芽：儿童信仰问答（中英双语）学习模块。
-- 请在已运行 001、006、007、008、009 后，于 Supabase Dashboard → SQL Editor 整段执行。
-- 本脚本新增要理问答相关表，并为 learner_profiles 增加独立的每日新问/复习设置。

begin;

alter table public.learner_profiles
  add column if not exists catechism_daily_new_limit smallint not null default 3
    check (catechism_daily_new_limit between 1 and 20),
  add column if not exists catechism_review_limit smallint not null default 10
    check (catechism_review_limit between 1 and 50);

create table if not exists public.catechism_collections (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  code text not null check (char_length(code) between 1 and 100),
  title text not null check (char_length(title) between 1 and 120),
  english_title text check (english_title is null or char_length(english_title) between 1 and 180),
  source_note text check (source_note is null or char_length(source_note) <= 500),
  license_note text check (license_note is null or char_length(license_note) <= 500),
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, code)
);

-- 问答内容属于具体版本的问答册。即使两个版本问题相似，也不会自动合并学习进度。
create table if not exists public.catechism_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.catechism_collections(id) on delete cascade,
  item_key text not null check (char_length(item_key) between 1 and 100),
  sort_order integer not null check (sort_order > 0),
  section_title text check (section_title is null or char_length(section_title) <= 120),
  question_zh text not null check (char_length(question_zh) between 1 and 2000),
  question_en text not null check (char_length(question_en) between 1 and 3000),
  answer_zh text not null check (char_length(answer_zh) between 1 and 4000),
  answer_en text not null check (char_length(answer_en) between 1 and 6000),
  scripture_reference text check (scripture_reference is null or char_length(scripture_reference) <= 1000),
  parent_note text check (parent_note is null or char_length(parent_note) <= 1000),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collection_id, item_key),
  unique (collection_id, sort_order)
);

create table if not exists public.learner_catechism_collections (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  collection_id uuid not null references public.catechism_collections(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (learner_id, collection_id)
);

-- 当前状态用于快速生成今日任务；历史事实始终保留在 catechism_attempts。
create table if not exists public.catechism_learning_states (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  item_id uuid not null references public.catechism_items(id) on delete restrict,
  stage smallint not null default 0 check (stage between 0 and 7),
  next_review_date date,
  last_result text check (last_result is null or last_result in ('recited', 'again')),
  total_attempts integer not null default 0 check (total_attempts >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  again_count integer not null default 0 check (again_count >= 0),
  first_practiced_local_date date,
  last_practiced_at timestamptz,
  last_practiced_local_date date,
  mastered_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (learner_id, item_id)
);

-- 同一天练习多次会产生多行。request_id 用于防止网络重试或双击重复计数。
create table if not exists public.catechism_attempts (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  item_id uuid not null references public.catechism_items(id) on delete restrict,
  recorded_by uuid references auth.users(id) on delete set null,
  result text not null check (result in ('recited', 'again')),
  practiced_at timestamptz not null default now(),
  practiced_local_date date not null,
  stage_before smallint not null check (stage_before between 0 and 7),
  stage_after smallint not null check (stage_after between 0 and 7),
  next_review_date date not null,
  note text check (note is null or char_length(note) <= 500),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (learner_id, request_id)
);

-- 兼容脚本曾被运行过的环境：已有学习事实后，禁止通过删除问题级联清空状态或历史。
alter table public.catechism_learning_states
  drop constraint if exists catechism_learning_states_item_id_fkey,
  add constraint catechism_learning_states_item_id_fkey
    foreign key (item_id) references public.catechism_items(id) on delete restrict;
alter table public.catechism_attempts
  drop constraint if exists catechism_attempts_item_id_fkey,
  add constraint catechism_attempts_item_id_fkey
    foreign key (item_id) references public.catechism_items(id) on delete restrict;

create index if not exists catechism_collections_owner_idx on public.catechism_collections (created_by, created_at desc);
create index if not exists catechism_items_order_idx on public.catechism_items (collection_id, sort_order);
create index if not exists learner_catechism_links_idx on public.learner_catechism_collections (learner_id, linked_at);
create index if not exists learner_catechism_collection_idx on public.learner_catechism_collections (collection_id);
create index if not exists catechism_states_due_idx on public.catechism_learning_states (learner_id, next_review_date, stage);
create index if not exists catechism_states_item_idx on public.catechism_learning_states (item_id);
create index if not exists catechism_attempts_history_idx on public.catechism_attempts (learner_id, item_id, practiced_at desc);
create index if not exists catechism_attempts_date_idx on public.catechism_attempts (learner_id, practiced_local_date desc);
create index if not exists catechism_attempts_item_idx on public.catechism_attempts (item_id);
create index if not exists catechism_attempts_recorder_idx on public.catechism_attempts (recorded_by);

alter table public.catechism_collections enable row level security;
alter table public.catechism_items enable row level security;
alter table public.learner_catechism_collections enable row level security;
alter table public.catechism_learning_states enable row level security;
alter table public.catechism_attempts enable row level security;

drop policy if exists "catechism collection owner reads" on public.catechism_collections;
drop policy if exists "catechism collection owner writes" on public.catechism_collections;
create policy "catechism collection owner reads" on public.catechism_collections
  for select to authenticated using (created_by = (select auth.uid()));
create policy "catechism collection owner writes" on public.catechism_collections
  for all to authenticated using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

drop policy if exists "catechism item owner reads" on public.catechism_items;
drop policy if exists "catechism item owner writes" on public.catechism_items;
create policy "catechism item owner reads" on public.catechism_items
  for select to authenticated using (
    exists (
      select 1 from public.catechism_collections c
      where c.id = collection_id and c.created_by = (select auth.uid())
    )
  );
create policy "catechism item owner writes" on public.catechism_items
  for all to authenticated using (
    exists (
      select 1 from public.catechism_collections c
      where c.id = collection_id and c.created_by = (select auth.uid())
    )
  ) with check (
    exists (
      select 1 from public.catechism_collections c
      where c.id = collection_id and c.created_by = (select auth.uid())
    )
  );

drop policy if exists "parent reads learner catechism collections" on public.learner_catechism_collections;
drop policy if exists "parent writes learner catechism collections" on public.learner_catechism_collections;
create policy "parent reads learner catechism collections" on public.learner_catechism_collections
  for select to authenticated using (
    exists (
      select 1 from public.learner_profiles l
      where l.id = learner_id and l.parent_user_id = (select auth.uid())
    )
  );
create policy "parent writes learner catechism collections" on public.learner_catechism_collections
  for all to authenticated using (
    exists (
      select 1 from public.learner_profiles l
      where l.id = learner_id and l.parent_user_id = (select auth.uid())
    )
  ) with check (
    exists (
      select 1 from public.learner_profiles l
      where l.id = learner_id and l.parent_user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.catechism_collections c
      where c.id = collection_id and c.created_by = (select auth.uid())
    )
  );

drop policy if exists "parent reads catechism states" on public.catechism_learning_states;
drop policy if exists "parent writes catechism states" on public.catechism_learning_states;
create policy "parent reads catechism states" on public.catechism_learning_states
  for select to authenticated using (
    exists (
      select 1 from public.learner_profiles l
      where l.id = learner_id and l.parent_user_id = (select auth.uid())
    )
  );

drop policy if exists "parent reads catechism attempts" on public.catechism_attempts;
drop policy if exists "parent writes catechism attempts" on public.catechism_attempts;
create policy "parent reads catechism attempts" on public.catechism_attempts
  for select to authenticated using (
    exists (
      select 1 from public.learner_profiles l
      where l.id = learner_id and l.parent_user_id = (select auth.uid())
    )
  );
-- 原子记录一次判断，并按 1/3/7/14/30/60/90/180 天安排复习。
-- recited：上升一级；again：下降两级（最低 0），次日再复习。
create or replace function public.record_catechism_attempt(
  p_learner_id uuid,
  p_item_id uuid,
  p_result text,
  p_local_date date,
  p_request_id uuid,
  p_note text default null
)
returns table (
  next_stage integer,
  next_due_date date,
  attempt_total integer,
  recited_total integer,
  again_total integer,
  was_idempotent boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.catechism_learning_states%rowtype;
  v_stage_before smallint;
  v_next_stage smallint;
  v_next_date date;
  v_interval_days integer;
begin
  if (select auth.uid()) is null then
    raise exception '请先登录家长账号';
  end if;
  if p_result not in ('recited', 'again') then
    raise exception '练习结果无效';
  end if;
  if p_local_date is null or p_local_date < current_date - 2 or p_local_date > current_date + 2 then
    raise exception '练习日期无效';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception '备注不能超过 500 个字';
  end if;

  if not exists (
    select 1
    from public.learner_profiles l
    join public.learner_catechism_collections lc on lc.learner_id = l.id
    join public.catechism_collections c on c.id = lc.collection_id
    join public.catechism_items i on i.collection_id = c.id
    where l.id = p_learner_id
      and l.parent_user_id = (select auth.uid())
      and i.id = p_item_id
      and i.status = 'active'
      and c.status = 'published'
      and c.created_by = (select auth.uid())
  ) then
    raise exception '这个问题未发布或不属于所选孩子';
  end if;

  insert into public.catechism_learning_states (learner_id, item_id)
  values (p_learner_id, p_item_id)
  on conflict (learner_id, item_id) do nothing;

  select s.* into v_state
  from public.catechism_learning_states s
  where s.learner_id = p_learner_id and s.item_id = p_item_id
  for update;

  if exists (
    select 1 from public.catechism_attempts a
    where a.learner_id = p_learner_id and a.request_id = p_request_id
  ) then
    return query select
      v_state.stage::integer,
      v_state.next_review_date,
      v_state.total_attempts,
      v_state.success_count,
      v_state.again_count,
      true;
    return;
  end if;

  v_stage_before := v_state.stage;

  -- 同一天可留下多条真实练习记录，但不能靠连续点击反复升级。
  -- 当天后来答错仍会降级一次；连续多次答错不会在一天内重复降级。
  if v_state.last_practiced_local_date = p_local_date and p_result = 'recited' then
    v_next_stage := v_state.stage;
    v_next_date := coalesce(v_state.next_review_date, p_local_date + 1);
  elsif v_state.last_practiced_local_date = p_local_date
        and p_result = 'again'
        and v_state.last_result = 'again' then
    v_next_stage := v_state.stage;
    v_next_date := coalesce(v_state.next_review_date, p_local_date + 1);
  elsif p_result = 'recited' then
    v_next_stage := least(v_state.stage + 1, 7);
    v_interval_days := case v_next_stage
      when 1 then 1
      when 2 then 3
      when 3 then 7
      when 4 then 14
      when 5 then 30
      when 6 then 60
      when 7 then case when v_state.stage = 7 then 180 else 90 end
      else 1
    end;
    v_next_date := p_local_date + v_interval_days;
  else
    v_next_stage := greatest(v_state.stage - 2, 0);
    v_interval_days := 1;
    v_next_date := p_local_date + v_interval_days;
  end if;

  update public.catechism_learning_states s
  set stage = v_next_stage,
      next_review_date = v_next_date,
      last_result = p_result,
      total_attempts = s.total_attempts + 1,
      success_count = s.success_count + case when p_result = 'recited' then 1 else 0 end,
      again_count = s.again_count + case when p_result = 'again' then 1 else 0 end,
      first_practiced_local_date = coalesce(s.first_practiced_local_date, p_local_date),
      last_practiced_at = now(),
      last_practiced_local_date = p_local_date,
      mastered_at = case
        when p_result = 'again' then null
        when v_next_stage = 7 then coalesce(s.mastered_at, now())
        else s.mastered_at
      end,
      updated_at = now()
  where s.learner_id = p_learner_id and s.item_id = p_item_id
  returning s.* into v_state;

  insert into public.catechism_attempts (
    learner_id, item_id, recorded_by, result, practiced_local_date,
    stage_before, stage_after, next_review_date, note, request_id
  ) values (
    p_learner_id, p_item_id, (select auth.uid()), p_result, p_local_date,
    v_stage_before,
    v_next_stage, v_next_date, nullif(btrim(p_note), ''), p_request_id
  );

  return query select
    v_state.stage::integer,
    v_state.next_review_date,
    v_state.total_attempts,
    v_state.success_count,
    v_state.again_count,
    false;
end;
$$;

revoke all on public.catechism_collections, public.catechism_items,
  public.learner_catechism_collections, public.catechism_learning_states,
  public.catechism_attempts from public, anon;
revoke all on public.catechism_collections, public.catechism_items,
  public.learner_catechism_collections, public.catechism_learning_states,
  public.catechism_attempts from authenticated;
grant select, insert, update on public.catechism_collections, public.catechism_items to authenticated;
grant select, insert, delete on public.learner_catechism_collections to authenticated;
grant select on public.catechism_learning_states, public.catechism_attempts to authenticated;

revoke all on function public.record_catechism_attempt(uuid, uuid, text, date, uuid, text) from public, anon;
grant execute on function public.record_catechism_attempt(uuid, uuid, text, date, uuid, text) to authenticated;

commit;
