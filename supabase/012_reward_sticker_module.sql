-- 字芽：小芽贴纸册 / 奖励模块。
-- 前置：请先依次运行 001–011。
-- 本脚本只新增奖励账户、贴纸流水、成长星、礼物与兑换记录；
-- 不修改汉字记忆曲线、诗词打卡、音乐阶段或既有学习历史。

begin;

create table if not exists public.reward_accounts (
  learner_id uuid primary key references public.learner_profiles(id) on delete cascade,
  sticker_goal integer not null default 10 check (sticker_goal between 1 and 100),
  growth_points_per_sticker integer not null default 3 check (growth_points_per_sticker between 2 and 10),
  daily_growth_point_limit integer not null default 2 check (daily_growth_point_limit between 1 and 10),
  growth_points integer not null default 0 check (growth_points >= 0 and growth_points < growth_points_per_sticker),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 贴纸余额始终由不可变流水求和；兑换和修正也追加新行，不覆盖历史。
create table if not exists public.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  event_type text not null check (event_type in (
    'hanzi_daily',
    'growth_bundle',
    'math_manual',
    'manual_bonus',
    'initial_balance',
    'correction',
    'redemption',
    'redemption_reversal'
  )),
  amount integer not null check (amount between -1000 and 1000 and amount <> 0),
  title text not null check (char_length(title) between 1 and 100),
  note text check (note is null or char_length(note) <= 300),
  sticker_code text check (sticker_code is null or char_length(sticker_code) <= 30),
  local_date date not null,
  dedupe_key text check (dedupe_key is null or char_length(dedupe_key) between 1 and 180),
  reference_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (learner_id, dedupe_key)
);

-- 同一首诗 / 同一个音乐项目在同一天最多获得一颗成长星。
-- 达到每日上限的练习仍保留为 counted=false，便于解释“练习已记录，但今天不重复加星”。
create table if not exists public.reward_growth_events (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  activity_type text not null check (activity_type in ('poem', 'song', 'instrument', 'rhythm')),
  source_record_id uuid not null,
  source_scope_id uuid not null,
  local_date date not null,
  points smallint not null check (points in (0, 1)),
  counted boolean not null,
  reason text not null check (reason in ('credited', 'daily_limit')),
  created_at timestamptz not null default now(),
  unique (learner_id, activity_type, source_scope_id, local_date)
);

create table if not exists public.reward_catalog_items (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  sticker_cost integer not null default 10 check (sticker_cost between 1 and 100),
  icon text not null default '🎁' check (char_length(icon) between 1 and 12),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  reward_item_id uuid references public.reward_catalog_items(id) on delete set null,
  title_snapshot text not null check (char_length(title_snapshot) between 1 and 80),
  sticker_cost integer not null check (sticker_cost between 1 and 100),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'completed' check (status in ('completed', 'reversed')),
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  local_date date not null,
  reversed_at timestamptz,
  reversal_note text check (reversal_note is null or char_length(reversal_note) <= 300)
);

create index if not exists reward_ledger_history_idx
  on public.reward_ledger (learner_id, created_at desc);
create index if not exists reward_ledger_local_date_idx
  on public.reward_ledger (learner_id, local_date desc);
create index if not exists reward_ledger_created_by_idx
  on public.reward_ledger (created_by);
create index if not exists reward_growth_events_daily_idx
  on public.reward_growth_events (learner_id, local_date, counted);
create index if not exists reward_catalog_owner_status_idx
  on public.reward_catalog_items (created_by, status, created_at desc);
create index if not exists reward_redemptions_history_idx
  on public.reward_redemptions (learner_id, redeemed_at desc);
create index if not exists reward_redemptions_item_idx
  on public.reward_redemptions (reward_item_id);
create index if not exists reward_redemptions_redeemed_by_idx
  on public.reward_redemptions (redeemed_by);

alter table public.reward_accounts enable row level security;
alter table public.reward_ledger enable row level security;
alter table public.reward_growth_events enable row level security;
alter table public.reward_catalog_items enable row level security;
alter table public.reward_redemptions enable row level security;

drop policy if exists "parent reads reward accounts" on public.reward_accounts;
drop policy if exists "parent writes reward accounts" on public.reward_accounts;
create policy "parent reads reward accounts"
on public.reward_accounts for select to authenticated
using (
  exists (
    select 1
    from public.learner_profiles learner
    where learner.id = learner_id
      and learner.parent_user_id = (select auth.uid())
  )
);
create policy "parent writes reward accounts"
on public.reward_accounts for all to authenticated
using (
  exists (
    select 1
    from public.learner_profiles learner
    where learner.id = learner_id
      and learner.parent_user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.learner_profiles learner
    where learner.id = learner_id
      and learner.parent_user_id = (select auth.uid())
  )
);

drop policy if exists "parent reads reward ledger" on public.reward_ledger;
drop policy if exists "parent inserts reward ledger" on public.reward_ledger;
create policy "parent reads reward ledger"
on public.reward_ledger for select to authenticated
using (
  exists (
    select 1
    from public.learner_profiles learner
    where learner.id = learner_id
      and learner.parent_user_id = (select auth.uid())
  )
);
create policy "parent inserts reward ledger"
on public.reward_ledger for insert to authenticated
with check (
  exists (
    select 1
    from public.learner_profiles learner
    where learner.id = learner_id
      and learner.parent_user_id = (select auth.uid())
  )
  and created_by = (select auth.uid())
);

drop policy if exists "parent reads reward growth" on public.reward_growth_events;
drop policy if exists "parent inserts reward growth" on public.reward_growth_events;
create policy "parent reads reward growth"
on public.reward_growth_events for select to authenticated
using (
  exists (
    select 1
    from public.learner_profiles learner
    where learner.id = learner_id
      and learner.parent_user_id = (select auth.uid())
  )
);
create policy "parent inserts reward growth"
on public.reward_growth_events for insert to authenticated
with check (
  exists (
    select 1
    from public.learner_profiles learner
    where learner.id = learner_id
      and learner.parent_user_id = (select auth.uid())
  )
);

drop policy if exists "parent manages reward catalog" on public.reward_catalog_items;
create policy "parent manages reward catalog"
on public.reward_catalog_items for all to authenticated
using (created_by = (select auth.uid()))
with check (created_by = (select auth.uid()));

drop policy if exists "parent reads reward redemptions" on public.reward_redemptions;
drop policy if exists "parent inserts reward redemptions" on public.reward_redemptions;
drop policy if exists "parent updates reward redemptions" on public.reward_redemptions;
create policy "parent reads reward redemptions"
on public.reward_redemptions for select to authenticated
using (
  exists (
    select 1
    from public.learner_profiles learner
    where learner.id = learner_id
      and learner.parent_user_id = (select auth.uid())
  )
);
create policy "parent inserts reward redemptions"
on public.reward_redemptions for insert to authenticated
with check (
  exists (
    select 1
    from public.learner_profiles learner
    where learner.id = learner_id
      and learner.parent_user_id = (select auth.uid())
  )
  and redeemed_by = (select auth.uid())
);
create policy "parent updates reward redemptions"
on public.reward_redemptions for update to authenticated
using (
  exists (
    select 1
    from public.learner_profiles learner
    where learner.id = learner_id
      and learner.parent_user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.learner_profiles learner
    where learner.id = learner_id
      and learner.parent_user_id = (select auth.uid())
  )
);

revoke all on
  public.reward_accounts,
  public.reward_ledger,
  public.reward_growth_events,
  public.reward_catalog_items,
  public.reward_redemptions
from anon;

revoke insert, update, delete on public.reward_accounts from authenticated;
revoke insert, update, delete on public.reward_ledger from authenticated;
revoke insert, update, delete on public.reward_growth_events from authenticated;
revoke insert, update, delete on public.reward_redemptions from authenticated;

-- 奖励余额、成长星和兑换记录只能由下面的受限 RPC 写入；
-- 登录用户只有读取权限，避免绕过业务规则直接伪造流水。
grant select on public.reward_accounts to authenticated;
grant select on public.reward_ledger to authenticated;
grant select on public.reward_growth_events to authenticated;
grant select, insert, update, delete on public.reward_catalog_items to authenticated;
grant select on public.reward_redemptions to authenticated;

-- 完成当天全部汉字任务后领取一枚贴纸。
-- 数据库验证今日确实存在已回答卡片，且已没有 pending 卡片；
-- learner + 本地日期唯一键保证刷新、重试和重复打开都不会多发。
drop function if exists public.claim_hanzi_daily_reward(uuid);
create function public.claim_hanzi_daily_reward(p_learner_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_today date;
  v_session_id uuid;
  v_pending_count integer;
  v_answered_count integer;
  v_account public.reward_accounts%rowtype;
  v_ledger_id uuid;
  v_balance integer;
  v_positive_count integer;
  v_sticker_code text;
begin
  select learner.timezone
  into v_timezone
  from public.learner_profiles learner
  where learner.id = p_learner_id
    and learner.parent_user_id = (select auth.uid());

  if not found then
    raise exception '无权操作该孩子档案' using errcode = '42501';
  end if;

  insert into public.reward_accounts (learner_id)
  values (p_learner_id)
  on conflict (learner_id) do nothing;

  select *
  into v_account
  from public.reward_accounts account
  where account.learner_id = p_learner_id
  for update;

  v_today := (now() at time zone v_timezone)::date;

  select session.id
  into v_session_id
  from public.daily_sessions session
  where session.learner_id = p_learner_id
    and session.date_local = v_today;

  if not found then
    select coalesce(sum(ledger.amount), 0)::integer
    into v_balance
    from public.reward_ledger ledger
    where ledger.learner_id = p_learner_id;

    return jsonb_build_object(
      'eligible', false,
      'awarded', false,
      'reason', 'no_session',
      'balance', v_balance,
      'progress', v_account.growth_points,
      'goal', v_account.sticker_goal
    );
  end if;

  select
    count(*) filter (where item.status = 'pending')::integer,
    count(*) filter (where item.status = 'answered')::integer
  into v_pending_count, v_answered_count
  from public.daily_session_items item
  where item.session_id = v_session_id;

  if v_answered_count = 0 or v_pending_count > 0 then
    select coalesce(sum(ledger.amount), 0)::integer
    into v_balance
    from public.reward_ledger ledger
    where ledger.learner_id = p_learner_id;

    return jsonb_build_object(
      'eligible', false,
      'awarded', false,
      'reason', case when v_answered_count = 0 then 'no_answered_items' else 'pending_items' end,
      'balance', v_balance,
      'progress', v_account.growth_points,
      'goal', v_account.sticker_goal
    );
  end if;

  select count(*)::integer
  into v_positive_count
  from public.reward_ledger ledger
  where ledger.learner_id = p_learner_id
    and ledger.amount > 0;

  v_sticker_code := (array[
    'sprout', 'sun', 'rabbit', 'whale', 'star',
    'flower', 'rocket', 'rainbow', 'bear', 'moon'
  ]::text[])[1 + (v_positive_count % 10)];

  insert into public.reward_ledger (
    learner_id,
    event_type,
    amount,
    title,
    note,
    sticker_code,
    local_date,
    dedupe_key,
    reference_id,
    created_by
  )
  values (
    p_learner_id,
    'hanzi_daily',
    1,
    '完成今天的汉字学习',
    '今日全部汉字卡片已经完成',
    v_sticker_code,
    v_today,
    'hanzi:' || v_today::text,
    v_session_id,
    (select auth.uid())
  )
  on conflict (learner_id, dedupe_key) do nothing
  returning id into v_ledger_id;

  select coalesce(sum(ledger.amount), 0)::integer
  into v_balance
  from public.reward_ledger ledger
  where ledger.learner_id = p_learner_id;

  return jsonb_build_object(
    'eligible', true,
    'awarded', v_ledger_id is not null,
    'duplicate', v_ledger_id is null,
    'reason', case when v_ledger_id is null then 'already_claimed' else 'awarded' end,
    'balance', v_balance,
    'progress', v_account.growth_points,
    'goal', v_account.sticker_goal,
    'sticker_code', case when v_ledger_id is null then null else v_sticker_code end,
    'title', '识字小达人'
  );
end;
$$;

-- 诗词 / 唱歌 / 辨音 / 节奏：一条真实练习记录最多贡献一颗成长星。
-- 不信任客户端传来的日期、项目或结果，全部从既有不可变练习记录反查。
drop function if exists public.register_reward_activity(uuid, text, uuid);
create function public.register_reward_activity(
  p_learner_id uuid,
  p_activity_type text,
  p_source_record_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_scope_id uuid;
  v_local_date date;
  v_music_type text;
  v_music_result text;
  v_account public.reward_accounts%rowtype;
  v_existing_counted boolean;
  v_daily_count integer;
  v_event_id uuid;
  v_new_growth_points integer;
  v_awarded boolean := false;
  v_balance integer;
  v_positive_count integer;
  v_sticker_code text;
begin
  if p_activity_type not in ('poem', 'song', 'instrument', 'rhythm') then
    raise exception '奖励活动类型不正确' using errcode = '22023';
  end if;

  select learner.timezone
  into v_timezone
  from public.learner_profiles learner
  where learner.id = p_learner_id
    and learner.parent_user_id = (select auth.uid());

  if not found then
    raise exception '无权操作该孩子档案' using errcode = '42501';
  end if;

  if p_activity_type = 'poem' then
    select attempt.poem_id, attempt.recited_local_date
    into v_scope_id, v_local_date
    from public.poem_recitation_attempts attempt
    join public.poems poem
      on poem.id = attempt.poem_id
     and poem.created_by = (select auth.uid())
    where attempt.id = p_source_record_id
      and attempt.learner_id = p_learner_id;

    if not found then
      raise exception '找不到这次诗词练习记录' using errcode = '42501';
    end if;
  else
    select
      attempt.item_id,
      attempt.practiced_local_date,
      item.item_type,
      attempt.result
    into
      v_scope_id,
      v_local_date,
      v_music_type,
      v_music_result
    from public.music_practice_attempts attempt
    join public.music_items item
      on item.id = attempt.item_id
     and item.created_by = (select auth.uid())
    where attempt.id = p_source_record_id
      and attempt.learner_id = p_learner_id;

    if not found then
      raise exception '找不到这次音乐练习记录' using errcode = '42501';
    end if;

    if v_music_type <> p_activity_type then
      raise exception '音乐练习类型与奖励活动不匹配' using errcode = '22023';
    end if;

    -- 只播放歌曲会保留学习记录，但需要真正跟唱才积累成长星。
    if p_activity_type = 'song' and v_music_result = 'song_listened' then
      select coalesce(sum(ledger.amount), 0)::integer
      into v_balance
      from public.reward_ledger ledger
      where ledger.learner_id = p_learner_id;

      return jsonb_build_object(
        'eligible', false,
        'credited', false,
        'awarded', false,
        'reason', 'listen_only',
        'balance', v_balance,
        'progress', coalesce(
          (select account.growth_points from public.reward_accounts account where account.learner_id = p_learner_id),
          0
        )
      );
    end if;
  end if;

  insert into public.reward_accounts (learner_id)
  values (p_learner_id)
  on conflict (learner_id) do nothing;

  select *
  into v_account
  from public.reward_accounts account
  where account.learner_id = p_learner_id
  for update;

  select event.counted
  into v_existing_counted
  from public.reward_growth_events event
  where event.learner_id = p_learner_id
    and event.activity_type = p_activity_type
    and event.source_scope_id = v_scope_id
    and event.local_date = v_local_date;

  if found then
    select coalesce(sum(ledger.amount), 0)::integer
    into v_balance
    from public.reward_ledger ledger
    where ledger.learner_id = p_learner_id;

    return jsonb_build_object(
      'eligible', true,
      'credited', false,
      'awarded', false,
      'duplicate', true,
      'reason', case when v_existing_counted then 'same_item_today' else 'daily_limit' end,
      'daily_limit_reached', not v_existing_counted,
      'balance', v_balance,
      'progress', v_account.growth_points,
      'needed', v_account.growth_points_per_sticker - v_account.growth_points,
      'goal', v_account.sticker_goal
    );
  end if;

  select count(*) filter (where event.counted)::integer
  into v_daily_count
  from public.reward_growth_events event
  where event.learner_id = p_learner_id
    and event.local_date = v_local_date;

  if v_daily_count >= v_account.daily_growth_point_limit then
    insert into public.reward_growth_events (
      learner_id,
      activity_type,
      source_record_id,
      source_scope_id,
      local_date,
      points,
      counted,
      reason
    )
    values (
      p_learner_id,
      p_activity_type,
      p_source_record_id,
      v_scope_id,
      v_local_date,
      0,
      false,
      'daily_limit'
    )
    on conflict (learner_id, activity_type, source_scope_id, local_date) do nothing;

    select coalesce(sum(ledger.amount), 0)::integer
    into v_balance
    from public.reward_ledger ledger
    where ledger.learner_id = p_learner_id;

    return jsonb_build_object(
      'eligible', true,
      'credited', false,
      'awarded', false,
      'reason', 'daily_limit',
      'daily_limit_reached', true,
      'balance', v_balance,
      'progress', v_account.growth_points,
      'needed', v_account.growth_points_per_sticker - v_account.growth_points,
      'goal', v_account.sticker_goal
    );
  end if;

  insert into public.reward_growth_events (
    learner_id,
    activity_type,
    source_record_id,
    source_scope_id,
    local_date,
    points,
    counted,
    reason
  )
  values (
    p_learner_id,
    p_activity_type,
    p_source_record_id,
    v_scope_id,
    v_local_date,
    1,
    true,
    'credited'
  )
  returning id into v_event_id;

  v_new_growth_points := v_account.growth_points + 1;

  if v_new_growth_points >= v_account.growth_points_per_sticker then
    v_new_growth_points := v_new_growth_points - v_account.growth_points_per_sticker;
    v_awarded := true;

    select count(*)::integer
    into v_positive_count
    from public.reward_ledger ledger
    where ledger.learner_id = p_learner_id
      and ledger.amount > 0;

    v_sticker_code := (array[
      'sprout', 'sun', 'rabbit', 'whale', 'star',
      'flower', 'rocket', 'rainbow', 'bear', 'moon'
    ]::text[])[1 + (v_positive_count % 10)];

    insert into public.reward_ledger (
      learner_id,
      event_type,
      amount,
      title,
      note,
      sticker_code,
      local_date,
      dedupe_key,
      reference_id,
      created_by
    )
    values (
      p_learner_id,
      'growth_bundle',
      1,
      '集齐三颗成长小星星',
      '诗词或音乐练习积累兑换',
      v_sticker_code,
      v_local_date,
      'growth:' || v_event_id::text,
      v_event_id,
      (select auth.uid())
    );
  end if;

  update public.reward_accounts account
  set growth_points = v_new_growth_points,
      updated_at = now()
  where account.learner_id = p_learner_id;

  select coalesce(sum(ledger.amount), 0)::integer
  into v_balance
  from public.reward_ledger ledger
  where ledger.learner_id = p_learner_id;

  return jsonb_build_object(
    'eligible', true,
    'credited', true,
    'awarded', v_awarded,
    'duplicate', false,
    'reason', case when v_awarded then 'growth_sticker_awarded' else 'growth_point_credited' end,
    'daily_limit_reached', false,
    'daily_credited', v_daily_count + 1,
    'balance', v_balance,
    'progress', v_new_growth_points,
    'needed', v_account.growth_points_per_sticker - v_new_growth_points,
    'goal', v_account.sticker_goal,
    'sticker_code', case when v_awarded then v_sticker_code else null end,
    'title', case when v_awarded then '勇敢探索' else null end
  );
end;
$$;

-- 家长手工奖励：数学每日一次；初始贴纸只带入一次；特别表扬/修正以 request_id 幂等。
drop function if exists public.grant_manual_reward(uuid, text, integer, text, date, uuid);
create function public.grant_manual_reward(
  p_learner_id uuid,
  p_kind text,
  p_amount integer,
  p_note text,
  p_local_date date,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_today date;
  v_effective_date date;
  v_account public.reward_accounts%rowtype;
  v_event_type text;
  v_title text;
  v_dedupe_key text;
  v_ledger_id uuid;
  v_balance integer;
  v_positive_count integer;
  v_sticker_code text;
begin
  if p_request_id is null then
    raise exception '缺少本次操作编号' using errcode = '22023';
  end if;

  if p_kind not in ('math', 'bonus', 'initial', 'correction') then
    raise exception '家长奖励类型不正确' using errcode = '22023';
  end if;

  select learner.timezone
  into v_timezone
  from public.learner_profiles learner
  where learner.id = p_learner_id
    and learner.parent_user_id = (select auth.uid());

  if not found then
    raise exception '无权操作该孩子档案' using errcode = '42501';
  end if;

  v_today := (now() at time zone v_timezone)::date;
  v_effective_date := coalesce(p_local_date, v_today);

  if v_effective_date > v_today or v_effective_date < v_today - 365 then
    raise exception '奖励日期只能选择今天或过去一年内的日期' using errcode = '22023';
  end if;

  if p_kind = 'math' and p_amount <> 1 then
    raise exception '数学作业每次固定奖励 1 枚贴纸' using errcode = '22023';
  elsif p_kind = 'initial' and (p_amount < 1 or p_amount > 100) then
    raise exception '初始贴纸数量应为 1–100 枚' using errcode = '22023';
  elsif p_kind = 'bonus' and (p_amount < 1 or p_amount > 20) then
    raise exception '一次特别表扬可奖励 1–20 枚贴纸' using errcode = '22023';
  elsif p_kind = 'correction' and (p_amount < -20 or p_amount > 20 or p_amount = 0) then
    raise exception '修正数量应在 -20 到 20 之间且不能为 0' using errcode = '22023';
  end if;

  if p_kind = 'correction' and nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception '修正贴纸必须填写原因' using errcode = '22023';
  end if;

  insert into public.reward_accounts (learner_id)
  values (p_learner_id)
  on conflict (learner_id) do nothing;

  select *
  into v_account
  from public.reward_accounts account
  where account.learner_id = p_learner_id
  for update;

  select coalesce(sum(ledger.amount), 0)::integer
  into v_balance
  from public.reward_ledger ledger
  where ledger.learner_id = p_learner_id;

  if v_balance + p_amount < 0 then
    raise exception '贴纸余额不足，不能修正到负数' using errcode = '22023';
  end if;

  v_event_type := case p_kind
    when 'math' then 'math_manual'
    when 'bonus' then 'manual_bonus'
    when 'initial' then 'initial_balance'
    else 'correction'
  end;
  v_title := case p_kind
    when 'math' then '完成数学作业'
    when 'bonus' then '爸爸妈妈的特别表扬'
    when 'initial' then '从线下贴纸册带入'
    else '家长修正贴纸'
  end;
  v_dedupe_key := case p_kind
    when 'math' then 'math:' || v_effective_date::text
    when 'initial' then 'initial'
    else 'manual:' || p_request_id::text
  end;

  if p_amount > 0 then
    select count(*)::integer
    into v_positive_count
    from public.reward_ledger ledger
    where ledger.learner_id = p_learner_id
      and ledger.amount > 0;

    v_sticker_code := (array[
      'sprout', 'sun', 'rabbit', 'whale', 'star',
      'flower', 'rocket', 'rainbow', 'bear', 'moon'
    ]::text[])[1 + (v_positive_count % 10)];
  end if;

  insert into public.reward_ledger (
    learner_id,
    event_type,
    amount,
    title,
    note,
    sticker_code,
    local_date,
    dedupe_key,
    created_by
  )
  values (
    p_learner_id,
    v_event_type,
    p_amount,
    v_title,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_sticker_code,
    v_effective_date,
    v_dedupe_key,
    (select auth.uid())
  )
  on conflict (learner_id, dedupe_key) do nothing
  returning id into v_ledger_id;

  select coalesce(sum(ledger.amount), 0)::integer
  into v_balance
  from public.reward_ledger ledger
  where ledger.learner_id = p_learner_id;

  return jsonb_build_object(
    'eligible', true,
    'awarded', v_ledger_id is not null and p_amount > 0,
    'duplicate', v_ledger_id is null,
    'reason', case
      when v_ledger_id is null and p_kind = 'math' then 'math_already_awarded'
      when v_ledger_id is null and p_kind = 'initial' then 'initial_already_added'
      when v_ledger_id is null then 'duplicate_request'
      else 'manual_saved'
    end,
    'amount', case when v_ledger_id is null then 0 else p_amount end,
    'balance', v_balance,
    'progress', v_account.growth_points,
    'goal', v_account.sticker_goal,
    'sticker_code', case when v_ledger_id is null then null else v_sticker_code end,
    'title', v_title
  );
end;
$$;

-- 家长确认兑换礼物；先锁定孩子奖励账户，再检查余额并追加 -N 流水。
drop function if exists public.redeem_reward(uuid, uuid, text, uuid);
create function public.redeem_reward(
  p_learner_id uuid,
  p_reward_item_id uuid,
  p_note text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_today date;
  v_account public.reward_accounts%rowtype;
  v_item public.reward_catalog_items%rowtype;
  v_existing public.reward_redemptions%rowtype;
  v_redemption_id uuid;
  v_balance integer;
begin
  if p_request_id is null then
    raise exception '缺少本次兑换编号' using errcode = '22023';
  end if;

  select learner.timezone
  into v_timezone
  from public.learner_profiles learner
  where learner.id = p_learner_id
    and learner.parent_user_id = (select auth.uid());

  if not found then
    raise exception '无权操作该孩子档案' using errcode = '42501';
  end if;

  select redemption.*
  into v_existing
  from public.reward_redemptions redemption
  where redemption.request_id = p_request_id
    and redemption.learner_id = p_learner_id;

  if found then
    select coalesce(sum(ledger.amount), 0)::integer
    into v_balance
    from public.reward_ledger ledger
    where ledger.learner_id = p_learner_id;

    return jsonb_build_object(
      'redeemed', false,
      'duplicate', true,
      'reason', 'duplicate_request',
      'balance', v_balance,
      'redemption_id', v_existing.id,
      'title', v_existing.title_snapshot,
      'cost', v_existing.sticker_cost
    );
  end if;

  select item.*
  into v_item
  from public.reward_catalog_items item
  where item.id = p_reward_item_id
    and item.created_by = (select auth.uid())
    and item.status = 'active';

  if not found then
    raise exception '找不到可以兑换的礼物' using errcode = '42501';
  end if;

  insert into public.reward_accounts (learner_id)
  values (p_learner_id)
  on conflict (learner_id) do nothing;

  select *
  into v_account
  from public.reward_accounts account
  where account.learner_id = p_learner_id
  for update;

  select coalesce(sum(ledger.amount), 0)::integer
  into v_balance
  from public.reward_ledger ledger
  where ledger.learner_id = p_learner_id;

  if v_balance < v_item.sticker_cost then
    raise exception
      '贴纸还不够：当前 % 枚，兑换“%”需要 % 枚',
      v_balance,
      v_item.title,
      v_item.sticker_cost
      using errcode = '22023';
  end if;

  v_today := (now() at time zone v_timezone)::date;

  insert into public.reward_redemptions (
    request_id,
    learner_id,
    reward_item_id,
    title_snapshot,
    sticker_cost,
    note,
    status,
    redeemed_by,
    local_date
  )
  values (
    p_request_id,
    p_learner_id,
    v_item.id,
    v_item.title,
    v_item.sticker_cost,
    nullif(btrim(coalesce(p_note, '')), ''),
    'completed',
    (select auth.uid()),
    v_today
  )
  returning id into v_redemption_id;

  insert into public.reward_ledger (
    learner_id,
    event_type,
    amount,
    title,
    note,
    local_date,
    dedupe_key,
    reference_id,
    created_by
  )
  values (
    p_learner_id,
    'redemption',
    -v_item.sticker_cost,
    '兑换礼物：' || v_item.title,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_today,
    'redemption:' || v_redemption_id::text,
    v_redemption_id,
    (select auth.uid())
  );

  v_balance := v_balance - v_item.sticker_cost;

  return jsonb_build_object(
    'redeemed', true,
    'duplicate', false,
    'reason', 'redeemed',
    'balance', v_balance,
    'redemption_id', v_redemption_id,
    'title', v_item.title,
    'cost', v_item.sticker_cost
  );
end;
$$;

-- 误兑换不删除历史：把兑换标记为 reversed，并追加等额返还流水。
drop function if exists public.reverse_reward_redemption(uuid, text, uuid);
create function public.reverse_reward_redemption(
  p_redemption_id uuid,
  p_note text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_redemption public.reward_redemptions%rowtype;
  v_account public.reward_accounts%rowtype;
  v_balance integer;
  v_positive_count integer;
  v_sticker_code text;
begin
  if p_request_id is null then
    raise exception '缺少本次撤销编号' using errcode = '22023';
  end if;

  select redemption.*
  into v_redemption
  from public.reward_redemptions redemption
  join public.learner_profiles learner
    on learner.id = redemption.learner_id
   and learner.parent_user_id = (select auth.uid())
  where redemption.id = p_redemption_id;

  if not found then
    raise exception '找不到这条礼物兑换记录' using errcode = '42501';
  end if;

  insert into public.reward_accounts (learner_id)
  values (v_redemption.learner_id)
  on conflict (learner_id) do nothing;

  select *
  into v_account
  from public.reward_accounts account
  where account.learner_id = v_redemption.learner_id
  for update;

  select redemption.*
  into v_redemption
  from public.reward_redemptions redemption
  where redemption.id = p_redemption_id
  for update;

  if v_redemption.status = 'reversed' then
    select coalesce(sum(ledger.amount), 0)::integer
    into v_balance
    from public.reward_ledger ledger
    where ledger.learner_id = v_redemption.learner_id;

    return jsonb_build_object(
      'reversed', false,
      'duplicate', true,
      'reason', 'already_reversed',
      'balance', v_balance,
      'title', v_redemption.title_snapshot,
      'amount', v_redemption.sticker_cost
    );
  end if;

  select count(*)::integer
  into v_positive_count
  from public.reward_ledger ledger
  where ledger.learner_id = v_redemption.learner_id
    and ledger.amount > 0;

  v_sticker_code := (array[
    'sprout', 'sun', 'rabbit', 'whale', 'star',
    'flower', 'rocket', 'rainbow', 'bear', 'moon'
  ]::text[])[1 + (v_positive_count % 10)];

  update public.reward_redemptions redemption
  set status = 'reversed',
      reversed_at = now(),
      reversal_note = nullif(btrim(coalesce(p_note, '')), '')
  where redemption.id = p_redemption_id;

  insert into public.reward_ledger (
    learner_id,
    event_type,
    amount,
    title,
    note,
    sticker_code,
    local_date,
    dedupe_key,
    reference_id,
    created_by
  )
  values (
    v_redemption.learner_id,
    'redemption_reversal',
    v_redemption.sticker_cost,
    '撤销兑换：' || v_redemption.title_snapshot,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_sticker_code,
    v_redemption.local_date,
    'reversal:' || v_redemption.id::text,
    v_redemption.id,
    (select auth.uid())
  )
  on conflict (learner_id, dedupe_key) do nothing;

  select coalesce(sum(ledger.amount), 0)::integer
  into v_balance
  from public.reward_ledger ledger
  where ledger.learner_id = v_redemption.learner_id;

  return jsonb_build_object(
    'reversed', true,
    'duplicate', false,
    'reason', 'reversed',
    'balance', v_balance,
    'title', v_redemption.title_snapshot,
    'amount', v_redemption.sticker_cost,
    'sticker_code', v_sticker_code
  );
end;
$$;

revoke execute on function public.claim_hanzi_daily_reward(uuid) from public, anon;
revoke execute on function public.register_reward_activity(uuid, text, uuid) from public, anon;
revoke execute on function public.grant_manual_reward(uuid, text, integer, text, date, uuid) from public, anon;
revoke execute on function public.redeem_reward(uuid, uuid, text, uuid) from public, anon;
revoke execute on function public.reverse_reward_redemption(uuid, text, uuid) from public, anon;

grant execute on function public.claim_hanzi_daily_reward(uuid) to authenticated;
grant execute on function public.register_reward_activity(uuid, text, uuid) to authenticated;
grant execute on function public.grant_manual_reward(uuid, text, integer, text, date, uuid) to authenticated;
grant execute on function public.redeem_reward(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.reverse_reward_redemption(uuid, text, uuid) to authenticated;

commit;

-- 运行后快速检查：应返回 5 张表和 5 个函数。
select
  (select count(*) from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'reward_accounts',
        'reward_ledger',
        'reward_growth_events',
        'reward_catalog_items',
        'reward_redemptions'
      )) as reward_table_count,
  (select count(*) from information_schema.routines
    where routine_schema = 'public'
      and routine_name in (
        'claim_hanzi_daily_reward',
        'register_reward_activity',
        'grant_manual_reward',
        'redeem_reward',
        'reverse_reward_redemption'
      )) as reward_function_count;
