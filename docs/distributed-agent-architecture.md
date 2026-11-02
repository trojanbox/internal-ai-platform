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
> **本轮已确认的任务投递方向：** Agent Host 通过 Redis Streams Consumer Group 从兼容版本对应的共享队列主动领取任务，不预先指定目标 Host。PostgreSQL 继续保存 Run、Assignment、Lease、Fence 与待投递 Outbox 的权威状态。具体实现与故障恢复尚未验证。
>
> **本轮已确认的 Runtime 版本隔离：** 继续采用**单 Agent Host（Worker 进程）多 Pi Durable Harness**。同一 Node.js 进程只加载一套固定的 Runtime 构建及其 Task / Extension 定义；不同构建版本通过独立 Worker 池并存。任务必须绑定经过验证的兼容要求，路由与接管时进行检查。版本兼容与存储迁移机制尚未实现。
>
> **控制面长期边界：** Run Control 与面向浏览器的 API 独立部署，均可多副本运行。任务投递、超时恢复维护按独立的可部署运行职责划分，避免上线后依赖拆分 API 或重写调度协议。

## 1. 目标与架构边界

该架构希望同时满足以下性质：

- API、Run Control、任务投递、后台维护和 Agent Host 具备独立的运行生命周期及明确职责；接入层与执行节点均可多副本部署。
- 一个 Agent Host（Worker / Node.js 进程）可同时承载多个 Pi Durable Harness；每个 Harness 对应独立逻辑 Storage。同一个进程内所有 Harness 使用固定的 Runtime 构建版本，同一个 Storage 在任意时刻只有一个有效写入所有者。
- 任务准入、执行所有权、Agent 内部检查点、文件工作空间分别有明确的权威来源；共享队列负责通知与竞争消费。
- Agent Host 仅消费自身兼容组的共享 Stream，并在领取后通过独立 Run Control 的授权接口竞争 Assignment、Lease、Fence；Run Control 通过 PostgreSQL 原子条件事务裁决。收到 Redis 消息不会自动取得执行权。
- Agent Host 进程停止或运行节点故障后，在**执行权安全转移且持久状态完整**的前提下，可分别转移该进程原先承载的各份 Storage，并尝试恢复对应 Harness。
- 用户断开网页或 API 副本退出，不应单独导致后台执行状态丢失；不同 Runtime 版本的 Worker 池允许并存，旧任务恢复前必须核对其存储及扩展兼容性。
- 工具调用保留两条来源：平台直接连接的 MCP 工具，以及原生插件提供的工具；插件允许复用 MCP 连接。
- 不在平台核心内实现采购、审批等企业业务工作流引擎；业务流程由插件或外部服务拥有。

**重要区分：** “跨节点从检查点恢复”不同于“无缝迁移正在运行的进程”。正在流式生成的 LLM 请求、未持久化的内存片段、进程句柄及本地未同步文件，不能承诺原样跨机器迁移。此能力当前是**待审、待验证**的技术目标，与产品基线中尚未确认的跨机无缝恢复需求分开处理。

## 2. 总体架构图

以下 Mermaid 图是概念组件图，代表**逻辑职责**，不规定未来必须分别部署多少个服务或代码 Package。

~~~mermaid
flowchart LR
    WEB["Browser / Web App"]
    API["API Service × N<br/>认证 · HTTP · 查询 · 事件订阅"]
    CONTROL["Run Control Service × N<br/>准入 · Claim · Lease · Fence"]
    DELIVERY["Task Delivery Service × N<br/>Outbox · 兼容版本路由"]
    MAINT["System Maintenance Service × N<br/>Lease 对账 · Timer · 恢复"]
    RT["实时事件分发（候选）<br/>可重建的事件流"]
    AUTH[("Redis<br/>现有 Session / 限流")]

    subgraph PG["PostgreSQL：逻辑数据域隔离"]
        CTRL[("控制状态与 Outbox<br/>Run · Assignment · Lease · Fence · 兼容要求")]
        DUR[("Pi Durable 状态<br/>Storage Adapter（待实现）")]
        BIZ[("产品业务数据")]
    end

    subgraph QUEUES["Redis Streams：按 Runtime 兼容组分流"]
        Q1[("兼容组 K1<br/>共享 Stream + Consumer Group")]
        Q2[("兼容组 K2<br/>共享 Stream + Consumer Group")]
    end

    subgraph P1["Worker Pool K1 · 可扩展 Agent Hosts"]
        direction TB
        H1["Host A · Node.js 进程<br/>固定 Runtime Build A"]
        A1["Pi Durable Harness A1<br/>独立 Storage"]
        A2["Pi Durable Harness A2<br/>独立 Storage"]
        H1 --> A1
        H1 --> A2
    end

    subgraph P2["Worker Pool K2 · 可扩展 Agent Hosts"]
        direction TB
        H2["Host B · Node.js 进程<br/>固定 Runtime Build B"]
        B1["Pi Durable Harness B1<br/>独立 Storage"]
        B2["Pi Durable Harness B2<br/>独立 Storage"]
        H2 --> B1
        H2 --> B2
    end

    FILES[("持久工作空间 / 产物（候选）")]
    MODELS["模型提供商"]
    TOOLS["MCP / 插件 / 外部工具"]

    WEB <--> API
    API -->|"内部控制 API"| CONTROL
    API <--> BIZ
    API <--> AUTH
    CONTROL <-->|"权威控制事务"| CTRL
    DELIVERY <-->|"消费 Outbox"| CTRL
    MAINT <-->|"过期 / 唤醒 / 恢复"| CTRL
    DELIVERY -->|"按 K1 路由 XADD"| Q1
    DELIVERY -->|"按 K2 路由 XADD"| Q2
    Q1 -->|"XREADGROUP 自主领取"| H1
    Q2 -->|"XREADGROUP 自主领取"| H2
    H1 <-->|"Claim / Renew / Report"| CONTROL
    H2 <-->|"Claim / Renew / Report"| CONTROL
    A1 <-->|"Fence + 版本检查 + 提交"| DUR
    A2 <-->|"Fence + 版本检查 + 提交"| DUR
    B1 <-->|"Fence + 版本检查 + 提交"| DUR
    B2 <-->|"Fence + 版本检查 + 提交"| DUR
    A1 <--> FILES
    B1 <--> FILES
    A1 --> MODELS
    B1 --> MODELS
    A1 --> TOOLS
    B1 --> TOOLS
    A1 -.->|"临时执行事件"| RT
    B1 -.->|"临时执行事件"| RT
    RT -.->|"订阅 / 重连补拉"| API
~~~

图中 K1、K2 代表两种**已被证明互不兼容的 Runtime 执行组**，Build A、Build B 只是示意名称。每组可以有多个 Agent Host 副本，每个 Host 可以承载多个 Harness。为减少连线，模型、工具、文件与事件通道只从部分 Harness 绘出，其他 Harness 也具有相同的调用能力。

设计原则：

1. API 与 Run Control 是独立部署角色，API 不持有任务控制、Lease 或 Fence 裁决状态。Run Control 使用 PostgreSQL 维护强一致控制元数据。
2. Task Delivery 和 System Maintenance 具有独立的运行职责、部署和扩容边界；它们只通过已提交的控制状态推进投递与后台恢复。
3. Redis Streams 按**兼容组**而非具体 Host 分流。每个兼容组内使用共享 Stream + Consumer Group，Agent Host 主动竞争领取；Redis 领取本身不构成执行授权。
4. 一个 Agent Host 对应一个 Node.js Worker 进程，进程内运行多个独立 Storage 的 Harness；该进程固定一套 Runtime Build，不动态混用不兼容的 Pi Durable 版本。
5. PostgreSQL 保存 Run、Assignment、Lease、Fence、Outbox 和任务的版本兼容要求；Pi Durable Storage 保存 Agent 内部事实。Adapter 提交时必须在同一事务校验 Fence 与有效所有权。
6. 不同 Worker Build 可以同时部署；旧任务只能由验证兼容的 Worker 领取和恢复。没有可用兼容 Worker 时必须可见地等待，不得自动强行跨版本接管。
7. Stream 消息允许重复或因故障丢失，Outbox 与 Run 状态负责重建；XACK 只表示投递意图已可靠处理，不能代表 Agent 完成。
8. 实时流与已提交执行事实、工作空间与 Runtime Checkpoint 维持各自权威来源。跨节点恢复必须同时验证版本、存储、工具副作用及文件状态。

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
- 提供产品层统一 API，通过内部服务契约连接独立 Run Control，隔离底层 Pi Durable 与 Redis Streams 实现。

**边界：** API 与 Run Control 在部署、伸缩和故障域上分离；API 不直接选择 Agent Host、不代替 Run Control 续租、不直接创建 Harness 或执行 Agent Loop。现有 Controller → Service → Repository → Database 规则仅约束已实现的 API 内部结构。

### 3.3 独立控制与投递服务（Temporal 职责分离思想）

**服务边界：** 采用独立的 Run Control Service（原 Coordinator），与现有 API 不同进程、不同部署和扩容单元。Task Delivery、System Maintenance 也作为独立可部署的运行职责设计。部署可使用相同仓库和共享领域契约，但不能依赖先内嵌在 API、上线后再拆分。

| 运行角色 | 唯一主责 | 不负责 |
| --- | --- | --- |
| API Service | 外部 HTTP 接入、鉴权、订阅、查询与交互 | 执行所有权、调度状态裁决、Agent Loop |
| Run Control Service | 任务准入与控制、Claim / Renew / Release、Assignment、Lease、Fence、任务兼容性校验 | 任务消息传输、模型轮次和 Pi 内部任务 |
| Task Delivery Service | PostgreSQL Outbox 的读取与可靠发布、按兼容组投递 Redis Streams、发布状态对账 | 决定执行所有权 |
| System Maintenance Service | Lease 过期、恢复与休眠唤醒扫描、失效版本池的任务诊断与重投意图 | 直接选择 Host、启动 Harness |
| Agent Host | 对应版本池的队列领取、本地容量、多个 Harness 生命周期 | 跨节点任务分配、直接修改控制状态 |

以上是**目标架构职责划分**，并不表示这些服务当前已实现，也不要求额外复制 Temporal 的 History Shard、通用 Workflow 引擎或 Raft 集群。

### 3.3.1 Run Control Service（权威控制面）

- 通过内部服务接口处理已认证调用方的任务创建、取消、暂停、恢复等控制请求；创建 Run 与初始输入引用的同时在 PostgreSQL 事务中形成 Outbox，不预先指定 Host。
- 对 Agent Host 暴露受控的 Claim / Renew / Release / Report 交互，统一裁决 Assignment、Lease、Fence 和运行终态；Host 不直接拥有控制表的任意写权限。
- 校验 Host 注册的 Runtime Build 和任务的执行兼容要求。Claim 必须先确认版本允许、任务可执行、没有其他有效所有者，再在 PostgreSQL 事务中签发所有权与 Fence。
- 依赖 PostgreSQL 事务、条件更新和必要行锁支持多副本并发，不要求整个控制面使用单 Leader；事务安全和数据库主备故障切换需要真实验证。
- 不保存 Pi Durable Task Checkpoint、完整对话正文或 Token 增量。Storage Adapter 仍需自行对每次持久化写入做事务级 Fence 校验，避免旧进程绕开控制服务写入。

### 3.3.2 Task Delivery Service（可靠投递）

- 根据 Run 已确定的 **required_runtime_compatibility_key**，将已提交 Outbox 通过 `XADD` 送往对应兼容组的共享 Stream；不会选择某个具体 Host。
- 发布可能中断或重复；保留稳定的 outbox_id 供消费者幂等对账，不能把 Redis Stream ID 当成业务主键。
- 当兼容组没有可用 Host 时，待执行意图仍保存在 PostgreSQL；不得把旧版本任务直接投递到不兼容的新版本池。
- 不负责为某个 Host 签发 Lease，也不在收到队列 ACK 时宣布任务已经执行完成。

### 3.3.3 System Maintenance Service（后台恢复）

- 扫描超时 Lease、未完成 Run、待投递或投递结果不确定的 Outbox、到期的 Pi Durable 休眠唤醒意图。
- 对失效所有权发起受控状态转移、递增 Fence，并写入重新可领取的 Outbox；重新投递仍由 Task Delivery 完成。
- 识别“任务被某个旧 Runtime Build / 兼容组固定，但当前没有健康可用 Worker”的情况，保持可诊断的等待 / 阻塞状态，并由部署流程保障兼容池恢复或经验证后迁移。
- 多副本扫描必须可重入，不得与仍有合法 Lease 的 Agent Host 产生双重执行。

### 3.3.4 Redis Streams：兼容版本路由与消费组

**确认的长期行为：** 仍然采用“Worker 主动领取、多个 Host 竞争消费”，不会退回 Coordinator 定向派发。为支持旧版和新版并存，**同一个共享 Stream 的所有消费者必须满足同一兼容约束**。

- 每个独立兼容组使用自己的 Stream 和 Consumer Group；各组的消费者只订阅本组的 Stream。Redis Consumer Group 不会根据消息 JSON 的版本字段自动筛选，多个 Consumer Group 读取同一 Stream 还会分别收到消息，因此不能用“同一 Stream 上多组”冒充版本分流。
- 兼容组由已验证的持久化状态、Task / Extension 定义和工具运行约束确定；部署版本号本身不证明兼容。默认以**精确的 Runtime Build** 构成独立兼容组，只有兼容性测试通过后才允许多个 Build 共用同一组。
- Host 使用 `XREADGROUP` 领取后，通过 Run Control Claim 获取合法 Lease / Fence；版本不符、任务不可执行、已有有效所有者时必须拒绝启动，并采取不丢失任务意图的幂等处置。
- 只有任务接管与启动意图已形成可恢复的持久记录才 `XACK`，不用等待完整 Agent Run 完成。
- 未确认的 Pending 消息可以经 `XPENDING` / `XAUTOCLAIM` 恢复消费；它们不直接撤销 PostgreSQL 中其他 Host 的有效 Assignment。
- Host 已 ACK 但执行中崩溃时，由 Maintenance 根据 PG Lease / 状态生成新的 Outbox，Delivery 重新发布到该任务**当前有效的兼容组**。
- Redis 故障或消息丢失后，按 PG Run / Outbox 对账重投。Stream 的保留、消费者组生命周期、ACL、AOF、复制与积压监控独立设计，不影响现有 Redis 认证边界。

### 3.4 Agent Host：固定 Runtime Build 的单 Worker 多 Harness

**执行层结构（已确认）：**

```text
Worker Pool K1（兼容组，可有多个 Host 副本）
└── Agent Host A（Node.js 进程，固定 Runtime Build A）
    ├── Pi Durable Harness A1 → 独立逻辑 Storage A1
    ├── Pi Durable Harness A2 → 独立逻辑 Storage A2
    ├── Pi Durable Harness A3 → 独立逻辑 Storage A3
    └── Pi Durable Harness AN → 独立逻辑 Storage AN

Worker Pool K2（另一兼容组）
└── Agent Host B（Node.js 进程，固定 Runtime Build B）
    ├── Pi Durable Harness B1 → 独立逻辑 Storage B1
    └── Pi Durable Harness BN → 独立逻辑 Storage BN
```

Agent Host 同时也是一个 Node.js Worker 进程；进程内多个 Harness 共享 CPU、内存和进程故障域，也统一使用该进程已加载的 Pi Durable、Task 定义和 Extension Registry 构建。**不在同一进程动态装载两套不兼容 Runtime，也不改为一个 Worker 一个 Harness。** 每个兼容组可部署多个 Host 副本，通过副本扩缩容。Host 自身管理 Harness，无独立 Dispatcher 服务或 Worker 进程池。

**职责：**

- 上报身份、进程代次、健康、容量、当前 Harness 数量、不可变 runtime_build_id 和声明支持的 runtime_compatibility_key；实际可接管资格以控制服务的兼容性规则为准。
- 只订阅已授权且兼容的 Stream；有空闲容量时通过该组 Consumer Group 的 `XREADGROUP` 主动领取，在进程内原子预留资源，避免超量启动。
- 使用 Run Control 的 Claim / Renew / Release 接口获取和维持执行资格；Run Control 负责 PostgreSQL 条件事务和版本准入，Host 未获得合法 Lease / Fence 或未通过兼容性检查时不能启动 Harness。
- 成功领取后，按 storage_id 创建或复用相应 Harness；在打开持久化状态前验证 Storage Schema / Task / Extension 与当前 Runtime Build 兼容，随后提交输入或调用 Pi Durable 恢复能力。
- 只有启动意图与执行资格形成了可恢复的持久处理结果才 XACK。容量不足、启动失败、ACK 丢失须进入明确的 Pending 回收或 PG 状态对账路径。
- 管理本进程中各 Harness 的暂停、关闭、唤醒、资源回收、健康状态及经 Run Control 的 Lease 续期；处理持久化取消与暂停等控制意图，支持 Drain 时停止接纳新的任务。
- 进程整体崩溃时，多个 Harness 同时停止；由 Coordinator 逐个 storage_id 对账并再次发布共享队列，其他 Host 可竞争接管。

**边界：** Host 只从兼容组共享队列领取任务，不自行扫描全局 PostgreSQL 任务表，不直接改写控制表、跨版本抢占 Storage 或管理其他 Host 的归属。不建立第二套 Agent Task 状态机；不可信命令与 CPU 密集工具通过明确 Sandbox 隔离。

### 3.5 Pi Durable Harness（Agent Runtime 实例）

**职责：**

- 在同一 Agent Host 进程内与其他 Harness 并行运行，每个 Harness 绑定自己的逻辑 Storage 与执行资格。
- 维护 Conversation / Entry / Submission、模型调用、工具任务、扩展和上下文。
- 通过内部 Task 与 Checkpoint 记录 Agent 运行进度；支持重新打开后恢复未完成工作。
- 使用 Pi Durable 自带的输入幂等、忙碌会话与 steer / follow-up 机制。
- 实现工具调用的恢复策略：可安全重放的工作按规则重放，外部副作用未知时显式标记中断或未知结果。
- 提供执行事件、工具返回值和最终答复，供产品层按权限展示或建立索引。

**接管粒度：** 一个 Harness 可以管理多个 Conversation；本轮确认每个 Harness 使用独立逻辑 Storage，按 storage_id / Harness 调度和接管，没有要求一个 Conversation 只能属于一个 Harness。如果同一 Harness 包含多个 Conversation，它们共享该 Storage 的所有权、版本兼容要求和故障恢复范围。会话到 Harness 的映射仍待验证。

**边界：** 不负责跨主机的 Assignment 竞争、租约选举、全局资源调度及企业业务数据归属。Pi Durable 内部 Run、Submission、Task 与平台业务 Run 并非天然一一对应，必须定义清楚映射，避免维护两套 Agent 内部执行状态机。

**上游事实：** Pi Durable 提供可插拔 Storage 接口、Harness.open() 与 resume()；官方声明一个 Storage 同时只由一个进程拥有，框架自身没有跨进程锁。Task / Document 的版本与迁移机制并不能替代整套 Runtime、Storage Schema 及插件兼容性测试；它仍属于实验性 API。

### 3.6 PostgreSQL Storage Adapter（待开发或适配）

**职责：**

- 实现 Pi Durable 的 Storage 契约：原子 Commit、稳定 ID / 序列、Conversation / Entry / Task / Document 查询、关闭和错误语义。
- 允许多个逻辑 Storage 并行服务不同会话或 Agent，采用稳定的 storage_id 隔离数据和所有权。
- 将每次需要改变持久化事实的提交与 Assignment Fence 校验放到**同一数据库事务**中；旧 Fence 必须失败关闭。
- 在存储连接不可靠、提交结果不确定时向 Harness 暴露真实错误，不能静默假定成功。
- 打开 Storage 前验证已记录的 Schema / Runtime 兼容信息；禁止旧版 Worker 在未经验证的情况下打开已升级存储，也禁止不受控的自动降级迁移。
- 通过上游 Storage Conformance、版本迁移、回滚约束及跨连接故障切换测试。

**边界：** PG 可插拔接口已经存在；适合多 Storage 并发、支持 Fencing 的 PG Adapter 尚未由本仓库实现和验证。已有第三方 PG Adapter 的“整个 Schema 一位 Owner”锁定模型不可未经改造直接视为高并发多会话方案。

**特别注意：** Fence 保护数据库写入仍不足以阻止已失去执行权的旧 Agent Host / Harness 在外部系统产生副作用。涉及写操作的 MCP / 插件必须另做权限校验、稳定幂等键或结果核验.

### 3.7 持久化与文件存储层

| 数据类别 | 候选权威来源 | 所有者及约束 |
| --- | --- | --- |
| Run、Assignment、Lease、Fence、Outbox、执行兼容要求 | PostgreSQL 控制数据域 | 独立 Run Control 负责权威裁决；Delivery / Maintenance 负责投递和对账；Host 通过受控接口申请执行资格 |
| 对话、模型轮次、Tool Result、Task Checkpoint | PostgreSQL 中的 Pi Durable 数据域 | 只有持有有效 Storage 所有权的 Harness 可写 |
| 用户、团队、项目及归属 | 产品业务数据库 | 由相应产品模块管理，不向 Agent 放开任意表写权限 |
| 文件、工作空间快照、生成产物 | 持久文件服务 / 对象存储（待选型） | 内容空间负责归属；Agent 只取得本次授权的工作区访问权 |
| 登录 Session / CSRF / 登录限流 | Redis（当前已实现） | 现有账户与基础设施模块管理 |
| 按兼容组分流的任务投递及 Pending / ACK | Redis Streams（目标方案，未实现） | 每个兼容组一个共享 Stream + Consumer Group；PG Run / Outbox 保留权威意图 |
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
| runtime_build_id | Agent Host 所装载的不可变构建标识，覆盖 Pi Durable 依赖与本应用 Task / Extension 实现版本；不能仅以 Pi semver 替代 |
| required_runtime_compatibility_key | Run / Storage 恢复所需的执行兼容组；必须先经验证才能扩大可接受的 Build 集合 |
| storage_schema_version | 对应 Storage 的持久化格式或迁移版本，作为打开与升级前的兼容校验依据 |
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
8. 运行任务必须固定到经过验证的 runtime_compatibility_key；新 Build 不得因版本号更高而自动取得旧 Storage 的运行资格，跨版本执行必须先经过明确的兼容或迁移流程。
9. 同一 Agent Host 进程内多个 Harness 共用唯一 Runtime Build；单 Harness 的故障恢复不能隐式升级其他 Harness 所依赖的持久化格式。
10. 任务宣告成功前须验证执行结果与跨存储产物已持久化；未知结果不可无依据重试。

## 5. 关键运行链路

### 5.1 创建任务、版本分流与共享队列领取

1. Web 提交请求，API 完成认证授权、参数和 request_id 幂等校验，并通过内部服务调用独立 Run Control。
2. Run Control 确定新任务适用的默认 Runtime 兼容组（仅新任务适用），在 PostgreSQL 同一事务中提交 Run、初始输入引用、required_runtime_compatibility_key 和 Outbox；不指定 Host，也不提前签发 Assignment。
3. Task Delivery 读取已提交 Outbox，按任务兼容组通过 `XADD` 写入对应 Stream。失败可重发，重复投递由 outbox_id 和 PG 状态去重。
4. 有空闲资源、且声明兼容组匹配的 Agent Host 通过该 Stream 的 `XREADGROUP` 领取任务，在本进程内预留容量。
5. Host 通过 Run Control 的 Claim 接口请求执行资格；Run Control 校验任务状态、Build 兼容要求、Lease 与 Fence，并通过 PostgreSQL 条件事务裁决。失败或版本不符时不能启动 Harness。
6. 成功领取者绑定独立逻辑 Storage，在打开 Pi Durable Harness 前核验 Storage Schema、Task 定义及 Extension 兼容性，随后按需提交输入或恢复 Checkpoint。
7. 当接管与启动意图已形成可恢复的持久状态后，Host 对该 Stream 消息 `XACK`。Agent 可以长时间运行，无需让 Redis 消息一直处于 Pending。

**跨存储边界：** PG 提交 Run 与 XADD、Pi Durable 输入提交之间没有统一原子事务。必须恢复“Run 已创建但未发布”“消息领取后未获得 Lease”“Lease 已取得但 Harness 未启动”“Harness 启动后 ACK 丢失”等窗口；重复投递不得造成双重执行或错误的跨版本恢复。

### 5.2 运行中输入与控制

- 用户补充输入由 API 授权并去重，映射到当前有效的 Pi Durable Conversation；steer、follow-up 等语义以其实际接口为准。
- 取消、暂停和恢复请求先在 PostgreSQL 持久化控制意图，再由有效 Assignment 所属 Host 在安全边界读取并执行。**不为了运行中控制操作重新引入按 Host 定向的任务 Stream**；低延迟通知策略留待验证。
- Pi Durable 内部 Submission / Task 与平台 Run 各守其职责；对无法确认的外部工具副作用记录真实结果或 unknown。

### 5.3 休眠与唤醒

Pi Durable 可持久化 Task Sleep 并通过 onWake 向宿主报告到期时间。Host 内管理各 Harness 的唤醒需求；进程退出后，System Maintenance 根据 PG 持久控制记录发现到期任务并形成 Outbox，Task Delivery 将其发布到任务**原有的兼容组 Stream**。兼容 Host 重新领取后仍需通过 Run Control 校验 Lease / Fence，不依赖原进程内 setTimeout。

等待状态是否释放资源、保留所有权以及时限策略需独立验证。

### 5.4 实时展示与完成

- Token、部分输出和工具进度通过临时实时流显示；持久消息与 Tool Result 以 Pi Durable 已提交事实为准。
- 文件和业务成果在其权威存储确认后才可对外标记已交付。
- Redis Streams 仅承担共享任务投递，不作为每个 Token 的日志或最终执行事实。
- 审计与展示索引可以从权威记录派生，不得反写或覆盖 Pi Durable 历史。

### 5.5 ACK、Pending 与运行中故障

- **未 ACK：** 领取后崩溃，消息进入所属兼容组 Stream 的 Pending；其他同组 Host 可经 XPENDING / XAUTOCLAIM 恢复消费责任，但必须通过 Run Control 核验 Lease 与版本要求。
- **已 ACK：** ACK 仅表示任务已被稳定接管，Agent 继续运行；后续 Host 崩溃由 Maintenance 检测 PG Lease 失效并形成 Outbox，Delivery 重新发布到兼容组 Stream。
- **重复、过期或错版本消息：** 已完成、已取消、有有效 Lease 或不满足 Build 兼容要求的任务不能被启动；按 PG 权威状态采取可恢复的拒绝、重新路由或幂等 ACK，不能静默丢弃。
- **容量不足：** 先检查资源再领取；若领取后发现不足，明确保留 Pending 恢复或重投路径。
- **Redis 数据丢失：** 根据 PG Run / Outbox 重新投递到对应兼容组；改变 Redis 消息 ID 不能改变任务的执行版本约束。

### 5.6 Runtime 版本部署、Drain、升级与回滚

**默认采用兼容组固定与旧版共存，借鉴 Temporal Worker Versioning 的思想，但不依赖 Temporal 软件。**

1. **构建标识：** 每个 Agent Host 启动时声明其不可变 runtime_build_id（Pi Durable 依赖、Task 定义、Extensions / 插件执行代码等的固定构建身份），不在同一进程中热切换不兼容 Runtime。
2. **新任务路由：** Run Control 将新任务绑定至当前允许使用的兼容组。只有新创建的任务默认选择新组；已经接受的运行、睡眠或待恢复任务继续保留自己的 required_runtime_compatibility_key。
3. **并行版本池：** 发布新 Build 时增加对应 Agent Host 副本和兼容组 Stream；旧版本池继续承接需要旧状态格式的任务。每个池内部仍是 Consumer Group 自主领取，无需逐 Host 定向调度。
4. **安全 Drain：** 停止为旧兼容组接收新的普通任务后，旧 Host 仍应能够完成或恢复该组未结束的任务；存在睡眠、Pending 或可恢复任务时，不能仅根据“当前活跃数为零”直接移除旧池。
5. **显式迁移：** 只有实际证明新的 Runtime Build、Storage Schema、Task Checkpoint、Extension Registry、工具签名与恢复语义兼容，才允许在没有并发所有者的安全边界迁移 Storage 兼容要求。迁移必须保留审计记录、可核验的原始状态及明确回滚方案。
6. **回滚约束：** 构建回滚不等于持久化数据可回滚。若新版本改变 Schema 或检查点且无法由旧版本读取，必须先恢复兼容的存储快照或采用已验证的逆迁移流程；严禁不检查 Schema 直接让旧 Worker 打开。
7. **缺失兼容池：** 任务所需版本的 Worker 全部不可用时，保持明确的 waiting_for_compatible_runtime / blocked 等诊断语义（具体状态名称待设计），不中途偷换版本或重新执行已知不可重放工具；运维恢复对应池或发起经过验证的迁移。

**同一 Storage 内有多个 Conversation：** 它们共享存储格式与所有权。迁移兼容要求必须以整个 Storage 为原子边界评估，不能只升级其中一个 Conversation 而忽略同 Storage 的其他未完成 Task。

## 6. 跨节点故障恢复（候选关键能力）

~~~mermaid
sequenceDiagram
    participant M as System Maintenance
    participant P as PostgreSQL 控制 + Durable 状态
    participant D as Task Delivery
    participant S as Redis Stream K1
    participant A as Host A / Build A
    participant C as Run Control
    participant B as Host B / Build A

    M->>P: 识别待执行 Run（required compatibility K1）
    P-->>D: 已提交的 Outbox / K1
    D->>S: XADD 兼容组 K1
    A->>S: XREADGROUP 主动领取
    S-->>A: run_id / storage_id / outbox_id
    A->>C: Claim(run_id, Build A, K1)
    C->>P: 校验兼容与 Lease，事务签发 fence=41
    C-->>A: Assignment / Lease / fence=41
    A->>A: 核验 Storage Schema 后 Harness.open / resume
    A->>S: 持久接管后 XACK
    A->>P: Checkpoint（fence=41）
    Note over A: Host A 故障
    M->>P: Lease 失效，撤销旧归属并生成 K1 恢复 Outbox
    P-->>D: 读取 K1 恢复 Outbox
    D->>S: XADD 到 K1
    B->>S: XREADGROUP 主动领取
    S-->>B: 原 storage_id 的恢复意图
    B->>C: Claim(run_id, Build A, K1)
    C->>P: 校验兼容，事务签发 fence=42
    C-->>B: 新 Assignment / Lease
    B->>B: 检查版本并 Harness.open / resume
    B->>S: 持久接管后 XACK
    B->>P: Checkpoint（fence=42）
    A->>P: 旧所有者迟到写入（fence=41）
    P-->>A: 拒绝旧 Fence
~~~

图中的 A、B 只是两个兼容的 Host 实例，**不要求二者运行相同的具体 Build；只有经验证属于兼容组 K1 才能接管。** 一个 Host 进程崩溃时，它承载的多个 Harness 同时停止，Maintenance 分别对账其 Storage 并恢复 Outbox。已 ACK 任务的恢复不依赖 Redis Pending。

恢复成功仍以事务级 Fence、Pi Durable 已提交 Checkpoint、可恢复的工作区和受控外部副作用为前提。若 K1 的健康 Worker 全部缺失，任务保持可见等待；不让 K2 的 Host 猜测兼容并直接打开状态。

## 7. 故障与可用性边界

| 故障 | 预期处理原则 | 尚需验证 |
| --- | --- | --- |
| 浏览器断线 / API 副本退出 | 后台任务继续，重新查询历史和实时状态 | 重连游标与权限 |
| Run Control 单副本退出 | 其他独立控制副本继续受控 Claim / Renew / Release；API 不接管控制权限 | PG 并发裁决、服务发现与内部 RPC |
| Task Delivery / Maintenance 副本退出 | 同角色其他副本继续 Outbox 投递、Lease 对账、到期恢复 | 幂等发布、并发扫描 |
| Host 领取后、XACK 前崩溃 | Redis Pending 可恢复消费责任，但必须重新校验 PG Lease | XAUTOCLAIM、消费竞争 |
| Host 已 ACK、执行中崩溃 | PG Lease 过期对账，重新发布到该 Storage 的兼容组 Stream，再由兼容 Host 恢复 | 多 Harness、Fence、版本、文件状态 |
| 新版本上线，旧任务仍存在 | 保留旧兼容组与 Worker 池；升级新任务不会自动迁移旧 Checkpoint | Task / Extension / Schema 兼容性与版本分流 |
| 兼容 Worker 池全部不可用 | 任务可见地等待兼容 Worker 恢复或受控迁移，不跨版本盲目接管 | 阻塞状态、告警与恢复流程 |
| 构建或存储版本回滚 | 必须核验旧 Runtime 能否读取当前存储格式，否则阻止回滚接管 | Storage Schema 与 Task 数据迁移、快照恢复 |
| 单个 Harness 出错 | 尽量只影响当前 Storage，其他 Harness 继续运行 | 进程共享资源 |
| Redis Streams 故障或消息丢失 | PG Run / Outbox 保留，重新发布，不丢失权威任务意图 | AOF、复制、PEL 与 Stream 保留 |
| 旧 Host 网络分区恢复 | 旧 Fence 提交被拒绝，敏感工具也要检查执行资格 | 工具幂等、失效隔离 |
| PostgreSQL 故障 | 无法安全竞争执行权或提交 Checkpoint，拒绝无依据继续写入 | PG HA 与未知提交结果 |
| MCP / 插件副作用未知 | 保留 unknown，先核验再决定是否重试 | 外部工具协议 |
| 工作空间无法恢复 | 暂停接管或报告失败，不能用空工作区继续修改 | Snapshot 一致性 |

**高可用边界：** Redis Streams 已选为目标共享投递技术，但兼容组分流、生产 HA、AOF、保留与消费恢复参数均待验证。PostgreSQL、文件存储和各 Runtime 版本池同样需要独立的故障恢复策略。Run Control / Delivery / Maintenance 独立多副本能隔离负载和故障，但不能单独保证全系统高可用。

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

**尚未实现：** 独立 Run Control / Task Delivery / System Maintenance 服务、PostgreSQL Run / Outbox 与版本兼容元数据、按兼容组分流的 Redis Streams Consumer Group、Agent Host 主动领取 / XACK / Pending 恢复、固定 Runtime Build 的进程内多 Harness 管理、版本池并存及迁移机制、Pi Durable Runtime 集成、PG Storage Adapter、分布式执行所有权、跨节点恢复、工作空间快照、Agent 事件流和插件 / MCP 执行管线。

长期保持以下原则：

- 当前代码结构与依赖方向遵循 [现有系统架构](./architecture.md)；本文件不要求立即新增 apps 或 packages。
- API 与 Run Control 的独立部署边界从设计起固定；Delivery 和 Maintenance 采用独立可部署运行角色。源码目录与共享契约待实现阶段确定，不能将这些角色临时合并到 API 并把上线后拆分作为计划。
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
| 同组 Consumer Group 竞争 | 同一兼容组多个 Host 竞争一个 Run，Run Control 只签发一个有效 Assignment，重复事件安全处置 |
| 版本隔离与分流 | 不兼容 Build 消费不同 Stream；两个兼容组同时在线时，旧任务不会被路由到错误版本 |
| 固定 Runtime Build 的单 Worker 多 Harness | 同一进程多个 Harness 共享构建依赖，但每个 Storage 独立执行与恢复；进程内不混装不兼容版本 |
| 旧版 Drain 与兼容版本池缺失 | 仍有旧版本任务时保持旧池或显式阻塞；不能错误迁移睡眠、待恢复或 Pending 任务 |
| Schema 与 Task 数据升级 / 回滚 | 迁移前阻断并发旧所有者；不兼容回滚失败关闭，并具有测试验证的恢复方案 |
| Outbox 与 Redis 故障 | PG 提交后 XADD 失败、Redis 丢消息、重复发布均可对账恢复 |
| 未 ACK 与已 ACK 不同故障窗口 | XAUTOCLAIM 恢复未 ACK 的消费；已 ACK 的长任务通过 PG Lease 扫描重新入队，不抢占有效 Lease |
| Fence 可隔离失效执行者 | 在数据库切换、旧连接恢复、异步迟到提交等情况下，旧代次写入始终被拒绝 |
| Pi Durable 任务能跨节点恢复 | 真实 kill 与网络分区后可从持久检查点恢复，不依赖旧机内存 |
| MCP / 插件副作用可安全处置 | 已执行但结果未知时不会被无依据重复调用 |
| 工作空间状态可恢复 | 接管后文件内容、版本和工具作用范围与持久化记录一致 |
| Runtime 兼容升级可验证 | 完整验证 Task、Extension、工具签名、Storage Schema 和迁移规则；只有验证通过才扩大兼容 Build 范围 |

验证失败时应修正对应边界，避免通过吞错、固定延时或无限重试掩盖根因。

## 11. 参考与维护规则

- [Pi Durable 上游 README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md) — Harness、恢复、工具重放、Storage 和限制。
- [Pi Durable Storage 类型定义](https://github.com/earendil-works/pi/blob/main/packages/durable/src/types.ts) — 自定义适配器实现应遵循的接口合同。
- [Redis Streams 官方文档](https://redis.io/docs/latest/develop/data-types/streams/) — Consumer Group、ACK 和 Pending 恢复语义。
- [项目产品基线](./prd/product-baseline.md) — 已确认功能边界高于本文的候选技术选择。
- [项目现有架构](./architecture.md) — 已落地的脚手架、模块和依赖规则。
- [项目文档管理规范](./documentation-policy.md) — 对长期知识的维护约束。

未来当技术决策被确认并实现时，在**同一份文档**中更新状态、职责和仍存的限制；不要追加一份“最终版”来制造并行事实来源。
