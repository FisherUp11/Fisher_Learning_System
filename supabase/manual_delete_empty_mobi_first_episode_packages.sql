-- 一次性清理：删除 owner（xiangyufei11@gmail.com）所在学习空间中，
-- 标题完全为“新增23字（mobi-第一集）”的空汉字册。
--
-- 安全边界：
-- 1. 只允许该邮箱恰好拥有一个 active owner 学习空间，否则回滚；
-- 2. 先锁定并列出候选资源；
-- 3. 任何候选册含有汉字、仍有孩子分配，或仍被设为孩子当前字册时，全部回滚；
-- 4. 不删除 characters 表中的公共汉字，更不删除学习状态或学习尝试。
--
-- 如果“10 个”指的是该资源含有 10 个汉字，本脚本会拒绝执行，
-- 以免把并非空资源的字册误删。

-- 执行时先显示候选核对结果。所有计数均为 0 才会进入下方删除。
with owner_workspace as (
  select member.workspace_id
  from public.workspace_members member
  join auth.users auth_user on auth_user.id = member.user_id
  where lower(auth_user.email) = 'xiangyufei11@gmail.com'
    and member.role = 'owner'
    and member.status = 'active'
)
select
  package_row.id,
  package_row.title,
  package_row.status,
  package_row.review_status,
  package_row.created_at,
  count(distinct entry.character_id) as character_count,
  count(distinct assignment.learner_id) as learner_assignment_count,
  count(distinct learner.id) filter (where learner.active_package_id = package_row.id) as active_package_count
from public.content_packages package_row
join owner_workspace workspace on workspace.workspace_id = package_row.workspace_id
left join public.package_characters entry on entry.package_id = package_row.id
left join public.learner_content_packages assignment on assignment.package_id = package_row.id
left join public.learner_profiles learner on learner.active_package_id = package_row.id
where package_row.title = '新增23字（mobi-第一集）'
group by package_row.id
order by package_row.created_at;

begin;

do $$
declare
  v_workspace_ids uuid[];
  v_workspace_id uuid;
  v_target_count integer;
  v_non_empty_count integer;
  v_assignment_count integer;
  v_active_package_count integer;
  v_deleted_count integer;
begin
  select array_agg(member.workspace_id order by member.workspace_id)
    into v_workspace_ids
  from public.workspace_members member
  join auth.users auth_user on auth_user.id = member.user_id
  where lower(auth_user.email) = 'xiangyufei11@gmail.com'
    and member.role = 'owner'
    and member.status = 'active';

  if coalesce(cardinality(v_workspace_ids), 0) <> 1 then
    raise exception '未能唯一确定 xiangyufei11@gmail.com 的 owner 学习空间（找到 % 个），已取消删除', coalesce(cardinality(v_workspace_ids), 0);
  end if;
  v_workspace_id := v_workspace_ids[1];

  -- 同一事务内锁定候选，避免检查后被别的操作改动。
  perform 1
  from public.content_packages package_row
  where package_row.workspace_id = v_workspace_id
    and package_row.title = '新增23字（mobi-第一集）'
  for update;

  select
    count(*),
    count(*) filter (where exists (
      select 1 from public.package_characters entry where entry.package_id = package_row.id
    )),
    count(*) filter (where exists (
      select 1 from public.learner_content_packages assignment where assignment.package_id = package_row.id
    )),
    count(*) filter (where exists (
      select 1 from public.learner_profiles learner where learner.active_package_id = package_row.id
    ))
  into v_target_count, v_non_empty_count, v_assignment_count, v_active_package_count
  from public.content_packages package_row
  where package_row.workspace_id = v_workspace_id
    and package_row.title = '新增23字（mobi-第一集）';

  if v_target_count = 0 then
    raise exception '没有找到标题完全为“新增23字（mobi-第一集）”的资源，未删除任何内容';
  end if;
  if v_non_empty_count > 0 then
    raise exception '找到 % 份目标资源，其中 % 份含有汉字，判定不是空资源，已全部回滚', v_target_count, v_non_empty_count;
  end if;
  if v_assignment_count > 0 or v_active_package_count > 0 then
    raise exception '找到 % 份目标资源，但仍有 % 份存在孩子分配、% 份是孩子当前字册，已全部回滚', v_target_count, v_assignment_count, v_active_package_count;
  end if;

  delete from public.content_packages package_row
  where package_row.workspace_id = v_workspace_id
    and package_row.title = '新增23字（mobi-第一集）'
    and not exists (
      select 1 from public.package_characters entry where entry.package_id = package_row.id
    );
  get diagnostics v_deleted_count = row_count;

  raise notice '已删除 % 份空资源“新增23字（mobi-第一集）”。', v_deleted_count;
end;
$$;

commit;

-- 最终验证：正常应返回 0。
with owner_workspace as (
  select member.workspace_id
  from public.workspace_members member
  join auth.users auth_user on auth_user.id = member.user_id
  where lower(auth_user.email) = 'xiangyufei11@gmail.com'
    and member.role = 'owner'
    and member.status = 'active'
)
select
  count(*) as remaining_resource_count
from public.content_packages package_row
join owner_workspace workspace on workspace.workspace_id = package_row.workspace_id
where package_row.title = '新增23字（mobi-第一集）';
