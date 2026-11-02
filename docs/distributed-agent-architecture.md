# 分布式 Agent 平台目标架构（Pi Durable）

> **文档状态：目标技术架构草案，尚未实现或通过分布式验证。**
>
> **适用项目：** internal-ai-platform。本文记录可长期迭代的技术职责和安全边界，不代表现有代码已经提供这些组件。
>
> **已确定的产品前提：** 仅云端服务、企业内部使用、聊天为主入口、原生 MCP 与插件两条能力接入路径并存。产品模块的唯一主责以 [产品基线](./prd/product-baseline.md) 为准。
>
> **本轮技术方向：** 自建分布式运行环境，采用 Pi Durable 作为候选 Agent Runtime；不引入 Temporal 或 Cloudflare Durable Objects 作为部署依赖。PostgreSQL 分布式存储适配、自动接管等仍属于待验证的技术设计，不能视为已获确认的产品功能或既有实现。

## 1. 目标与架构边界

该架构希望同时满足以下性质：

- 接入层与执行节点彼此独立，均可多副本部署。
- 同一个 Pi Durable Storage 在任意时刻只有一个有效写入所有者；不同 Storage 可分布在不同 Agent Host 上并发运行。
- 调度决策、执行资格、Agent 内部检查点、文件工作空间分别有明确的权威来源。
- Worker 进程停止、节点故障后，在**执行权安全转移且持久状态完整**的前提下，允许另一节点尝试从 Pi Durable 检查点恢复。
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
    CO["Coordinator 逻辑控制面<br/>准入 · 调度 · Lease · Fence"]
    RT["实时事件分发<br/>短期流 / 游标（候选）"]
    AUTH[("Redis<br/>现有认证 Session / 限流")]

    subgraph HOSTS["Agent Hosts：多个可扩展的执行节点"]
        direction TB
        D1["Host A · Dispatcher"]
        W1["Pi Durable Harness A<br/>Agent · Tasks · Tools"]
        D2["Host B · Dispatcher"]
        W2["Pi Durable Harness B<br/>Agent · Tasks · Tools"]
        D1 --> W1
        D2 --> W2
    end

    subgraph PG["PostgreSQL：分离的逻辑数据域"]
        CTRL[("控制状态<br/>Run · Assignment · Lease · Fence")]
        DUR[("Pi Durable 状态<br/>Storage Adapter（待实现）")]
        BIZ[("产品业务数据<br/>用户 / 项目等")]
    end

    FILES[("持久工作空间 / 对象存储<br/>文件 · Snapshot · Artifact（候选）")]
    MODELS["模型服务<br/>自建或已授权提供商"]
    TOOLS["工具服务<br/>原生 MCP / 插件 / 外部 API"]

    WEB <--> API
    API -->|"任务请求 / 控制请求"| CO
    API <--> BIZ
    API <--> AUTH
    CO <-->|"权威调度事务"| CTRL
    CO -->|"明确的 Assignment / 取消 / 唤醒"| D1
    CO -->|"明确的 Assignment / 取消 / 唤醒"| D2
    W1 <-->|"原子持久化 + Fence 校验"| DUR
    W2 <-->|"原子持久化 + Fence 校验"| DUR
    W1 <--> FILES
    W2 <--> FILES
    W1 --> MODELS
    W2 --> MODELS
    W1 --> TOOLS
    W2 --> TOOLS
    W1 -.->|"临时进度事件"| RT
    W2 -.->|"临时进度事件"| RT
    RT -.->|"订阅 / 重连补拉"| API
~~~

设计原则：

1. Coordinator 不直接执行 LLM Round 或 Tool Call；Pi Durable 不进行全局跨节点调度。
2. PostgreSQL 是控制状态和 Pi Durable 持久化状态的候选承载组件，二者必须逻辑隔离；Redis 仍承担现有认证职责，不成为执行状态事实源。
3. Agent Host 可以同时承载多个互相隔离的 Harness，但每份 Storage 只能有一位当前所有者。
4. 实时流服务只承载可重建的展示事件，稳定消息和工具结果必须以 Pi Durable 已提交的数据为准。
5. 文件持久化与执行状态持久化独立。跨节点恢复必须同时核验工作空间是否可重建。

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

**边界：** 不直接挑选 Worker、不代替 Coordinator 续租、不直接执行 Agent Loop；API 实例内存不保存唯一的 Run 状态。现有 Controller → Service → Repository → Database 边界继续有效。

### 3.3 分布式协调层（Coordinator）

**职责：**

- 管理可调度 Agent Host 的健康、能力、容量及 Drain 状态。
- 对任务执行进行资源准入，形成当前有效 Assignment。
- 管理 Execution Lease 与单调递增的 Assignment Fence，处理续租、撤销和故障接管。
- 选择目标 Agent Host，投递可去重的启动、取消、唤醒等控制意图。
- 保存任务的**平台级**生命周期及执行归属，协调同一任务的重入和并发限制。
- 在节点失联后判断旧所有权是否失效，在满足接管条件时重新分配。

**边界：** 不保存 LLM 流式正文、Pi Durable 内部 Task Checkpoint，也不决定模型下一步调用哪个工具。企业业务流程及其编排属于插件。

**多副本方案：** 首选利用 PostgreSQL 事务、条件更新和必要的行级锁串行化所有权变更。多个 Coordinator 副本共享权威控制数据；初始设计不要求再实现一套独立 Raft 共识协议。数据库故障切换和竞争写入的正确性必须实测。

### 3.4 执行主机与本地 Dispatcher（Agent Host）

**职责：**

- 作为独立执行节点向协调层报告身份、能力、容量与健康状态。
- 在本地负责 Harness 的创建、定位、停止、关闭、重新打开及资源回收。
- 管理本机可并发执行的 Storage / Agent 数量，以及 CPU、内存、隔离执行资源。
- 收到有效 Assignment 后打开对应 Storage；恢复时先取得新的所有权，再调用 Pi Durable 恢复入口。
- 在续租失败、所有权被撤销或存储错误时停止启动新工作，进入安全停止流程。

**边界：** Dispatcher 只管理本机资源，不自行扫描全局任务池做跨节点分配；不可越过 Coordinator 将同一 Storage 分配给第二个执行者。

### 3.5 Pi Durable Agent Runtime（Worker 的核心）

**职责：**

- 维护 Conversation / Entry / Submission、模型调用、工具任务、扩展和上下文。
- 通过内部 Task 与 Checkpoint 记录 Agent 运行进度；支持重新打开后恢复未完成工作。
- 使用 Pi Durable 自带的输入幂等、忙碌会话与 steer / follow-up 机制。
- 实现工具调用的恢复策略：可安全重放的工作按规则重放，外部副作用未知时显式标记中断或未知结果。
- 提供执行事件、工具返回值和最终答复，供产品层按权限展示或建立索引。

**边界：** 不负责跨主机的 Assignment 竞争、租约选举、全局资源调度及企业业务数据归属。Pi Durable 自身的 Run、Submission、Task 与平台的业务 Run 不是天然一一对应关系，必须明确建立映射，避免维护两套 Agent 内部执行状态机。

**上游事实：** Pi Durable 当前提供可插拔 Storage 接口、Harness.open() 与 resume()；官方声明一个 Storage 同时只由一个进程拥有，框架自身没有跨进程锁。它仍属于实验性 API，升级兼容必须单独测试。

### 3.6 PostgreSQL Storage Adapter（待开发或适配）

**职责：**

- 实现 Pi Durable 的 Storage 契约：原子 Commit、稳定 ID / 序列、Conversation / Entry / Task / Document 查询、关闭和错误语义。
- 允许多个逻辑 Storage 并行服务不同会话或 Agent，采用稳定的 storage_id 隔离数据和所有权。
- 将每次需要改变持久化事实的提交与 Assignment Fence 校验放到**同一数据库事务**中；旧 Fence 必须失败关闭。
- 在存储连接不可靠、提交结果不确定时向 Harness 暴露真实错误，不能静默假定成功。
- 通过上游 Storage Conformance 测试及跨连接、故障切换测试。

**边界：** PG 可插拔接口已经存在；适合多 Storage 并发、支持 Fencing 的 PG Adapter 尚未由本仓库实现和验证。已有第三方 PG Adapter 的“整个 Schema 一位 Owner”锁定模型不可未经改造直接视为高并发多会话方案。

**特别注意：** Fence 保护本地数据库写入仍不足以阻止一个旧 Worker 在外部系统执行副作用。涉及写操作的 MCP / 插件必须另做权限校验、稳定幂等键或结果核验。

### 3.7 持久化与文件存储层

| 数据类别 | 候选权威来源 | 所有者及约束 |
| --- | --- | --- |
| Run、Assignment、Lease、Fence、调度意图 | PostgreSQL 控制数据域 | Coordinator 负责变更，事务保障竞争安全 |
| 对话、模型轮次、Tool Result、Task Checkpoint | PostgreSQL 中的 Pi Durable 数据域 | 只有持有有效 Storage 所有权的 Harness 可写 |
| 用户、团队、项目及归属 | 产品业务数据库 | 由相应产品模块管理，不向 Agent 放开任意表写权限 |
| 文件、工作空间快照、生成产物 | 持久文件服务 / 对象存储（待选型） | 内容空间负责归属；Agent 只取得本次授权的工作区访问权 |
| 登录 Session / CSRF / 登录限流 | Redis（当前已实现） | 现有账户与基础设施模块管理 |
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

**职责：** 将 Worker 的部分输出推送给当前订阅的 Web 客户端；支持 API 多副本、重连后的状态查询与可用事件补拉。

**边界：** 不要求逐 Token 同步持久化；已完成的 Message / Tool Result 以 Pi Durable 已提交事实为准。Redis 现有认证用途不意味着已经具备可靠事件流系统，该组件的实现技术尚未选择。

## 4. 核心身份与运行状态边界

这些是**逻辑标识**，不代表当前已有表、接口或固定字段：

| 标识 | 含义 |
| --- | --- |
| storage_id | 一份 Pi Durable Harness 持久化命名空间的稳定身份 |
| conversation_id | Pi Durable 内部会话身份；与平台 UI 会话的映射待确认 |
| run_id | 平台层的一次任务或运行身份；不能直接假设等同于 Pi Durable 内部 Run |
| request_id | 同一次用户操作的幂等身份，重发必须返回一致的逻辑结果 |
| assignment_id | 一次将任务交给某个 Agent Host 的执行授权 |
| lease_until | 当前 Assignment 的有效期限，采用权威存储时间与一致性规则 |
| fence | 针对同一所有权范围单调递增的代次，用于拒绝迟到执行者 |
| host_id / host_epoch | 运行节点及进程代次，区分节点重启后的旧消息 |

核心不变量：

1. 同一个 storage_id 同一时刻只允许一位**有效写入所有者**。
2. 改变 Assignment 时必须原子地撤销旧资格、产生更高 Fence 并保存新归属。
3. 所有 Pi Durable 持久化提交都必须接受与其所有权一致的事务级 Fence 校验；不能先读 Fence、再无条件写入。
4. 调度控制状态由 Coordinator 拥有，Agent 内部执行事实由 Pi Durable 拥有，文件和项目的长期归属由内容空间拥有。
5. 同一个 request_id 不能因为 API 重连或命令重投产生第二次独立创建。
6. 任务标记成功之前，必须验证必要的 Agent 结果与业务产物已经持久化；跨存储一致性由明确的完成协议承担。
7. 状态无法确认时保持真实的不确定性，不靠无依据的刷新、重试或忽略错误推进执行。

## 5. 关键运行链路

### 5.1 创建任务

1. Web 向 API 提交输入；API 完成认证、授权、参数与请求幂等校验。
2. API 向 Coordinator 提出平台级运行申请；Coordinator 从持久化控制状态判断准入与资源容量。
3. Coordinator 在权威事务中创建 Run / Assignment、生成执行 Fence，并记录待送达的控制意图。
4. Agent Host 的 Dispatcher 接收并幂等核验 Assignment，按 storage_id、Fence 获取 Storage 执行所有权。
5. Dispatcher 打开 Pi Durable Harness；新任务提交输入，已存在的任务按需要恢复。
6. Pi Durable 负责后续模型调用、工具任务与持久化检查点，平台层维护可查询的任务归属和状态。

任务申请与 Pi Durable 输入提交可能跨越不同事务域；正式实现必须定义“申请成功但输入尚未持久化”时的补偿与对账流程，不能让空任务被错误地报告为运行成功。

### 5.2 运行中输入与停止

- 客户端输入由 API 授权并去重后送入对应的 Pi Durable Conversation；是否 steer、排队后续输入或拒绝，需要按 Pi Durable 实际接口明确映射。
- 取消与暂停首先进入平台控制语义，再由当前有效 Host 在安全边界调用 Runtime 的对应能力。
- Pi Durable 的内部 Submission / Task 状态与平台 Run 状态分别承担各自职责；平台不复制 LLM Round 内部状态机。
- 对取消中的不可中断外部副作用，需要记录其最终结果或未知状态；不能在收到取消请求时立刻声称所有外部动作均已撤销。

### 5.3 休眠与唤醒

Pi Durable 可以持久化 Task Sleep，并通过 onWake 把下一次唤醒需求交给宿主。自建场景下，需要由 Agent Host / Coordinator 保存并处理唤醒意图，在到期时分配具备所有权的执行节点；不能仅依赖原进程中的 setTimeout 完成跨节点调度。

处于等待状态的任务是否释放活跃计算槽位、保留哪种所有权以及超时策略，属于待验证的实施规则。

### 5.4 对话展示与完成

- 流式 Token、局部思考与临时工具输出通过短期实时通道展示。
- 稳定消息与 Tool Result 由 Pi Durable 承担持久化，用户重连时以持久化状态校正视图。
- 文件或其他跨系统业务成果在其权威存储确认后，才能被平台标记为已交付。
- 审计和运行索引可以从持久化事实建立投影，不能反向覆盖 Pi Durable 内部历史。

## 6. 跨节点故障恢复（候选关键能力）

~~~mermaid
sequenceDiagram
    participant A as Host A / Pi Durable
    participant C as Coordinator
    participant P as PostgreSQL 控制 + Durable 状态
    participant B as Host B / Pi Durable

    C->>P: 事务创建 Assignment A（fence=41）
    C->>A: Start(storage_id, fence=41)
    A->>P: 校验 Fence 并提交 Checkpoint
    Note over A: 进程崩溃或与控制面失联
    C->>P: 原子确认失效并变更归属（fence=42）
    P-->>C: Assignment B 生效
    C->>B: Start(storage_id, fence=42)
    B->>P: 获取有效 Storage 所有权
    B->>B: Harness.open() + resume()
    B->>P: 校验新 Fence 后继续持久化
    A->>P: 迟到提交（fence=41）
    P-->>A: 拒绝过期所有权
~~~

这是需要通过真实故障注入验证的目标流程；**节点暂时失联不必然等于进程已经停止**。实现时应区分租约到期、进程终止、旧所有者仍运行以及存储连接丢失等不同情况。

恢复链路成立的前提：

1. 权威控制存储能够安全原子地转移执行资格；旧进程所有提交都能被 Fence 拒绝。
2. Pi Durable Storage 数据已持久化并允许其他进程重新打开；接管时使用兼容的 Runtime / 扩展版本。
3. 新节点能够恢复所需文件工作空间和外部引用，不能依赖旧机的临时目录。
4. 外部工具若在崩溃时已经执行、结果却未落库，必须核实结果或标记 unknown；不能盲目再次执行。
5. 旧 Worker 即使恢复网络也不能再次取得同一执行资格；敏感工具在执行前必须额外验证权限与代次。

**恢复成功的定义：** 从已提交检查点继续、没有并发写入、不会无依据重复产生外部副作用。不得承诺恢复故障前的内存调用栈或每一个流式 Token。

## 7. 故障与可用性边界

| 故障 | 预期处理原则 | 尚需验证 |
| --- | --- | --- |
| 浏览器断线 / API 副本退出 | 后台任务所有权不变；重新连接任意 API 并查询历史 | 实时事件补拉及游标 |
| Coordinator 单副本退出 | 其他副本继续基于 PG 权威状态处理调度 | 多副本事务竞争与命令去重 |
| Worker 进程崩溃 | 旧租约失效并安全转移资格后，尝试在其他 Host 从 Checkpoint 恢复 | Storage Fencing、版本、文件状态 |
| 旧 Worker 网络分区后恢复 | 旧 Fence 提交必须被拒绝，并停止后续副作用 | 外部工具代理的执行资格保护 |
| PostgreSQL 暂时不可用 | 禁止以过期所有权继续产生不可确认的状态写入；失败的 Harness 按官方语义关闭 | PG HA、重连、提交结果未知 |
| 模型请求失败或中断 | 遵守 Pi Durable 的任务重试与失败语义 | 费用统计、重复请求与超时 |
| 外部 MCP / 插件写操作结果未知 | 保留 unknown，按业务幂等键核验；无依据不重试 | 各工具类型的副作用策略 |
| 节点无法恢复文件工作区 | 暂停恢复或报告失败，不能基于空目录继续修改 | Snapshot 一致性与挂载方案 |

**基础设施高可用边界：** Coordinator 多副本并不自动意味着平台高可用。PostgreSQL、文件存储、命令投递路径及运行节点同样需要可恢复的故障模型。具体容器编排、消息中间件、对象存储产品与 HA 拓扑尚未选定。

## 8. 安全、权限与产品模块归属

- **身份与访问：** 保留当前 Session + HttpOnly Cookie、CSRF 和服务端权限校验；未来企业登录方式需要与产品需求独立确认。
- **企业空间：** 每企业一套云端空间；会话归个人且始终私有；项目和文件按产品基线归属个人或团队。执行工作空间和 Storage 授权不得跨越用户可见范围。
- **运行权限：** Assignment 只授权指定 storage_id、运行节点、执行代次和被允许的工具范围，不向 Agent 下发全库管理员凭据。
- **MCP 与插件：** 两种路径并存，均检查当前用户/项目授权；共享插件不共享个人凭据，也不会扩大外部系统权限。
- **审计责任：** 平台记录工具调用主体、来源、时间、结果与失败语义；插件自己的业务日志仍由插件持有。
- **系统分层：** 任务管理负责通用运行控制和云端协调；Agent 与模型负责推理与工具选择；内容空间负责文件归属；插件负责专业业务流程。不得因新增分布式运行层而增加第七个用户可见产品区域。

这些业务边界的权威来源为 [产品基线](./prd/product-baseline.md)；本文只说明分布式执行如何遵守它们。

## 9. 与当前代码基线的关系

**已存在的脚手架能力：** apps/web、apps/api、packages/contracts、PostgreSQL + Drizzle、Redis 认证基础设施、统一 API 客户端、分层测试和 CI。当前 NestJS 仍是唯一后端入口。

**尚未实现：** Coordinator、Agent Host / Dispatcher、Pi Durable Runtime 集成、PG Storage Adapter、分布式执行所有权、跨节点恢复、工作空间快照、Agent 事件流和插件 / MCP 执行管线。

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
| 多 Storage 并发及独占所有权可共存 | 多 Host 操作不同 storage_id 并行，竞争同一 storage_id 不会发生双写 |
| Fence 可隔离失效执行者 | 在数据库切换、旧连接恢复、异步迟到提交等情况下，旧代次写入始终被拒绝 |
| Pi Durable 任务能跨节点恢复 | 真实 kill 与网络分区后可从持久检查点恢复，不依赖旧机内存 |
| MCP / 插件副作用可安全处置 | 已执行但结果未知时不会被无依据重复调用 |
| 工作空间状态可恢复 | 接管后文件内容、版本和工具作用范围与持久化记录一致 |
| Runtime 升级可兼容已有任务 | 持久化 Task、扩展注册和迁移规则在版本变化后行为明确 |

验证失败时应修正对应边界，避免通过吞错、固定延时或无限重试掩盖根因。

## 11. 参考与维护规则

- [Pi Durable 上游 README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md) — Harness、恢复、工具重放、Storage 和限制。
- [Pi Durable Storage 类型定义](https://github.com/earendil-works/pi/blob/main/packages/durable/src/types.ts) — 自定义适配器实现应遵循的接口合同。
- [项目产品基线](./prd/product-baseline.md) — 已确认功能边界高于本文的候选技术选择。
- [项目现有架构](./architecture.md) — 已落地的脚手架、模块和依赖规则。
- [项目文档管理规范](./documentation-policy.md) — 对长期知识的维护约束。

未来当技术决策被确认并实现时，在**同一份文档**中更新状态、职责和仍存的限制；不要追加一份“最终版”来制造并行事实来源。
