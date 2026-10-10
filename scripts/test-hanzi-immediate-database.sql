-- 仅供开发回归：真实 RPC，但所有随机测试孩子/队列/成绩最后回滚。
begin;
do $$
declare
  v_owner uuid; v_family uuid; v_package uuid; v_child uuid:=gen_random_uuid();
  v_item uuid; v_request uuid:=gen_random_uuid(); v_saved jsonb; v_character uuid;
begin
  select id into v_owner from auth.users where email='xiangyufei11@gmail.com';
  select family_id into v_family from public.learner_profiles where parent_user_id=v_owner limit 1;
  select p.id into v_package from public.content_packages p join public.families f on f.workspace_id=p.workspace_id
    where f.id=v_family and p.status='published' and p.review_status='approved'
      and exists(select 1 from public.package_characters c where c.package_id=p.id) limit 1;
  if v_owner is null or v_family is null or v_package is null then raise exception '需要现有 owner 家庭和已发布字册'; end if;
  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  insert into public.learner_profiles(id,parent_user_id,display_name,family_id,daily_new_limit,active_package_id)
    values(v_child,v_owner,'即时换卡回滚测试',v_family,1,v_package);
  insert into public.learner_module_access(learner_id,module_key,enabled) values(v_child,'hanzi',true);
  insert into public.learner_content_packages(learner_id,package_id,assigned_by) values(v_child,v_package,v_owner);
  select session_item_id,character_id into v_item,v_character from public.get_today_queue(v_child) order by queue_position limit 1;
  if v_item is null then raise exception '未生成测试队列'; end if;
  v_saved:=public.answer_queue_item(v_child,v_item,'known',v_request,false);
  if (v_saved->>'daily_passed')::boolean then raise exception '首次独立认出不应完成双确认'; end if;
  v_saved:=public.answer_queue_item(v_child,v_item,'known',v_request,false);
  if not (v_saved->>'idempotent')::boolean or (select count(*) from public.learning_attempts where learner_id=v_child)<>1 then
    raise exception '响应丢失后相同请求重试重复计数'; end if;
  if exists(select 1 from public.get_today_queue(v_child) where session_item_id=v_item) then raise exception '同步队列仍包含已答原卡'; end if;
  select session_item_id into v_item from public.get_today_queue(v_child) where character_id=v_character order by queue_position limit 1;
  v_saved:=public.answer_queue_item(v_child,v_item,'known',gen_random_uuid(),false);
  if not (v_saved->>'daily_passed')::boolean or (v_saved->>'next_stage')::integer<>1 then raise exception '二次确认的阶段结果错误'; end if;
  if exists(select 1 from public.get_today_queue(v_child)) then raise exception '确认完成后仍有待答卡'; end if;
  if (select count(*) from public.learning_attempts where learner_id=v_child)<>2 then raise exception '真实次数不等于两次'; end if;
end; $$;
rollback;
select 'PASS: 汉字提交→同UUID重试→权威队列→二次确认→完成，次数/阶段正确；测试数据已回滚' as result;
