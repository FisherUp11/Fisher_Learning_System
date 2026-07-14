-- 字芽 MVP：学习卡在回答后取得服务端真实“待答次数”。
-- 请在已运行 001（及已部署当前前端代码）后，于 Supabase Dashboard → SQL Editor 整段执行。
-- 不会删除或改写孩子、字库、学习状态和任何历史回答。

begin;

create or replace function public.answer_queue_item(
  p_learner_id uuid,
  p_session_item_id uuid,
  p_result text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_state public.learning_states%rowtype;
  v_today date;
  v_timezone text;
  v_previous_stage smallint;
  v_next_stage smallint;
  v_next_due_at timestamptz;
  v_append_kind text := null;
  v_reinforcement_added boolean := false;
  v_position integer;
  v_pending_count integer := 0;
  v_mastered_at timestamptz;
begin
  if p_result not in ('known', 'again') then
    raise exception 'result 只能是 known 或 again' using errcode = '22023';
  end if;

  select l.timezone into v_timezone from public.learner_profiles l
  where l.id = p_learner_id and l.parent_user_id = (select auth.uid());
  if not found then raise exception '无权操作该孩子档案' using errcode = '42501'; end if;
  v_today := (now() at time zone v_timezone)::date;

  if exists (select 1 from public.learning_attempts a where a.request_id = p_request_id) then
    return jsonb_build_object('idempotent', true);
  end if;

  select i.*, s.learner_id into v_item
  from public.daily_session_items i
  join public.daily_sessions s on s.id = i.session_id
  where i.id = p_session_item_id and s.learner_id = p_learner_id
  for update of i;
  if not found then raise exception '找不到待回答的学习卡' using errcode = '42501'; end if;
  if v_item.status <> 'pending' then return jsonb_build_object('idempotent', true); end if;

  insert into public.learning_states (learner_id, character_id, stage, due_at)
  values (p_learner_id, v_item.character_id, 0, now())
  on conflict (learner_id, character_id) do nothing;
  select * into v_state from public.learning_states where learner_id = p_learner_id and character_id = v_item.character_id for update;
  v_previous_stage := v_state.stage;
  v_mastered_at := v_state.mastered_at;

  if v_item.queue_kind = 'new' then
    v_next_stage := 0;
    v_next_due_at := now();
    v_append_kind := 'new_reinforcement';
  elsif v_item.queue_kind = 'new_reinforcement' then
    if p_result = 'known' then
      v_next_stage := 1;
      v_next_due_at := now() + interval '1 day';
    else
      v_next_stage := 0;
      v_next_due_at := now() + interval '1 day';
    end if;
  elsif v_item.queue_kind = 'error_reinforcement' then
    v_next_stage := v_state.stage;
    v_next_due_at := now() + interval '1 day';
  elsif p_result = 'again' then
    v_next_stage := greatest(0, v_state.stage - 2);
    v_next_due_at := now();
    v_append_kind := 'error_reinforcement';
    v_mastered_at := null;
  else
    if v_state.stage = 7 then
      v_next_stage := 7;
      v_next_due_at := now() + interval '180 days';
      v_mastered_at := coalesce(v_state.mastered_at, now());
    else
      v_next_stage := v_state.stage + 1;
      v_next_due_at := now() + case v_next_stage
        when 1 then interval '1 day'
        when 2 then interval '3 days'
        when 3 then interval '7 days'
        when 4 then interval '14 days'
        when 5 then interval '30 days'
        when 6 then interval '60 days'
        when 7 then interval '90 days'
      end;
    end if;
  end if;

  if v_append_kind is not null and v_state.reinforced_on is distinct from v_today then
    select coalesce(max(i.queue_position), 0) + 1 into v_position
    from public.daily_session_items i
    where i.session_id = v_item.session_id;
    insert into public.daily_session_items (session_id, character_id, queue_kind, queue_position)
    values (v_item.session_id, v_item.character_id, v_append_kind, v_position)
    on conflict (session_id, character_id, queue_kind) do nothing;
    v_reinforcement_added := true;
  end if;

  update public.learning_states
  set stage = v_next_stage,
      due_at = v_next_due_at,
      last_result = p_result,
      reinforced_on = case when v_reinforcement_added then v_today else reinforced_on end,
      consecutive_known = case when p_result = 'known' then consecutive_known + 1 else 0 end,
      mastered_at = case when v_next_stage < 7 then null else v_mastered_at end,
      updated_at = now()
  where id = v_state.id;

  update public.daily_session_items set status = 'answered', answered_at = now() where id = v_item.id;
  insert into public.learning_attempts (request_id, learner_id, character_id, state_id, session_item_id, result, queue_kind, previous_stage, next_stage, next_due_at)
  values (p_request_id, p_learner_id, v_item.character_id, v_state.id, v_item.id, p_result, v_item.queue_kind, v_previous_stage, v_next_stage, v_next_due_at);

  select count(*) into v_pending_count
  from public.daily_session_items i
  where i.session_id = v_item.session_id and i.status = 'pending';

  return jsonb_build_object(
    'next_stage', v_next_stage,
    'next_due_at', v_next_due_at,
    'reinforcement_added', v_reinforcement_added,
    'pending_count', v_pending_count
  );
end;
$$;

revoke execute on function public.answer_queue_item(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.answer_queue_item(uuid, uuid, text, uuid) to authenticated;

commit;
