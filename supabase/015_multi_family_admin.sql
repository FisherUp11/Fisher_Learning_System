-- 字芽：多家庭、空间管理员、共享资源审核与分配基础。
-- 前置：已经按顺序运行 001–014。
-- 本迁移只补充归属与权限，不删除或重建任何孩子、学习历史、奖励流水或媒体记录。

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.learning_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  legacy_owner_user_id uuid unique references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.learning_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'parent')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.learning_workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  legacy_parent_user_id uuid unique references auth.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'parent' check (role in ('parent', 'guardian')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.learning_workspaces(id) on delete cascade,
  invited_email text not null check (char_length(invited_email) between 3 and 320),
  family_name text not null check (char_length(family_name) between 1 and 80),
  token_hash text not null unique check (char_length(token_hash) = 64),
  role text not null default 'parent' check (role = 'parent'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.learning_workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (char_length(event_type) between 1 and 80),
  entity_type text check (entity_type is null or char_length(entity_type) <= 60),
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workspace_members_user_idx on public.workspace_members (user_id, status, workspace_id);
create index if not exists families_workspace_idx on public.families (workspace_id, status, created_at);
create index if not exists family_members_user_idx on public.family_members (user_id, status, family_id);
create index if not exists workspace_invites_workspace_idx on public.workspace_invitations (workspace_id, status, created_at desc);
create index if not exists workspace_audit_workspace_idx on public.workspace_audit_events (workspace_id, created_at desc);

-- 现有直接归属字段暂时保留；新关系先旁路回填，方便回滚。
alter table public.learner_profiles
  add column if not exists family_id uuid references public.families(id) on delete restrict,
  add column if not exists hanzi_review_mode text not null default 'adaptive'
    check (hanzi_review_mode in ('adaptive', 'fixed')),
  add column if not exists hanzi_base_review_limit smallint not null default 15
    check (hanzi_base_review_limit between 5 and 40),
  add column if not exists hanzi_max_review_limit smallint not null default 25
    check (hanzi_max_review_limit between 5 and 50);

alter table public.content_packages
  add column if not exists workspace_id uuid references public.learning_workspaces(id) on delete restrict,
  add column if not exists submitted_for_learner_id uuid references public.learner_profiles(id) on delete set null,
  add column if not exists review_status text not null default 'pending_review'
    check (review_status in ('draft', 'pending_review', 'approved', 'rejected')),
  add column if not exists visibility text not null default 'workspace_shared'
    check (visibility in ('workspace_shared', 'family_private')),
  add column if not exists fingerprint text,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz;

alter table public.characters
  add column if not exists workspace_id uuid references public.learning_workspaces(id) on delete restrict;

alter table public.poem_collections
  add column if not exists workspace_id uuid references public.learning_workspaces(id) on delete restrict,
  add column if not exists submitted_for_learner_id uuid references public.learner_profiles(id) on delete set null,
  add column if not exists review_status text not null default 'pending_review'
    check (review_status in ('draft', 'pending_review', 'approved', 'rejected')),
  add column if not exists visibility text not null default 'workspace_shared'
    check (visibility in ('workspace_shared', 'family_private')),
  add column if not exists fingerprint text,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz;

alter table public.poems
  add column if not exists workspace_id uuid references public.learning_workspaces(id) on delete restrict;

alter table public.music_items
  add column if not exists workspace_id uuid references public.learning_workspaces(id) on delete restrict,
  add column if not exists submitted_for_learner_id uuid references public.learner_profiles(id) on delete set null,
  add column if not exists review_status text not null default 'pending_review'
    check (review_status in ('draft', 'pending_review', 'approved', 'rejected')),
  add column if not exists visibility text not null default 'workspace_shared'
    check (visibility in ('workspace_shared', 'family_private')),
  add column if not exists fingerprint text,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz;

alter table public.catechism_collections
  add column if not exists workspace_id uuid references public.learning_workspaces(id) on delete restrict,
  add column if not exists submitted_for_learner_id uuid references public.learner_profiles(id) on delete set null,
  add column if not exists review_status text not null default 'pending_review'
    check (review_status in ('draft', 'pending_review', 'approved', 'rejected')),
  add column if not exists visibility text not null default 'workspace_shared'
    check (visibility in ('workspace_shared', 'family_private')),
  add column if not exists fingerprint text,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz;

alter table public.learner_content_packages
  add column if not exists assigned_by uuid references auth.users(id) on delete set null,
  add column if not exists assignment_status text not null default 'active'
    check (assignment_status in ('active', 'inactive')),
  add column if not exists assignment_order integer not null default 1 check (assignment_order > 0),
  add column if not exists unassigned_at timestamptz;

alter table public.learner_poem_collections
  add column if not exists assigned_by uuid references auth.users(id) on delete set null,
  add column if not exists assignment_status text not null default 'active'
    check (assignment_status in ('active', 'inactive')),
  add column if not exists unassigned_at timestamptz;

alter table public.learner_music_items
  add column if not exists assigned_by uuid references auth.users(id) on delete set null,
  add column if not exists assignment_status text not null default 'active'
    check (assignment_status in ('active', 'inactive')),
  add column if not exists unassigned_at timestamptz;

alter table public.learner_catechism_collections
  add column if not exists assigned_by uuid references auth.users(id) on delete set null,
  add column if not exists assignment_status text not null default 'active'
    check (assignment_status in ('active', 'inactive')),
  add column if not exists unassigned_at timestamptz;

-- 为每个旧的直接拥有者建立独立空间和家庭。现有项目通常只会生成一组。
with owners as (
  select parent_user_id as user_id from public.learner_profiles
  union select created_by from public.content_packages
  union select created_by from public.poem_collections
  union select created_by from public.music_items
  union select created_by from public.catechism_collections
)
insert into public.learning_workspaces (name, owner_user_id, legacy_owner_user_id)
select '字芽学习空间', owners.user_id, owners.user_id
from owners
where owners.user_id is not null
on conflict (legacy_owner_user_id) do nothing;

insert into public.workspace_members (workspace_id, user_id, role)
select workspace.id, workspace.owner_user_id, 'owner'
from public.learning_workspaces workspace
on conflict (workspace_id, user_id) do update
set role = 'owner', status = 'active';

insert into public.families (workspace_id, name, legacy_parent_user_id)
select workspace.id, '我的家庭', workspace.owner_user_id
from public.learning_workspaces workspace
where workspace.legacy_owner_user_id is not null
on conflict (legacy_parent_user_id) do nothing;

insert into public.family_members (family_id, user_id, role)
select family.id, family.legacy_parent_user_id, 'parent'
from public.families family
where family.legacy_parent_user_id is not null
on conflict (family_id, user_id) do update set status = 'active';

update public.learner_profiles learner
set family_id = family.id
from public.families family
where family.legacy_parent_user_id = learner.parent_user_id
  and learner.family_id is null;

update public.content_packages resource
set workspace_id = workspace.id,
    review_status = case when resource.status = 'published' then 'approved' else 'draft' end,
    approved_by = case when resource.status = 'published' then resource.created_by else null end,
    approved_at = case when resource.status = 'published' then coalesce(resource.updated_at, resource.created_at) else null end
from public.learning_workspaces workspace
where workspace.legacy_owner_user_id = resource.created_by
  and resource.workspace_id is null;

update public.characters resource
set workspace_id = workspace.id
from public.learning_workspaces workspace
where workspace.legacy_owner_user_id = resource.created_by
  and resource.workspace_id is null;

update public.poem_collections resource
set workspace_id = workspace.id,
    review_status = case when resource.status = 'published' then 'approved' else 'draft' end,
    approved_by = case when resource.status = 'published' then resource.created_by else null end,
    approved_at = case when resource.status = 'published' then coalesce(resource.updated_at, resource.created_at) else null end
from public.learning_workspaces workspace
where workspace.legacy_owner_user_id = resource.created_by
  and resource.workspace_id is null;

update public.poems resource
set workspace_id = workspace.id
from public.learning_workspaces workspace
where workspace.legacy_owner_user_id = resource.created_by
  and resource.workspace_id is null;

update public.music_items resource
set workspace_id = workspace.id,
    review_status = case when resource.status = 'published' then 'approved' else 'draft' end,
    approved_by = case when resource.status = 'published' then resource.created_by else null end,
    approved_at = case when resource.status = 'published' then coalesce(resource.updated_at, resource.created_at) else null end
from public.learning_workspaces workspace
where workspace.legacy_owner_user_id = resource.created_by
  and resource.workspace_id is null;

update public.catechism_collections resource
set workspace_id = workspace.id,
    review_status = case when resource.status = 'published' then 'approved' else 'draft' end,
    approved_by = case when resource.status = 'published' then resource.created_by else null end,
    approved_at = case when resource.status = 'published' then coalesce(resource.updated_at, resource.created_at) else null end
from public.learning_workspaces workspace
where workspace.legacy_owner_user_id = resource.created_by
  and resource.workspace_id is null;

update public.learner_content_packages assignment
set assigned_by = package.created_by
from public.content_packages package
where package.id = assignment.package_id and assignment.assigned_by is null;
update public.learner_poem_collections assignment
set assigned_by = collection.created_by
from public.poem_collections collection
where collection.id = assignment.collection_id and assignment.assigned_by is null;
update public.learner_music_items assignment
set assigned_by = item.created_by
from public.music_items item
where item.id = assignment.item_id and assignment.assigned_by is null;
update public.learner_catechism_collections assignment
set assigned_by = collection.created_by
from public.catechism_collections collection
where collection.id = assignment.collection_id and assignment.assigned_by is null;

alter table public.learner_profiles alter column family_id set not null;
alter table public.content_packages alter column workspace_id set not null;
alter table public.characters alter column workspace_id set not null;
alter table public.poem_collections alter column workspace_id set not null;
alter table public.poems alter column workspace_id set not null;
alter table public.music_items alter column workspace_id set not null;
alter table public.catechism_collections alter column workspace_id set not null;

create unique index if not exists characters_workspace_character_uidx
  on public.characters (workspace_id, character);
create unique index if not exists poems_workspace_key_uidx
  on public.poems (workspace_id, poem_key);
create index if not exists content_packages_workspace_idx
  on public.content_packages (workspace_id, review_status, status, created_at desc);
create index if not exists content_packages_submission_target_idx
  on public.content_packages (submitted_for_learner_id) where submitted_for_learner_id is not null;
create index if not exists poem_collections_workspace_idx
  on public.poem_collections (workspace_id, review_status, status, created_at desc);
create index if not exists poem_collections_submission_target_idx
  on public.poem_collections (submitted_for_learner_id) where submitted_for_learner_id is not null;
create index if not exists music_items_workspace_review_idx
  on public.music_items (workspace_id, review_status, status, item_type, updated_at desc);
create index if not exists music_items_submission_target_idx
  on public.music_items (submitted_for_learner_id) where submitted_for_learner_id is not null;
create index if not exists catechism_collections_workspace_idx
  on public.catechism_collections (workspace_id, review_status, status, created_at desc);
create index if not exists catechism_collections_submission_target_idx
  on public.catechism_collections (submitted_for_learner_id) where submitted_for_learner_id is not null;
create index if not exists learner_packages_active_order_idx
  on public.learner_content_packages (learner_id, assignment_status, assignment_order, linked_at);

-- 权限判断放在不暴露的 private schema；函数自身显式读取 auth.uid()。
create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.workspace_members member
    where member.workspace_id = p_workspace_id
      and member.user_id = (select auth.uid())
      and member.status = 'active'
  );
$$;

create or replace function private.is_workspace_admin(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.workspace_members member
    where member.workspace_id = p_workspace_id
      and member.user_id = (select auth.uid())
      and member.status = 'active'
      and member.role in ('owner', 'admin')
  );
$$;

create or replace function private.can_read_family(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.families family
    where family.id = p_family_id and (
      exists (
        select 1 from public.family_members family_member
        where family_member.family_id = family.id
          and family_member.user_id = (select auth.uid())
          and family_member.status = 'active'
      )
      or exists (
        select 1 from public.workspace_members workspace_member
        where workspace_member.workspace_id = family.workspace_id
          and workspace_member.user_id = (select auth.uid())
          and workspace_member.status = 'active'
          and workspace_member.role in ('owner', 'admin')
      )
    )
  );
$$;

create or replace function private.can_access_learner(p_learner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.learner_profiles learner
    join public.families family on family.id = learner.family_id
    where learner.id = p_learner_id
      and (
        learner.parent_user_id = (select auth.uid())
        or exists (
          select 1 from public.family_members family_member
          where family_member.family_id = family.id
            and family_member.user_id = (select auth.uid())
            and family_member.status = 'active'
        )
        or exists (
          select 1 from public.workspace_members workspace_member
          where workspace_member.workspace_id = family.workspace_id
            and workspace_member.user_id = (select auth.uid())
            and workspace_member.status = 'active'
            and workspace_member.role in ('owner', 'admin')
        )
      )
  );
$$;

create or replace function private.learner_workspace_id(p_learner_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select family.workspace_id
  from public.learner_profiles learner
  join public.families family on family.id = learner.family_id
  where learner.id = p_learner_id
    and private.can_access_learner(learner.id);
$$;

revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.is_workspace_admin(uuid) from public, anon;
revoke all on function private.can_read_family(uuid) from public, anon;
revoke all on function private.can_access_learner(uuid) from public, anon;
revoke all on function private.learner_workspace_id(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.is_workspace_admin(uuid) to authenticated;
grant execute on function private.can_read_family(uuid) to authenticated;
grant execute on function private.can_access_learner(uuid) to authenticated;
grant execute on function private.learner_workspace_id(uuid) to authenticated;

-- 新基础表 RLS。
alter table public.learning_workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.workspace_audit_events enable row level security;

create policy "members read workspaces" on public.learning_workspaces for select to authenticated
using (private.is_workspace_member(id));
create policy "owners update workspaces" on public.learning_workspaces for update to authenticated
using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));

create policy "self or admins read workspace members" on public.workspace_members for select to authenticated
using (user_id = (select auth.uid()) or private.is_workspace_admin(workspace_id));
create policy "owners manage workspace members" on public.workspace_members for all to authenticated
using (exists (select 1 from public.learning_workspaces workspace where workspace.id = workspace_id and workspace.owner_user_id = (select auth.uid())))
with check (exists (select 1 from public.learning_workspaces workspace where workspace.id = workspace_id and workspace.owner_user_id = (select auth.uid())));

create policy "family members or admins read families" on public.families for select to authenticated
using (private.can_read_family(id));
create policy "admins manage families" on public.families for all to authenticated
using (private.is_workspace_admin(workspace_id)) with check (private.is_workspace_admin(workspace_id));

create policy "self or admins read family members" on public.family_members for select to authenticated
using (private.can_read_family(family_id));
create policy "admins manage family members" on public.family_members for all to authenticated
using (exists (select 1 from public.families family where family.id = family_members.family_id and private.is_workspace_admin(family.workspace_id)))
with check (exists (select 1 from public.families family where family.id = family_members.family_id and private.is_workspace_admin(family.workspace_id)));

create policy "admins read invitations" on public.workspace_invitations for select to authenticated
using (private.is_workspace_admin(workspace_id));
create policy "admins create invitations" on public.workspace_invitations for insert to authenticated
with check (private.is_workspace_admin(workspace_id) and created_by = (select auth.uid()));
create policy "admins update invitations" on public.workspace_invitations for update to authenticated
using (private.is_workspace_admin(workspace_id)) with check (private.is_workspace_admin(workspace_id));

create policy "admins read audit" on public.workspace_audit_events for select to authenticated
using (private.is_workspace_admin(workspace_id));
create policy "admins append audit" on public.workspace_audit_events for insert to authenticated
with check (private.is_workspace_admin(workspace_id) and actor_user_id = (select auth.uid()));

revoke all on public.learning_workspaces, public.workspace_members, public.families,
  public.family_members, public.workspace_invitations, public.workspace_audit_events from public, anon;
grant select, update on public.learning_workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members, public.families, public.family_members to authenticated;
grant select, insert, update on public.workspace_invitations to authenticated;
grant select, insert on public.workspace_audit_events to authenticated;

-- learner_profiles 改为家庭/管理员授权；parent_user_id 继续兼容原家长。
drop policy if exists "parent reads learners" on public.learner_profiles;
drop policy if exists "parent writes learners" on public.learner_profiles;
create policy "family or admin reads learners" on public.learner_profiles for select to authenticated
using (private.can_access_learner(id));
create policy "family creates learners" on public.learner_profiles for insert to authenticated
with check (
  parent_user_id = (select auth.uid()) and exists (
    select 1 from public.family_members family_member
    where family_member.family_id = learner_profiles.family_id
      and family_member.user_id = (select auth.uid())
      and family_member.status = 'active'
  )
);
create policy "family or admin updates learners" on public.learner_profiles for update to authenticated
using (private.can_access_learner(id)) with check (private.can_access_learner(id));
create policy "primary parent deletes learners" on public.learner_profiles for delete to authenticated
using (parent_user_id = (select auth.uid()));

-- 学习事实增加家庭成员/管理员读取能力。写入仍优先经过既有受限 RPC。
create policy "workspace reads learning states" on public.learning_states for select to authenticated
using (private.can_access_learner(learner_id));
create policy "workspace reads daily sessions" on public.daily_sessions for select to authenticated
using (private.can_access_learner(learner_id));
create policy "workspace reads session items" on public.daily_session_items for select to authenticated
using (exists (select 1 from public.daily_sessions session where session.id = session_id and private.can_access_learner(session.learner_id)));
create policy "workspace reads learning attempts" on public.learning_attempts for select to authenticated
using (private.can_access_learner(learner_id));
create policy "workspace reads daily progress" on public.daily_character_progress for select to authenticated
using (private.can_access_learner(learner_id));
create policy "workspace reads character priorities" on public.learner_character_priorities for select to authenticated
using (private.can_access_learner(learner_id));

-- 共享资源：成员可读已批准内容或自己的待审内容；只有管理员可以批准/归档共享内容。
drop policy if exists "package owner reads" on public.content_packages;
drop policy if exists "package owner writes" on public.content_packages;
create policy "workspace reads packages" on public.content_packages for select to authenticated
using (private.is_workspace_member(workspace_id) and (review_status = 'approved' or created_by = (select auth.uid()) or private.is_workspace_admin(workspace_id)));
create policy "members create package submissions" on public.content_packages for insert to authenticated
with check (
  private.is_workspace_member(workspace_id) and created_by = (select auth.uid()) and
  (private.is_workspace_admin(workspace_id) or (status = 'draft' and review_status in ('draft', 'pending_review')))
);
create policy "admins or authors update packages" on public.content_packages for update to authenticated
using (
  private.is_workspace_admin(workspace_id) or (
    created_by = (select auth.uid())
    and status = 'draft'
    and review_status in ('draft', 'pending_review', 'rejected')
  )
)
with check (
  private.is_workspace_admin(workspace_id) or
  (created_by = (select auth.uid()) and status = 'draft' and review_status in ('draft', 'pending_review'))
);
create policy "admins delete packages" on public.content_packages for delete to authenticated
using (private.is_workspace_admin(workspace_id));

drop policy if exists "character owner reads" on public.characters;
drop policy if exists "character owner writes" on public.characters;
create policy "workspace reads characters" on public.characters for select to authenticated
using (
  private.is_workspace_member(workspace_id) and (
    created_by = (select auth.uid()) or private.is_workspace_admin(workspace_id) or exists (
      select 1 from public.package_characters package_character
      join public.content_packages package on package.id = package_character.package_id
      where package_character.character_id = characters.id
        and package.status = 'published' and package.review_status = 'approved'
    )
  )
);
create policy "members create characters" on public.characters for insert to authenticated
with check (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()));
create policy "admins or authors update characters" on public.characters for update to authenticated
using (private.is_workspace_admin(workspace_id) or created_by = (select auth.uid()))
with check (
  private.is_workspace_admin(workspace_id) or (
    created_by = (select auth.uid()) and not exists (
      select 1 from public.package_characters package_character
      join public.content_packages package on package.id = package_character.package_id
      where package_character.character_id = characters.id
        and package.status = 'published' and package.review_status = 'approved'
    )
  )
);
create policy "admins delete characters" on public.characters for delete to authenticated
using (private.is_workspace_admin(workspace_id));

drop policy if exists "package character owner reads" on public.package_characters;
drop policy if exists "package character owner writes" on public.package_characters;
create policy "workspace reads package characters" on public.package_characters for select to authenticated
using (exists (
  select 1 from public.content_packages package
  where package.id = package_characters.package_id
    and private.is_workspace_member(package.workspace_id)
    and (package.review_status = 'approved' or package.created_by = (select auth.uid()) or private.is_workspace_admin(package.workspace_id))
));
create policy "admins or submitting authors manage package characters" on public.package_characters for all to authenticated
using (exists (
  select 1 from public.content_packages package
  where package.id = package_characters.package_id and (
    private.is_workspace_admin(package.workspace_id) or
    (package.created_by = (select auth.uid()) and package.status = 'draft' and package.review_status in ('draft', 'pending_review'))
  )
))
with check (exists (
  select 1 from public.content_packages package
  join public.characters character on character.id = package_characters.character_id and character.workspace_id = package.workspace_id
  where package.id = package_characters.package_id and (
    private.is_workspace_admin(package.workspace_id) or
    (package.created_by = (select auth.uid()) and package.status = 'draft' and package.review_status in ('draft', 'pending_review'))
  )
));

-- 诗词共享资源。
drop policy if exists "poem collection owner reads" on public.poem_collections;
drop policy if exists "poem collection owner writes" on public.poem_collections;
create policy "workspace reads poem collections" on public.poem_collections for select to authenticated
using (private.is_workspace_member(workspace_id) and (review_status = 'approved' or created_by = (select auth.uid()) or private.is_workspace_admin(workspace_id)));
create policy "members create poem submissions" on public.poem_collections for insert to authenticated
with check (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()) and (private.is_workspace_admin(workspace_id) or (status = 'draft' and review_status in ('draft', 'pending_review'))));
create policy "admins or authors update poem collections" on public.poem_collections for update to authenticated
using (private.is_workspace_admin(workspace_id) or (created_by = (select auth.uid()) and status = 'draft' and review_status in ('draft', 'pending_review', 'rejected')))
with check (private.is_workspace_admin(workspace_id) or (created_by = (select auth.uid()) and status = 'draft' and review_status in ('draft', 'pending_review')));
create policy "admins delete poem collections" on public.poem_collections for delete to authenticated using (private.is_workspace_admin(workspace_id));

drop policy if exists "poem owner reads" on public.poems;
drop policy if exists "poem owner writes" on public.poems;
create policy "workspace reads poems" on public.poems for select to authenticated using (
  private.is_workspace_member(workspace_id) and (
    created_by = (select auth.uid()) or private.is_workspace_admin(workspace_id) or exists (
      select 1 from public.poem_collection_items collection_item
      join public.poem_collections collection on collection.id = collection_item.collection_id
      where collection_item.poem_id = poems.id
        and collection.status = 'published' and collection.review_status = 'approved'
    )
  )
);
create policy "members create poems" on public.poems for insert to authenticated
with check (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()));
create policy "admins or authors update poems" on public.poems for update to authenticated
using (private.is_workspace_admin(workspace_id) or created_by = (select auth.uid()))
with check (
  private.is_workspace_admin(workspace_id) or (
    created_by = (select auth.uid()) and not exists (
      select 1 from public.poem_collection_items collection_item
      join public.poem_collections collection on collection.id = collection_item.collection_id
      where collection_item.poem_id = poems.id
        and collection.status = 'published' and collection.review_status = 'approved'
    )
  )
);

drop policy if exists "poem collection item owner reads" on public.poem_collection_items;
drop policy if exists "poem collection item owner writes" on public.poem_collection_items;
create policy "workspace reads poem collection items" on public.poem_collection_items for select to authenticated
using (exists (
  select 1 from public.poem_collections collection
  where collection.id = poem_collection_items.collection_id
    and private.is_workspace_member(collection.workspace_id)
    and (collection.review_status = 'approved' or collection.created_by = (select auth.uid()) or private.is_workspace_admin(collection.workspace_id))
));
create policy "admins or authors manage poem collection items" on public.poem_collection_items for all to authenticated
using (exists (select 1 from public.poem_collections collection where collection.id = poem_collection_items.collection_id and (private.is_workspace_admin(collection.workspace_id) or (collection.created_by = (select auth.uid()) and collection.status = 'draft' and collection.review_status in ('draft', 'pending_review')))))
with check (exists (select 1 from public.poem_collections collection join public.poems poem on poem.id = poem_collection_items.poem_id and poem.workspace_id = collection.workspace_id where collection.id = poem_collection_items.collection_id and (private.is_workspace_admin(collection.workspace_id) or (collection.created_by = (select auth.uid()) and collection.status = 'draft' and collection.review_status in ('draft', 'pending_review')))));

-- 音乐共享资源。
drop policy if exists "music owner reads items" on public.music_items;
drop policy if exists "music owner writes items" on public.music_items;
create policy "workspace reads music items" on public.music_items for select to authenticated
using (private.is_workspace_member(workspace_id) and (review_status = 'approved' or created_by = (select auth.uid()) or private.is_workspace_admin(workspace_id)));
create policy "members create music submissions" on public.music_items for insert to authenticated
with check (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()) and (private.is_workspace_admin(workspace_id) or (status = 'draft' and review_status in ('draft', 'pending_review'))));
create policy "admins or authors update music" on public.music_items for update to authenticated
using (private.is_workspace_admin(workspace_id) or (created_by = (select auth.uid()) and status = 'draft' and review_status in ('draft', 'pending_review', 'rejected')))
with check (private.is_workspace_admin(workspace_id) or (created_by = (select auth.uid()) and status = 'draft' and review_status in ('draft', 'pending_review')));
create policy "admins delete music" on public.music_items for delete to authenticated using (private.is_workspace_admin(workspace_id));
create policy "authors delete unapproved music" on public.music_items for delete to authenticated
using (created_by = (select auth.uid()) and status = 'draft' and review_status in ('draft', 'pending_review', 'rejected'));

drop policy if exists "music owner reads assets" on public.music_assets;
drop policy if exists "music owner writes assets" on public.music_assets;
create policy "workspace reads music assets" on public.music_assets for select to authenticated
using (exists (
  select 1 from public.music_items item
  where item.id = music_assets.item_id
    and private.is_workspace_member(item.workspace_id)
    and (item.review_status = 'approved' or item.created_by = (select auth.uid()) or private.is_workspace_admin(item.workspace_id))
));
create policy "admins or authors manage music assets" on public.music_assets for all to authenticated
using (exists (select 1 from public.music_items item where item.id = music_assets.item_id and (private.is_workspace_admin(item.workspace_id) or (item.created_by = (select auth.uid()) and item.status = 'draft' and item.review_status in ('draft', 'pending_review')))))
with check (exists (select 1 from public.music_items item where item.id = music_assets.item_id and (private.is_workspace_admin(item.workspace_id) or (item.created_by = (select auth.uid()) and item.status = 'draft' and item.review_status in ('draft', 'pending_review')))));

-- 要理问答共享资源。
drop policy if exists "catechism collection owner reads" on public.catechism_collections;
drop policy if exists "catechism collection owner writes" on public.catechism_collections;
create policy "workspace reads catechism collections" on public.catechism_collections for select to authenticated
using (private.is_workspace_member(workspace_id) and (review_status = 'approved' or created_by = (select auth.uid()) or private.is_workspace_admin(workspace_id)));
create policy "members create catechism submissions" on public.catechism_collections for insert to authenticated
with check (private.is_workspace_member(workspace_id) and created_by = (select auth.uid()) and (private.is_workspace_admin(workspace_id) or (status = 'draft' and review_status in ('draft', 'pending_review'))));
create policy "admins or authors update catechism collections" on public.catechism_collections for update to authenticated
using (private.is_workspace_admin(workspace_id) or (created_by = (select auth.uid()) and status = 'draft' and review_status in ('draft', 'pending_review', 'rejected')))
with check (private.is_workspace_admin(workspace_id) or (created_by = (select auth.uid()) and status = 'draft' and review_status in ('draft', 'pending_review')));
create policy "admins delete catechism collections" on public.catechism_collections for delete to authenticated using (private.is_workspace_admin(workspace_id));

drop policy if exists "catechism item owner reads" on public.catechism_items;
drop policy if exists "catechism item owner writes" on public.catechism_items;
create policy "workspace reads catechism items" on public.catechism_items for select to authenticated
using (exists (
  select 1 from public.catechism_collections collection
  where collection.id = catechism_items.collection_id
    and private.is_workspace_member(collection.workspace_id)
    and (collection.review_status = 'approved' or collection.created_by = (select auth.uid()) or private.is_workspace_admin(collection.workspace_id))
));
create policy "admins or authors manage catechism items" on public.catechism_items for all to authenticated
using (exists (select 1 from public.catechism_collections collection where collection.id = catechism_items.collection_id and (private.is_workspace_admin(collection.workspace_id) or (collection.created_by = (select auth.uid()) and collection.status = 'draft' and collection.review_status in ('draft', 'pending_review')))))
with check (exists (select 1 from public.catechism_collections collection where collection.id = catechism_items.collection_id and (private.is_workspace_admin(collection.workspace_id) or (collection.created_by = (select auth.uid()) and collection.status = 'draft' and collection.review_status in ('draft', 'pending_review')))));

-- 分配只能由管理员改变；家长和管理员都能读取自己有权查看的孩子分配。
drop policy if exists "parent reads learner packages" on public.learner_content_packages;
drop policy if exists "parent writes learner packages" on public.learner_content_packages;
create policy "learner access reads package assignments" on public.learner_content_packages for select to authenticated
using (private.can_access_learner(learner_id));
create policy "admins manage package assignments" on public.learner_content_packages for all to authenticated
using (private.is_workspace_admin(private.learner_workspace_id(learner_id)))
with check (
  private.is_workspace_admin(private.learner_workspace_id(learner_id)) and (
    assignment_status = 'inactive' or exists (
    select 1 from public.content_packages package
    where package.id = learner_content_packages.package_id
      and package.workspace_id = private.learner_workspace_id(learner_id)
      and package.review_status = 'approved'
      and package.status = 'published'
  ))
);

drop policy if exists "parent reads learner poem collections" on public.learner_poem_collections;
drop policy if exists "parent writes learner poem collections" on public.learner_poem_collections;
create policy "learner access reads poem assignments" on public.learner_poem_collections for select to authenticated
using (private.can_access_learner(learner_id));
create policy "admins manage poem assignments" on public.learner_poem_collections for all to authenticated
using (private.is_workspace_admin(private.learner_workspace_id(learner_id)))
with check (private.is_workspace_admin(private.learner_workspace_id(learner_id)) and (assignment_status = 'inactive' or exists (select 1 from public.poem_collections collection where collection.id = learner_poem_collections.collection_id and collection.workspace_id = private.learner_workspace_id(learner_id) and collection.review_status = 'approved' and collection.status = 'published')));

drop policy if exists "parent reads learner music" on public.learner_music_items;
drop policy if exists "parent writes learner music" on public.learner_music_items;
create policy "learner access reads music assignments" on public.learner_music_items for select to authenticated
using (private.can_access_learner(learner_id));
create policy "admins manage music assignments" on public.learner_music_items for all to authenticated
using (private.is_workspace_admin(private.learner_workspace_id(learner_id)))
with check (private.is_workspace_admin(private.learner_workspace_id(learner_id)) and (assignment_status = 'inactive' or exists (select 1 from public.music_items item where item.id = learner_music_items.item_id and item.workspace_id = private.learner_workspace_id(learner_id) and item.review_status = 'approved' and item.status = 'published')));

drop policy if exists "parent reads learner catechism collections" on public.learner_catechism_collections;
drop policy if exists "parent writes learner catechism collections" on public.learner_catechism_collections;
create policy "learner access reads catechism assignments" on public.learner_catechism_collections for select to authenticated
using (private.can_access_learner(learner_id));
create policy "admins manage catechism assignments" on public.learner_catechism_collections for all to authenticated
using (private.is_workspace_admin(private.learner_workspace_id(learner_id)))
with check (private.is_workspace_admin(private.learner_workspace_id(learner_id)) and (assignment_status = 'inactive' or exists (select 1 from public.catechism_collections collection where collection.id = learner_catechism_collections.collection_id and collection.workspace_id = private.learner_workspace_id(learner_id) and collection.review_status = 'approved' and collection.status = 'published')));

-- 共享内容下的孩子历史允许所属家庭与管理员读取；写入仍受 RPC/真实分配校验。
create policy "workspace reads poem attempts" on public.poem_recitation_attempts for select to authenticated
using (private.can_access_learner(learner_id));
create policy "workspace reads music states" on public.music_learning_states for select to authenticated
using (private.can_access_learner(learner_id));
create policy "workspace reads music attempts" on public.music_practice_attempts for select to authenticated
using (private.can_access_learner(learner_id));
create policy "workspace reads catechism states" on public.catechism_learning_states for select to authenticated
using (private.can_access_learner(learner_id));
create policy "workspace reads catechism attempts" on public.catechism_attempts for select to authenticated
using (private.can_access_learner(learner_id));

-- 第二家庭可对管理员分配的共享诗词打卡。
drop policy if exists "parent writes poem recitation attempts" on public.poem_recitation_attempts;
create policy "family records assigned poem attempts" on public.poem_recitation_attempts for insert to authenticated
with check (
  private.can_access_learner(learner_id)
  and (recorded_by is null or recorded_by = (select auth.uid()))
  and exists (
    select 1
    from public.learner_poem_collections assignment
    join public.poem_collection_items collection_item on collection_item.collection_id = assignment.collection_id
    join public.poem_collections collection on collection.id = assignment.collection_id
    where assignment.learner_id = poem_recitation_attempts.learner_id
      and assignment.assignment_status = 'active'
      and collection_item.poem_id = poem_recitation_attempts.poem_id
      and collection.status = 'published'
      and collection.review_status = 'approved'
  )
);

-- 登录后的受邀家长用一次性 token 加入空间；token 明文不存数据库。
create or replace function public.accept_workspace_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_email text;
  v_invitation public.workspace_invitations%rowtype;
  v_family_id uuid;
begin
  if v_user_id is null then
    raise exception '请先登录或注册家长账号' using errcode = '42501';
  end if;
  if p_token is null or char_length(p_token) < 20 or char_length(p_token) > 200 then
    raise exception '邀请链接无效' using errcode = '22023';
  end if;

  select lower(user_record.email) into v_email
  from auth.users user_record
  where user_record.id = v_user_id;

  select invitation.* into v_invitation
  from public.workspace_invitations invitation
  where invitation.token_hash = encode(digest(p_token, 'sha256'), 'hex')
  for update;

  if not found or v_invitation.status <> 'pending' then
    raise exception '邀请不存在、已使用或已撤销' using errcode = '22023';
  end if;
  if v_invitation.expires_at <= now() then
    raise exception '邀请已经过期，请联系管理员重新生成' using errcode = '22023';
  end if;
  if lower(v_invitation.invited_email) <> v_email then
    raise exception '请使用收到邀请的邮箱登录' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.workspace_members member
    where member.user_id = v_user_id and member.status = 'active'
  ) then
    raise exception '当前账号已加入学习空间；当前版本请使用一个尚未加入其他空间的家长账号' using errcode = '22023';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (v_invitation.workspace_id, v_user_id, 'parent', 'active')
  on conflict (workspace_id, user_id) do update set role = 'parent', status = 'active';

  insert into public.families (workspace_id, name)
  values (v_invitation.workspace_id, v_invitation.family_name)
  returning id into v_family_id;

  insert into public.family_members (family_id, user_id, role, status)
  values (v_family_id, v_user_id, 'parent', 'active');

  update public.workspace_invitations
  set status = 'accepted', accepted_by = v_user_id, accepted_at = now()
  where id = v_invitation.id;

  insert into public.workspace_audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, details)
  values (v_invitation.workspace_id, v_user_id, 'invitation.accepted', 'family', v_family_id, jsonb_build_object('email', v_email));

  return jsonb_build_object('workspace_id', v_invitation.workspace_id, 'family_id', v_family_id, 'accepted', true);
end;
$$;

revoke execute on function public.accept_workspace_invitation(text) from public, anon;
grant execute on function public.accept_workspace_invitation(text) to authenticated;

-- 新增 public 表显式授权，兼容 Supabase 2026 年后的 Data API 暴露设置。
grant select, insert, update, delete on public.content_packages, public.characters, public.package_characters,
  public.learner_profiles, public.learner_content_packages, public.poem_collections, public.poems,
  public.poem_collection_items, public.learner_poem_collections, public.music_items, public.music_assets,
  public.learner_music_items, public.catechism_collections, public.catechism_items,
  public.learner_catechism_collections to authenticated;

-- 家庭归属和主家长是不可由客户端改写的身份字段。
revoke update on public.learner_profiles from authenticated;
grant update (
  display_name, daily_new_limit, timezone, active_package_id, updated_at,
  catechism_daily_new_limit, catechism_review_limit,
  hanzi_review_mode, hanzi_base_review_limit, hanzi_max_review_limit
) on public.learner_profiles to authenticated;

commit;
