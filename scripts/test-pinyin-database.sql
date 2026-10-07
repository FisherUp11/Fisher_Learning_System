-- 仅供开发验证：在已应用 034、035 的项目运行，所有样本写入在最后 ROLLBACK。
-- 使用现有空间 owner 的鉴权上下文和随机测试孩子，不更改真实孩子设置/成绩。
begin;
do $$
declare
  v_owner uuid; v_family uuid; v_child uuid:=gen_random_uuid(); v_second uuid:=gen_random_uuid();
  v_nasal uuid:=gen_random_uuid(); v_legacy uuid:=gen_random_uuid();
  v_today jsonb; v_again jsonb; v_codes text[]; v_seen text[]:='{}'; v_code text; v_item uuid; v_request uuid;
  v_plan record; v_count integer; v_done integer:=0; v_id uuid; v_before integer;
begin
  select id into v_owner from auth.users where email='xiangyufei11@gmail.com';
  select family_id into v_family from public.learner_profiles where parent_user_id=v_owner order by created_at limit 1;
  if v_owner is null or v_family is null then raise exception '测试需要现有 owner 家庭'; end if;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  insert into public.learner_profiles(id,parent_user_id,display_name,family_id)
    values(v_child,v_owner,'034 回滚测试',v_family),(v_second,v_owner,'034 隔离测试',v_family),
      (v_nasal,v_owner,'035 鼻韵母测试',v_family),(v_legacy,v_owner,'035 旧版本兼容测试',v_family);
  insert into public.learner_module_access(learner_id,module_key,enabled)
    values(v_child,'hanzi',true),(v_second,'hanzi',true),(v_nasal,'hanzi',true),(v_legacy,'hanzi',true)
    on conflict(learner_id,module_key) do update set enabled=true;
  insert into public.pinyin_settings(learner_id,mode,daily_limit,enabled_categories,new_order)
    values(v_child,'initials',4,array['initial'],'sequential'),(v_second,'both',4,array['compound','whole'],'random'),
      (v_nasal,'both',5,array['front_nasal','back_nasal'],'sequential');

  -- 旧前端只传 mode 时仍可切换；新前端显式的六类组合不被兼容 mode 覆盖。
  insert into public.pinyin_settings(learner_id,mode,daily_limit) values(v_legacy,'finals',4);
  if (select enabled_categories from public.pinyin_settings where learner_id=v_legacy)<>array['final'] then
    raise exception '旧版本首次保存没有转换类别'; end if;
  update public.pinyin_settings set mode='initials' where learner_id=v_legacy;
  if (select enabled_categories from public.pinyin_settings where learner_id=v_legacy)<>array['initial'] then
    raise exception '旧版本 mode 切换没有同步类别'; end if;
  update public.pinyin_settings set mode='both',enabled_categories=array['front_nasal','back_nasal'] where learner_id=v_legacy;
  update public.pinyin_settings set daily_limit=3 where learner_id=v_legacy;
  if (select enabled_categories from public.pinyin_settings where learner_id=v_legacy)<>array['front_nasal','back_nasal'] then
    raise exception '显式鼻韵母类别被兼容层覆盖'; end if;
  update public.pinyin_settings set mode='off' where learner_id=v_legacy;
  if cardinality((select enabled_categories from public.pinyin_settings where learner_id=v_legacy))<>0 then
    raise exception '旧版本关闭没有同步类别'; end if;

  v_today:=public.pinyin_get_today(v_nasal);
  select array_agg(item->>'unit_code' order by ordinal) into v_codes from jsonb_array_elements(v_today->'items') with ordinality t(item,ordinal);
  if v_codes<>array['an','en','in','un','ün'] or (v_today->>'total')::integer<>5 then
    raise exception '鼻韵母顺序/每天上限失败：%',v_codes; end if;
  if exists(select 1 from jsonb_array_elements(v_today->'items') t(item) where item->>'category'<>'front_nasal'
    or (item->>'required_confirmations')::integer<>2) then raise exception '鼻韵母分类或双确认失败'; end if;
  insert into public.pinyin_states(learner_id,unit_code,stage,due_at)
    select v_nasal,unit_code,3,now()+interval '365 days' from public.pinyin_introductions where learner_id=v_nasal;
  select array_agg(unit_code) into v_codes from private.pinyin_plan_units(v_nasal,array['front_nasal','back_nasal'],5,'sequential',now());
  if v_codes<>array['ang','eng','ing','ong'] then raise exception '剩余后鼻韵母首次加入失败：%',v_codes; end if;
  update public.pinyin_settings set enabled_categories=array['back_nasal'] where learner_id=v_nasal;
  if jsonb_array_length(public.pinyin_get_today(v_nasal)->'items')<>0 then raise exception '前鼻韵母取消勾选未暂停'; end if;
  if (select count(*) from public.pinyin_units)<>63 then raise exception '公共拼音题库应为 63 个单元'; end if;

  v_today:=public.pinyin_get_today(v_child);
  select array_agg(item->>'unit_code' order by ordinal) into v_codes from jsonb_array_elements(v_today->'items') with ordinality t(item,ordinal);
  if v_codes<>array['b','p','m','f'] then raise exception '顺序选卡失败：%',v_codes; end if;
  if exists(select 1 from public.pinyin_states where learner_id=v_child) then raise exception '仅排入不应产生已练成绩'; end if;
  v_again:=public.pinyin_get_today(v_child);
  if v_today<>v_again then raise exception '刷新重洗/重复发卡'; end if;
  if (select count(*) from public.pinyin_introductions where learner_id=v_child)<>4 then raise exception '首次加入重复'; end if;
  select count(*) into v_count from private.pinyin_plan_units(v_child,array['initial'],4,'random',now()+interval '2 days') where kind='review' and unit_code=any(v_codes);
  if v_count<>4 then raise exception '没练完的应续学，不能再作为新卡'; end if;

  v_item:=(v_today->'items'->0->>'item_id')::uuid;
  v_request:=gen_random_uuid();
  v_again:=public.pinyin_answer(v_child,v_item,'known',v_request);
  if (v_again->>'passed')::boolean then raise exception '第一次答对不应通过'; end if;
  perform public.pinyin_answer(v_child,v_item,'known',v_request);
  if (select total_attempts from public.pinyin_states where learner_id=v_child and unit_code='b')<>1 then raise exception '幂等失败'; end if;
  select id into v_id from public.pinyin_daily_items where session_id=(select id from public.pinyin_daily_sessions where learner_id=v_child)
    and unit_code='b' and status='pending' order by queue_position limit 1;
  v_again:=public.pinyin_answer(v_child,v_id,'known',gen_random_uuid());
  if not (v_again->>'passed')::boolean or (v_again->>'stage')::integer<>1 then raise exception '双确认评分回归失败'; end if;

  v_today:=public.pinyin_get_today(v_child);
  v_code:=v_today->'items'->0->>'unit_code'; v_item:=(v_today->'items'->0->>'item_id')::uuid;
  insert into public.pinyin_mnemonics(learner_id,unit_code,mnemonic) values(v_child,v_code,'孩子专用测试口诀');
  v_today:=public.pinyin_get_today(v_child);
  if v_today->'items'->0->>'mnemonic'<>'孩子专用测试口诀' then raise exception '自定义口诀未返回'; end if;
  if exists(select 1 from public.pinyin_mnemonics where learner_id=v_second) then raise exception '口诀跨孩子泄漏'; end if;

  update public.pinyin_settings set enabled_categories=array['compound','whole'],mode='both' where learner_id=v_child;
  v_today:=public.pinyin_get_today(v_child);
  if jsonb_array_length(v_today->'items')<>0 then raise exception '取消勾选后仍显示旧类'; end if;
  begin
    perform public.pinyin_answer(v_child,v_item,'again',gen_random_uuid());
    raise exception '暂停类仍可作答';
  exception when sqlstate '22023' then null; end;
  update public.pinyin_settings set enabled_categories=array['initial'],mode='initials',new_order='random' where learner_id=v_child;

  -- 将测试孩子已加入的单元设为远期，再连续选剩余新单元：23 个声母恰好覆盖一次。
  insert into public.pinyin_states(learner_id,unit_code,stage,due_at)
    select v_child,unit_code,3,now()+interval '365 days' from public.pinyin_introductions where learner_id=v_child
    on conflict(learner_id,unit_code) do update set stage=3,due_at=excluded.due_at;
  v_seen:=v_codes;
  perform setseed(0.3);
  loop
    v_count:=0;
    for v_plan in select * from private.pinyin_plan_units(v_child,array['initial'],4,'random',now()+interval '2 days') loop
      if v_plan.kind<>'new' or v_plan.unit_code=any(v_seen) then raise exception '随机首次加入重复：%',v_plan.unit_code; end if;
      v_seen:=array_append(v_seen,v_plan.unit_code); v_count:=v_count+1;
      insert into public.pinyin_introductions(learner_id,unit_code,introduced_date) values(v_child,v_plan.unit_code,current_date);
      insert into public.pinyin_states(learner_id,unit_code,stage,due_at) values(v_child,v_plan.unit_code,3,now()+interval '365 days');
    end loop;
    exit when v_count=0;
    v_done:=v_done+1;
    if v_done>10 then raise exception '随机选卡未终止'; end if;
  end loop;
  if cardinality(v_seen)<>23 then raise exception '随机声母覆盖不完整：%',cardinality(v_seen); end if;
  update public.pinyin_states set due_at=now()-interval '1 day' where learner_id=v_child and unit_code='b';
  if (select kind from private.pinyin_plan_units(v_child,array['initial'],4,'random',now()) limit 1)<>'review' then raise exception '随机模式破坏到期优先'; end if;

  v_today:=public.pinyin_get_today(v_second);
  if (v_today->>'total')::integer<>4 or exists(select 1 from jsonb_array_elements(v_today->'items') t(item)
    where item->>'category' not in ('compound','whole')) then raise exception '新类别勾选失败'; end if;
  if has_function_privilege('anon','public.pinyin_get_today(uuid)','execute') or
    has_function_privilege('authenticated','private.pinyin_plan_units(uuid,text[],integer,text,timestamptz)','execute') then raise exception '函数权限过宽'; end if;
  perform set_config('pinyin.test.child',v_child::text,true);
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.pinyin_get_today(v_child);
    raise exception '陌生账号可以读拼音';
  exception when sqlstate '42501' then null; end;
end; $$;
-- 切换为真实 authenticated 数据库角色验证 RLS，而非只测试 RPC 内部判断。
set local role authenticated;
do $$ begin
  if exists(select 1 from public.pinyin_introductions where learner_id=current_setting('pinyin.test.child')::uuid)
    or exists(select 1 from public.pinyin_mnemonics where learner_id=current_setting('pinyin.test.child')::uuid) then
    raise exception 'RLS 未隔离陌生账号';
  end if;
end; $$;
reset role;
rollback;
select 'PASS: 六类63单元、鼻韵母选学/暂停、旧新版设置兼容、顺序、刷新幂等、随机23声母不重复、续学、到期优先、双确认、口诀隔离、RPC权限和RLS；全部测试数据已回滚' as result;
