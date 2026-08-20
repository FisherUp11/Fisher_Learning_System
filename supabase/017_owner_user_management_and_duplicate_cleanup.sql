-- 字芽：owner 用户/家庭管理、首次改密与重复资源安全合并。
-- 前置：已经按顺序运行 001–016。
-- 本迁移不会删除现有用户、孩子或学习历史；永久删除只会在 owner 主动调用合并 RPC 时发生。

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_workspace_owner(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.learning_workspaces workspace
    where workspace.id = p_workspace_id
      and workspace.owner_user_id = (select auth.uid())
      and workspace.status = 'active'
  );
$$;
revoke all on function private.is_workspace_owner(uuid) from public, anon;
grant execute on function private.is_workspace_owner(uuid) to authenticated;

create table if not exists public.workspace_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.learning_workspaces(id) on delete cascade,
  display_name text not null default '家庭账号' check (char_length(display_name) between 1 and 80),
  must_change_password boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  password_reset_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade
);

create index if not exists workspace_user_profiles_workspace_idx
  on public.workspace_user_profiles (workspace_id, created_at);

insert into public.workspace_user_profiles (user_id, workspace_id, display_name, created_by)
select member.user_id, member.workspace_id,
  case when member.role = 'owner' then '空间所有者' when member.role = 'admin' then '管理员' else '家长' end,
  workspace.owner_user_id
from public.workspace_members member
join public.learning_workspaces workspace on workspace.id = member.workspace_id
on conflict (user_id) do nothing;

alter table public.workspace_user_profiles enable row level security;
drop policy if exists "self or owner reads user profiles" on public.workspace_user_profiles;
drop policy if exists "owner manages user profiles" on public.workspace_user_profiles;
create policy "self or owner reads user profiles" on public.workspace_user_profiles
for select to authenticated
using (user_id = (select auth.uid()) or private.is_workspace_owner(workspace_id));
create policy "owner manages user profiles" on public.workspace_user_profiles
for all to authenticated
using (private.is_workspace_owner(workspace_id))
with check (private.is_workspace_owner(workspace_id));

revoke all on public.workspace_user_profiles from public, anon;
grant select, insert, update, delete on public.workspace_user_profiles to authenticated;

-- 成员目录和邀请属于 owner 专属功能；admin 的审核/分配能力保持不变。
drop policy if exists "self or admins read workspace members" on public.workspace_members;
drop policy if exists "self or owner reads workspace members" on public.workspace_members;
create policy "self or owner reads workspace members" on public.workspace_members
for select to authenticated
using (user_id = (select auth.uid()) or private.is_workspace_owner(workspace_id));

drop policy if exists "admins read invitations" on public.workspace_invitations;
drop policy if exists "admins create invitations" on public.workspace_invitations;
drop policy if exists "admins update invitations" on public.workspace_invitations;
drop policy if exists "owners read invitations" on public.workspace_invitations;
drop policy if exists "owners create invitations" on public.workspace_invitations;
drop policy if exists "owners update invitations" on public.workspace_invitations;
create policy "owners read invitations" on public.workspace_invitations for select to authenticated
using (private.is_workspace_owner(workspace_id));
create policy "owners create invitations" on public.workspace_invitations for insert to authenticated
with check (private.is_workspace_owner(workspace_id) and created_by = (select auth.uid()));
create policy "owners update invitations" on public.workspace_invitations for update to authenticated
using (private.is_workspace_owner(workspace_id))
with check (private.is_workspace_owner(workspace_id));

create or replace function public.complete_initial_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception '请先登录'; end if;
  update public.workspace_user_profiles
  set must_change_password = false, password_reset_at = now(), updated_at = now()
  where user_id = (select auth.uid());
end;
$$;
revoke all on function public.complete_initial_password_change() from public, anon;
grant execute on function public.complete_initial_password_change() to authenticated;

-- 邀请已有 Supabase 账号加入时，同时补齐用户目录资料。
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
  if v_user_id is null then raise exception '请先登录或注册家长账号' using errcode = '42501'; end if;
  if p_token is null or char_length(p_token) < 20 or char_length(p_token) > 200 then
    raise exception '邀请链接无效' using errcode = '22023';
  end if;
  select lower(user_record.email) into v_email from auth.users user_record where user_record.id = v_user_id;
  select invitation.* into v_invitation
  from public.workspace_invitations invitation
  where invitation.token_hash = encode(digest(p_token, 'sha256'), 'hex')
  for update;
  if not found or v_invitation.status <> 'pending' then raise exception '邀请不存在、已使用或已撤销' using errcode = '22023'; end if;
  if v_invitation.expires_at <= now() then raise exception '邀请已经过期，请联系 owner 重新生成' using errcode = '22023'; end if;
  if lower(v_invitation.invited_email) <> v_email then raise exception '请使用收到邀请的邮箱登录' using errcode = '42501'; end if;
  if exists (select 1 from public.workspace_members member where member.user_id = v_user_id and member.status = 'active') then
    raise exception '当前账号已加入学习空间；当前版本一个账号只能加入一个空间' using errcode = '22023';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (v_invitation.workspace_id, v_user_id, 'parent', 'active')
  on conflict (workspace_id, user_id) do update set role = 'parent', status = 'active';
  insert into public.families (workspace_id, name)
  values (v_invitation.workspace_id, v_invitation.family_name)
  returning id into v_family_id;
  insert into public.family_members (family_id, user_id, role, status)
  values (v_family_id, v_user_id, 'parent', 'active');
  insert into public.workspace_user_profiles (user_id, workspace_id, display_name, must_change_password, created_by)
  values (v_user_id, v_invitation.workspace_id, coalesce(nullif(split_part(v_email, '@', 1), ''), '家长'), false, v_invitation.created_by)
  on conflict (user_id) do update set workspace_id = excluded.workspace_id, display_name = excluded.display_name, updated_at = now();
  update public.workspace_invitations
  set status = 'accepted', accepted_by = v_user_id, accepted_at = now()
  where id = v_invitation.id;
  insert into public.workspace_audit_events (workspace_id, actor_user_id, event_type, entity_type, entity_id, details)
  values (v_invitation.workspace_id, v_user_id, 'invitation.accepted', 'family', v_family_id, jsonb_build_object('email', v_email));
  return jsonb_build_object('workspace_id', v_invitation.workspace_id, 'family_id', v_family_id, 'accepted', true);
end;
$$;
revoke all on function public.accept_workspace_invitation(text) from public, anon;
grant execute on function public.accept_workspace_invitation(text) to authenticated;

create or replace function public.owner_provision_workspace_user(
  p_workspace_id uuid,
  p_user_id uuid,
  p_display_name text,
  p_role text,
  p_family_id uuid default null,
  p_new_family_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid := p_family_id;
begin
  if not private.is_workspace_owner(p_workspace_id) then raise exception '只有空间所有者可以创建账号'; end if;
  if p_role not in ('admin', 'parent') then raise exception '账号角色只能是管理员或家长'; end if;
  if nullif(btrim(p_display_name), '') is null then raise exception '请填写账号称呼'; end if;
  if exists (select 1 from public.workspace_members where user_id = p_user_id) then raise exception '这个账号已经加入学习空间'; end if;

  if p_role = 'parent' then
    if v_family_id is null then
      if nullif(btrim(p_new_family_name), '') is null then raise exception '家长账号必须选择或创建家庭'; end if;
      insert into public.families (workspace_id, name)
      values (p_workspace_id, left(btrim(p_new_family_name), 80))
      returning id into v_family_id;
    elsif not exists (
      select 1 from public.families where id = v_family_id and workspace_id = p_workspace_id and status = 'active'
    ) then
      raise exception '所选家庭不存在或已归档';
    end if;
  else
    v_family_id := null;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (p_workspace_id, p_user_id, p_role, 'active');

  if v_family_id is not null then
    insert into public.family_members (family_id, user_id, role, status)
    values (v_family_id, p_user_id, 'parent', 'active');
  end if;

  insert into public.workspace_user_profiles (
    user_id, workspace_id, display_name, must_change_password, created_by, password_reset_at
  ) values (
    p_user_id, p_workspace_id, left(btrim(p_display_name), 80), true, (select auth.uid()), now()
  );

  insert into public.workspace_audit_events (
    workspace_id, actor_user_id, event_type, entity_type, entity_id, details
  ) values (
    p_workspace_id, (select auth.uid()), 'user.provisioned', 'workspace_user', p_user_id,
    jsonb_build_object('role', p_role, 'family_id', v_family_id)
  );
  return v_family_id;
end;
$$;
revoke all on function public.owner_provision_workspace_user(uuid, uuid, text, text, uuid, text) from public, anon;
grant execute on function public.owner_provision_workspace_user(uuid, uuid, text, text, uuid, text) to authenticated;

create or replace function public.owner_update_workspace_user(
  p_workspace_id uuid,
  p_user_id uuid,
  p_display_name text,
  p_role text,
  p_status text,
  p_family_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_workspace_owner(p_workspace_id) then raise exception '只有空间所有者可以修改账号'; end if;
  if p_user_id = (select auth.uid()) then raise exception '不能在这里修改空间所有者自己的角色或状态'; end if;
  if p_role not in ('admin', 'parent') then raise exception '账号角色只能是管理员或家长'; end if;
  if p_status not in ('active', 'suspended') then raise exception '账号状态不正确'; end if;
  if nullif(btrim(p_display_name), '') is null then raise exception '请填写账号称呼'; end if;
  if not exists (select 1 from public.workspace_members where workspace_id = p_workspace_id and user_id = p_user_id) then
    raise exception '找不到这个空间账号';
  end if;
  if p_role = 'parent' and not exists (
    select 1 from public.families where id = p_family_id and workspace_id = p_workspace_id and status = 'active'
  ) then
    raise exception '家长账号必须选择一个正常家庭';
  end if;

  update public.workspace_members
  set role = p_role, status = p_status
  where workspace_id = p_workspace_id and user_id = p_user_id;

  delete from public.family_members family_member
  using public.families family
  where family_member.family_id = family.id
    and family.workspace_id = p_workspace_id
    and family_member.user_id = p_user_id;

  if p_role = 'parent' then
    insert into public.family_members (family_id, user_id, role, status)
    values (p_family_id, p_user_id, 'parent', p_status);
  end if;

  insert into public.workspace_user_profiles (user_id, workspace_id, display_name, must_change_password, created_by)
  values (p_user_id, p_workspace_id, left(btrim(p_display_name), 80), false, (select auth.uid()))
  on conflict (user_id) do update
  set display_name = excluded.display_name, updated_at = now();

  insert into public.workspace_audit_events (
    workspace_id, actor_user_id, event_type, entity_type, entity_id, details
  ) values (
    p_workspace_id, (select auth.uid()), 'user.updated', 'workspace_user', p_user_id,
    jsonb_build_object('role', p_role, 'status', p_status, 'family_id', p_family_id)
  );
end;
$$;
revoke all on function public.owner_update_workspace_user(uuid, uuid, text, text, text, uuid) from public, anon;
grant execute on function public.owner_update_workspace_user(uuid, uuid, text, text, text, uuid) to authenticated;

-- 兼容过去没有指纹的旧资源。指纹只按实际内容生成，不凭标题猜测重复。
update public.content_packages package_row
set fingerprint = fingerprints.value
from (
  select package_character.package_id,
    encode(digest(string_agg(concat_ws('|', character_row.character, character_row.pinyin_marked, character_row.meaning,
      coalesce(character_row.word_one, ''), coalesce(character_row.word_two, ''), coalesce(character_row.example_sentence, ''), package_character.sequence::text),
      E'\n' order by package_character.sequence), 'sha256'), 'hex') as value
  from public.package_characters package_character
  join public.characters character_row on character_row.id = package_character.character_id
  group by package_character.package_id
) fingerprints
where package_row.id = fingerprints.package_id;

update public.poem_collections collection_row
set fingerprint = fingerprints.value
from (
  select collection_item.collection_id,
    encode(digest(string_agg(concat_ws('|', poem.poem_key, poem.title, poem.author, coalesce(poem.dynasty, ''), poem.content, collection_item.sequence::text),
      E'\n' order by collection_item.sequence), 'sha256'), 'hex') as value
  from public.poem_collection_items collection_item
  join public.poems poem on poem.id = collection_item.poem_id
  group by collection_item.collection_id
) fingerprints
where collection_row.id = fingerprints.collection_id;

update public.catechism_collections collection_row
set fingerprint = fingerprints.value
from (
  select item.collection_id,
    encode(digest(string_agg(concat_ws('|', item.item_key, item.sort_order::text, coalesce(item.section_title, ''), item.question_zh, item.answer_zh,
      item.question_en, item.answer_en, coalesce(item.scripture_reference, ''), coalesce(item.parent_note, '')),
      E'\n' order by item.sort_order), 'sha256'), 'hex') as value
  from public.catechism_items item
  group by item.collection_id
) fingerprints
where collection_row.id = fingerprints.collection_id;

update public.music_items
set fingerprint = encode(digest(concat_ws('|', item_type, btrim(title), coalesce(btrim(category), ''),
  coalesce(btrim(description), ''), coalesce(btrim(lyrics), ''), coalesce(btrim(correct_answer), ''),
  coalesce(btrim(instructions), ''), difficulty::text), 'sha256'), 'hex');

-- 根资源永久删除改为 owner 专属。普通管理员继续拥有审核、发布、归档与分配权限。
drop policy if exists "admins delete packages" on public.content_packages;
drop policy if exists "owners delete packages" on public.content_packages;
create policy "owners delete packages" on public.content_packages for delete to authenticated
using (private.is_workspace_owner(workspace_id));
drop policy if exists "admins delete characters" on public.characters;
drop policy if exists "owners delete characters" on public.characters;
create policy "owners delete characters" on public.characters for delete to authenticated
using (private.is_workspace_owner(workspace_id));
drop policy if exists "admins delete poem collections" on public.poem_collections;
drop policy if exists "owners delete poem collections" on public.poem_collections;
create policy "owners delete poem collections" on public.poem_collections for delete to authenticated
using (private.is_workspace_owner(workspace_id));
drop policy if exists "admins delete music" on public.music_items;
drop policy if exists "owners delete music" on public.music_items;
create policy "owners delete music" on public.music_items for delete to authenticated
using (private.is_workspace_owner(workspace_id));
drop policy if exists "admins delete catechism collections" on public.catechism_collections;
drop policy if exists "owners delete catechism collections" on public.catechism_collections;
create policy "owners delete catechism collections" on public.catechism_collections for delete to authenticated
using (private.is_workspace_owner(workspace_id));

create or replace function public.owner_merge_duplicate_resource(
  p_resource_type text,
  p_keep_id uuid,
  p_remove_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_keep_fingerprint text;
  v_remove_fingerprint text;
  v_assignment_count integer := 0;
  v_history_count integer := 0;
  v_object_keys text[] := array[]::text[];
begin
  if p_keep_id = p_remove_id then raise exception '保留资源和删除资源不能相同'; end if;
  if p_resource_type not in ('hanzi', 'poem', 'music', 'catechism') then raise exception '资源类型不正确'; end if;

  if p_resource_type = 'hanzi' then
    select keep.workspace_id, keep.fingerprint, remove.fingerprint
      into v_workspace_id, v_keep_fingerprint, v_remove_fingerprint
    from public.content_packages keep
    join public.content_packages remove on remove.id = p_remove_id and remove.workspace_id = keep.workspace_id
    where keep.id = p_keep_id and keep.status = 'published' and keep.review_status = 'approved';
  elsif p_resource_type = 'poem' then
    select keep.workspace_id, keep.fingerprint, remove.fingerprint
      into v_workspace_id, v_keep_fingerprint, v_remove_fingerprint
    from public.poem_collections keep
    join public.poem_collections remove on remove.id = p_remove_id and remove.workspace_id = keep.workspace_id
    where keep.id = p_keep_id and keep.status = 'published' and keep.review_status = 'approved';
  elsif p_resource_type = 'music' then
    select keep.workspace_id, keep.fingerprint, remove.fingerprint
      into v_workspace_id, v_keep_fingerprint, v_remove_fingerprint
    from public.music_items keep
    join public.music_items remove on remove.id = p_remove_id and remove.workspace_id = keep.workspace_id
    where keep.id = p_keep_id and keep.status = 'published' and keep.review_status = 'approved';
  else
    select keep.workspace_id, keep.fingerprint, remove.fingerprint
      into v_workspace_id, v_keep_fingerprint, v_remove_fingerprint
    from public.catechism_collections keep
    join public.catechism_collections remove on remove.id = p_remove_id and remove.workspace_id = keep.workspace_id
    where keep.id = p_keep_id and keep.status = 'published' and keep.review_status = 'approved';
  end if;

  if v_workspace_id is null then raise exception '请把要保留的资源先审核通过并发布'; end if;
  if not private.is_workspace_owner(v_workspace_id) then raise exception '只有空间所有者可以永久清理重复资源'; end if;
  if v_keep_fingerprint is null or v_remove_fingerprint is null or v_keep_fingerprint <> v_remove_fingerprint then
    raise exception '两份资源内容不完全相同，不能自动合并；请改用归档';
  end if;

  if p_resource_type = 'hanzi' then
    insert into public.learner_content_packages (
      learner_id, package_id, linked_at, assigned_by, assignment_status, assignment_order, unassigned_at
    )
    select learner_id, p_keep_id, linked_at, (select auth.uid()), assignment_status, assignment_order, unassigned_at
    from public.learner_content_packages where package_id = p_remove_id
    on conflict (learner_id, package_id) do update set
      assignment_status = case when public.learner_content_packages.assignment_status = 'active' or excluded.assignment_status = 'active' then 'active' else 'inactive' end,
      assignment_order = least(public.learner_content_packages.assignment_order, excluded.assignment_order),
      unassigned_at = case when public.learner_content_packages.assignment_status = 'active' or excluded.assignment_status = 'active' then null else greatest(public.learner_content_packages.unassigned_at, excluded.unassigned_at) end,
      assigned_by = (select auth.uid());
    get diagnostics v_assignment_count = row_count;
    update public.learner_profiles set active_package_id = p_keep_id where active_package_id = p_remove_id;
    delete from public.content_packages where id = p_remove_id;

  elsif p_resource_type = 'poem' then
    insert into public.learner_poem_collections (
      learner_id, collection_id, linked_at, assigned_by, assignment_status, unassigned_at
    )
    select learner_id, p_keep_id, linked_at, (select auth.uid()), assignment_status, unassigned_at
    from public.learner_poem_collections where collection_id = p_remove_id
    on conflict (learner_id, collection_id) do update set
      assignment_status = case when public.learner_poem_collections.assignment_status = 'active' or excluded.assignment_status = 'active' then 'active' else 'inactive' end,
      unassigned_at = case when public.learner_poem_collections.assignment_status = 'active' or excluded.assignment_status = 'active' then null else greatest(public.learner_poem_collections.unassigned_at, excluded.unassigned_at) end,
      assigned_by = (select auth.uid());
    get diagnostics v_assignment_count = row_count;
    delete from public.poem_collections where id = p_remove_id;

  elsif p_resource_type = 'music' then
    if exists (
      select 1 from (
        (select asset_type, original_name, content_type, byte_size, coalesce(label, '') as label, sequence
         from public.music_assets where item_id = p_keep_id
         except
         select asset_type, original_name, content_type, byte_size, coalesce(label, '') as label, sequence
         from public.music_assets where item_id = p_remove_id)
        union all
        (select asset_type, original_name, content_type, byte_size, coalesce(label, '') as label, sequence
         from public.music_assets where item_id = p_remove_id
         except
         select asset_type, original_name, content_type, byte_size, coalesce(label, '') as label, sequence
         from public.music_assets where item_id = p_keep_id)
      ) media_differences
    ) then
      raise exception '两份音乐的媒体清单不同，不能自动合并；请人工核对后归档或删除未使用项';
    end if;
    select count(*) into v_history_count from (
      select 1 from public.music_learning_states where item_id = p_remove_id
      union all select 1 from public.music_practice_attempts where item_id = p_remove_id
    ) history;
    if v_history_count > 0 then raise exception '这份音乐已有学习历史，为保护记录只能归档，不能永久删除'; end if;
    insert into public.learner_music_items (
      learner_id, item_id, assigned_at, assigned_by, assignment_status, unassigned_at
    )
    select learner_id, p_keep_id, assigned_at, (select auth.uid()), assignment_status, unassigned_at
    from public.learner_music_items where item_id = p_remove_id
    on conflict (learner_id, item_id) do update set
      assignment_status = case when public.learner_music_items.assignment_status = 'active' or excluded.assignment_status = 'active' then 'active' else 'inactive' end,
      unassigned_at = case when public.learner_music_items.assignment_status = 'active' or excluded.assignment_status = 'active' then null else greatest(public.learner_music_items.unassigned_at, excluded.unassigned_at) end,
      assigned_by = (select auth.uid());
    get diagnostics v_assignment_count = row_count;
    select coalesce(array_agg(object_key), array[]::text[]) into v_object_keys
    from public.music_assets where item_id = p_remove_id;
    delete from public.music_items where id = p_remove_id;

  else
    select count(*) into v_history_count from (
      select 1 from public.catechism_learning_states state
      join public.catechism_items item on item.id = state.item_id
      where item.collection_id = p_remove_id
      union all
      select 1 from public.catechism_attempts attempt
      join public.catechism_items item on item.id = attempt.item_id
      where item.collection_id = p_remove_id
    ) history;
    if v_history_count > 0 then raise exception '这份问答册已有学习历史，为保护记录只能归档，不能永久删除'; end if;
    insert into public.learner_catechism_collections (
      learner_id, collection_id, linked_at, assigned_by, assignment_status, unassigned_at
    )
    select learner_id, p_keep_id, linked_at, (select auth.uid()), assignment_status, unassigned_at
    from public.learner_catechism_collections where collection_id = p_remove_id
    on conflict (learner_id, collection_id) do update set
      assignment_status = case when public.learner_catechism_collections.assignment_status = 'active' or excluded.assignment_status = 'active' then 'active' else 'inactive' end,
      unassigned_at = case when public.learner_catechism_collections.assignment_status = 'active' or excluded.assignment_status = 'active' then null else greatest(public.learner_catechism_collections.unassigned_at, excluded.unassigned_at) end,
      assigned_by = (select auth.uid());
    get diagnostics v_assignment_count = row_count;
    delete from public.catechism_collections where id = p_remove_id;
  end if;

  insert into public.workspace_audit_events (
    workspace_id, actor_user_id, event_type, entity_type, entity_id, details
  ) values (
    v_workspace_id, (select auth.uid()), 'resource.duplicate_merged', p_resource_type, p_keep_id,
    jsonb_build_object('removed_id', p_remove_id, 'assignment_rows', v_assignment_count)
  );

  return jsonb_build_object(
    'kept_id', p_keep_id,
    'removed_id', p_remove_id,
    'assignment_rows', v_assignment_count,
    'object_keys', to_jsonb(v_object_keys)
  );
end;
$$;
revoke all on function public.owner_merge_duplicate_resource(text, uuid, uuid) from public, anon;
grant execute on function public.owner_merge_duplicate_resource(text, uuid, uuid) to authenticated;

commit;

-- 运行后验证（应返回 1 位 owner；现有 owner 账号不会被改密码）：
-- select member.role, member.status, profile.display_name, profile.must_change_password
-- from public.workspace_members member
-- left join public.workspace_user_profiles profile on profile.user_id = member.user_id
-- where member.role = 'owner';
