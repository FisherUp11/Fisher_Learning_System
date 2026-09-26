-- 前置：015、017（现有项目建议先完成 001–020）。整份运行，可重跑。
-- 不创建真实账号、不删除学习记录。上线顺序：运行本文件 → 部署代码。
begin;

-- 原函数 search_path='' 时无法解析 pgcrypto.digest。用 PostgreSQL 内置 SHA256，
-- 与现有 Node SHA256 哈希完全一致，已有未过期链接继续有效。
create or replace function public.accept_workspace_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_email text;
  v_confirmed timestamptz;
  v_inv public.workspace_invitations%rowtype;
  v_family uuid;
begin
  if v_user is null then raise exception '请先登录受邀账号' using errcode='42501'; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then raise exception '邀请链接无效'; end if;
  -- 同一账号使用不同邀请并发加入时也串行，避免创建两个家庭。
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 21));
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id=v_user;
  if v_confirmed is null then raise exception '请先在邮箱完成验证，再接受邀请' using errcode='42501'; end if;
  select i.* into v_inv from public.workspace_invitations i
  where i.token_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8')),'hex') for update;
  if not found then raise exception '邀请不存在，请联系 owner 重新发送'; end if;
  if lower(v_inv.invited_email) is distinct from v_email then raise exception '请使用收到邀请的邮箱登录' using errcode='42501'; end if;
  if not exists(select 1 from public.learning_workspaces w where w.id=v_inv.workspace_id and w.status='active') then raise exception '学习空间已停用'; end if;
  if v_inv.status='accepted' and v_inv.accepted_by=v_user and exists (
    select 1 from public.workspace_members m where m.workspace_id=v_inv.workspace_id and m.user_id=v_user and m.status='active'
  ) then return jsonb_build_object('accepted',true,'already_accepted',true,'workspace_id',v_inv.workspace_id); end if;
  if v_inv.status<>'pending' then raise exception '邀请已使用或已撤销，请联系 owner'; end if;
  if v_inv.expires_at<=now() then raise exception '邀请已过期，请联系 owner 重新发送'; end if;
  if not exists(select 1 from public.learning_workspaces w join public.workspace_members m on m.workspace_id=w.id and m.user_id=w.owner_user_id
    where w.id=v_inv.workspace_id and w.owner_user_id=v_inv.created_by and m.status='active' and m.role='owner') then raise exception '邀请人权限已变更，请联系当前 owner'; end if;
  if exists(select 1 from public.workspace_members m where m.user_id=v_user) then
    raise exception '此账号已加入空间或已被停用，请联系 owner 管理已有账号；不能通过邀请覆盖权限';
  end if;
  insert into public.workspace_members(workspace_id,user_id,role,status) values(v_inv.workspace_id,v_user,'parent','active');
  insert into public.families(workspace_id,name) values(v_inv.workspace_id,v_inv.family_name) returning id into v_family;
  insert into public.family_members(family_id,user_id,role,status) values(v_family,v_user,'parent','active');
  insert into public.workspace_user_profiles(user_id,workspace_id,display_name,must_change_password,created_by)
    values(v_user,v_inv.workspace_id,left(coalesce(nullif(split_part(v_email,'@',1),''),'家长'),80),false,v_inv.created_by);
  update public.workspace_invitations set status='accepted',accepted_by=v_user,accepted_at=now() where id=v_inv.id;
  insert into public.workspace_audit_events(workspace_id,actor_user_id,event_type,entity_type,entity_id)
    values(v_inv.workspace_id,v_user,'invitation.accepted','family',v_family);
  return jsonb_build_object('accepted',true,'workspace_id',v_inv.workspace_id,'family_id',v_family);
end; $$;
revoke all on function public.accept_workspace_invitation(text) from public,anon;
grant execute on function public.accept_workspace_invitation(text) to authenticated;

-- 不保存临时密码明文。私有区仅保存 Auth 已有的加盐密码哈希快照，
-- 防止用户只调用 complete RPC 就绕过首次改密。匿名/普通客户端不可读写。
create table if not exists private.initial_password_baselines (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_password text not null
);
revoke all on private.initial_password_baselines from public,anon,authenticated;
create or replace function private.capture_initial_password()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.must_change_password then
    if tg_op='INSERT' then
      insert into private.initial_password_baselines select u.id,u.encrypted_password from auth.users u where u.id=new.user_id
      on conflict(user_id) do update set encrypted_password=excluded.encrypted_password;
    elsif not old.must_change_password or new.password_reset_at is distinct from old.password_reset_at then
      insert into private.initial_password_baselines select u.id,u.encrypted_password from auth.users u where u.id=new.user_id
      on conflict(user_id) do update set encrypted_password=excluded.encrypted_password;
    end if;
  else delete from private.initial_password_baselines where user_id=new.user_id;
  end if;
  return new;
end; $$;
revoke all on function private.capture_initial_password() from public,anon,authenticated;
drop trigger if exists capture_initial_password on public.workspace_user_profiles;
create trigger capture_initial_password after insert or update on public.workspace_user_profiles
for each row execute function private.capture_initial_password();
insert into private.initial_password_baselines
select u.id,u.encrypted_password from auth.users u join public.workspace_user_profiles p on p.user_id=u.id where p.must_change_password
on conflict(user_id) do nothing;

create or replace function public.complete_initial_password_change()
returns void language plpgsql security definer set search_path='' as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null then raise exception '请先登录'; end if;
  if exists(select 1 from public.workspace_user_profiles where user_id=v_user and must_change_password) then
    if not exists(select 1 from private.initial_password_baselines b join auth.users u on u.id=b.user_id
       where b.user_id=v_user and nullif(u.encrypted_password,'') is not null and u.encrypted_password<>b.encrypted_password) then
      raise exception '请先设置与临时密码不同的新密码';
    end if;
    update public.workspace_user_profiles set must_change_password=false,password_reset_at=now(),updated_at=now() where user_id=v_user;
  end if;
end; $$;
revoke all on function public.complete_initial_password_change() from public,anon;
grant execute on function public.complete_initial_password_change() to authenticated;

create table if not exists public.service_usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.learning_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null check(char_length(feature) between 1 and 80),
  service text not null check(service in ('text','image','tts','stt')),
  model text not null check(char_length(model) between 1 and 160),
  status text not null default 'started' check(status in ('started','success','error','unknown')),
  input_tokens bigint check(input_tokens>=0),
  output_tokens bigint check(output_tokens>=0),
  cached_input_tokens bigint check(cached_input_tokens>=0),
  characters integer not null default 0 check(characters>=0),
  images integer not null default 0 check(images>=0),
  audio_seconds numeric not null default 0 check(audio_seconds>=0),
  http_status integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists service_usage_workspace_time on public.service_usage_events(workspace_id,created_at desc);
create index if not exists service_usage_user_time on public.service_usage_events(user_id,created_at desc);
alter table public.service_usage_events enable row level security;
revoke all on public.service_usage_events from public,anon,authenticated;
grant select on public.service_usage_events to authenticated;
grant select,insert,update on public.service_usage_events to service_role;
drop policy if exists "workspace admins read usage" on public.service_usage_events;
create policy "workspace admins read usage" on public.service_usage_events for select to authenticated
using(private.is_workspace_admin(workspace_id));
-- No client INSERT/UPDATE policy: browser users cannot forge or erase metering.
create or replace function public.workspace_service_usage(p_workspace_id uuid,p_from timestamptz,p_to timestamptz)
returns table(user_id uuid,service text,model text,requests bigint,succeeded bigint,failed bigint,uncertain bigint,
  input_tokens numeric,output_tokens numeric,cached_input_tokens numeric,token_unknown bigint,characters bigint,images bigint,audio_seconds numeric)
language sql stable security invoker set search_path='' as $$
  select e.user_id,e.service,e.model,count(*),count(*) filter(where e.status='success'),
    count(*) filter(where e.status='error'),count(*) filter(where e.status in ('started','unknown')),
    sum(e.input_tokens),sum(e.output_tokens),sum(e.cached_input_tokens),
    count(*) filter(where e.service in ('text','image') and (e.input_tokens is null or e.output_tokens is null)),
    sum(e.characters),sum(e.images),sum(e.audio_seconds)
  from public.service_usage_events e
  where e.workspace_id=p_workspace_id and e.created_at>=p_from and e.created_at<p_to
    and p_to>p_from and p_to<=p_from+interval '367 days'
  group by e.user_id,e.service,e.model;
$$;
revoke all on function public.workspace_service_usage(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.workspace_service_usage(uuid,timestamptz,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
