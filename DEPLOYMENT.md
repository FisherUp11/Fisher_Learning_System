# 字芽 MVP｜保姆级部署与首次测试

这份手册假定项目根目录是 `Fisher_Learning_System`，且你已经把 Supabase 与 Azure 的环境变量写在本目录 `.env.local`。**不要把 `.env.local` 上传到 Git、聊天窗口或 Vercel 的公开变量。**

## 0. 这次会得到什么

完成后，你会有一个可安装到 iPhone/iPad 的网页应用：

1. 家长用邮箱和密码登录；
2. 创建孩子昵称；
3. 上传一份汉字 CSV；
4. 孩子逐张学习，使用“我自己认出来了 / 还要再学一次”完成动态双确认；
5. Supabase 保存全部尝试记录，并根据阶段自动安排下一次；
6. 朗读优先使用 Azure Speech；Azure 不可用时自动退回浏览器中文朗读。

## 1. 首次准备清单

- [ ] 一个 Supabase 项目。
- [ ] 一个 Vercel 账号/团队（可先只在本机测试）。
- [ ] Node.js 20.9+；本机已经检测到 Node 24，可以直接使用。
- [ ] 本目录的 `.env.local` 不为空。
- [ ] 准备好 `samples/characters-sample.csv`，先只导入 30 字，而不是马上 1300 字。

## 2. 在 Supabase 创建数据库

1. 打开 Supabase Dashboard → 对应项目 → **SQL Editor** → **New query**。
2. 打开本地文件 [supabase/001_hanzi_mvp.sql](./supabase/001_hanzi_mvp.sql)，复制**全部内容**到 SQL Editor。
3. 点击 **Run**。首次运行通常只需要几秒。
4. 再打开 [supabase/004_library_pagination.sql](./supabase/004_library_pagination.sql)，复制**全部内容**到 SQL Editor 并点击 **Run**。它为“字库”提供服务端筛选与分页。
5. 再运行 [supabase/005_daily_new_limit_50.sql](./supabase/005_daily_new_limit_50.sql)，使“家长”页的 20–50 个新字冲刺选项生效。
6. 再运行 [supabase/006_multi_package_library.sql](./supabase/006_multi_package_library.sql)，使每个孩子保留全部历史导入字册，并让“字库”可以按来源字册筛选。
7. 再运行 [supabase/007_queue_count_and_memory_image.sql](./supabase/007_queue_count_and_memory_image.sql)，补齐联想图版本所需的回答函数；后续 `014` 会再升级为按不同汉字统计的动态双确认。
8. 再运行 [supabase/008_poem_recitation_mvp.sql](./supabase/008_poem_recitation_mvp.sql)，启用诗词册、每次背诵打卡、可选评分和背诵日期记录。
9. 再运行 [supabase/009_music_learning_mvp.sql](./supabase/009_music_learning_mvp.sql)，启用“唱一唱 / 辨声音 / 打节奏”、孩子分配、每次练习历史和音乐记忆阶段。
10. 再运行 [supabase/010_catechism_learning_mvp.sql](./supabase/010_catechism_learning_mvp.sql)，启用儿童信仰问答、多问答册、双语内容、每日新问/复习设置和记忆阶段。
11. 再运行 [supabase/011_priority_character_learning.sql](./supabase/011_priority_character_learning.sql)，启用孩子级重点字、跨全部字册优先学习、重点筛选和统计。它不修改答错降级或复习间隔。
12. 再运行 [supabase/012_reward_sticker_module.sql](./supabase/012_reward_sticker_module.sql)，启用小芽贴纸册、成长星、家长手工贴纸、礼物兑换和撤销。它不修改任何学习模块的复习规则。
13. 再运行 [supabase/013_fix_get_today_queue_session_id_ambiguity.sql](./supabase/013_fix_get_today_queue_session_id_ambiguity.sql)，修复跨日带入未完成汉字时的 `session_id is ambiguous`；它只替换队列函数，不改学习数据。
14. 再运行 [supabase/014_dynamic_double_confirmation.sql](./supabase/014_dynamic_double_confirmation.sql)，启用新字/不稳定字连续两次独立认出、稳定字一次确认、柔和降级和不限次数的当天队尾重试。
15. 成功后，在 SQL Editor 依次执行下面两段验证；两段都应返回结果或空表，不应报权限/函数不存在错误。

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'learner_profiles', 'characters', 'learning_states', 'learning_attempts',
    'daily_character_progress',
    'learner_character_priorities',
    'poems', 'poem_recitation_attempts',
    'music_items', 'music_assets', 'music_learning_states', 'music_practice_attempts',
    'catechism_collections', 'catechism_items', 'learner_catechism_collections',
    'catechism_learning_states', 'catechism_attempts',
    'reward_accounts', 'reward_ledger', 'reward_growth_events',
    'reward_catalog_items', 'reward_redemptions'
  )
order by table_name;
```

```sql
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'get_today_queue', 'answer_queue_item', 'get_library_progress', 'get_library_rows',
    'set_character_priorities', 'record_music_practice', 'record_catechism_attempt',
    'claim_hanzi_daily_reward', 'register_reward_activity', 'grant_manual_reward',
    'redeem_reward', 'reverse_reward_redemption'
  );
```

如果你已经运行过 001、并且学习页显示 `structure of query does not match function result type`，不要删除任何表；只运行 [supabase/002_fix_get_today_queue.sql](./supabase/002_fix_get_today_queue.sql)，然后刷新学习页。

如果你是在本次“字库学习状态 / 分页”功能更新前就已经运行过 001，请额外运行一次 [supabase/004_library_pagination.sql](./supabase/004_library_pagination.sql)。它只新增一个只读汇总函数，不会删除或修改孩子、字库和学习记录。此前已经运行过的 003 可以保留，不需要删除。

若需要在家长页选择每天 40 或 50 个新字，请再运行 [supabase/005_daily_new_limit_50.sql](./supabase/005_daily_new_limit_50.sql)。它只放宽每日新字数量的数据库校验，不会重排当天已生成的学习任务。

若已经为同一个孩子导入过多份 CSV，请运行 [supabase/006_multi_package_library.sql](./supabase/006_multi_package_library.sql)。它会建立“孩子 ↔ 字册”的长期关系，并自动回填历史数据：优先使用当前字册、已有学习记录；只有一个孩子的账号会把剩余历史字册安全归给该孩子。不会删除任何字册或学习记录。

若已更新到“联想图 / 准确待答数”版本，请再运行 [supabase/007_queue_count_and_memory_image.sql](./supabase/007_queue_count_and_memory_image.sql)。它只替换 `answer_queue_item` 函数，让每次回答返回事务完成后的真实待答次数；不会改变复习规则或删除任何数据。

若已更新到诗词背诵版本，请再运行 [supabase/008_poem_recitation_mvp.sql](./supabase/008_poem_recitation_mvp.sql)。它会新建 `poem_collections`、`poems`、`learner_poem_collections` 与 `poem_recitation_attempts` 等表，并对所有新表启用 RLS；不会修改汉字队列、学习阶段或任何旧数据。

若已更新到音乐学习版本，请再运行 [supabase/009_music_learning_mvp.sql](./supabase/009_music_learning_mvp.sql)。它只新增音乐专用表、RLS 和一个练习 RPC，不修改汉字/诗词数据。文件本体放在 Cloudflare R2，数据库仅保存对象键与文件元数据。

若已更新到儿童信仰问答版本，请再运行 [supabase/010_catechism_learning_mvp.sql](./supabase/010_catechism_learning_mvp.sql)。它会给孩子档案增加默认“每天 3 个新问题、最多 10 个到期复习”的独立设置，并新增五张问答专用表、RLS 与 `record_catechism_attempt` RPC；不会修改汉字、诗词或音乐历史。

若已更新到汉字重点字版本，请再运行 [supabase/011_priority_character_learning.sql](./supabase/011_priority_character_learning.sql)。它会新增 `learner_character_priorities` 和原子批量保存 RPC，并替换 `get_today_queue` / `get_library_rows` 的当前版本。重点字只改变候选顺序：不会提前于 `due_at` 复习，不会增加每日新字总量，也不会修改 `answer_queue_item` 或已有学习历史。前端和 `011` 必须一起上线，否则“册”会明确提示先运行脚本。

若已更新到奖励贴纸版本，请再运行 [supabase/012_reward_sticker_module.sql](./supabase/012_reward_sticker_module.sql)。它只读取汉字、诗词和音乐的真实练习记录来判断奖励，并新增独立的奖励账户、不可变贴纸流水、成长星、礼物与兑换表。奖励调用失败不会阻断原学习记录保存。详细规则见 [小芽贴纸册说明](./13_奖励贴纸模块说明.md)。

若学习页提示 `column reference "session_id" is ambiguous` 或生产环境只显示 Server Components 通用错误，请运行 [supabase/013_fix_get_today_queue_session_id_ambiguity.sql](./supabase/013_fix_get_today_queue_session_id_ambiguity.sql)。它修复旧日 `pending` 卡片带入今天时的冲突目标歧义，不删除当天队列或历史。

若前端提示“学习规则需要升级”或找不到五参数 `answer_queue_item`，请完整运行 [supabase/014_dynamic_double_confirmation.sql](./supabase/014_dynamic_double_confirmation.sql)。它新增每日单字确认进度和可编号的重试卡，不删除旧回答；当天已经按旧规则完成且没有待答卡的字继续视为完成。

### 2.1 SQL 做了什么，为什么必须整段运行

- 建立内容、孩子、当前学习状态、每日队列、不可变回答历史等基础表；006 额外建立“孩子 ↔ 字册”关联表；008 建立诗词内容与背诵记录；009 建立音乐内容、媒体元数据、练习状态与历史；010 建立双语信仰问答、孩子分配、学习状态与每次判断历史；011 建立孩子级重点字及其安全保存/查询入口；012 建立贴纸流水、成长星、礼物与兑换记录；014 建立一天一个字的独立确认进度。
- 所有表都开启 RLS；每位家长只能看到自己孩子/内容的数据。
- 创建 `get_today_queue`、`answer_queue_item` 与字库汇总函数；004/006 会把字库查询升级为可分页、可按历史导入包筛选的版本。
- 函数只授予 `authenticated` 执行权，并在函数内再次核验 `auth.uid()` 是否拥有该孩子档案。

不要只复制建表部分、漏掉最后的 RLS/function grant；那会导致应用无法安全工作。

## 3. 配置 Supabase Auth

在 Supabase Dashboard → **Authentication → URL Configuration**：

1. **Site URL**：本机测试填 `http://localhost:3000`；正式部署后改成你的 Vercel 域名，例如 `https://ziya.example.com`。
2. **Redirect URLs**：至少加入：

```text
http://localhost:3000/auth/callback
https://你的-vercel-域名/auth/callback
```

3. **Authentication → Providers → Email**：打开 Email provider。
4. 测试期可保留“确认邮箱”开启；注册后去邮箱点确认链接，再回来登录。

密码最少 6 位是 Supabase 默认规则；实际家庭使用建议设更长的家长密码。

## 4. 检查本地环境变量

当前代码会读取如下变量：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# 可选的新式键名：NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=

AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
# 可选；不填时使用默认的中文女声和美式英语女声
AZURE_SPEECH_ZH_VOICE=zh-CN-XiaoxiaoNeural
AZURE_SPEECH_EN_VOICE=en-US-JennyNeural
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_API_VERSION=2024-10-21

# 可选：Azure 中部署 gpt-image-1-mini 后的部署名与该部署可用的 API 版本
AZURE_IMAGE_DEPLOYMENT=
AZURE_IMAGE_API_VERSION=

# 音乐模块：Cloudflare R2 私有 Bucket
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=fisher-learning-media
```

你现有 `.env.local` 的 Supabase/Azure 字段已经符合这套命名。MVP 核心只需要 Supabase；Azure Speech 和 OpenAI 缺失时分别退回浏览器朗读/不显示生成内容，学习记录不受影响。音乐文件上传与播放需要 4 个 `R2_*` 变量，请按 [Cloudflare R2 保姆级配置教程](./10_Cloudflare_R2保姆级配置教程.md) 操作。

安全检查：

- `NEXT_PUBLIC_` 只允许 Supabase URL 与 anon/publishable key；它们设计上可在浏览器使用。
- **绝不**给 `AZURE_*`、`R2_*`、Supabase `service_role` 加 `NEXT_PUBLIC_` 前缀。
- 不要在客户端代码、CSV、日志或截图中记录任何密钥。

## 5. 本机启动

在本目录运行：

```bash
npm install
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

### 5.1 首轮真实验收（建议按顺序做）

1. 创建一个家长账号；如果系统要求确认邮箱，先完成确认。
2. 登录后到“家长”页，创建孩子档案，例如“小满”。
3. 点击下载 `characters-sample.csv`，不修改内容直接上传。
4. 去“学一学”，完成 30 字中的一轮。
5. 对一个新字第一次点击“我自己认出来了”，确认页面显示 1/2 且它在队尾再次出现；第二次独立认出后才显示今日通过并升到 stage 1。
6. 对 stage 3 以上到期字第一次独立认出，确认一次即可通过；对 stage 2 字点“还要再学一次”，确认只降到 stage 1，并且后续当天再错不继续降级。
7. 点击汉字朗读、答案或联想图后，确认本轮提示“得到过帮助”，不会增加独立确认；学好后字卡重新隐藏答案并排到队尾。
8. 到 Supabase Table Editor → `learning_attempts`，确认每次回答都有独立记录和 `assisted/attempt_number/clean_streak_after`；在 `daily_character_progress` 确认一天一个字一行。
9. 到“字库”页，确认默认“全部已导入字册”能显示每份 CSV 的汉字；按“来源字册”筛选其中一份，并展开一个字确认回答次数、阶段、下次复习日和来源字册正确显示；确认每页只显示 48 个字并可翻页。
10. 在“册”中勾选来自两次不同 CSV 的 5–10 个字，点击“保存本页重点字”；确认顶部重点统计、重点筛选和每行“重点”标识同步更新。每日新字设为 5 时，新任务仍不超过 5 个新字，并优先取未学重点字；未到期重点字不应提前出现。详细验收见 [汉字重点字功能说明](./12_汉字重点字功能说明.md)。
11. 已配置图片模型时，在“学一学”点击“看联想图”，确认出现无文字的儿童联想插图；本轮应标记为得到帮助，稍后重新隐藏图片和答案再独立认。
12. 到“家长”页下载 `poems-template.csv`，用模板中的 3 首先试跑或填入第一批 28 首后上传；在顶部“学习模块”打开“诗词背诵”，点进一首诗，连续点击两次“今天背过一次”，确认页面显示 2 条记录、Supabase `poem_recitation_attempts` 也有同一日期的 2 行。再试一次“暂不评分”，确认该行保留且标为未评分。
13. 按 [Cloudflare R2 保姆级配置教程](./10_Cloudflare_R2保姆级配置教程.md) 创建私有 Bucket、CORS 和 Token；在“学习模块 → 音乐天地 → 家长管理”创建一首测试歌曲，上传 MP3、分配孩子并发布；在孩子页播放后点一次练习结果，确认 `music_practice_attempts` 新增 1 行。
14. 到“家长 → 儿童信仰问答”下载 CSV 模板，先导入模板中的 2 问并发布；打开“问一问”，确认中英文分别朗读、答案揭晓后才能判断。对同一问连续两次点“背出来了”，确认 `catechism_attempts` 同日保留 2 行但阶段只升级一次；随后“单独练这一问”点“还要再背”，确认历史新增且答错降级一次。
15. 打开“奖励管理”，新增一个 10 枚贴纸的测试礼物；完成当天全部汉字卡，确认仅出现一次贴纸庆祝且 `reward_ledger` 只有一条当天 `hanzi_daily`。同一首诗当天打卡两次应只加一颗成长星；同一首歌仅听不加星；每天第三个不同的诗词/音乐项目保存练习但不再加星。累计三颗星后应自动发 1 枚贴纸。
16. 在“奖励管理”给今天的数学作业加 1 枚，再重复提交，余额只能增加一次；测试一次礼物兑换，确认扣除正确，再点撤销，确认余额返还且原兑换记录显示“已撤销”。完整验收见 [小芽贴纸册说明](./13_奖励贴纸模块说明.md)。

如果第 3 步上传后“学一学”仍显示空字册，请先刷新一次页面；仍失败时查看浏览器控制台与 Vercel/Next 终端错误，再检查 SQL 是否完整运行。

## 6. 发布到 Vercel

推荐方式：把本目录单独建为一个 Git 仓库，推到 GitHub 后在 Vercel 导入。这样不会和现有英语系统混在同一个部署项目里。

### 6.1 Vercel Dashboard 导入

1. 把本目录提交到自己的 Git 仓库；确认 `.env.local` 没有被提交。
2. 打开 Vercel → **Add New → Project** → 导入仓库。
3. Framework Preset 选择 **Next.js**；Root Directory 选本目录（如果仓库根目录就是本项目，则无需填写）。
4. 在 **Environment Variables** 中逐项加入第 4 节的变量。选择 Production、Preview、Development 三种环境均可；若 Azure 暂时不用，可只填 Supabase 两项。
5. 点击 Deploy。
6. 第一次部署成功后，回到 Supabase 的 URL Configuration，把 Vercel 正式地址补进 Site URL / Redirect URLs。

### 6.2 生产验证

- [ ] 用 Safari iPhone 打开 Vercel URL，可登录、创建档案、导入 CSV、完成答题。
- [ ] 点击分享 → 添加到主屏幕，打开后能回到“学一学”。
- [ ] 在 iPad 横竖屏下，大字和底部按钮不被安全区遮挡。
- [ ] 断开 Azure 配置或临时让 Speech 请求失败时，浏览器朗读仍可工作。
- [ ] 用两个不同邮箱的测试家长 A/B，确认 B 看不到 A 的孩子、字包、尝试记录。

## 7. 导入 1300 字前的内容检查

先连续试用 7 天、确认孩子实际能完成，再导入 1300 字。导入 CSV 的最低格式：

```csv
character,pinyin_marked,meaning,word_1,word_2,example_sentence,sequence
山,shān,高高的山,大山,山上,山上有一棵树。,1
```

- `character`：恰好一个汉字，整个文件不能重复。
- `pinyin_marked`：带声调，例如 `shān`。
- `meaning`：儿童能懂的短释义。
- `sequence`：学习顺序；建议先从高频、容易造词的字开始。
- 一次上传一个学习包。重新上传会创建新包并把当前孩子切换到新包，不会删除旧记录。
- 前期若孩子已有识字基础，可在家长页临时选择每天 20–50 个新字做快速摸底；摸底结束后建议改为 8–10 个。新字和 stage 0–2 需要连续两次独立认出，没认出时还会继续排到队尾，因此 50 个新字至少会形成约 100 次卡片回答，实际可能更多。**当天已生成的任务不会被取消或重排；保存后的新上限会在孩子时区的下一天自动生效。**

## 8. 常见问题

### 诗词页提示缺少表或权限错误

先确认完整运行了 [supabase/008_poem_recitation_mvp.sql](./supabase/008_poem_recitation_mvp.sql)，不要只复制其中的 `create table`。脚本末尾的 RLS policy 与 `grant` 同样必需。然后刷新浏览器；仍有问题时，在 SQL Editor 执行：

```sql
select id, poem_key, title from public.poems order by created_at desc limit 10;
select learner_id, poem_id, recited_local_date, score from public.poem_recitation_attempts order by recited_at desc limit 20;
```

若第一句能返回诗词、第二句在打卡后能返回记录，说明数据层正常，接着检查是否在页面选择了正确的孩子。

### 信仰问答页提示缺少表、列或 RPC

完整运行 [supabase/010_catechism_learning_mvp.sql](./supabase/010_catechism_learning_mvp.sql)，不要只运行建表部分。运行后可在 SQL Editor 检查：

```sql
select id, title, status from public.catechism_collections order by created_at desc;
select item_key, sort_order, question_zh from public.catechism_items order by sort_order limit 10;
select learner_id, item_id, result, practiced_local_date, stage_before, stage_after
from public.catechism_attempts order by practiced_at desc limit 20;
```

如果 SQL Editor 能查到新表但网页仍提示 schema cache 错误，先等待十几秒并刷新页面；仍未恢复时，在 Supabase Dashboard 的 Data API 设置确认 `public` schema 已暴露。脚本已经显式给 `authenticated` 授权，但 Data API 的 schema 暴露开关仍是独立设置。

### 贴纸页提示 `reward_...` 或奖励函数不存在

完整运行 [supabase/012_reward_sticker_module.sql](./supabase/012_reward_sticker_module.sql)，不要只运行前半段建表。脚本最后应显示 `reward_table_count = 5`、`reward_function_count = 5`。

如果学习记录已成功保存、但提示贴纸暂未同步，先不要重复点击学习按钮。运行 `012` 后刷新贴纸册；奖励模块故意不会让自身故障阻断汉字、诗词或音乐记录。若当天汉字已经在运行 `012` 前完成，可由家长在“奖励管理 → 特别表扬”补 1 枚并写明原因。

同一首诗/音乐同一天只加一颗星、同一天最多两颗星、数学同一天只发一枚，都属于预期去重规则，不是保存失败。

### 注册后没有收到邮件

先查垃圾邮件；确认 Supabase Email provider 已启用，Site URL/Redirect URL 正确。测试阶段也可在 Supabase Auth 的 Users 页面人工确认测试用户。

### 页面显示“未找到可用的孩子档案或已发布学习包”

一般是孩子没有 active package，或 SQL 没有完整运行。到家长页重新上传样例 CSV；若仍失败，重新执行 `001_hanzi_mvp.sql`（它的 `create table if not exists` 与 `create or replace function` 可安全重复运行）。

### 汉字页显示 Server Components 通用错误

先查看 Next.js/Vercel 服务端日志。如果真实错误是：

```text
column reference "session_id" is ambiguous
```

完整运行 [supabase/013_fix_get_today_queue_session_id_ambiguity.sql](./supabase/013_fix_get_today_queue_session_id_ambiguity.sql)，然后刷新“学一学”。该问题只会在存在前一天未完成卡片、系统尝试跨日带入时触发，因此可能表现为“有时能打开，有时报错”。

### 学习页提示“学习规则需要升级”

完整运行 [supabase/014_dynamic_double_confirmation.sql](./supabase/014_dynamic_double_confirmation.sql)，确认脚本末尾返回 `progress_table_count = 1`、`queue_function_count = 1`、`answer_function_count = 1`，再刷新页面。新版前端依赖 `daily_character_progress` 以及五参数 `answer_queue_item`，因此 SQL 必须先于或同时于前端部署。

### 朗读没有声音

先点击一次“听一听”（iOS 不允许未经点击自动播音）。检查 `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` 是否添加到 Vercel；Azure 失败会退回浏览器朗读，Safari 的中文语音取决于系统语音包。

### Vercel 构建失败，说找不到环境变量

确认变量加在 **Vercel 项目**里而不是只留在本机 `.env.local`，然后 Redeploy。`NEXT_PUBLIC_SUPABASE_URL` 和 anon/publishable key 必须在构建阶段存在。

### 怎么备份

在 Supabase Dashboard 定期导出数据库备份。每次运行新 SQL 迁移前至少备份以下数据：

- 识字：`content_packages`、`characters`、`package_characters`、`learner_profiles`、`learning_states`、`learning_attempts`、`daily_sessions`、`daily_session_items`、`daily_character_progress`；
- 诗词：`poem_collections`、`poems`、`learner_poem_collections`、`poem_recitation_attempts`；
- 音乐：`music_items`、`music_assets`、`learner_music_items`、`music_learning_states`、`music_practice_attempts`；
- 信仰问答：`catechism_collections`、`catechism_items`、`learner_catechism_collections`、`catechism_learning_states`、`catechism_attempts`。
- 奖励：`reward_accounts`、`reward_ledger`、`reward_growth_events`、`reward_catalog_items`、`reward_redemptions`。

不要只备份当前状态，逐次练习历史才是以后解释进度和调整算法的依据。R2 里的 MP3/琴谱不在 Supabase 数据库备份内，需要另行保留源文件或做 R2 备份。

## 9. 升级原则

开始新增模块、录音或 AI 审核前，先阅读 [ARCHITECTURE.md](./ARCHITECTURE.md)。不要直接在生产库临时修改复习函数：复习规则、编号 SQL 迁移、前端文案与测试案例必须同时改。问答模块尤其不能直接写 `catechism_learning_states` 或改删 `catechism_attempts`。
