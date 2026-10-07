-- 字芽 035：前鼻韵母、后鼻韵母分别选学；旧版 mode 写入兼容。
-- 前置：029、034 已运行。整份可重复执行，不重置设置、阶段、次数或历史队列。
-- 新增类别不会自动勾选。只扩展公共题库，仍使用 034 的同一套记忆/随机逻辑。
begin;

alter table public.pinyin_units drop constraint if exists pinyin_units_category_check;
alter table public.pinyin_units add constraint pinyin_units_category_check
  check(category in ('final','initial','compound','front_nasal','back_nasal','whole'));
alter table public.pinyin_settings drop constraint if exists pinyin_settings_categories_check;
alter table public.pinyin_settings add constraint pinyin_settings_categories_check
  check(enabled_categories <@ array['final','initial','compound','front_nasal','back_nasal','whole']::text[]
    and array_position(enabled_categories,null) is null);

-- 接续原来的 sort_order，不改变已加入单元及旧队列的先后。
insert into public.pinyin_units(code,category,sort_order,example_hanzi,example_pinyin) values
('an','front_nasal',55,'安','ān'),('en','front_nasal',56,'恩','ēn'),
('in','front_nasal',57,'因','yīn'),('un','front_nasal',58,'春','chūn'),('ün','front_nasal',59,'云','yún'),
('ang','back_nasal',60,'昂','áng'),('eng','back_nasal',61,'灯','dēng'),
('ing','back_nasal',62,'英','yīng'),('ong','back_nasal',63,'冬','dōng')
on conflict(code) do update set category=excluded.category,sort_order=excluded.sort_order,
  example_hanzi=excluded.example_hanzi,example_pinyin=excluded.example_pinyin;

-- 迁移先上线、前端稍后部署时，旧版仍可能只更新 mode。
-- 只有旧 mode 改变且未显式修改类别时，才转换旧的两类设置。
-- 新版显式提交鼻韵母/整体认读组合时，不能被旧 mode='both' 覆盖。
create or replace function private.pinyin_sync_legacy_mode() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if cardinality(new.enabled_categories)=0 and new.mode<>'off' then
      new.enabled_categories:=case new.mode when 'finals' then array['final']
        when 'initials' then array['initial'] when 'both' then array['final','initial'] else '{}'::text[] end;
    end if;
  elsif new.mode is distinct from old.mode and new.enabled_categories is not distinct from old.enabled_categories then
    new.enabled_categories:=case new.mode when 'finals' then array['final']
      when 'initials' then array['initial'] when 'both' then array['final','initial'] else '{}'::text[] end;
  end if;
  return new;
end; $$;
revoke all on function private.pinyin_sync_legacy_mode() from public,anon,authenticated;
drop trigger if exists pinyin_settings_legacy_mode_sync on public.pinyin_settings;
create trigger pinyin_settings_legacy_mode_sync before insert or update on public.pinyin_settings
  for each row execute function private.pinyin_sync_legacy_mode();

notify pgrst,'reload schema';
commit;
