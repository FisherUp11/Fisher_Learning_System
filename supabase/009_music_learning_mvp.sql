-- 字芽：音乐学习模块（唱一唱、辨声音、打节奏）。
-- 请在已运行 001 与后续增量脚本后，于 Supabase Dashboard → SQL Editor 整段执行。
-- 此脚本只新增音乐表、RLS 与 record_music_practice RPC，不改写汉字或诗词记录。

begin;

create table if not exists public.music_items (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  item_type text not null check (item_type in ('song', 'instrument', 'rhythm')),
  title text not null check (char_length(title) between 1 and 100),
  category text check (category is null or char_length(category) <= 60),
  description text check (description is null or char_length(description) <= 500),
  lyrics text check (lyrics is null or char_length(lyrics) <= 12000),
  correct_answer text check (correct_answer is null or char_length(correct_answer) <= 100),
  instructions text check (instructions is null or char_length(instructions) <= 2000),
  difficulty smallint not null default 1 check (difficulty between 1 and 5),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.music_assets (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.music_items(id) on delete cascade,
  asset_type text not null check (asset_type in ('audio', 'cover', 'score', 'instrument_image', 'rhythm_sheet', 'demo_audio')),
  object_key text not null check (char_length(object_key) between 1 and 500),
  original_name text not null check (char_length(original_name) between 1 and 255),
  content_type text not null check (char_length(content_type) between 1 and 100),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 104857600),
  label text check (label is null or char_length(label) <= 60),
  sequence integer not null default 1 check (sequence > 0),
  created_at timestamptz not null default now(),
  unique (item_id, object_key)
);

create table if not exists public.learner_music_items (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  item_id uuid not null references public.music_items(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (learner_id, item_id)
);

create table if not exists public.music_learning_states (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  item_id uuid not null references public.music_items(id) on delete cascade,
  stage smallint not null default 0 check (stage between 0 and 7),
  due_at timestamptz not null default now(),
  last_result text,
  consecutive_success integer not null default 0 check (consecutive_success >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id, item_id)
);

create table if not exists public.music_practice_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  item_id uuid not null references public.music_items(id) on delete cascade,
  result text not null check (result in (
    'song_listened', 'song_sang_along', 'song_prompted', 'song_independent',
    'instrument_known', 'instrument_again', 'rhythm_known', 'rhythm_again'
  )),
  guess_note text check (guess_note is null or char_length(guess_note) <= 300),
  previous_stage smallint not null check (previous_stage between 0 and 7),
  next_stage smallint not null check (next_stage between 0 and 7),
  next_due_at timestamptz not null,
  practiced_local_date date not null,
  practiced_at timestamptz not null default now()
);

create index if not exists music_items_owner_type_idx on public.music_items (created_by, item_type, status);
create index if not exists music_assets_item_order_idx on public.music_assets (item_id, asset_type, sequence);
create unique index if not exists music_assets_singleton_idx on public.music_assets (item_id, asset_type)
where asset_type in ('audio', 'cover', 'instrument_image', 'rhythm_sheet', 'demo_audio');
create index if not exists learner_music_items_learner_idx on public.learner_music_items (learner_id, assigned_at);
create index if not exists music_states_due_idx on public.music_learning_states (learner_id, due_at, stage);
create index if not exists music_attempts_history_idx on public.music_practice_attempts (learner_id, item_id, practiced_at desc);
create index if not exists music_attempts_date_idx on public.music_practice_attempts (learner_id, practiced_local_date desc);

alter table public.music_items enable row level security;
alter table public.music_assets enable row level security;
alter table public.learner_music_items enable row level security;
alter table public.music_learning_states enable row level security;
alter table public.music_practice_attempts enable row level security;

drop policy if exists "music owner reads items" on public.music_items;
drop policy if exists "music owner writes items" on public.music_items;
create policy "music owner reads items" on public.music_items for select to authenticated
using (created_by = (select auth.uid()));
create policy "music owner writes items" on public.music_items for all to authenticated
using (created_by = (select auth.uid()))
with check (created_by = (select auth.uid()));

drop policy if exists "music owner reads assets" on public.music_assets;
drop policy if exists "music owner writes assets" on public.music_assets;
create policy "music owner reads assets" on public.music_assets for select to authenticated using (
  exists (select 1 from public.music_items m where m.id = item_id and m.created_by = (select auth.uid()))
);
create policy "music owner writes assets" on public.music_assets for all to authenticated using (
  exists (select 1 from public.music_items m where m.id = item_id and m.created_by = (select auth.uid()))
) with check (
  exists (select 1 from public.music_items m where m.id = item_id and m.created_by = (select auth.uid()))
);

drop policy if exists "parent reads learner music" on public.learner_music_items;
drop policy if exists "parent writes learner music" on public.learner_music_items;
create policy "parent reads learner music" on public.learner_music_items for select to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
);
create policy "parent writes learner music" on public.learner_music_items for all to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
) with check (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
  and exists (select 1 from public.music_items m where m.id = item_id and m.created_by = (select auth.uid()))
);

drop policy if exists "parent reads music states" on public.music_learning_states;
drop policy if exists "parent writes music states" on public.music_learning_states;
create policy "parent reads music states" on public.music_learning_states for select to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
);
create policy "parent writes music states" on public.music_learning_states for all to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
) with check (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
  and exists (select 1 from public.music_items m where m.id = item_id and m.created_by = (select auth.uid()))
);

drop policy if exists "parent reads music attempts" on public.music_practice_attempts;
drop policy if exists "parent writes music attempts" on public.music_practice_attempts;
create policy "parent reads music attempts" on public.music_practice_attempts for select to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
);
create policy "parent writes music attempts" on public.music_practice_attempts for all to authenticated using (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
) with check (
  exists (select 1 from public.learner_profiles l where l.id = learner_id and l.parent_user_id = (select auth.uid()))
  and exists (select 1 from public.music_items m where m.id = item_id and m.created_by = (select auth.uid()))
);

revoke all on public.music_items, public.music_assets, public.learner_music_items, public.music_learning_states, public.music_practice_attempts from anon;
grant select, insert, update, delete on public.music_items, public.music_assets, public.learner_music_items, public.music_learning_states, public.music_practice_attempts to authenticated;

drop function if exists public.record_music_practice(uuid, uuid, text, text, uuid);
create function public.record_music_practice(
  p_learner_id uuid,
  p_item_id uuid,
  p_result text,
  p_guess_note text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_timezone text;
  v_item_type text;
  v_state public.music_learning_states%rowtype;
  v_previous_stage smallint;
  v_next_stage smallint;
  v_next_due_at timestamptz;
  v_interval interval;
  v_success boolean := false;
begin
  if exists (select 1 from public.music_practice_attempts a where a.request_id = p_request_id) then
    return jsonb_build_object('idempotent', true);
  end if;

  select l.timezone into v_timezone
  from public.learner_profiles l
  where l.id = p_learner_id and l.parent_user_id = (select auth.uid());
  if not found then raise exception '无权操作该孩子档案' using errcode = '42501'; end if;

  select m.item_type into v_item_type
  from public.music_items m
  join public.learner_music_items lm on lm.item_id = m.id and lm.learner_id = p_learner_id
  where m.id = p_item_id and m.created_by = (select auth.uid()) and m.status = 'published';
  if not found then raise exception '找不到已分配给孩子的音乐内容' using errcode = '42501'; end if;

  if (v_item_type = 'song' and p_result not in ('song_listened', 'song_sang_along', 'song_prompted', 'song_independent'))
    or (v_item_type = 'instrument' and p_result not in ('instrument_known', 'instrument_again'))
    or (v_item_type = 'rhythm' and p_result not in ('rhythm_known', 'rhythm_again')) then
    raise exception '练习结果与内容类型不匹配' using errcode = '22023';
  end if;

  insert into public.music_learning_states (learner_id, item_id, stage, due_at)
  values (p_learner_id, p_item_id, 0, now())
  on conflict (learner_id, item_id) do nothing;

  select * into v_state from public.music_learning_states
  where learner_id = p_learner_id and item_id = p_item_id
  for update;
  v_previous_stage := v_state.stage;

  if p_result = 'song_listened' then
    v_next_stage := v_state.stage;
    v_next_due_at := now() + interval '1 day';
  elsif p_result = 'song_sang_along' then
    v_next_stage := greatest(1, v_state.stage);
    v_next_due_at := now() + interval '1 day';
  elsif p_result = 'song_prompted' then
    v_next_stage := least(7, greatest(2, v_state.stage + 1));
    v_success := true;
  elsif p_result in ('song_independent', 'instrument_known', 'rhythm_known') then
    v_next_stage := least(7, v_state.stage + 1);
    v_success := true;
  else
    v_next_stage := greatest(0, v_state.stage - 2);
    v_next_due_at := now() + interval '1 day';
  end if;

  if v_next_due_at is null then
    v_interval := case v_next_stage
      when 0 then interval '1 day'
      when 1 then interval '1 day'
      when 2 then interval '3 days'
      when 3 then interval '7 days'
      when 4 then interval '14 days'
      when 5 then interval '30 days'
      when 6 then interval '60 days'
      else case when v_state.stage = 7 then interval '180 days' else interval '90 days' end
    end;
    v_next_due_at := now() + v_interval;
  end if;

  update public.music_learning_states
  set stage = v_next_stage,
      due_at = v_next_due_at,
      last_result = p_result,
      consecutive_success = case
        when p_result = 'song_listened' then consecutive_success
        when v_success then consecutive_success + 1
        else 0
      end,
      updated_at = now()
  where id = v_state.id;

  insert into public.music_practice_attempts (
    request_id, learner_id, item_id, result, guess_note, previous_stage, next_stage, next_due_at, practiced_local_date
  ) values (
    p_request_id, p_learner_id, p_item_id, p_result, nullif(btrim(coalesce(p_guess_note, '')), ''),
    v_previous_stage, v_next_stage, v_next_due_at, (now() at time zone v_timezone)::date
  );

  return jsonb_build_object('next_stage', v_next_stage, 'next_due_at', v_next_due_at, 'idempotent', false);
end;
$$;

revoke execute on function public.record_music_practice(uuid, uuid, text, text, uuid) from public, anon;
grant execute on function public.record_music_practice(uuid, uuid, text, text, uuid) to authenticated;

commit;
