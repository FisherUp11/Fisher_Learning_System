-- 字芽：诗词背诵记录模块。
-- 请在已运行 001、006、007 后，于 Supabase Dashboard → SQL Editor 整段执行。
-- 此脚本只新增诗词相关表，不会改写任何汉字、孩子或既有学习记录。

begin;

create table if not exists public.poem_collections (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  code text not null,
  title text not null check (char_length(title) between 1 and 80),
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, code)
);

create table if not exists public.poems (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  poem_key text not null check (char_length(poem_key) between 1 and 100),
  title text not null check (char_length(title) between 1 and 80),
  author text not null check (char_length(author) between 1 and 50),
  dynasty text check (dynasty is null or char_length(dynasty) between 1 and 30),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (created_by, poem_key)
);

create table if not exists public.poem_collection_items (
  collection_id uuid not null references public.poem_collections(id) on delete cascade,
  poem_id uuid not null references public.poems(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  created_at timestamptz not null default now(),
  primary key (collection_id, poem_id),
  unique (collection_id, sequence)
);

-- 一位孩子可以拥有多次导入的诗词册；后续导入会叠加，而不是覆盖第一批。
create table if not exists public.learner_poem_collections (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  collection_id uuid not null references public.poem_collections(id) on delete cascade,
  linked_at timestamptz not null default now(),
  primary key (learner_id, collection_id)
);

-- 每一次点击“今天背过一次”都会新增一行；同一天背两遍会保留两条独立记录。
-- score 允许为空：只打卡、不评分时以 null 保存。
create table if not exists public.poem_recitation_attempts (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  poem_id uuid not null references public.poems(id) on delete cascade,
  recorded_by uuid references auth.users(id) on delete set null,
  recited_at timestamptz not null default now(),
  recited_local_date date not null,
  score smallint check (score is null or score between 1 and 10),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists poems_owner_key_idx on public.poems (created_by, poem_key);
create index if not exists poem_collection_items_order_idx on public.poem_collection_items (collection_id, sequence);
create index if not exists learner_poem_collections_learner_idx on public.learner_poem_collections (learner_id, linked_at);
create index if not exists poem_recitation_history_idx on public.poem_recitation_attempts (learner_id, poem_id, recited_at desc);
create index if not exists poem_recitation_dates_idx on public.poem_recitation_attempts (learner_id, recited_local_date desc);

alter table public.poem_collections enable row level security;
alter table public.poems enable row level security;
alter table public.poem_collection_items enable row level security;
alter table public.learner_poem_collections enable row level security;
alter table public.poem_recitation_attempts enable row level security;

drop policy if exists "poem collection owner reads" on public.poem_collections;
drop policy if exists "poem collection owner writes" on public.poem_collections;
create policy "poem collection owner reads" on public.poem_collections for select to authenticated using (created_by = (select auth.uid()));
create policy "poem collection owner writes" on public.poem_collections for all to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

drop policy if exists "poem owner reads" on public.poems;
drop policy if exists "poem owner writes" on public.poems;
create policy "poem owner reads" on public.poems for select to authenticated using (created_by = (select auth.uid()));
create policy "poem owner writes" on public.poems for all to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

drop policy if exists "poem collection item owner reads" on public.poem_collection_items;
drop policy if exists "poem collection item owner writes" on public.poem_collection_items;
create policy "poem collection item owner reads" on public.poem_collection_items for select to authenticated using (
  exists (select 1 from public.poem_collections c where c.id = collection_id and c.created_by = (select auth.uid()))
);
create policy "poem collection item owner writes" on public.poem_collection_items for all to authenticated using (
  exists (select 1 from public.poem_collections c where c.id = collection_id and c.created_by = (select auth.uid()))
) with check (
  exists (select 1 from public.poem_collections c where c.id = collection_id and c.created_by = (select auth.uid()))
  and exists (select 1 from public.poems p where p.id = poem_id and p.created_by = (select auth.uid()))
);

drop policy if exists "parent reads learner poem collections" on public.learner_poem_collections;
drop policy if exists "parent writes learner poem collections" on public.learner_poem_collections;
create policy "parent reads learner poem collections" on public.learner_poem_collections for select to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
);
create policy "parent writes learner poem collections" on public.learner_poem_collections for all to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
) with check (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
  and exists (select 1 from public.poem_collections c where c.id = collection_id and c.created_by = (select auth.uid()))
);

drop policy if exists "parent reads poem recitation attempts" on public.poem_recitation_attempts;
drop policy if exists "parent writes poem recitation attempts" on public.poem_recitation_attempts;
create policy "parent reads poem recitation attempts" on public.poem_recitation_attempts for select to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
);
create policy "parent writes poem recitation attempts" on public.poem_recitation_attempts for all to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
  and exists (select 1 from public.poems p where p.id = poem_id and p.created_by = (select auth.uid()))
) with check (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
  and exists (select 1 from public.poems p where p.id = poem_id and p.created_by = (select auth.uid()))
  and (recorded_by is null or recorded_by = (select auth.uid()))
);

revoke all on public.poem_collections, public.poems, public.poem_collection_items, public.learner_poem_collections, public.poem_recitation_attempts from anon;
grant select, insert, update, delete on public.poem_collections, public.poems, public.poem_collection_items, public.learner_poem_collections, public.poem_recitation_attempts to authenticated;

commit;
