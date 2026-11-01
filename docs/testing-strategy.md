# 测试策略与数据库生命周期

本模板把测试体系视为架构的一部分。目标是让不同风险在最小但足够真实的层级被验证，而不是把所有问题都推给 E2E。

## 1. 测试分层

```text
Architecture Test
      ↓
Unit / Component / Contract Test
      ↓
API Integration Test
      ↓
Browser E2E
```

选择原则：**优先使用能真实证明风险的最低层级。**

### Architecture Test

位置：

```text
tests/architecture/
```

负责冻结跨文件、跨 Package、目录和依赖边界，例如：

- 私有 CSS Module 不向父目录借用；
- `layout/`、`infrastructure/` 等目录约束；
- Workspace Package 根目录只暴露公开入口；
- `radix-ui` 只能由 `packages/ui` 持有；
- 无状态前端 Service / ApiClient 的静态类扩展合同；
- 后端纯 Unit Test 必须与生产 Owner 共置，根 `tests/unit` 不允许重新出现；
- 临时智能体工作目录和文档管理约束。

这类规则很难由普通功能测试稳定覆盖，因此使用专门的 Architecture Test。

### Unit / Component / Contract Test

前端组件、UI Primitive、i18n、Contract 以及后端纯 Unit Test 都与源码 Owner 共置。

后端示例：

```text
apps/api/src/modules/account/services/
├── auth.service.ts
└── auth.service.test.ts
```

纯 Unit Test 包括 Service、Guard、纯 helper，以及通过 stub 隔离数据库后的局部 Repository 规则测试。测试文件必须与对应生产文件位于同一目录，移动或重命名 Owner 时测试一起移动。

由 Nest 管理的 Subject 通过 TestingModule 获取，不绕过框架生命周期手工 `new Service()`。

真实数据库 Repository Test 不属于 Unit Test，继续放在 `tests/integration/api/repositories/`。Unit Test 只验证局部规则和分支，不承担数据库、HTTP Pipeline 或浏览器行为验证。

### API Integration Test

位置：

```text
tests/integration/api/
```

Integration Test 使用真实：

- `AppModule` wiring；
- Nest HTTP Pipeline；
- Guard / Validation Pipe / Exception Filter；
- PostgreSQL + Drizzle 与真实 Redis；
- 正式 Migration Ledger。

Repository 和 HTTP 行为不使用内存伪实现代替数据库。

### Browser E2E

位置：

```text
tests/e2e/
```

真实链路：

```text
Playwright Browser
       ↓
Real Vite Web
       ↓
Real Nest API
       ↓
Dedicated PostgreSQL E2E DB + Redis E2E DB
```

核心业务 API 不 mock。第三方外部系统在未来真实接入后，可以在明确边界处使用可控替身。

本地可运行 Chromium、Firefox、WebKit；CI 默认执行 Chromium 主链路。

## 2. 数据库生命周期

数据库当前结构由 Drizzle Schema 描述，脚手架只保留 `apps/api/drizzle/` 中的一份初始 SQL Migration、一个 Snapshot 和仅一条记录的 Journal，用于从零创建当前数据库。派生后的真实项目必须独立维护自身的增量迁移，不覆盖已部署数据库的历史。

关键约束：

- API 启动不自动 migrate；
- 开发环境显式执行 `pnpm db:migrate` / `pnpm db:setup`；
- Integration 和 E2E 都从同一份初始 Migration 重建专用测试数据库；
- 测试不得复用开发 PostgreSQL / Redis。

当前独立数据库：

```text
开发：        internal_ai_platform_dev
Integration: internal_ai_platform_integration_test
E2E:         internal_ai_platform_e2e_test
```

## 3. 测试 PostgreSQL 与 Redis 重置安全

破坏性测试库 reset 必须对两种存储执行独立安全检查：

1. `NODE_ENV` 必须为 `test`，并显式配置独立测试数据库连接串；
2. 数据库名必须同时包含 test 及 integration/e2e 标记，且 Host/Port/Database 身份不得与 DATABASE_URL 相同。

Redis 测试环境使用独立的 `TEST_REDIS_URL`（DB 14）和 `E2E_REDIS_URL`（DB 15），不得指向开发/生产 Redis。
脚本在执行 FLUSHDB 前校验 NODE_ENV=test、Redis 目标 DB 是对应的 14/15，且不等于 REDIS_URL。建议单独的测试 Redis 实例。

Reset 流程：

```text
校验 PG、Redis 两个专用测试目标
        ↓
清空专用 Redis DB 14/15；清理 PG public/drizzle Schema
        ↓
执行唯一的初始 Migration
        ↓
按测试类型决定是否 Seed
```

任何未来修改都不能通过放宽环境与测试库身份的保护来解决测试便利性问题。

## 4. E2E 生命周期

E2E 执行前会 reset + migrate + seed 独立 PostgreSQL E2E DB，并清理 Redis E2E DB 15，然后由 Playwright 启动真实 API 和 Web Server。

测试用例必须自行准备或依赖明确的 fixture，不能依赖测试执行顺序，也不能通过固定 sleep 掩盖异步问题。

失败时保留：

- Trace；
- Screenshot；
- Video；
- HTML Report / test-results（CI）。

## 5. Coverage

Coverage 用于发现风险缺口，不设置机械的全局百分比门槛。

优先保证：

- 安全和认证关键分支；
- 稳定 Contract；
- 持久化行为；
- 真实 HTTP Pipeline；
- 关键 UI 用户行为；
- 容易在重构时被破坏的 Architecture Contract。

## 6. 常用验证入口

日常提交前：

```bash
pnpm verify
```

它串联：

```text
format:check
→ lint
→ typecheck
→ architecture
→ unit
→ integration
→ build
```

关键用户流程或跨栈改动：

```bash
pnpm test:e2e:chromium
```

需要完整本地浏览器矩阵时：

```bash
pnpm test:e2e
```

完整 Gate：

```bash
pnpm verify:all
```

Coverage：

```bash
pnpm test:coverage
```

## 7. 测试相关权威来源

| 主题                     | 权威来源                            |
| ------------------------ | ----------------------------------- |
| 根测试脚本               | 根 `package.json`                   |
| Architecture Contract    | `tests/architecture`                |
| API Unit                 | `apps/api/src/**/*.test.ts`         |
| API Integration          | `tests/integration/api`             |
| Test App / Cookie helper | `tests/support/api`                 |
| Browser E2E              | `tests/e2e`、`playwright.config.ts` |
| 测试库与 Redis reset     | `apps/api/scripts/reset-test-db.ts` |
| Migration                | `apps/api/drizzle`                  |
