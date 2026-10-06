-- 031：青蛙跳字岛专用在线音频；不依赖音乐学习模块。
-- 前置：030 已运行。只保存家长提供的直连音频 URL，不抓取或转存第三方文件。
begin;

create table if not exists public.hanzi_frog_music_tracks (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  audio_url text not null check (char_length(audio_url) between 12 and 2048 and audio_url ~* '^https://'),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hanzi_frog_music_learner_idx
  on public.hanzi_frog_music_tracks(learner_id, created_at desc);
create index if not exists hanzi_frog_music_creator_idx
  on public.hanzi_frog_music_tracks(created_by);

alter table public.hanzi_frog_music_tracks enable row level security;
drop policy if exists "frog music child read" on public.hanzi_frog_music_tracks;
drop policy if exists "frog music child insert" on public.hanzi_frog_music_tracks;
drop policy if exists "frog music child update" on public.hanzi_frog_music_tracks;
drop policy if exists "frog music child delete" on public.hanzi_frog_music_tracks;
create policy "frog music child read" on public.hanzi_frog_music_tracks
  for select to authenticated using (private.can_access_learner(learner_id));
create policy "frog music child insert" on public.hanzi_frog_music_tracks
  for insert to authenticated with check
  (private.can_access_learner(learner_id) and created_by = (select auth.uid()));
create policy "frog music child update" on public.hanzi_frog_music_tracks
  for update to authenticated using (private.can_access_learner(learner_id))
  with check (private.can_access_learner(learner_id));
create policy "frog music child delete" on public.hanzi_frog_music_tracks
  for delete to authenticated using (private.can_access_learner(learner_id));
revoke all on public.hanzi_frog_music_tracks from anon, authenticated;
grant select, insert, update, delete on public.hanzi_frog_music_tracks to authenticated;

commit;
