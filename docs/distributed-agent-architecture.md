# 分布式 Agent 平台目标架构（Pi Durable）

> **文档状态：目标技术架构草案，尚未实现或通过分布式验证。**
>
> **适用项目：** internal-ai-platform。本文记录可长期迭代的技术职责和安全边界，不代表现有代码已经提供这些组件。
>
> **已确定的产品前提：** 仅云端服务、企业内部使用、聊天为主入口、原生 MCP 与插件两条能力接入路径并存。产品模块的唯一主责以 [产品基线](./prd/product-baseline.md) 为准。
>
> **本轮技术方向：** 自建分布式运行环境，采用 Pi Durable 作为候选 Agent Runtime；不引入 Temporal 或 Cloudflare Durable Objects 作为部署依赖。PostgreSQL 分布式存储适配、自动接管等仍属于待验证的技术设计，不能视为已获确认的产品功能或既有实现。
>
> **本轮已确认的执行层结构：** 一个 Agent Host 对应一个 Node.js 进程，进程内同时承载多个 Pi Durable Harness，每个 Harness 使用独立逻辑 Storage。取消独立 Dispatcher 层与 Worker 进程池；本地容量和 Harness 生命周期由 Agent Host 进程内部管理。
>
> **本轮已确认的任务投递方向：** Agent Host 通过 Redis Streams Consumer Group 主动从共享队列领取任务，不预先指定目标 Host。PostgreSQL 继续保存 Run、Assignment、Lease、Fence 与待投递 Outbox 的权威状态。具体实现与故障恢复尚未验证。

## 1. 目标与架构边界

该架构希望同时满足以下性质：

- 接入层与执行节点彼此独立，均可多副本部署。
- 一个 Agent Host（Node.js 进程）可同时承载多个 Pi Durable Harness；每个 Harness 对应独立逻辑 Storage。同一个 Storage 在任意时刻只有一个有效写入所有者，不同 Storage 可在同一 Host 内或不同 Host 间并发运行。
- 任务准入、执行所有权、Agent 内部检查点、文件工作空间分别有明确的权威来源；共享队列负责通知与竞争消费。
- Agent Host 根据自身容量主动领取任务，再通过 PostgreSQL 的原子条件事务竞争 Assignment、Lease、Fence；收到 Redis 消息不会自动取得执行权。
- Agent Host 进程停止或运行节点故障后，在**执行权安全转移且持久状态完整**的前提下，可分别转移该进程原先承载的各份 Storage，并尝试恢复对应 Harness。
- 用户断开网页或 API 副本退出，不应单独导致后台执行状态丢失。
- 工具调用保留两条来源：平台直接连接的 MCP 工具，以及原生插件提供的工具；插件允许复用 MCP 连接。
- 不在平台核心内实现采购、审批等企业业务工作流引擎；业务流程由插件或外部服务拥有。

**重要区分：** “跨节点从检查点恢复”不同于“无缝迁移正在运行的进程”。正在流式生成的 LLM 请求、未持久化的内存片段、进程句柄及本地未同步文件，不能承诺原样跨机器迁移。此能力当前是**待审、待验证**的技术目标，与产品基线中尚未确认的跨机无缝恢复需求分开处理。

## 2. 总体架构图

以下 Mermaid 图是概念组件图，代表**逻辑职责**，不规定未来必须分别部署多少个服务或代码 Package。

~~~mermaid
flowchart LR
    WEB["Browser / Web App"]
    API["无状态 API 副本组<br/>NestJS · 认证 · 请求 · 订阅"]
    CO["Coordinator<br/>任务准入 · Outbox 发布 · 超时对账"]
    RT["实时事件分发<br/>短期流 / 游标（候选）"]
    AUTH[("Redis<br/>现有认证 Session / 限流")]
    STREAM[("Redis Streams 共享队列<br/>Consumer Group")]

    subgraph PG["PostgreSQL：分离的逻辑数据域"]
        CTRL[("控制状态 + Outbox<br/>Run · Assignment · Lease · Fence")]
        DUR[("Pi Durable 状态<br/>Storage Adapter（待实现）")]
        BIZ[("产品业务数据<br/>用户 / 项目等")]
    end

    subgraph HOSTS["Agent Hosts：按 Node.js 进程水平扩容"]
        direction TB
        subgraph HOST_A["Agent Host A · Node.js 进程"]
            direction TB
            HA["主动领取任务<br/>本地容量 · Harness 生命周期"]
            A1["Pi Durable Harness A1<br/>独立逻辑 Storage"]
            A2["Pi Durable Harness A2<br/>独立逻辑 Storage"]
            HA --> A1
            HA --> A2
        end
        subgraph HOST_B["Agent Host B · Node.js 进程"]
            direction TB
            HB["主动领取任务<br/>本地容量 · Harness 生命周期"]
            B1["Pi Durable Harness B1<br/>独立逻辑 Storage"]
            B2["Pi Durable Harness B2<br/>独立逻辑 Storage"]
            HB --> B1
            HB --> B2
        end
    end

    FILES[("持久工作空间 / 对象存储<br/>文件 · Snapshot · Artifact（候选）")]
    MODELS["模型服务<br/>自建或已授权提供商"]
    TOOLS["工具服务<br/>原生 MCP / 插件 / 外部 API"]

    WEB <--> API
    API -->|"创建 / 控制 / 查询"| CO
    API <--> BIZ
    API <--> AUTH
    CO <-->|"权威事务与过期扫描"| CTRL
    CO -->|"Outbox 提交后 XADD"| STREAM
    STREAM -->|"XREADGROUP 主动领取"| HA
    STREAM -->|"XREADGROUP 主动领取"| HB
    HA <-->|"PG 事务竞争 Lease / Fence"| CTRL
    HB <-->|"PG 事务竞争 Lease / Fence"| CTRL
    A1 <-->|"Fence 校验 + 原子提交"| DUR
    A2 <-->|"Fence 校验 + 原子提交"| DUR
    B1 <-->|"Fence 校验 + 原子提交"| DUR
    B2 <-->|"Fence 校验 + 原子提交"| DUR
    A1 <--> FILES
    B1 <--> FILES
    A1 --> MODELS
    B1 --> MODELS
    A1 --> TOOLS
    B1 --> TOOLS
    A1 -.->|"临时进度"| RT
    B1 -.->|"临时进度"| RT
    RT -.->|"订阅 / 重连补拉"| API
~~~

为控制连线密度，图中 A1、B1 通向模型、工具、工作空间和实时流的连接仅作代表性示意；其他 Harness 具备相同能力。每个 Harness 都使用自己的逻辑 Storage，执行资格由 PostgreSQL 裁决。

设计原则：

1. Coordinator 负责准入、权威控制状态、Outbox 和故障对账，不指定执行节点，也不管理 LLM / Tool 内部状态。
2. Redis Streams 的 Consumer Group 负责共享任务投递，Agent Host 主动通过 XREADGROUP 领取；Redis 消费者身份不能替代 PostgreSQL 的执行授权。
3. PostgreSQL 保存 Run / Assignment / Lease / Fence / Outbox 与 Pi Durable 持久状态（不同逻辑数据域）；Redis Streams 不能成为最终业务事实源。
4. Agent Host 是一个 Node.js 进程，进程内管理多个 Pi Durable Harness，不设置独立 Dispatcher 服务或 Worker 进程池。
5. storage_id 为执行所有权与跨节点接管的最小粒度，Agent Host 只管理本进程的容量和生命周期。
6. Streams 可能重复投递或丢失消息，PG Outbox / Run 状态负责重建；XACK 仅确认投递处理，不能代表 Agent 已完成。
7. 实时流与已提交执行事实、文件工作空间与 Runtime Checkpoint 均保持清晰的归属和恢复边界。

## 3. 各层职责与禁止越界的行为

### 3.1 客户端与交互层（Web）

**职责：**

- 聊天输入、消息与工具状态展示、任务列表和执行进度展示。
- 发起任务、补充输入、取消、暂停或继续等用户操作；具体可用命令取决于实现后的能力。
- 与任意健康 API 副本连接；断线后依据持久状态重建界面。
- 展示插件 UI、工具来源和需要用户批准的操作，遵守当前用户与空间的访问范围。

**边界：** 浏览器不持有调度权、Storage 所有权和工具密钥；WebSocket 连接也不代表 Run 必须持续存活。

### 3.2 无状态 API 层（现有 apps/api）

**职责：**

- 复用现有 NestJS 认证、Session、CSRF、HTTP Contract 与请求日志机制。
- 校验用户、企业空间、会话、项目和工具调用权限；为重复提交提供稳定请求标识。
- 将“创建任务 / 控制任务 / 追加输入”送交相应权威接口；按权限返回查询和历史数据。
- 向浏览器转发实时事件，重连后基于持久数据补足状态。
- 提供产品层统一 API，隔离底层 Coordinator / Pi Durable 内部协议。

**边界：** 不直接选择 Agent Host、不代替 Coordinator 续租、不直接创建 Harness 或执行 Agent Loop；API 实例内存不保存唯一的 Run 状态。现有 Controller → Service → Repository → Database 边界继续有效.

### 3.3 分布式协调层（Coordinator）

**职责：**

- 对创建任务执行鉴权后的准入、并发和配额规则；在 PostgreSQL 中原子保存 Run、初始输入引用与待投递 Outbox，尚不分配具体 Host。
- 维护 Assignment、Lease、Fence 的权威数据与竞争规则；Host 领取时使用 PostgreSQL 条件事务获取合法执行权。
- 将已提交的 Outbox 意图通过 XADD 发布到 Redis Streams；发布失败保留 Outbox 重试，重复发布须幂等。
- 定期对账待投递 Run、过期 Lease、失效 Assignment 和待恢复 Storage；撤销失效资格并写入新的 Outbox，供任意有容量的 Host 领取。
- 收集 Agent Host 健康、运行容量和 Drain 状态，用于监控、准入和控制规则。
- 持久化取消、暂停、唤醒等面向运行中任务的控制意图，由当前有效所有者读取并在安全边界处理。

**边界：** 不定向选择 Agent Host、不向指定 Host 发送启动任务、不自行维护本地 Harness 槽位；不保存 Pi Durable 内部 Task Checkpoint 或 LLM 流式输出。插件业务工作流不属于 Coordinator。

**多副本方案：** 利用 PostgreSQL 事务、条件更新和必要的行锁保证状态一致性；Outbox 投递和过期扫描允许幂等重做。初期不引入额外的 Raft 共识协议。

### 3.3.1 共享任务投递层（Redis Streams + PostgreSQL Outbox）

- **队列模型：** 单个共享任务 Stream + Consumer Group，多个 Agent Host 使用 XREADGROUP 竞争消费。初期不按 Host 创建专属 Stream，也不需要定向 WebSocket 控制链路。
- **持久投递：** Coordinator 在同一 PostgreSQL 事务中创建 Run 和 Outbox，提交成功后读取 Outbox 并 XADD。PG 和 Redis 之间没有共享原子事务，发布可能重复。
- **消息内容：** Stream 只传 run_id、storage_id、outbox_id 等稳定任务引用；不携带预先确定的 Host / Assignment / Fence。Redis Stream ID 是传输标识，不能充当业务幂等键。
- **执行门禁：** Host 对消息先做 PG 当前状态检查，再原子竞争 Assignment、Lease 与 Fence；已完成、取消或被其他有效 Lease 持有的任务不得重复启动。
- **ACK 规则：** Host 完成可恢复的持久接管后调用 XACK，不等到完整 Agent 任务结束；Redis ACK 也不能替代 Pi Durable Checkpoint。
- **Pending 恢复：** XREADGROUP 领取后未 XACK 的消息可以通过 XPENDING、XAUTOCLAIM 恢复消费责任。XAUTOCLAIM 不撤销当前有效的 PG Assignment，不能据此直接接管执行。
- **已 ACK 的长任务：** Host 在运行中崩溃后，Redis Pending 已无对应消息；Coordinator 基于 PG Lease 过期、Run 状态和幂等约束创建新的 Outbox，重投共享队列。
- **队列故障：** Redis 不可用、故障切换丢失消息或消息被过早清理时，仍能依据 PG 已提交的 Run / Outbox 重新发布。Redis 的 AOF、主从复制、Stream 保留、Pending 积压和监控需独立设计并验证。
- **隔离：** 当前 Redis 已用于认证和限流；新增 Streams 的资源、ACL、过期与容量策略不能破坏现有认证安全边界。

### 3.4 Agent Host：一个 Node.js 进程承载多个 Pi Durable Harness

**执行层结构（已确认）：**

```text
Agent Host A（Node.js 进程）
├── Pi Durable Harness A1 → 独立逻辑 Storage A1
├── Pi Durable Harness A2 → 独立逻辑 Storage A2
├── Pi Durable Harness A3 → 独立逻辑 Storage A3
└── Pi Durable Harness AN → 独立逻辑 Storage AN
```

一个 Agent Host 是可部署、可水平扩容的 Node.js 进程。多个 Harness 共享进程 CPU、内存和故障域。Host 自身管理各 Harness，无独立 Dispatcher 服务或 Worker 进程池。

**职责：**

- 上报身份、进程代次、健康、能力、容量和当前 Harness 数量。
- 本地有空闲容量时才通过 Redis Streams Consumer Group 的 XREADGROUP 主动领取任务；在进程内原子预留资源，避免超量启动。
- 以 PostgreSQL 为权威，对 Run 和 Storage 状态执行条件事务，获取 Assignment、Lease、Fence；拿不到执行资格就不能启动 Harness。
- 成功领取后，按 storage_id 创建或复用相应 Harness，打开独立 Storage，并提交输入或调用 Pi Durable 的恢复能力。
- 只有启动意图与执行资格形成了可恢复的持久处理结果才 XACK。容量不足、启动失败、ACK 丢失须进入明确的 Pending 回收或 PG 状态对账路径。
- 管理本进程中各 Harness 的暂停、关闭、唤醒、资源回收、健康状态及 Lease 续期；处理持久化取消与暂停等控制意图。
- 进程整体崩溃时，多个 Harness 同时停止；由 Coordinator 逐个 storage_id 对账并再次发布共享队列，其他 Host 可竞争接管。

**边界：** Host 可以从共享队列领取任务，不自行扫描全局 PostgreSQL 待执行任务表做二次分配，也不管理其他 Host 的所有权。不增加本地第二套 Agent Task 状态机；需要隔离不可信命令或 CPU 密集工具时，应建立明确的 Sandbox 边界。

### 3.5 Pi Durable Harness（Agent Runtime 实例）

**职责：**

- 在同一 Agent Host 进程内与其他 Harness 并行运行，每个 Harness 绑定自己的逻辑 Storage 与执行资格。
- 维护 Conversation / Entry / Submission、模型调用、工具任务、扩展和上下文。
- 通过内部 Task 与 Checkpoint 记录 Agent 运行进度；支持重新打开后恢复未完成工作。
- 使用 Pi Durable 自带的输入幂等、忙碌会话与 steer / follow-up 机制。
- 实现工具调用的恢复策略：可安全重放的工作按规则重放，外部副作用未知时显式标记中断或未知结果。
- 提供执行事件、工具返回值和最终答复，供产品层按权限展示或建立索引。

**接管粒度：** 一个 Harness 本身可以管理多个 Conversation；本轮确认每个 Harness 使用独立逻辑 Storage，按 storage_id / Harness 调度和接管，没有要求一个 Conversation 只能属于一个 Harness。如果同一 Harness 包含多个 Conversation，它们共享该 Storage 的所有权和故障恢复范围。会话到 Harness 的具体映射待验证。

**边界：** 不负责跨主机的 Assignment 竞争、租约选举、全局资源调度及企业业务数据归属。Pi Durable 内部 Run、Submission、Task 与平台业务 Run 并非天然一一对应，必须定义清楚映射，避免维护两套 Agent 内部执行状态机。

**上游事实：** Pi Durable 提供可插拔 Storage 接口、Harness.open() 与 resume()；官方声明一个 Storage 同时只由一个进程拥有，框架自身没有跨进程锁。它仍属于实验性 API，升级兼容必须单独测试。

### 3.6 PostgreSQL Storage Adapter（待开发或适配）

**职责：**

- 实现 Pi Durable 的 Storage 契约：原子 Commit、稳定 ID / 序列、Conversation / Entry / Task / Document 查询、关闭和错误语义。
- 允许多个逻辑 Storage 并行服务不同会话或 Agent，采用稳定的 storage_id 隔离数据和所有权。
- 将每次需要改变持久化事实的提交与 Assignment Fence 校验放到**同一数据库事务**中；旧 Fence 必须失败关闭。
- 在存储连接不可靠、提交结果不确定时向 Harness 暴露真实错误，不能静默假定成功。
- 通过上游 Storage Conformance 测试及跨连接、故障切换测试。

**边界：** PG 可插拔接口已经存在；适合多 Storage 并发、支持 Fencing 的 PG Adapter 尚未由本仓库实现和验证。已有第三方 PG Adapter 的“整个 Schema 一位 Owner”锁定模型不可未经改造直接视为高并发多会话方案。

**特别注意：** Fence 保护数据库写入仍不足以阻止已失去执行权的旧 Agent Host / Harness 在外部系统产生副作用。涉及写操作的 MCP / 插件必须另做权限校验、稳定幂等键或结果核验.

### 3.7 持久化与文件存储层

| 数据类别 | 候选权威来源 | 所有者及约束 |
| --- | --- | --- |
| Run、Assignment、Lease、Fence、Outbox | PostgreSQL 控制数据域 | Coordinator 维护规则与对账，Host 通过受控事务竞争执行资格 |
| 对话、模型轮次、Tool Result、Task Checkpoint | PostgreSQL 中的 Pi Durable 数据域 | 只有持有有效 Storage 所有权的 Harness 可写 |
| 用户、团队、项目及归属 | 产品业务数据库 | 由相应产品模块管理，不向 Agent 放开任意表写权限 |
| 文件、工作空间快照、生成产物 | 持久文件服务 / 对象存储（待选型） | 内容空间负责归属；Agent 只取得本次授权的工作区访问权 |
| 登录 Session / CSRF / 登录限流 | Redis（当前已实现） | 现有账户与基础设施模块管理 |
| 共享任务投递及 Pending / ACK | Redis Streams（目标方案，未实现） | Consumer Group 管竞争消费；PG Run / Outbox 保留权威意图 |
| Token 与工具临时进度 | 实时事件通道（待选型） | 可以丢失并重建，不可替代持久化执行事实 |
| 操作审计索引 | 任务与运行管理所属数据域（待细化） | 可从权威执行事实派生；不能维护相冲突的第二套工具执行状态 |

**边界：** 这里的“同一 PostgreSQL”指能够使用同一 PG 技术栈或 HA 集群，不代表必须使用同一 Schema、连接池或迁移权限。现有脚手架的数据库初始基线不因本设计自动修改。

### 3.8 模型服务层

**职责：** 提供经平台允许的模型调用能力，包括模型选择、提供商认证、调用限制、耗量回传。具体模型可以来自自建部署或外部提供商。

**边界：** 模型服务不拥有任务所有权和运行状态；Provider 的一次成功响应不直接等于 Pi Durable 的提交成功。运行结果仍受 Harness 持久化语义约束。

### 3.9 MCP、原生插件与隔离执行环境

**职责：**

- 平台直接 MCP 接入：连接管理、授权状态、工具发现及调用入口。
- 原生插件：安装与启停、工具声明、配置、可用范围；可以根据明确授权复用 MCP 连接。
- 工具执行：在每次调用前检查当前身份、项目/会话范围、连接凭证和执行资格。
- 对具有外部副作用的工具，要求稳定业务幂等键或可查询的操作结果；无法确认结果时保留 unknown 状态。
- 需要命令或文件操作的工具在具备相应隔离能力的运行环境中执行。

**边界：** Agent 负责选择工具，平台负责通用权限与调度，插件拥有专业业务规则和完整业务工作流。插件可用不等于用户自动取得其外部系统权限。

### 3.10 实时订阅与状态查询

**职责：** 将各 Agent Host 内 Harness 的部分输出推送给当前订阅的 Web 客户端；支持 API 多副本、重连后的状态查询与可用事件补拉。

**边界：** 不要求逐 Token 同步持久化；已完成的 Message / Tool Result 以 Pi Durable 已提交事实为准。Redis 现有认证用途不意味着已经具备可靠事件流系统，该组件的实现技术尚未选择。

## 4. 核心身份与运行状态边界

这些是**逻辑标识**，不代表当前已有表、接口或固定字段：

| 标识 | 含义 |
| --- | --- |
| storage_id | 一份 Harness 独立逻辑 Storage 的稳定身份，也是执行所有权与跨节点接管的最小粒度 |
| conversation_id | Pi Durable 内部会话身份；与平台 UI 会话的映射待确认 |
| run_id | 平台层的一次任务或运行身份；不能直接假设等同于 Pi Durable 内部 Run |
| request_id | 同一次用户操作的幂等身份，重发必须返回一致的逻辑结果 |
| outbox_id | PostgreSQL 中稳定的投递意图 ID，重复 XADD 时供业务去重 |
| stream_message_id | Redis 传输消息标识，同一 Outbox 重新发布后可以变化 |
| assignment_id | 某 Agent Host 竞争 PostgreSQL 成功后取得的执行授权 |
| lease_until | 当前 Assignment 的有效期限，采用权威存储时间与一致性规则 |
| fence | 针对同一所有权范围单调递增的代次，用于拒绝迟到执行者 |
| host_id / host_epoch | Agent Host（Node.js 进程）的身份与进程代次，区分重启后的旧命令 |

核心不变量：

1. 每个 storage_id 同一时刻只有一位有效写入所有者，一个 Host 可以持有多个不同的 Storage。
2. Host 领取 Redis 消息后必须在 PG 中原子获得 Assignment、Lease、Fence 才能执行；多个 Host 不能同时写同一份 Storage。
3. 失效和接管必须原子地递增 Fence，所有 Pi Durable 提交在同一数据库事务内校验所有权；不能先查询再无条件写入。
4. Redis Consumer Group 负责消费通知，PostgreSQL 保证执行所有权；XAUTOCLAIM 不授予或抢夺合法 Lease。
5. request_id 和 outbox_id 能阻止 API 重发、重复 XADD、重复消费造成第二个独立业务执行。
6. 已成功提交 PG 的 Run / Outbox 能在 Redis 故障后恢复；XACK 仅确认投递接管，不表示 Agent 完成。
7. Agent 内部执行事实由 Pi Durable 管理，文件和项目归属由内容空间管理；不同事实源不可维护冲突副本。
8. 任务宣告成功前须验证执行结果与跨存储产物已持久化；未知结果不可无依据重试。

## 5. 关键运行链路

### 5.1 创建任务与共享队列领取

1. Web 提交请求，API 完成认证授权、参数和 request_id 幂等校验。
2. Coordinator 在 PostgreSQL 的同一事务中提交 Run、初始输入引用和 Outbox 意图；暂不指定 Host，也不提前签发 Assignment。
3. 已提交的 Outbox 通过 XADD 进入 Redis Streams。失败可重发，重复投递由 outbox_id 和 PG 状态去重。
4. 有空闲资源的 Agent Host 通过 XREADGROUP 主动领取，在本进程内预留容量。
5. Host 检查 PG 中的 Run / Storage 状态，并通过条件事务竞争 Assignment、Lease、Fence；失败时不能启动 Harness。
6. 成功者绑定独立逻辑 Storage，打开或定位 Pi Durable Harness，按需提交初始输入或恢复 Checkpoint。
7. 当执行接管和启动意图已形成可恢复的持久状态后，Host 对 Stream 消息 XACK。Agent 可以继续运行数小时，无需让 Redis 消息保持 Pending。

**跨存储边界：** PG 提交 Run 与 XADD、Pi Durable 输入提交之间没有统一原子事务。必须明确处理“Run 已创建但未发布”“消息领取后未获得 Lease”“Lease 已取得但 Harness 未启动”“Harness 启动后 ACK 丢失”，不能因为重复投递同时启动两个所有者。

### 5.2 运行中输入与控制

- 用户补充输入由 API 授权并去重，映射到当前有效的 Pi Durable Conversation；steer、follow-up 等语义以其实际接口为准。
- 取消、暂停和恢复请求先在 PostgreSQL 持久化控制意图，再由有效 Assignment 所属 Host 在安全边界读取并执行。**不为了运行中控制操作重新引入按 Host 定向的任务 Stream**；低延迟通知策略留待验证。
- Pi Durable 内部 Submission / Task 与平台 Run 各守其职责；对无法确认的外部工具副作用记录真实结果或 unknown。

### 5.3 休眠与唤醒

Pi Durable 可持久化 Task Sleep 并通过 onWake 向宿主报告到期时间。Host 内管理各 Harness 的唤醒需求；进程退出后，Coordinator 仍需通过 PG 持久控制记录发现到期任务，将恢复意图写入 Outbox，再发布到 Redis Streams 供任意 Host 领取。唤醒与恢复时重新校验 Lease / Fence，不能依赖原进程内 setTimeout。

等待状态是否释放资源、保留所有权以及时限策略需独立验证。

### 5.4 实时展示与完成

- Token、部分输出和工具进度通过临时实时流显示；持久消息与 Tool Result 以 Pi Durable 已提交事实为准。
- 文件和业务成果在其权威存储确认后才可对外标记已交付。
- Redis Streams 仅承担共享任务投递，不作为每个 Token 的日志或最终执行事实。
- 审计与展示索引可以从权威记录派生，不得反写或覆盖 Pi Durable 历史。

### 5.5 ACK、Pending 与运行中故障

- **未 ACK：** 领取后崩溃，消息进入 Pending；其他 Host 可通过 XPENDING / XAUTOCLAIM 恢复消费责任，但仍需核验 PG 当前 Lease。
- **已 ACK：** ACK 仅表示任务已被稳定接管，Agent 继续运行；后续 Host 崩溃则由 PostgreSQL 检测 Lease 失效并创建新 Outbox / Stream 消息。
- **重复及过期消息：** 已完成、已取消或被有效 Lease 持有的任务不得重新执行，可按持久状态幂等处置和 ACK。
- **本地容量不足：** 尽量先检查资源再领取；若领取后发现资源不足，不得静默 ACK 导致任务失联，应进入明确的 Pending 认领或 PG 重投流程。
- **Redis 数据丢失：** 以已提交的 PostgreSQL Run / Outbox 为依据重新投递，允许传输消息 ID 变化，绝不因此产生第二份执行资格。

## 6. 跨节点故障恢复（候选关键能力）

~~~mermaid
sequenceDiagram
    participant C as Coordinator / Outbox
    participant P as PostgreSQL 控制 + Pi Durable 状态
    participant S as Redis Streams Consumer Group
    participant A as Agent Host A / Harness A1
    participant B as Agent Host B / 恢复 Harness A1

    C->>P: 原子创建 Run + Outbox
    C->>S: XADD 共享任务通知
    A->>S: XREADGROUP 主动领取
    S-->>A: run_id / storage_id / outbox_id
    A->>P: 事务竞争 Assignment / Lease / fence=41
    P-->>A: 合法执行资格
    A->>A: Harness.open() / resume()
    A->>S: 持久接管后 XACK
    A->>P: 提交 Checkpoint (fence=41)
    Note over A: Host A 进程故障
    C->>P: Lease 过期后撤销旧归属并创建恢复 Outbox
    C->>S: XADD 恢复通知
    B->>S: XREADGROUP 主动领取
    S-->>B: 同一 storage_id 的恢复任务
    B->>P: 事务竞争新 Assignment / fence=42
    P-->>B: 合法执行资格
    B->>B: Harness.open() + resume()
    B->>S: 持久接管后 XACK
    B->>P: 提交 Checkpoint (fence=42)
    A->>P: 旧进程恢复后的迟到写入 (fence=41)
    P-->>A: 拒绝旧代次
~~~

本图以单个 storage_id / Harness 为例，尚未经过故障注入验证。一个 Agent Host 进程宕机，进程内多个 Harness 同时停止；Coordinator 根据 PostgreSQL 分别对账、生成可领取意图，其他 Host 自主竞争。

成功恢复的前提是：PG 能原子撤销旧执行资格并递增 Fence；Pi Durable Storage 与工作区状态可重新打开；工具结果未知时有核验或 unknown 语义；网络暂时断联不会被误判为可安全的双重执行。恢复的是已提交 Checkpoint，不保证迁移未持久化 Token、内存调用栈或本地句柄。

## 7. 故障与可用性边界

| 故障 | 预期处理原则 | 尚需验证 |
| --- | --- | --- |
| 浏览器断线 / API 副本退出 | 后台任务继续，重新查询历史和实时状态 | 重连游标与权限 |
| Coordinator 单副本退出 | 其他副本依据 PG 继续 Outbox 发布和故障对账 | 幂等发布、并发扫描 |
| Host 领取后、XACK 前崩溃 | Redis Pending 可恢复消费责任，但必须重新校验 PG Lease | XAUTOCLAIM、消费竞争 |
| Host 已 ACK、执行中崩溃 | PG Lease 过期对账，重新发布共享队列，再按 Storage 恢复 | 多 Harness、Fence、文件状态 |
| 单个 Harness 出错 | 尽量只影响当前 Storage，其他 Harness 继续运行 | 进程共享资源 |
| Redis Streams 故障或消息丢失 | PG Run / Outbox 保留，重新发布，不丢失权威任务意图 | AOF、复制、PEL 与 Stream 保留 |
| 旧 Host 网络分区恢复 | 旧 Fence 提交被拒绝，敏感工具也要检查执行资格 | 工具幂等、失效隔离 |
| PostgreSQL 故障 | 无法安全竞争执行权或提交 Checkpoint，拒绝无依据继续写入 | PG HA 与未知提交结果 |
| MCP / 插件副作用未知 | 保留 unknown，先核验再决定是否重试 | 外部工具协议 |
| 工作空间无法恢复 | 暂停接管或报告失败，不能用空工作区继续修改 | Snapshot 一致性 |

**高可用边界：** Redis Streams 已选为目标共享投递技术，但生产 HA、AOF、保留与消费恢复参数均待验证。PostgreSQL、文件存储和 Agent Host 同样需要故障恢复策略，Coordinator 多副本本身不保证全系统高可用。

## 8. 安全、权限与产品模块归属

- **身份与访问：** 保留当前 Session + HttpOnly Cookie、CSRF 和服务端权限校验；未来企业登录方式需要与产品需求独立确认。
- **企业空间：** 每企业一套云端空间；会话归个人且始终私有；项目和文件按产品基线归属个人或团队。执行工作空间和 Storage 授权不得跨越用户可见范围。
- **运行权限：** 领取 Redis 消息仅获得竞争机会；Host 成功获取 PostgreSQL Assignment 后，权限才绑定 storage_id、实际执行者、执行代次及工具范围，不向 Agent 下发全库管理员凭据。
- **MCP 与插件：** 两种路径并存，均检查当前用户/项目授权；共享插件不共享个人凭据，也不会扩大外部系统权限。
- **审计责任：** 平台记录工具调用主体、来源、时间、结果与失败语义；插件自己的业务日志仍由插件持有。
- **系统分层：** 任务管理负责通用运行控制和云端协调；Agent 与模型负责推理与工具选择；内容空间负责文件归属；插件负责专业业务流程。不得因新增分布式运行层而增加第七个用户可见产品区域。

这些业务边界的权威来源为 [产品基线](./prd/product-baseline.md)；本文只说明分布式执行如何遵守它们。

## 9. 与当前代码基线的关系

**已存在的脚手架能力：** apps/web、apps/api、packages/contracts、PostgreSQL + Drizzle、Redis 认证基础设施、统一 API 客户端、分层测试和 CI。当前 NestJS 仍是唯一后端入口。

**尚未实现：** Coordinator、PostgreSQL Run / Outbox、Redis Streams Consumer Group、Agent Host 主动领取 / XACK / Pending 恢复、进程内多 Harness 管理、Pi Durable Runtime 集成、PG Storage Adapter、分布式执行所有权、跨节点恢复、工作空间快照、Agent 事件流和插件 / MCP 执行管线。

长期保持以下原则：

- 当前代码结构与依赖方向遵循 [现有系统架构](./architecture.md)；本文件不要求立即新增 apps 或 packages。
- 新的运行组件只有在明确独立生命周期和边界后才进入源码目录设计。
- 不修改现有数据库初始化基线以假装架构已经落地；新增运行表和适配器迁移应在实施阶段另行设计。
- 测试执行与测试库隔离继续遵循 [测试策略](./testing-strategy.md)。

## 10. 实施前必须验证的关键假设

以下条目是**架构判定条件**，不是已完成事项或开发 TODO 清单。

| 假设 | 需要证明的行为 |
| --- | --- |
| Pi Durable PG Storage 契约可实现 | 当前版本上游 Conformance 测试全部通过；原子提交与错误语义正确 |
| 多 Storage 并发及独占所有权可共存 | 单 Host 进程内多个 Harness 可对不同 storage_id 并行运行，跨 Host 争用同一 storage_id 不会双写 |
| 单进程多 Harness 生命周期安全 | 单个 Harness 启动、关闭、休眠或失败不无故影响其他 Harness；进程崩溃后按 Storage 逐个接管 |
| Host 并发容量准入安全 | 多个共享队列消息同时领取时不超额启动 Harness，容量不足不导致并行执行资格 |
| 共享 Consumer Group 竞争 | 多 Host 竞争同一 Run，PG 最终只允许一个有效 Assignment，重复事件安全处置 |
| Outbox 与 Redis 故障 | PG 提交后 XADD 失败、Redis 丢消息、重复发布均可对账恢复 |
| 未 ACK 与已 ACK 不同故障窗口 | XAUTOCLAIM 恢复未 ACK 的消费；已 ACK 的长任务通过 PG Lease 扫描重新入队，不抢占有效 Lease |
| Fence 可隔离失效执行者 | 在数据库切换、旧连接恢复、异步迟到提交等情况下，旧代次写入始终被拒绝 |
| Pi Durable 任务能跨节点恢复 | 真实 kill 与网络分区后可从持久检查点恢复，不依赖旧机内存 |
| MCP / 插件副作用可安全处置 | 已执行但结果未知时不会被无依据重复调用 |
| 工作空间状态可恢复 | 接管后文件内容、版本和工具作用范围与持久化记录一致 |
| Runtime 升级可兼容已有任务 | 持久化 Task、扩展注册和迁移规则在版本变化后行为明确 |

验证失败时应修正对应边界，避免通过吞错、固定延时或无限重试掩盖根因。

## 11. 参考与维护规则

- [Pi Durable 上游 README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md) — Harness、恢复、工具重放、Storage 和限制。
- [Pi Durable Storage 类型定义](https://github.com/earendil-works/pi/blob/main/packages/durable/src/types.ts) — 自定义适配器实现应遵循的接口合同。
- [Redis Streams 官方文档](https://redis.io/docs/latest/develop/data-types/streams/) — Consumer Group、ACK 和 Pending 恢复语义。
- [项目产品基线](./prd/product-baseline.md) — 已确认功能边界高于本文的候选技术选择。
- [项目现有架构](./architecture.md) — 已落地的脚手架、模块和依赖规则。
- [项目文档管理规范](./documentation-policy.md) — 对长期知识的维护约束。

未来当技术决策被确认并实现时，在**同一份文档**中更新状态、职责和仍存的限制；不要追加一份“最终版”来制造并行事实来源。
