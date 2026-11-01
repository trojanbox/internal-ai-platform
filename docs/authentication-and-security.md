# 认证与安全模型

本文档记录浏览器认证方案中需要长期保持一致的安全边界。具体请求 Schema、错误码和表字段以源码中的机器可读定义为准。

## 1. 认证模型

浏览器端使用服务端 Session：

```text
浏览器
  │ HttpOnly Session Cookie
  ▼
SessionAuthGuard
  ▼
AuthService.authenticate()
  ├── RedisSessionRepository → Redis 校验会话及 TTL
  └── AuthRepository        → PostgreSQL 校验用户启用、未软删除
```

前端不把 Session credential 保存到 Local Storage、Session Storage 或 JavaScript 状态中。

生产环境的 Session Cookie 名称使用 `__Host-session`；非生产环境使用 `session`。

## 2. 注册与登录

注册和登录请求先经过 `packages/contracts` 中的 Zod Schema 校验和规范化。

注册流程：

1. 规范化邮箱并使用 scrypt 派生密码摘要；
2. Redis 保存随机 Session Token 摘要对应的会话和 CSRF 摘要，设置绝对 TTL；
3. PostgreSQL 插入用户，成功后才返回 HttpOnly Session Cookie 和 CSRF Cookie；
4. Redis 写失败时不创建 PG 用户；PG 插入失败时清理未对外返回的 Session。

Redis 与 PostgreSQL 不支持共同的本地数据库事务。即使 PG 失败后的 DEL 也失败，未披露的 Session 不可能通过 PG 用户校验，最终自动到期。

登录首先从 PostgreSQL 查询用户并验证密码，成功后创建 Redis Session；不同于注册，登录不会再写入新用户。

为降低“用户是否存在”带来的明显时序差异，登录不存在用户时仍执行一次固定参数的 dummy scrypt 派生，然后返回与错误密码相同的认证失败结果。

## 3. 密码处理

当前密码哈希合同使用 Node.js `scrypt`，参数为：

```text
N = 32768
r = 8
p = 3
key length = 64 bytes
salt = 16 random bytes
max memory = 128 MiB
```

密码摘要把算法和参数编码进存储值。验证时只接受当前明确支持的参数组合。

变更密码算法或参数时，需要同时设计兼容和迁移策略；不能静默降低成本参数或绕过旧摘要验证。

## 4. Session Token

Session Token 是 32 字节随机 opaque token，浏览器持有原值；Redis key 为 `auth:session:SHA256(token)`，Value 仅保存 userId、csrfTokenHash，不保存原始凭据。

一个 Session 只有在以下条件同时成立时有效：

- Redis Session Key 存在、结构有效；
- Redis 绝对 TTL 尚未过期；
- 对应 PostgreSQL 用户存在、启用且未软删除。

Session TTL 来自 `SESSION_TTL_HOURS`，默认 168 小时。

退出登录时服务端先 DEL Redis Session Key，再清除浏览器 Session Cookie 和 CSRF Cookie。Redis 故障时不能伪装成服务端已登出。

## 5. Cookie 合同

Session Cookie：

- `HttpOnly=true`；
- `SameSite=Lax`；
- `Path=/`；
- Production 开启 `Secure`；
- Production 使用 `__Host-` 前缀。

CSRF Cookie：

- `HttpOnly=false`，前端需要读取；
- 其余生命周期参数与 Session Cookie 保持一致；
- Cookie 原值不作为服务端持久化凭据，Redis 只保存 CSRF 摘要。

如果未来改成跨站前后端部署，需要重新评估 SameSite、CORS、Cookie Domain 和 CSRF 模型，不能只放宽浏览器配置。

## 6. CSRF 防护

全局 `SessionAuthGuard` 对受保护请求统一执行认证。

对 `GET`、`HEAD`、`OPTIONS` 以外的请求，除了 Session 认证外，还必须校验：

```text
csrf_token Cookie
      ↓ 浏览器读取
X-CSRF-Token Header
      ↓
服务端 SHA-256
      ↓
与 Session 中 csrf_token_hash 比较
```

前端的 `ApiClient` 负责在 Mutation 请求上自动附加 `X-CSRF-Token`。

业务 Feature 不自行实现 CSRF Header、Cookie 读取或第二套认证客户端。

## 7. 默认拒绝模型

`AccountModule` 注册全局 `SessionAuthGuard`，因此 API 默认需要认证。

只有显式标记 `@Public()` 的 Route 绕过认证。

当前明确公开的能力是：

- 注册；
- 登录；
- Health；
- Readiness。

Session 查询、退出登录以及业务资源默认受保护。

新增公开 Route 时必须显式说明为什么可以匿名访问，不能为了方便绕过 Guard。

## 8. 前端职责

浏览器只负责：

- 通过 `credentials: 'include'` 携带 Session Cookie；
- Mutation 时读取 CSRF Cookie 并放入 `X-CSRF-Token`；
- 根据 API 的稳定错误合同展示状态。

前端认证状态不构成真实授权。任何未来权限模型都必须由 API 服务端验证。

## 9. 认证限流与代理边界

认证端点在密码推导前通过 Redis Lua INCR+PEXPIRE 原子窗口按可信客户端 IP 限流，登录 12 次/分钟、注册 6 次/分钟，返回 429 和 Retry-After。限流 key 使用哈希摘要；Redis 不可用时请求失败，不绕过限流。

默认忽略未经验证的转发 IP；若使用反向代理，应把受信任代理 IP 配置到 TRUSTED_PROXY_IPS。原始 X-Forwarded-For 不直接作为身份依据。Redis TTL 自动删除过期限流窗口，无需额外的 PG 表或清理脚本。

RequestContext 为每个请求生成/验证 X-Request-Id，并只记录方法、路径、响应状态和耗时；禁止记录密码、Cookie、原始请求体、Token。记录 actorId 前必须完成 Session Guard 的服务端认证。

## 10. Redis 持久化与部署

Redis 既负责 Session，又负责限流，必须明确生产持久化、备份、权限和 noeviction 策略。Redis 故障时不降级为无鉴权或不限流；Readiness 返回 503。
Redis Session 数据丢失时，用户需重新登录；用户禁用/软删除仍由 PostgreSQL 及时验证，不能只缓存 Redis 用户快照。

## 11. 安全相关权威来源

| 主题                        | 权威来源                                                    |
| --------------------------- | ----------------------------------------------------------- |
| 登录/注册输入与稳定错误码   | `packages/contracts`                                        |
| Cookie 名称与 Session TTL   | `apps/api/src/config/app.config.ts`                         |
| 密码与 Token 加密实现       | `apps/api/src/modules/account/security/auth.crypto.ts`      |
| Session / CSRF 认证规则     | `apps/api/src/modules/account/guards/session-auth.guard.ts` |
| Session 生命周期            | `AuthService` / `RedisSessionRepository`                    |
| PostgreSQL 用户模型         | Drizzle Auth Schema + Migration                             |
| 浏览器 Header / Cookie 行为 | `apps/web/src/infrastructure/http/api.client.ts`            |
