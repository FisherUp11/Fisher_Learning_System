-- 033｜诗词音乐视频外链。先在 Supabase SQL Editor 运行，再部署对应前端。
-- 只保存小鹅通课程页地址；不复制视频、不打通小鹅通账号，也不把观看自动计作背诵。
begin;

alter table public.poems
  add column if not exists music_video_url text;

-- 本次已确认的《咏柳》链接，仅写入当前 owner 所属空间的同名同作者诗。
-- 其他家庭若无该课程权益，仍需在小鹅通自行登录/获得授权。
update public.poems as poem
set music_video_url = 'https://appw1uy9xm82376.h5.xiaoeknow.com/p/course/video/v_69fab321e4b0694c3503fade?product_id=course_3DKib9wDUxcozoMOyVRhu8s3TPJ&course_id=course_3DKib9wDUxcozoMOyVRhu8s3TPJ',
    updated_at = now()
where poem.title = '咏柳'
  and poem.author = '贺知章'
  and poem.music_video_url is null
  and exists (
    select 1
    from public.workspace_members as member
    join auth.users as account on account.id = member.user_id
    where member.workspace_id = poem.workspace_id
      and member.role = 'owner'
      and lower(account.email) = 'xiangyufei11@gmail.com'
  );

commit;

notify pgrst, 'reload schema';

-- 运行后检查：结果里应能看到《咏柳》的 music_video_url。
select poem.title, poem.author, poem.music_video_url
from public.poems as poem
where poem.title = '咏柳' and poem.author = '贺知章';
