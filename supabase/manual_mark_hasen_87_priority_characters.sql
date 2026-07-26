-- 字芽：将指定的 87 个汉字标记为“哈森”的重点字。
--
-- 使用方法：
-- 1. 先确认已运行 supabase/011_priority_character_learning.sql。
-- 2. 在 Supabase Dashboard → SQL Editor 中整段运行本文件。
-- 3. 如家长邮箱或孩子昵称以后有变化，只修改下面两个常量。
--
-- 安全性：
-- - 只增加本清单中的重点标记，不会取消其他已经勾选的重点字。
-- - 可重复运行；已勾选的字不会产生重复记录。
-- - 87 个字中只要有一个尚未属于该孩子的已发布字库，整次操作就会回滚并列出缺少的字。

do $$
declare
  v_parent_email constant text := 'xiangyufei11@gmail.com';
  v_learner_name constant text := '哈森';
  v_expected_count constant integer := 87;
  v_characters constant text[] := array[
    '爷', '生', '长', '苗', '色', '想', '红', '黄', '蓝', '绿',
    '四', '七', '九', '气', '欢', '朵', '风', '家', '田', '黑',
    '老', '睡', '觉', '妈', '宝', '爸', '高', '兴', '画', '爱',
    '跳', '快', '乐', '青', '朋', '在', '跑', '它', '飞', '毛',
    '虫', '吃', '草', '花', '叶', '果', '兔', '鸟', '白', '云',
    '太', '阳', '星', '们', '出', '一', '二', '三', '方', '到',
    '好', '了', '有', '都', '没', '可', '少', '来', '要', '又',
    '起', '也', '什', '么', '我', '和', '你', '他', '哪', '里',
    '这', '那', '着', '是', '的', '只', '个'
  ]::text[];
  v_learner_id uuid;
  v_parent_user_id uuid;
  v_learner_count integer;
  v_unique_count integer;
  v_missing text[];
  v_added_count integer;
  v_marked_count integer;
begin
  if to_regclass('public.learner_character_priorities') is null then
    raise exception
      '尚未找到重点字表。请先运行 supabase/011_priority_character_learning.sql';
  end if;

  if cardinality(v_characters) <> v_expected_count then
    raise exception
      '脚本内汉字数量不正确：应为 % 个，实际为 % 个',
      v_expected_count,
      cardinality(v_characters);
  end if;

  select count(distinct target.hanzi)::integer
  into v_unique_count
  from unnest(v_characters) as target(hanzi);

  if v_unique_count <> v_expected_count then
    raise exception
      '脚本内存在重复汉字：应为 % 个不重复汉字，实际为 % 个',
      v_expected_count,
      v_unique_count;
  end if;

  select count(*)::integer
  into v_learner_count
  from public.learner_profiles learner
  join auth.users parent_account
    on parent_account.id = learner.parent_user_id
  where lower(parent_account.email) = lower(v_parent_email)
    and learner.display_name = v_learner_name;

  if v_learner_count <> 1 then
    raise exception
      '无法唯一定位孩子：家长邮箱“%”下昵称为“%”的档案共有 % 个，请先检查脚本顶部两个常量',
      v_parent_email,
      v_learner_name,
      v_learner_count;
  end if;

  select learner.id, learner.parent_user_id
  into v_learner_id, v_parent_user_id
  from public.learner_profiles learner
  join auth.users parent_account
    on parent_account.id = learner.parent_user_id
  where lower(parent_account.email) = lower(v_parent_email)
    and learner.display_name = v_learner_name;

  select coalesce(
    array_agg(target.hanzi order by target.ordinal_position),
    array[]::text[]
  )
  into v_missing
  from unnest(v_characters) with ordinality
    as target(hanzi, ordinal_position)
  where not exists (
    select 1
    from public.characters character_record
    join public.package_characters package_character
      on package_character.character_id = character_record.id
    join public.content_packages package
      on package.id = package_character.package_id
     and package.created_by = v_parent_user_id
     and package.status = 'published'
    join public.learner_content_packages learner_package
      on learner_package.package_id = package.id
     and learner_package.learner_id = v_learner_id
    where character_record.created_by = v_parent_user_id
      and character_record.character = target.hanzi
  );

  if cardinality(v_missing) > 0 then
    raise exception
      '本次没有写入任何数据。以下 % 个字尚未属于“%”的已发布字库：%',
      cardinality(v_missing),
      v_learner_name,
      array_to_string(v_missing, '、');
  end if;

  insert into public.learner_character_priorities (
    learner_id,
    character_id
  )
  select
    v_learner_id,
    character_record.id
  from unnest(v_characters) as target(hanzi)
  join public.characters character_record
    on character_record.created_by = v_parent_user_id
   and character_record.character = target.hanzi
  where exists (
    select 1
    from public.package_characters package_character
    join public.content_packages package
      on package.id = package_character.package_id
     and package.created_by = v_parent_user_id
     and package.status = 'published'
    join public.learner_content_packages learner_package
      on learner_package.package_id = package.id
     and learner_package.learner_id = v_learner_id
    where package_character.character_id = character_record.id
  )
  on conflict (learner_id, character_id) do nothing;

  get diagnostics v_added_count = row_count;

  select count(*)::integer
  into v_marked_count
  from public.learner_character_priorities priority
  join public.characters character_record
    on character_record.id = priority.character_id
  where priority.learner_id = v_learner_id
    and character_record.character = any(v_characters);

  if v_marked_count <> v_expected_count then
    raise exception
      '重点字写入校验失败：应为 % 个，实际为 % 个',
      v_expected_count,
      v_marked_count;
  end if;

  raise notice
    '完成：孩子“%”的 87 个目标字均已勾选为重点字；本次新增 % 个，原已勾选 % 个',
    v_learner_name,
    v_added_count,
    v_expected_count - v_added_count;
end
$$;

-- 运行成功后，结果应显示：
-- requested_count = 87
-- found_in_child_library = 87
-- marked_as_priority = 87
with target as (
  select *
  from unnest(array[
    '爷', '生', '长', '苗', '色', '想', '红', '黄', '蓝', '绿',
    '四', '七', '九', '气', '欢', '朵', '风', '家', '田', '黑',
    '老', '睡', '觉', '妈', '宝', '爸', '高', '兴', '画', '爱',
    '跳', '快', '乐', '青', '朋', '在', '跑', '它', '飞', '毛',
    '虫', '吃', '草', '花', '叶', '果', '兔', '鸟', '白', '云',
    '太', '阳', '星', '们', '出', '一', '二', '三', '方', '到',
    '好', '了', '有', '都', '没', '可', '少', '来', '要', '又',
    '起', '也', '什', '么', '我', '和', '你', '他', '哪', '里',
    '这', '那', '着', '是', '的', '只', '个'
  ]::text[]) with ordinality as listed(hanzi, ordinal_position)
),
selected_learner as (
  select learner.id, learner.parent_user_id, learner.display_name
  from public.learner_profiles learner
  join auth.users parent_account
    on parent_account.id = learner.parent_user_id
  where lower(parent_account.email) = lower('xiangyufei11@gmail.com')
    and learner.display_name = '哈森'
),
child_library_target as (
  select distinct
    target.ordinal_position,
    target.hanzi,
    character_record.id as character_id
  from target
  cross join selected_learner learner
  join public.characters character_record
    on character_record.created_by = learner.parent_user_id
   and character_record.character = target.hanzi
  join public.package_characters package_character
    on package_character.character_id = character_record.id
  join public.content_packages package
    on package.id = package_character.package_id
   and package.created_by = learner.parent_user_id
   and package.status = 'published'
  join public.learner_content_packages learner_package
    on learner_package.package_id = package.id
   and learner_package.learner_id = learner.id
)
select
  (select display_name from selected_learner) as learner_name,
  (select count(*) from target) as requested_count,
  count(child_target.character_id) as found_in_child_library,
  count(priority.character_id) as marked_as_priority,
  coalesce(
    string_agg(
      target.hanzi,
      '、' order by target.ordinal_position
    ) filter (where child_target.character_id is null),
    '无'
  ) as missing_characters
from target
left join child_library_target child_target
  on child_target.ordinal_position = target.ordinal_position
left join selected_learner learner
  on true
left join public.learner_character_priorities priority
  on priority.learner_id = learner.id
 and priority.character_id = child_target.character_id;
