# 系统架构与边界

本文档记录这个全栈模板中需要长期保持稳定的架构边界。具体字段、接口参数和数据库列不在这里重复维护，相关机器可读来源见文末“权威来源”。

## 1. 总体结构

项目采用 pnpm + Turborepo Monorepo：

```text
apps/web          React 浏览器应用
apps/api          NestJS API
packages/contracts  跨应用序列化合同
packages/ui         与业务无关的 UI Primitive
packages/i18n       国际化基础设施
```

核心原则是：**应用负责业务，Package 只承载真正需要跨边界复用的稳定能力。**

不为了“看起来分层完整”提前创建额外 Package、第二套 Runtime、第二套 HTTP Client 或通用 `shared/common` 垃圾桶。

## 2. 依赖方向

长期依赖方向保持为：

```text
apps/web ───────→ packages/contracts
    │            packages/ui
    └──────────→ packages/i18n

apps/api ───────→ packages/contracts
```

边界约束：

- `apps/web` 不 import `apps/api` 源码；
- `apps/api` 不 import `apps/web` 源码；
- `packages/contracts` 只承载跨 HTTP 边界的序列化 Schema / Type，不承载 Repository Row、Nest Provider、React Props；
- `packages/ui` 不依赖业务 Feature、Router、业务 Contract 或 `packages/i18n`；
- `packages/i18n` 不承担业务状态和网络请求；
- Workspace Package 的 `src/` 根目录只保留公开入口，具体实现继续按领域或职责分目录。

## 3. 后端模块边界

`AppModule` 只负责组装粗粒度 Module 和全局框架配置：

```text
AppModule
├── InfrastructureModule
├── AccountModule
└── CatalogModule
```

当前边界含义：

- `AccountModule`：账户、登录、注册、会话和认证；
- `CatalogModule`：列表、详情及同一业务域能力；
- `InfrastructureModule`：PostgreSQL / Redis 生命周期、Health、Readiness 等基础设施能力。

Module 可以随着真实业务扩展增加，例如 `WebsitesModule`、`BillingModule`、`OrganizationsModule`，但新增 Module 必须代表真实领域、独立基础设施生命周期、稳定公开 API 或明确的运行/安全边界。

禁止按 endpoint、单个 Provider、helper 或一个小 CRUD 机械拆 Module。

### Module 内部职责

依赖方向固定为：

```text
Controller → Service → Repository → PostgreSQL / Redis
```

约束：

- Controller 负责 HTTP 输入输出，不直接注入 Repository；
- Service 负责业务用例和事务边界，不直接编写 Drizzle 查询；
- Repository 持有持久化查询，默认只在所属 Module 内使用；
- Controller / Service / Repository 分别进入 `controllers/`、`services/`、`repositories/`，不平铺在 Module 根目录。

## 4. 前端边界

前端按 Feature 内聚。页面、组件、路由数据和服务优先靠近真实业务 Owner。

稳定的应用级边界：

```text
apps/web/src/
├── features/        业务能力
├── infrastructure/ 浏览器和 HTTP 基础设施
├── layout/         应用级布局
├── routing/        路由级公共实现
└── styles/         全局 Token / Reset / Base
```

不使用语义含糊的 `shell/`、`lib/` 作为默认容器。

### 样式局部性

Page / Component 私有 CSS Module 必须与 Owner 共置，并从当前目录引用。

禁止子级通过 `../`、`../../` 向父目录借私有 CSS Module。真正跨组件复用的视觉规则应提升为：

- Semantic Design Token；
- `packages/ui` Primitive；
- 明确的应用级公共样式。

### Service 与 HTTP

无实例状态的前端 Feature Service 使用静态可继承类。

所有业务 HTTP 请求经过：

```text
apps/web/src/infrastructure/http/ApiClient
```

业务 Feature 不创建第二套 fetch wrapper，也不直接散落网络错误、Cookie、CSRF 等基础设施逻辑。

### UI Primitive

复杂交互通过 `packages/ui` 封装 Radix Primitives：

```text
radix-ui → packages/ui → apps/web/features
```

业务 Feature 不直接 import `radix-ui`，也不单独安装 `@radix-ui/react-*`。

Radix 负责行为、Focus、Keyboard、ARIA、Portal 和 Dismiss；视觉由 CSS Modules + Design Token 控制。

## 5. 跨栈合同

前后端共享的 HTTP 序列化合同统一由 `packages/contracts` 持有。

原则：

- API 输入校验、响应类型和稳定错误码在同一处定义；
- 后端 Route 消费共享 Zod Schema；
- 前端通过共享类型和 `ApiClient` 消费；
- 不维护前后端两套平行 DTO；
- 数据库 Row、内部 Service Model 和 UI View Model 不因为名称相似就进入 Contract Package。

具体 Schema 和错误码以 `packages/contracts` 为权威来源，不在本文复制字段清单。

## 6. 数据库边界

PostgreSQL 连接池由 `InfrastructureModule` 管理连接生命周期，Drizzle Schema 描述当前模型，模板的一份初始 Migration 与 Snapshot 负责从零建库。

关键约束：

- API 启动不自动执行 Migration；
- Migration 是显式部署/初始化步骤；
- 新建的开发库、Integration DB、E2E DB 都使用同一份初始 Migration；
- 数据库物理字段使用 lower_snake_case，TypeScript 与 HTTP JSON 使用 camelCase。

数据库测试和生命周期细节见 [testing-strategy.md](./testing-strategy.md)。

### 事务、审计与软删除

Service 通过 DatabaseService.transaction 定义业务原子边界。Repository 读取当前作用域的 Drizzle 事务执行器；多请求、并行测试保持 AsyncLocalStorage 隔离。RequestContext 只传递认证后可信的 actorId、请求 ID；需要审计字段时 Repository 调用 AuditFields。缺失 actor 时操作失败，后台操作需先确立可信系统主体。

软删除是 Repository 的明确 SQL 条件；activeRecord(table) 提供统一的类型安全表达式，但不会悄悄修改 Drizzle 原生查询。列表、详情、更新、软删除和 totalRows 均使用它。使用 SQL Schema 约束保障一致性，PostgreSQL Trigger 维护 updated_at。

### Redis 认证基础设施

AccountModule 的 RedisSessionRepository 与 AuthRateLimitRepository 只保存登录会话、CSRF 摘要和限流计数；InfrastructureModule 统一管理 Redis 连接生命周期。用户与业务仍在 PostgreSQL。每次鉴权 Redis 命中 Session 后，PG 查询验证用户仍启用且未软删除。跨 PostgreSQL 和 Redis 不声明伪原子事务；注册先写 Redis 不公开的 Session，再写 PG 用户，PG 失败就删除未公开 Session。

## 7. 什么时候提升边界

只有出现真实复用或真实独立生命周期时才提升抽象：

- 单个 Feature 内部类型先留在 Feature；
- 真正跨 Web / API 的序列化协议才进入 `packages/contracts`；
- 多业务 Feature 稳定复用的无业务 UI 才进入 `packages/ui`；
- 同一业务域能力优先继续留在一个粗粒度 Nest Module；
- 独立领域或基础设施生命周期明确后再新增 Module。

## 8. 权威来源

| 主题             | 权威来源                                               |
| ---------------- | ------------------------------------------------------ |
| Workspace 与脚本 | 根 `package.json`、`pnpm-workspace.yaml`、`turbo.json` |
| HTTP Contract    | `packages/contracts`                                   |
| API Module 组装  | `apps/api/src/app.module.ts` 与各 `*.module.ts`        |
| 数据库当前模型   | Drizzle Schema                                         |
| 数据库初始化基线 | `apps/api/drizzle`                                     |
| 前端路由         | `apps/web/src/router.tsx`                              |
| UI Primitive     | `packages/ui`                                          |
| 国际化资源       | `packages/i18n`                                        |
| 测试可执行合同   | Unit / Integration / E2E / Architecture Test           |
