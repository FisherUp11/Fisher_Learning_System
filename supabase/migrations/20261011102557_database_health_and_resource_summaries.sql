-- 036：数据库容量看板、资源练习汇总与历史分页。
-- 已安装 001–035 的现有项目使用；不删除学习记录、不修改记忆规则。
-- 先备份，再整份运行；可重复运行。CLI 镜像文件与此文件只需执行其一。
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- 只返回汇总，避免把多年逐次记录传给应用，也不受 REST 1000 行上限影响。
create or replace function public.resource_practice_summary(p_kind text, p_learner_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_result jsonb;
begin
  if (select auth.uid()) is null or not private.can_access_learner(p_learner_id) then
    raise exception '无权查看这个孩子的学习记录' using errcode = '42501';
  end if;
  if p_kind = 'poem' then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result from (
      select a.poem_id as id, count(*) as "attemptCount",
        count(distinct a.recited_local_date) as "practiceDays",
        max(a.recited_at) as "lastRecitedAt",
        (array_agg(a.recited_local_date order by a.recited_at desc, a.id desc))[1] as "lastRecitedDate",
        (array_agg(a.score order by a.recited_at desc, a.id desc) filter (where a.score is not null))[1] as "lastScore",
        round(avg(a.score), 1) as "averageScore", count(a.score) as "scoreCount"
      from public.poem_recitation_attempts a
      where a.learner_id = p_learner_id and exists (
        select 1 from public.learner_poem_collections l
        join public.poem_collection_items i on i.collection_id = l.collection_id
        where l.learner_id = p_learner_id and l.assignment_status = 'active' and i.poem_id = a.poem_id)
      group by a.poem_id
    ) x;
  elsif p_kind = 'music' then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result from (
      select a.item_id as id, count(*) as "attemptCount", max(a.practiced_at) as "lastPracticedAt"
      from public.music_practice_attempts a
      where a.learner_id = p_learner_id and exists (select 1 from public.learner_music_items l
        where l.learner_id = p_learner_id and l.assignment_status = 'active' and l.item_id = a.item_id)
      group by a.item_id
    ) x;
  elsif p_kind = 'catechism' then
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_result from (
      select a.item_id as id, count(distinct a.practiced_local_date) as "practiceDays",
        bool_or(a.practiced_local_date = (now() at time zone lp.timezone)::date) as "practicedToday"
      from public.catechism_attempts a join public.learner_profiles lp on lp.id = a.learner_id
      where a.learner_id = p_learner_id and exists (
        select 1 from public.learner_catechism_collections l
        join public.catechism_items i on i.collection_id = l.collection_id
        where l.learner_id = p_learner_id and l.assignment_status = 'active' and i.id = a.item_id)
      group by a.item_id
    ) x;
  else
    raise exception '不支持的资源类型' using errcode = '22023';
  end if;
  return v_result;
end $$;
revoke all on function public.resource_practice_summary(text, uuid) from public, anon;
grant execute on function public.resource_practice_summary(text, uuid) to authenticated;

-- 详细记录每页 20 条；同一时间的记录以 UUID 再排序，保证翻页顺序确定。
create or replace function public.resource_practice_history(p_kind text, p_learner_id uuid, p_item_id uuid, p_page integer default 1)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_total bigint; v_page integer; v_pages integer; v_rows jsonb;
begin
  if (select auth.uid()) is null or not private.can_access_learner(p_learner_id) then
    raise exception '无权查看这个孩子的学习记录' using errcode = '42501';
  end if;
  if p_kind = 'poem' then
    if not exists (select 1 from public.learner_poem_collections l
      join public.poem_collection_items i on i.collection_id = l.collection_id
      join public.poems p on p.id = i.poem_id
      where l.learner_id = p_learner_id and l.assignment_status = 'active' and p.id = p_item_id) then
      raise exception '该诗词未分配给这个孩子' using errcode = '42501';
    end if;
    select count(*) into v_total from public.poem_recitation_attempts where learner_id = p_learner_id and poem_id = p_item_id;
    v_pages := greatest(1, ceil(v_total / 20.0)::integer);
    v_page := least(v_pages, greatest(1, least(100000, coalesce(p_page, 1))));
    select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc, x.id desc), '[]'::jsonb) into v_rows from (
      select id, recited_at as at, recited_local_date as "localDate", score,
        null::text as result, null::integer as "stageBefore", null::integer as "stageAfter", note
      from public.poem_recitation_attempts where learner_id = p_learner_id and poem_id = p_item_id
      order by recited_at desc, id desc limit 20 offset (v_page - 1) * 20
    ) x;
  elsif p_kind = 'music' then
    if not exists (select 1 from public.learner_music_items l join public.music_items i on i.id = l.item_id
      where l.learner_id = p_learner_id and l.assignment_status = 'active' and i.status = 'published' and i.id = p_item_id) then
      raise exception '该音乐内容未分配给这个孩子' using errcode = '42501';
    end if;
    select count(*) into v_total from public.music_practice_attempts where learner_id = p_learner_id and item_id = p_item_id;
    v_pages := greatest(1, ceil(v_total / 20.0)::integer);
    v_page := least(v_pages, greatest(1, least(100000, coalesce(p_page, 1))));
    select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc, x.id desc), '[]'::jsonb) into v_rows from (
      select id, practiced_at as at, practiced_local_date as "localDate", null::integer as score,
        result, previous_stage as "stageBefore", next_stage as "stageAfter", guess_note as note
      from public.music_practice_attempts where learner_id = p_learner_id and item_id = p_item_id
      order by practiced_at desc, id desc limit 20 offset (v_page - 1) * 20
    ) x;
  elsif p_kind = 'catechism' then
    if not exists (select 1 from public.learner_catechism_collections l
      join public.catechism_collections c on c.id = l.collection_id
      join public.catechism_items i on i.collection_id = c.id
      where l.learner_id = p_learner_id and l.assignment_status = 'active' and c.status = 'published'
        and i.status = 'active' and i.id = p_item_id) then
      raise exception '该问答未分配给这个孩子' using errcode = '42501';
    end if;
    select count(*) into v_total from public.catechism_attempts where learner_id = p_learner_id and item_id = p_item_id;
    v_pages := greatest(1, ceil(v_total / 20.0)::integer);
    v_page := least(v_pages, greatest(1, least(100000, coalesce(p_page, 1))));
    select coalesce(jsonb_agg(to_jsonb(x) order by x.at desc, x.id desc), '[]'::jsonb) into v_rows from (
      select id, practiced_at as at, practiced_local_date as "localDate", null::integer as score,
        result, stage_before as "stageBefore", stage_after as "stageAfter", note
      from public.catechism_attempts where learner_id = p_learner_id and item_id = p_item_id
      order by practiced_at desc, id desc limit 20 offset (v_page - 1) * 20
    ) x;
  else
    raise exception '不支持的资源类型' using errcode = '22023';
  end if;
  return jsonb_build_object('total', v_total, 'page', v_page, 'pages', v_pages, 'rows', v_rows);
end $$;
revoke all on function public.resource_practice_history(text, uuid, uuid, integer) from public, anon;
grant execute on function public.resource_practice_history(text, uuid, uuid, integer) to authenticated;

-- 全项目容量只给现有系统 owner 的空间，不自动授予其他空间未来的 owner。
create table if not exists private.database_health_workspaces (
  workspace_id uuid primary key references public.learning_workspaces(id) on delete cascade
);
create table if not exists private.database_health_samples (
  sampled_date date primary key,
  captured_at timestamptz not null,
  metrics jsonb not null
);
alter table private.database_health_workspaces enable row level security;
alter table private.database_health_samples enable row level security;
revoke all on private.database_health_workspaces, private.database_health_samples from public, anon, authenticated, service_role;
insert into private.database_health_workspaces(workspace_id)
select distinct m.workspace_id from public.workspace_members m join auth.users u on u.id = m.user_id
where m.role = 'owner' and m.status = 'active' and lower(u.email) = 'xiangyufei11@gmail.com'
on conflict do nothing;

-- 私有 definer 只读取系统元数据，不读取任何邮件/会议/学习内容，不调用 OS 文件函数。
create or replace function private.read_database_health(p_workspace_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_metrics jsonb; v_history jsonb; v_tables jsonb; v_now timestamptz := clock_timestamp();
  v_today date := (v_now at time zone 'Asia/Shanghai')::date; v_saved boolean := true;
begin
  if not exists (select 1 from private.database_health_workspaces h join public.workspace_members m on m.workspace_id = h.workspace_id
    where h.workspace_id = p_workspace_id and m.user_id = p_user_id and m.status = 'active' and m.role = 'owner') then
    raise exception '只有系统 owner 可以查看全项目数据库容量' using errcode = '42501';
  end if;
  -- 数据库级 5 分钟缓存：跨 Vercel 实例共用，不对每次刷新扫描目录。
  select metrics into v_metrics from private.database_health_samples
  where sampled_date = v_today and captured_at > v_now - interval '5 minutes';
  if v_metrics is null then
    perform pg_advisory_xact_lock(360036);
    select metrics into v_metrics from private.database_health_samples
    where sampled_date = v_today and captured_at > v_now - interval '5 minutes';
    if v_metrics is null then
      select coalesce(jsonb_agg(to_jsonb(x) order by x."totalBytes" desc, x.name), '[]'::jsonb) into v_tables from (
        select s.schemaname || '.' || s.relname as name,
          pg_total_relation_size(s.relid) as "totalBytes", pg_table_size(s.relid) as "dataBytes",
          pg_indexes_size(s.relid) as "indexBytes", greatest(s.n_live_tup, 0) as "estimatedRows",
          s.last_analyze as "lastAnalyze", s.last_autoanalyze as "lastAutoanalyze"
        from pg_stat_user_tables s where s.schemaname in ('public', 'private')
      ) x;
      v_metrics := jsonb_build_object(
        'capturedAt', v_now, 'databaseBytes', pg_database_size(current_database()),
        'clusterDatabaseBytes', (select sum(pg_database_size(datname)) from pg_database),
        'businessBytes', (select coalesce(sum((t->>'totalBytes')::bigint), 0) from jsonb_array_elements(v_tables) t),
        'indexBytes', (select coalesce(sum((t->>'indexBytes')::bigint), 0) from jsonb_array_elements(v_tables) t),
        'estimatedRows', (select coalesce(sum((t->>'estimatedRows')::bigint), 0) from jsonb_array_elements(v_tables) t),
        'tableCount', jsonb_array_length(v_tables), 'tables', v_tables,
        'readOnly', current_setting('transaction_read_only') = 'on',
        'diskUsedBytes', null, 'diskLimitBytes', null
      );
      begin
        insert into private.database_health_samples(sampled_date, captured_at, metrics) values(v_today, v_now, v_metrics)
        on conflict (sampled_date) do update set captured_at = excluded.captured_at, metrics = excluded.metrics;
        delete from private.database_health_samples where sampled_date < v_today - 120;
      exception when read_only_sql_transaction then
        v_saved := false; -- 容量满导致只读时仍展示实时元数据，不伪装成零。
      end;
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('date', sampled_date, 'bytes', metrics->'clusterDatabaseBytes') order by sampled_date), '[]'::jsonb)
    into v_history from private.database_health_samples where sampled_date >= v_today - 30;
  return v_metrics || jsonb_build_object('history', v_history, 'snapshotSaved', v_saved);
end $$;
revoke all on function private.read_database_health(uuid, uuid) from public, anon, authenticated;
grant execute on function private.read_database_health(uuid, uuid) to service_role;
grant usage on schema private to service_role;
create or replace function public.owner_database_health(p_workspace_id uuid, p_user_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.read_database_health(p_workspace_id, p_user_id);
$$;
revoke all on function public.owner_database_health(uuid, uuid) from public, anon, authenticated;
grant execute on function public.owner_database_health(uuid, uuid) to service_role;

-- 只清理白名单中的重复普通索引，必须与保留的 UNIQUE 索引完全等价。
-- 保留 PK、UNIQUE 和所有关联约束；任何结构不同的索引自动跳过。
do $$
declare pair record; v_ok boolean;
begin
  for pair in select * from (values
    ('adult_academic_chunks_source_id_ordinal_key', 'adult_academic_chunks_source_idx'),
    ('catechism_items_collection_id_sort_order_key', 'catechism_items_order_idx'),
    ('hanzi_frog_taps_session_id_question_index_touch_index_key', 'hanzi_frog_taps_session_idx'),
    ('kids_english_words_book_id_sequence_key', 'kids_words_book_idx'),
    ('poem_collection_items_collection_id_sequence_key', 'poem_collection_items_order_idx'),
    ('poem_game_attempts_session_id_event_index_key', 'poem_game_attempts_session_idx'),
    ('poems_created_by_poem_key_key', 'poems_owner_key_idx')
  ) v(keep_name, drop_name) loop
    select k.indisunique and k.indisvalid and k.indisready and d.indisvalid and d.indisready
      and not d.indisunique and not d.indisprimary and k.indrelid = d.indrelid
      and k.indkey = d.indkey and k.indclass = d.indclass and k.indcollation = d.indcollation
      and k.indoption = d.indoption and k.indnkeyatts = d.indnkeyatts
      and kc.relam = dc.relam and kc.reloptions is not distinct from dc.reloptions
      and k.indexprs::text is not distinct from d.indexprs::text
      and k.indpred::text is not distinct from d.indpred::text
      and not exists(select 1 from pg_constraint c where c.conindid = d.indexrelid)
      into v_ok
    from pg_index k join pg_class kc on kc.oid = k.indexrelid
    join pg_namespace kn on kn.oid = kc.relnamespace
    cross join pg_index d join pg_class dc on dc.oid = d.indexrelid
    join pg_namespace dn on dn.oid = dc.relnamespace
    where kn.nspname = 'public' and dn.nspname = 'public'
      and kc.relname = pair.keep_name and dc.relname = pair.drop_name;
    if v_ok then execute format('drop index public.%I', pair.drop_name); end if;
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
