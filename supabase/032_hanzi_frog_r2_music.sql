-- 032：青蛙跳字岛配乐增加私有 R2 文件模式；保留 031 的在线 URL 记录。
-- 前置：030、031 已运行。先运行本 SQL，再部署包含上传／播放接口的新版代码。
begin;

alter table public.hanzi_frog_music_tracks
  add column if not exists source_type text not null default 'url',
  add column if not exists object_key text,
  add column if not exists original_name text,
  add column if not exists content_type text,
  add column if not exists byte_size integer;

alter table public.hanzi_frog_music_tracks alter column audio_url drop not null;

alter table public.hanzi_frog_music_tracks
  drop constraint if exists hanzi_frog_music_source_check;
alter table public.hanzi_frog_music_tracks
  add constraint hanzi_frog_music_source_check check (
    (source_type = 'url' and audio_url is not null and object_key is null
      and original_name is null and content_type is null and byte_size is null)
    or
    (source_type = 'r2' and audio_url is null and object_key is not null
      and object_key ~ '^hanzi-frog/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}[.](mp3|m4a)$'
      and original_name is not null and char_length(original_name) between 1 and 255
      and content_type in ('audio/mpeg', 'audio/mp4', 'audio/x-m4a')
      and byte_size between 1 and 31457280)
  );

create unique index if not exists hanzi_frog_music_object_key_idx
  on public.hanzi_frog_music_tracks(object_key) where object_key is not null;

commit;
