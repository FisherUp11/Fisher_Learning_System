# 字芽｜Resend 忘记密码邮件配置教程（保姆级）

目标：用户在 `https://le.fisherai6.top/login` 点击“忘记密码”，输入邮箱后收到由 **Resend** 发出的“字芽”密码恢复邮件；点击邮件可在 iPhone、iPad 或电脑浏览器中设置新密码。

本项目采用下面的职责分工：

```text
字芽前端调用 resetPasswordForEmail
        ↓
Supabase Auth 生成一次性恢复凭证
        ↓
Supabase 通过 Resend Custom SMTP 发邮件
        ↓
/auth/recovery 验证凭证并建立短期恢复会话
        ↓
/reset-password 设置新密码并退出全部旧会话
```

这套流程不需要 Supabase Edge Function，也不需要在 Vercel 中增加 `RESEND_API_KEY`。Resend API Key 只填在 Supabase 的 SMTP 设置里。

## 0. 配置前先知道的地址

| 用途 | 地址 |
| --- | --- |
| 正式站点 | `https://le.fisherai6.top` |
| 正式密码恢复回调 | `https://le.fisherai6.top/auth/recovery` |
| Vercel 备用回调 | `https://fisher-learning-system.vercel.app/auth/recovery` |
| 本机回调 | `http://localhost:3000/auth/recovery` |

登录确认和邀请仍使用 `/auth/callback`；忘记密码专门使用 `/auth/recovery`，不要把两个地址删掉或互相替换。

## 1. 在 Resend 验证发件域名

如果 Resend → **Domains** 中 `fisherai6.top` 已经显示绿色 **Verified**，本节只需核对，不要重复添加 DNS 记录。

如果还没有验证：

1. 登录 [Resend](https://resend.com)。
2. 打开 **Domains → Add Domain**。
3. Domain 填 `fisherai6.top`，Region 选择离你较近的可用区域。
4. Resend 会显示 SPF、DKIM 和可能的 MX 记录。
5. 暂时不要关闭 Resend 页面，下一步要逐项复制它显示的真实值。

不要照抄其他教程里的 DNS 值。Resend 可能调整记录格式，必须以你当前 Resend Dashboard 显示的 Type、Name 和 Value 为准。

## 2. 在 Cloudflare 添加 Resend DNS

1. 打开 Cloudflare → `fisherai6.top` → **DNS → Records**。
2. 对照 Resend 页面逐条检查或添加记录。
3. CNAME、MX 和与邮件有关的记录保持 **DNS only（灰云）**。
4. TXT 没有代理开关，正常保存即可。
5. 回到 Resend 点击 **Verify DNS Records**，等待状态变成 **Verified**。

重要注意：

- 不要修改 `le` 指向 Vercel 的 CNAME；它负责网站访问，与发邮件不同。
- 不要删除现有 MX、DKIM、DMARC 或其他业务的邮件记录。
- 同一个主机名不能放两条不同的 SPF TXT。若该主机已有 `v=spf1 ...`，先按 Resend 页面判断是合并、保留还是使用它建议的 `send` 子域，不要简单再加一条。
- 记录生效通常需要几分钟；Cloudflare 显示已保存不等于 Resend 已验证成功。

## 3. 创建只用于 Supabase SMTP 的 Resend API Key

1. Resend → **API Keys → Create API Key**。
2. Name 填 `ziya-supabase-smtp`。
3. Permission 选择 **Sending access**。
4. 如果可以限制 Domain，选择 `fisherai6.top`。
5. 创建后立即复制以 `re_` 开头的完整 Key。

这个 Key 只显示一次。不要发到聊天、截图或 Git，也不要放进 `NEXT_PUBLIC_` 环境变量。

## 4. 在 Supabase 启用 Resend Custom SMTP

1. 打开 Supabase Dashboard → 当前项目。
2. 进入 **Authentication → SMTP Settings**。部分界面可能位于 **Authentication → Settings → SMTP**。
3. 打开 **Enable Custom SMTP**。
4. 填写：

| Supabase 字段 | 填写值 |
| --- | --- |
| Sender name | `字芽` |
| Sender email | `noreply@fisherai6.top` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | 上一步的完整 `re_...` Key |

5. 点击 **Save**。

如果 465 在你的网络环境不可用，可改用 587；465 是直接 SSL/TLS，587 是 STARTTLS。不要把 Resend Key 填到 Supabase URL、Anon Key 或 Secret Key 字段。

## 5. 配置 Supabase Site URL 与允许跳转地址

Supabase → **Authentication → URL Configuration**。

### 5.1 Site URL

填写：

```text
https://le.fisherai6.top
```

### 5.2 Redirect URLs

至少保留下面六条：

```text
http://localhost:3000/auth/callback
http://localhost:3000/auth/recovery
https://fisher-learning-system.vercel.app/auth/callback
https://fisher-learning-system.vercel.app/auth/recovery
https://le.fisherai6.top/auth/callback
https://le.fisherai6.top/auth/recovery
```

`/auth/callback` 用于确认邮箱和邀请；`/auth/recovery` 用于忘记密码。缺少 recovery 地址时，Supabase 会拒绝密码恢复跳转或回到错误域名。

## 6. 设置“Reset Password”邮件模板

Supabase → **Authentication → Email Templates → Reset Password**。

Subject 填：

```text
重置你的字芽登录密码
```

Body 使用项目中的完整模板文件：

[`samples/ziya-password-reset-template.html`](samples/ziya-password-reset-template.html)

打开文件、全选并复制到 Supabase 的 Reset Password Body。当前正式版采用与字芽 App 一致的米白与墨绿色视觉，包含移动端自适应、邮件预览摘要、登录账号提示、兼容传统邮件客户端的表格按钮、安全说明和备用链接。它沿用已经验证可发送的标准表格结构，关键链接仍然是：

```html
{{ .SiteURL }}/auth/recovery?token_hash={{ .TokenHash }}&amp;type=recovery
```

保存后，再次打开模板确认 `{{ .SiteURL }}` 和 `{{ .TokenHash }}` 仍完整存在。Site URL 必须是第 5.1 节的 `https://le.fisherai6.top`。

模板还使用 `{{ .Email }}` 显示本次申请对应的登录账号；这是 Supabase Auth 官方支持的邮件模板变量。不要把三个变量前后的双重大括号删除，也不要在 Dashboard 中使用富文本编辑器二次改写 HTML。

当前字芽模板把 `token_hash` 交给 `/auth/recovery` 服务端验证，不依赖发起申请的原浏览器状态，因此从手机邮件、iPad 或另一浏览器打开更稳定。为兼容已有模板，代码也接受 `/auth/callback?token_hash=...&type=recovery`，但新模板统一使用 `/auth/recovery`。

如果 Supabase 不允许编辑模板，先确认 Custom SMTP 已成功保存。2026 年 6 月后的新 Free 项目使用默认 SMTP 时不能自定义 Auth 邮件模板，配置自定义 SMTP 后才可编辑。

## 7. 检查限流，不要设置成无限制

Supabase → **Authentication → Rate Limits**：

- Custom SMTP 初始的项目邮件上限通常是每小时 30 封，可按当前家庭规模保留或小幅调整。
- Password Reset 同一用户默认至少间隔 60 秒；字芽前端也显示 60 秒倒计时。
- 不建议为了测试关闭限流。连续测试时等待 60 秒即可。
- Resend 自身还有套餐发送配额，以 Resend Dashboard 当前显示为准，不在文档中写死每日数量。

如果未来开放给很多家庭，再考虑在忘记密码页面增加 Cloudflare Turnstile；当前小范围家庭使用不需要额外复杂化。

## 8. Resend 邮件追踪设置

认证邮件中的链接不应被追踪服务改写。如果 Resend 的 Domain 或发送设置中启用了 **Click Tracking**，请关闭它。Open Tracking 可按需要关闭；密码恢复流程不依赖打开率。

## 9. 正式验收

建议使用一个可以接收邮件的测试账号，不要连续点击发送。

1. 打开 `https://le.fisherai6.top/login`。
2. 点击“忘记密码？”。
3. 输入已注册邮箱，点击“发送重置邮件”。
4. 页面应显示统一提示，并开始 60 秒倒计时。
5. 在 Resend → **Emails** 确认该邮件状态为 Delivered；同时检查收件箱和垃圾邮件。
6. 在 iPhone 邮件或另一浏览器点击邮件按钮，应进入 `/reset-password`。
7. 输入两次至少 12 位、同时含字母和数字的新密码。
8. 保存后应回到登录页，显示“密码已经修改成功”。
9. 旧密码不能再登录，新密码可以登录。
10. 其他设备的旧会话应退出；孩子、家庭、字册和全部学习历史不能发生变化。
11. 再次点击同一封邮件的链接，应看到“链接无效、已经使用或已经过期”。

不要在验收中使用不存在的邮箱判断系统是否有账号。页面对存在与不存在的邮箱都显示相同提示，这是防止账号枚举的安全设计。

## 10. 发送按钮报错时的精确排查

不要只根据前端一句“发送失败”反复改 SMTP。字芽现在会显示不含邮箱、密码和密钥的 **诊断码**，先按下面顺序定位。

### 10.1 先看页面诊断码

| 页面诊断码 | 说明 | 处理方法 |
| --- | --- | --- |
| `email_address_not_authorized` | Supabase 仍在使用内置邮件服务 | 回到 SMTP Settings，重新打开 Custom SMTP、保存，并重新进入页面确认开关仍然开启 |
| `over_email_send_rate_limit` / `over_request_rate_limit` / `HTTP 429` | 触发限流 | 至少等待 60 秒；不要连续点击 |
| `validation_failed` | 请求参数或恢复回调不被允许 | 把当前页面提示的完整 `/auth/recovery` 地址加入 Redirect URLs |
| `network_error` | 浏览器没有收到任何 Supabase Auth HTTP 响应，状态通常为 0 | 换网络、关闭异常代理或稍后重试 |
| `supabase_auth_server_error / HTTP 500` | Supabase Auth 已接到请求但服务器处理失败，不是设备断网 | 继续做 10.2 和 10.3，优先看 SMTP、模板和数据库依赖 |
| `client_exception` | 请求在浏览器端异常中断 | 刷新页面；本机开发时同时检查浏览器 Console |

页面仍然不会说明“这个邮箱是否注册”，避免别人用忘记密码功能探测系统账号。

### 10.2 查看 Supabase Auth 日志

1. 登录 Supabase Dashboard，进入当前项目。
2. 打开 **Logs Explorer**；不同版本入口可能位于 **Logs** 或 **Observability → Logs**。
3. Source 选择 **Auth / `auth_logs`**。
4. 时间范围选刚才点击按钮前后 10 分钟。
5. 搜索 `recover`、`gomail`、`smtp`、`template` 或 `error`。
6. 双击最新错误行展开，重点看 `msg`、`error` 和 HTTP 状态；不要把包含邮箱、Token 或密钥的完整日志公开发送。

如果 Logs Explorer 支持 SQL，可直接运行 Supabase 官方的 Auth 500 查询：

```sql
select
  cast(metadata.timestamp as datetime) as timestamp,
  msg,
  event_message,
  status,
  path,
  level
from auth_logs
cross join unnest(metadata) as metadata
where status::int = 500
   or regexp_contains(level, 'error|fatal')
order by timestamp desc
limit 30;
```

找到路径为 `/recover` 或 `/auth/v1/recover`、时间与刚才点击一致的最新一行即可，不需要把全部日志导出。

只显示 `POST | 500 | https://.../auth/v1/recover` 的是请求摘要，还不是错误原因。如果展开后 JSON 里是 `"log_type": "edge"`、`"logs": []`，这仍是 API 网关/Edge 日志，不是 Auth 服务日志；`auth_user: null` 对未登录的忘记密码请求也属于正常现象。请回到 Logs Explorer，明确选择 **Auth / `auth_logs`** 数据源，或运行上面的官方查询。在 Auth 结果中查看 `msg`、`event_message` 或 `error` 字段；只需保留错误文字，邮箱、token 和密钥要打码。

常见日志与修复：

| Auth 日志关键词 | 常见原因 | 修复 |
| --- | --- | --- |
| `gomail`、`authentication failed`、`535` | SMTP 用户名或 API Key 错误/失效 | Username 必须为 `resend`；在 Resend 新建 Sending access Key，完整替换 Supabase Password 后保存 |
| `domain is not verified`、`550`、`from address` | Sender email 不属于 Resend 已验证域名 | Resend 验证的是 `fisherai6.top` 时可用 `noreply@fisherai6.top`；若只验证了 `send.fisherai6.top`，Sender 必须改成该子域地址 |
| `connection refused`、`timeout`、`tls` | 端口/TLS 或服务暂时不可达 | 先用官方组合 `smtp.resend.com:465`；仍失败再改 `587` 并保存 |
| `templatemailer`、`template_body_parse_error` | Reset Password 模板变量或 HTML 语法错误 | 暂时换成 10.4 的最简模板测试 |
| `rate limit`、`429` | Supabase 或 Resend 限流 | 等待限制窗口，不要把限流关闭 |

Supabase Auth SDK 会把 HTTP 500 包装成 `AuthRetryableFetchError`，这里的 “retryable” 表示服务器错误可以稍后重试，不等于浏览器没有联网。Supabase 官方说明：Auth 的 HTTP 500 往往来自 SMTP、邮件模板或数据库等外部依赖，不能仅凭 500 判断为前端代码或设备网络错误。

### 10.3 对照 Resend 发送记录

打开 Resend → **Emails**，把时间范围对准刚才的测试：

- 完全没有记录：邮件没有成功从 Supabase 交给 Resend，以 Supabase Auth 日志为准检查 SMTP 鉴权、发件域名或模板。
- 有记录且 `Delivered`：SMTP 已正常，去收件箱、垃圾邮件、企业邮箱隔离区排查。
- 有记录但 `Bounced` / `Failed`：点开该记录查看 Resend 给出的具体原因；检查收件地址、退信抑制和域名验证。

重新打开 Resend → Domains，必须看到实际发件域名为绿色 **Verified**。只创建 DNS 记录但没有变成 Verified 不算配置完成。

### 10.4 用最简模板排除模板语法

如果 Auth 日志出现 `templatemailer`，把 Reset Password 的 Body 暂时改为下面内容并保存：

```html
<p>请点击下面的链接设置新密码：</p>
<p><a href="{{ .SiteURL }}/auth/recovery?token_hash={{ .TokenHash }}&amp;type=recovery">设置新密码</a></p>
```

等待 60 秒后只测试一次。若最简模板可以发送，说明 SMTP 正常，应检查原模板是否复制残缺、变量大括号不完整或 HTML 没有闭合；修好后再恢复美化模板。

### 10.5 当前最容易遗漏的两项

1. 当前忘记密码请求不再传入浏览器的 `redirectTo`，邮件统一使用 Supabase `Site URL` 的正式域名。因此从 localhost 点“发送重置邮件”时，新请求日志中不应再出现 `redirect_to=http://localhost:3000/...`；邮件点击后会进入 `https://le.fisherai6.top/auth/recovery`。
2. 在 Supabase 保存 Custom SMTP 后，离开页面再重新进入一次。开关、Sender、Host、Port 和 Username 都仍然显示正确，才算保存成功。Password 通常不会明文回显，这是正常现象。

### 10.6 与已经成功的 GC 管理系统对照

已对照本机项目 `/Users/fisherxiang/Documents/02_Projects/2026/GC_管理系统/FisherTools-V2`：

| 对照项 | GC 管理系统（已成功） | 字芽学习系统 | 结论 |
| --- | --- | --- | --- |
| Supabase 项目 | `rujmzndxqeikksadppsa` | `hodhbakqdmyahymyhjss` | 是两个独立项目，SMTP 设置不会自动共享 |
| Email provider | 已启用 | 已启用 | 不是 Email provider 开关问题 |
| `mailer_autoconfirm` | `false` | `false` | 与本次 500 无关 |
| 前端调用 | `resetPasswordForEmail` | `resetPasswordForEmail` | 调用 API 相同 |
| 模板变量 | `.SiteURL` + `.TokenHash` | `.SiteURL` + `.TokenHash` | 变量用法一致且合法 |
| Resend 本地环境变量 | 没有 `RESEND_API_KEY` | 没有 `RESEND_API_KEY` | 当前架构不需要在 `.env.local`/Vercel 配 Resend Key |
| 发件域 | `noreply@fisherai6.top` | 必须也使用已验证的 `fisherai6.top` | 不要改成 `noreply@le.fisherai6.top` |

字芽请求已经成功到达 `/auth/v1/recover`，却在当前 Supabase 项目内返回 HTTP 500；同时本地 SQL 没有在 `auth.users` 上创建自定义 trigger。因此排查优先级是：

2026-08-20 又使用同一套 `NEXT_PUBLIC_SUPABASE_URL` 和 publishable key，以一个不存在的随机邮箱直接请求当前项目的 `/auth/v1/recover`，结果为 HTTP 200；真实已注册邮箱的请求则为 HTTP 500。这进一步证明：

- 当前设备可以连接 Supabase，URL 和 publishable key 有效；
- Auth 恢复接口本身可以正常处理请求；
- 故障只在“找到真实用户后生成并发送恢复邮件”的分支发生；
- 应集中检查当前 Supabase 项目的 Custom SMTP、Reset Password 模板和 Send Email Hook，不应继续修改登录页或网络提示。

1. **当前项目的 SMTP Password/API Key 实际没有正确保存**；
2. **Sender email 误填为 `@le.fisherai6.top` 或其他未验证域**；
3. **Supabase Dashboard 里的 Reset Password Body 在复制时残缺**；
4. 其次才是 SMTP TLS/端口、Auth Hook 或 Supabase 项目内部依赖。

#### 按 GC 成功基线复位当前项目

不要把 GC 项目的 Supabase URL、publishable key 或 service key 复制到字芽。只在字芽的 Supabase Dashboard 里做下面操作：

1. Resend 新建一枚专用 Sending access Key，Domain 限定为 `fisherai6.top`；不要继续猜测旧 Key 是否复制完整。
2. Supabase → Authentication → SMTP Settings，暂时关闭 Custom SMTP 并保存，然后重新打开，按第 4 节六个字段全部重填。
3. Sender email **精确填** `noreply@fisherai6.top`；Host 不带 `https://`；Username 精确为小写 `resend`；Password 填新 `re_...` Key。
4. Reset Password Body 先替换为第 10.4 节的两行最简模板并保存，以排除粘贴残缺。
5. Authentication → Hooks 如果启用了 **Send Email Hook**，先关闭并保存；当前方案只使用 Custom SMTP，不需要该 Hook。
6. 等待 60 秒后只发送一次，同时查看 Resend → Emails 和 Supabase Auth Logs。

若“最简模板 + 新 Resend Key + `noreply@fisherai6.top` + 关闭 Send Email Hook”后仍然 HTTP 500，就不应继续改前端；请使用 10.2 的 `auth_logs` 查询取得 `msg`，或向 Supabase Support 提供项目 ref `hodhbakqdmyahymyhjss`、请求时间和日志 id（不提供密钥）。

## 11. 常见问题

### 页面提示已经发送，但没有收到邮件

依次检查：

1. Resend Domain 是否为 Verified。
2. Resend → Emails 是否有这条记录。
3. Supabase Custom SMTP 的 Host、Username 和 API Key 是否完整。
4. Sender email 是否属于已验证的 `fisherai6.top`。
5. 是否触发 Supabase 或 Resend 限流。
6. 收件箱的垃圾邮件、促销邮件和拦截规则。

### 提示 `Email address not authorized`

说明 Supabase 仍在使用默认 SMTP，或者 Custom SMTP 没有保存成功。重新保存第 4 节，并确认 Sender Email 与 Resend 已验证域名一致。

### 点击邮件后跳回登录页或提示链接无效

- 确认模板链接是 `{{ .SiteURL }}/auth/recovery?token_hash=...&type=recovery`。旧版 `/auth/callback?token_hash=...&type=recovery` 仍可兼容，但不再作为新模板首选。
- 确认 Supabase Redirect URLs 包含当前实际域名的 `/auth/recovery`。
- 重新发送一封新邮件；修改模板前发出的旧邮件不会自动更新。
- 确认 Resend Click Tracking 已关闭。

### 本机测试邮件跳到正式域名

这是当前模板的预期行为：模板使用 `{{ .SiteURL }}`，因此无论从本机还是正式站点发起，邮件都进入 `https://le.fisherai6.top/auth/recovery`，便于在手机或另一台设备打开。前端也不再传入动态 `redirectTo`，避免本机域名与正式邮件链接混在同一次请求中。

### 是否需要在 `.env.local` 或 Vercel 添加 Resend Key

不需要。当前密码恢复由 Supabase Auth 通过 Resend SMTP 发信，Key 只保存在 Supabase SMTP Settings。以后如果增加由 Next.js 直接发送的业务通知，再为那项功能单独评估 `RESEND_API_KEY`。

## 12. 最终检查清单

- [ ] Resend 中 `fisherai6.top` 已 Verified。
- [ ] Cloudflare 邮件 DNS 与 Resend 当前要求完全一致，CNAME/MX 为 DNS only。
- [ ] Resend 已创建受限 Sending access API Key。
- [ ] Supabase Custom SMTP 发件人为 `字芽 <noreply@fisherai6.top>`。
- [ ] Site URL 为 `https://le.fisherai6.top`。
- [ ] localhost、Vercel 和自定义域名都同时允许 `/auth/callback` 与 `/auth/recovery`。
- [ ] Reset Password 模板使用 `SiteURL + /auth/recovery + TokenHash + type=recovery`。
- [ ] Resend Click Tracking 已关闭。
- [ ] 真实账号完成一次“发送 → 点击 → 改密 → 新密码登录”测试。
- [ ] 不存在邮箱、过期链接和重复点击都不会暴露账号或进入系统。

## 官方参考

- [Supabase Password-based Auth](https://supabase.com/docs/guides/auth/passwords)
- [Supabase Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase Email Templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase Auth Rate Limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Supabase Auth Error Codes](https://supabase.com/docs/guides/auth/debugging/error-codes)
- [Supabase 500 Auth Error Troubleshooting](https://supabase.com/docs/guides/troubleshooting/resolving-500-status-authentication-errors-7bU5U8)
- [Supabase Logging](https://supabase.com/docs/guides/monitoring-and-debugging/logs)
- [Resend：Send emails using Supabase with SMTP](https://resend.com/docs/send-with-supabase-smtp)
- [Resend SMTP](https://resend.com/docs/send-with-smtp)
