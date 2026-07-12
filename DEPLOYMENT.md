# 字芽 MVP｜保姆级部署与首次测试

这份手册假定项目根目录是 `汉字学习系统方案`，且你已经把 Supabase 与 Azure 的环境变量写在本目录 `.env.local`。**不要把 `.env.local` 上传到 Git、聊天窗口或 Vercel 的公开变量。**

## 0. 这次会得到什么

完成后，你会有一个可安装到 iPhone/iPad 的网页应用：

1. 家长用邮箱和密码登录；
2. 创建孩子昵称；
3. 上传一份汉字 CSV；
4. 孩子逐张学习，回答“我认识 / 再学一次”；
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
7. 成功后，在 SQL Editor 依次执行下面两段验证；两段都应返回结果或空表，不应报权限/函数不存在错误。

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('learner_profiles', 'characters', 'learning_states', 'learning_attempts')
order by table_name;
```

```sql
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('get_today_queue', 'answer_queue_item', 'get_library_progress', 'get_library_rows');
```

如果你已经运行过 001、并且学习页显示 `structure of query does not match function result type`，不要删除任何表；只运行 [supabase/002_fix_get_today_queue.sql](./supabase/002_fix_get_today_queue.sql)，然后刷新学习页。

如果你是在本次“字库学习状态 / 分页”功能更新前就已经运行过 001，请额外运行一次 [supabase/004_library_pagination.sql](./supabase/004_library_pagination.sql)。它只新增一个只读汇总函数，不会删除或修改孩子、字库和学习记录。此前已经运行过的 003 可以保留，不需要删除。

若需要在家长页选择每天 40 或 50 个新字，请再运行 [supabase/005_daily_new_limit_50.sql](./supabase/005_daily_new_limit_50.sql)。它只放宽每日新字数量的数据库校验，不会重排当天已生成的学习任务。

若已经为同一个孩子导入过多份 CSV，请运行 [supabase/006_multi_package_library.sql](./supabase/006_multi_package_library.sql)。它会建立“孩子 ↔ 字册”的长期关系，并自动回填历史数据：优先使用当前字册、已有学习记录；只有一个孩子的账号会把剩余历史字册安全归给该孩子。不会删除任何字册或学习记录。

### 2.1 SQL 做了什么，为什么必须整段运行

- 建立内容、孩子、当前学习状态、每日队列、不可变回答历史等基础表；006 额外建立“孩子 ↔ 字册”关联表。
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
AZURE_OPENAI_ENDPOINT=
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_DEPLOYMENT=
AZURE_OPENAI_API_VERSION=2024-10-21
```

你现有 `.env.local` 的 Supabase/Azure 字段已经符合这套命名。MVP 核心只需要 Supabase；Azure Speech 和 OpenAI 缺失时分别退回浏览器朗读/不显示生成内容，学习记录不受影响。

安全检查：

- `NEXT_PUBLIC_` 只允许 Supabase URL 与 anon/publishable key；它们设计上可在浏览器使用。
- **绝不**给 `AZURE_*`、Supabase `service_role` 加 `NEXT_PUBLIC_` 前缀。
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
5. 对一张复习字点击“再学一次”，确认它在队列末尾出现一次强化卡。
6. 强化卡答“我认识”后刷新页面，确认它不会恢复原等级，而会留在降级后的状态、次日优先。
7. 到 Supabase Table Editor → `learning_attempts`，确认每一次回答都有独立记录。
8. 到“字库”页，确认默认“全部已导入字册”能显示每份 CSV 的汉字；按“来源字册”筛选其中一份，并展开一个字确认回答次数、阶段、下次复习日和来源字册正确显示；确认每页只显示 48 个字并可翻页。

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
- 前期若孩子已有识字基础，可在家长页临时选择每天 20–50 个新字做快速摸底；摸底结束后建议改为 8–10 个。每个新字当天还会有一次强化确认，因此 50 个新字最多可能形成约 100 次卡片回答。当天已生成的任务不会被取消，新的上限会补充后续未加入的字。

## 8. 常见问题

### 注册后没有收到邮件

先查垃圾邮件；确认 Supabase Email provider 已启用，Site URL/Redirect URL 正确。测试阶段也可在 Supabase Auth 的 Users 页面人工确认测试用户。

### 页面显示“未找到可用的孩子档案或已发布学习包”

一般是孩子没有 active package，或 SQL 没有完整运行。到家长页重新上传样例 CSV；若仍失败，重新执行 `001_hanzi_mvp.sql`（它的 `create table if not exists` 与 `create or replace function` 可安全重复运行）。

### 朗读没有声音

先点击一次“听一听”（iOS 不允许未经点击自动播音）。检查 `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` 是否添加到 Vercel；Azure 失败会退回浏览器朗读，Safari 的中文语音取决于系统语音包。

### Vercel 构建失败，说找不到环境变量

确认变量加在 **Vercel 项目**里而不是只留在本机 `.env.local`，然后 Redeploy。`NEXT_PUBLIC_SUPABASE_URL` 和 anon/publishable key 必须在构建阶段存在。

### 怎么备份

在 Supabase Dashboard 定期导出数据库备份；至少备份 `content_packages`、`characters`、`package_characters`、`learner_profiles`、`learning_states`、`learning_attempts`。不要只备份当前状态，回答历史才是以后调算法的依据。

## 9. 升级原则

开始新增古诗、音乐、录音或 AI 审核前，先阅读 [ARCHITECTURE.md](./ARCHITECTURE.md)。尤其不要直接修改 `answer_queue_item`：复习规则、SQL 函数、前端文案与测试案例必须同时改。
