# 24｜50 位孩子容量与 Azure 限额：部署和验收

适用范围：当前 `Fisher_Learning_System`，一个学习空间最多 50 个孩子档案。此上限不是“50 人同时在线”的性能承诺；真实峰值仍要在自己的 Supabase、Vercel、Azure 套餐上试跑。此次只加容量保护、用量提示和查询优化，不改汉字、诗词、音乐、问答的学习规则。

## 一、先做这三步，再部署代码

1. 在 Supabase Dashboard → 当前项目 → Database → Backups 确认最近备份；另保留 CSV 和 R2 原文件。不要在另一个项目运行 SQL。
2. 确认旧版已完成 `021_invitation_and_service_usage.sql` 和 `022_music_folders_activity_and_cost.sql`。打开 SQL Editor → New query，**完整复制并运行** [023_capacity_guard_50_learners.sql](./supabase/023_capacity_guard_50_learners.sql)。看到 Success 后等待 Data API schema cache 更新，再部署本次前端代码。可重跑 023，不删除孩子或学习历史。
3. 在 Vercel 项目 Environment Variables 确认 `NEXT_PUBLIC_SUPABASE_URL`、publishable/anon key、服务端 `SUPABASE_SECRET_KEY`（或旧 `SUPABASE_SERVICE_ROLE_KEY`）属于**同一个** Supabase 项目。Azure Key 也只能放服务端，不能加 `NEXT_PUBLIC_`。保存变量后 Redeploy，不能只改本机 `.env.local`。

**顺序很重要：先 023 SQL，后新版代码。** 新版会调用数据库原子保护函数；缺少它时，AI/语音会停止调用 Azure，并提示 owner 补 SQL，不会无记录地继续产生费用。普通学习记录和 R2 已有音乐播放不依赖此函数。

## 二、这次有什么保护

| 项目 | 保护/提醒 | 不包含什么 |
| --- | --- | --- |
| 孩子人数 | 数据库触发器对同一空间串行计数，满 50 个后拒绝新增；归档/停用家庭内的孩子也计入。管理首页和用量页在 40、45、50 位给不同提示。 | 不限制家长账号数，也不自动升级套餐。 |
| AI 文本与图片 | 在调用 Azure **之前**，按空间与账号分别检查近 60 秒/北京时间当日请求数，事务内原子占位；拦截也留审计计数。 | 不是 Azure 实际 TPM、图片计费余额或全局部署限额；其他应用共用 Azure 资源时，它们的请求不会算入本 App。 |
| Azure 朗读 | 除请求数外，限制当日提交字符数。达到保护线会让儿童朗读走设备语音回退（取决于设备支持）。 | 浏览器语音质量、声音包与 Azure 不同；缓存命中不重复扣额度。 |
| 语音识别 | 除请求数外，限制当日提交音频秒数。 | 旧成人口语功能被限额时需要稍后重试，不把转写失败当作学习答错。 |
| 容量看板 | 管理首页及「使用与成本」显示每服务今日、近一分钟、今日最高单分钟请求、保护拦截、Azure HTTP 429；达到阈值的卡片着重提示。 | **不是实时云账单**；关闭页面时不会给管理员发邮件或推送。 |

新查询把家长学习概况在数据库内一次聚合，避免 1000 行 Data API 默认上限截断大型字册；owner 用户目录按批次读取 Auth 账号，不再为每个账号单独请求。学习队列/复习规律未改变。

## 三、默认限额和怎样调整

以下是本 App 的保守起点，单位为「次/近 60 秒」「次/北京时间日」；四列依次为全空间分钟、单账号分钟、全空间每天、单账号每天。

| 服务 | 默认四档 | 额外日上限 |
| --- | --- | --- |
| AI 文本 | 10 / 3 / 300 / 30 | 无 Token 硬上限；务必参考 Azure 部署 TPM。 |
| AI 图片 | 2 / 1 / 100 / 8 | 按请求数，而非实际价格。 |
| Azure 朗读 | 15 / 6 / 1500 / 300 | 全空间 50,000 字符，单账号 5,000 字符。 |
| 语音识别 | 5 / 2 / 120 / 20 | 全空间 3,600 秒，单账号 300 秒。 |

在 Vercel → Project → Settings → Environment Variables 可调整，例如 `AZURE_GUARD_TTS_WORKSPACE_RPM=15`、`AZURE_GUARD_TTS_WORKSPACE_CHARS_DAY=50000`。全部变量名及默认值见 [.env.example](./.env.example)。变量只在**重新部署后**生效，不能在界面里直接改。推荐先保留默认值；如果 Azure Speech 是 F0，15 次/分钟给官方的 20 次/60 秒限制留了一些余量。若升级到 S0 或提高 Azure 模型部署额度，也要重新评估应用阈值，不要只把数字调大。Azure AI 文本的实际 RPM/TPM、图片部署额度因订阅/区域/部署而异，应在 Azure 门户逐个确认。

管理员看到「近一分钟接近上限」「今日达到 80%」「保护拦截」或「Azure 429」时，先看用量页的账号明细、Azure 指标与部署限额。429 不一定只由本 App 引起；Azure Speech 某个语音后端也可能限流。不要反复点生成按钮制造更多请求。

## 四、Supabase / Vercel / Azure 何时升级

将 `CAPACITY_SUPABASE_PLAN`、`CAPACITY_VERCEL_PLAN` 填为你核实过的套餐名称，只用于看板标签；它们**不会**让程序读取或购买套餐。

| 时机 | owner 要检查什么 | 决策 |
| --- | --- | --- |
| 20～30 位孩子 | 管理首页响应、Supabase Database 用量和连接、Vercel Functions 执行时间与错误率、Azure 429、R2 存储/流量。 | 先建立日常基线，准备 10/25/50 虚拟用户分级试跑。 |
| 40 位孩子 | 上述指标及账单趋势；检查 Supabase 免费套餐的数据库容量/计算资源是否接近上限、Vercel 项目是否仍在 Hobby、Azure Speech/模型部署额度是否覆盖高峰。 | 若持续高延迟/429/套餐告警，先升对应瓶颈，不必所有服务一起升。 |
| 45 位孩子 | 做一次真实业务路径的 50 用户峰值演练，记录 p95 页面/保存延迟、失败率、数据库负载、函数并发与 Azure 限流。 | 指标不达标时先扩容、降低生成频率或错峰；确认后再邀请更多家庭。 |
| 50 位孩子 | 新增孩子由数据库拒绝，已有学习保留。 | owner 决定是否提高产品人数上限并重新压测/修改 SQL；不要只改 UI 数字。 |

Vercel Hobby 的适用资格和超额处理要以当时官方套餐政策为准；若此项目涉及非个人/商业使用，应先核查是否需 Pro。Supabase 免费实例的计算和磁盘、项目暂停及配额也以当前 Dashboard 为准。Pro 不是“无限容量”：还要看超额计费、Spend Cap/预算通知和数据库计算档位。Azure 要在 Cost Management 设置预算通知，在 Azure Monitor 设置 429/失败率告警；**本 App 目前只提供登录后可见的容量看板，不代替这些平台告警。**

官方入口：[Supabase 用量与成本控制](https://supabase.com/docs/guides/platform/cost-control)、[Supabase 计算规格](https://supabase.com/docs/guides/platform/compute-and-disk)、[Vercel 套餐](https://vercel.com/docs/plans/hobby)、[Vercel 用量提醒](https://vercel.com/docs/spend-management)、[Azure Speech 配额](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits)、[Azure OpenAI 配额](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/quota)。价格与限制会变化，以门户当前显示为准。

## 五、上线后逐项验收

1. SQL Editor 运行下面只读检查，应看到三个新函数、一张拒绝日志表。管理页加载时看不到“容量报表尚未就绪”。

   ```sql
   select routine_name from information_schema.routines
   where routine_schema = 'public' and routine_name in
     ('reserve_metered_service_call','workspace_capacity_snapshot','learner_dashboard_snapshot','workspace_today_remaining')
   order by routine_name;
   select count(*) as protection_denials from public.service_guard_denials;
   select family.workspace_id, count(*) as children
   from public.learner_profiles learner join public.families family on family.id=learner.family_id
   group by family.workspace_id;
   ```

2. 用家长账号打开「家」：真实学习统计出现；再打开汉字学习页，普通会/不会的保存仍正常。用 owner 打开「管理中心」和「使用与成本」，容量数字一致。
3. 用一段不含私人资料的短文本试朗读一次。管理员刷新看板，TTS 今日调用应增加。**不要**为测试上限反复付费调用几十次。
4. 如要测试“拦截”，可在测试/预览环境将 `AZURE_GUARD_TTS_ACCOUNT_DAY=1`，重新部署后用测试账号调用两次；第二次应提示限额且 Azure 不新增调用。测完恢复设置。这会影响同环境所有用户，当日生产环境不要这样试。
5. 上线前跑 `npm run lint`、`npm run build` 和相关测试。真正的 50 用户并发演练必须在预览/受控环境、有预算和回滚方案时进行；本次代码检查不能替代它。

本次已在一次性本地 PostgreSQL/PGlite 环境把 023 完整运行两遍，并核对第 51 个孩子被拒绝、空间/账号限额、接近同时发起的占位、管理员用量与单孩子统计。可用 `PGLITE_MODULE=/你的本地路径/node_modules/@electric-sql/pglite node --test scripts/test-capacity-guard.cjs` 重跑；未设置路径时数据库测试会明确跳过。**没有在你的线上 Supabase 运行 023，也没有以 50 个真实浏览器完成压力测试。**

故障处理：若管理页显示“023 尚未运行”，先确认 SQL 在**网站使用的同一个 Supabase 项目**运行，等待 schema cache 后刷新；Azure 被保护停用时先查数据库错误/Secret key，不要关闭保护绕过记录。若出现 Azure 429，看 Azure 部署指标并适当降低应用分钟阈值。容量看板数值只统计本 App 已过保护边界的请求，不能与供应商账单做精确对账。
