# Runtime Architecture

## Node-Centric Model

Canal Plus 的运行模型不是独立 Console 管理多个 Agent，而是每个 Node 节点同时承担控制台和执行节点职责。

```text
Node 节点
  ├── Web UI
  ├── API Server
  ├── Node 管理模块
  ├── TaskProcessManager
  ├── TaskLogService
  ├── TaskStatusService
  ├── NodeHeartbeatService
  └── Task Process
        ├── Task Process 1
        ├── Task Process 2
        └── Task Process 3
```

## Core Services

### TaskProcessManager

- 根据当前节点 ID 和任务 lease 判断哪些任务应由本机托管。
- 为本机托管任务拉起独立子进程。
- 在 lease 迁移、节点排空、节点下线、任务停止时回收本地进程。
- 在节点恢复上线或重新均衡后重新协调本地任务集合。

### TaskLogService

- 聚合任务运行日志和控制面动作日志。
- 按任务保留有限数量的最近日志。
- 为前端提供任务日志列表和实时流式订阅。

### TaskStatusService

- 维护任务的进程状态、执行节点、最近心跳、最近日志和运行摘要。
- 区分 `running / remote / awaiting_takeover / failed / stopped` 等进程态。
- 在节点迁移、待接管、重跑、停止、故障退出等场景下更新统一运行态。

### NodeHeartbeatService

- 当前节点只刷新自己的心跳。
- 心跳超时后节点转离线，并触发 lease 重新分配。

## Runtime Semantics

### Task status

- `draft`: 草稿
- `pending`: 已创建但等待节点承载
- `full_syncing`: 正在执行全量阶段
- `incremental_running`: 正在执行增量阶段
- `paused`: 用户主动暂停
- `failed`: 任务执行异常
- `stopped`: 用户主动停止或全量迁移完成

### Process status

- `idle`: 尚未拉起本地进程
- `starting`: 本地进程启动中
- `running`: 本地进程运行中
- `stopping`: 本地进程正在停止
- `stopped`: 本地进程已结束
- `failed`: 本地进程异常退出
- `remote`: 当前任务由其他节点托管
- `awaiting_takeover`: 当前没有可用节点承载，等待接管

### Hosting semantics

- `managedByLocalNode=true`: 当前控制节点负责托管和读取本地日志
- `managedByLocalNode=false`: 当前任务在其他节点运行，本地只能看共享运行态，不直接读实时日志
- `localLogAccessible=false`: 前端应提示切换到对应节点查看日志

## Node Lifecycle

### Bring node online

1. 节点恢复上线
2. 当前节点写入上线事件
3. 触发 lease 重分配
4. 返回迁移报告
5. 各节点的 `TaskProcessManager` 根据 lease 变化重新协调本地进程

### Take node offline

1. 节点状态切换为离线
2. 受影响任务 lease 被重新分配
3. 返回迁移报告
4. 原节点本地进程被停止，目标节点重新拉起对应任务进程

### Drain node

1. 节点状态切换为排空中
2. 承载任务迁移到其他在线节点
3. 返回迁移报告
4. 排空节点不再接新任务

### Upgrade / Uninstall

1. 先迁移承载任务
2. 若迁移失败则回滚内存状态
3. 若迁移成功则继续执行升级或卸载
4. 返回节点步骤结果与受影响任务的迁移明细

## Frontend Mapping

### Dashboard

- 展示当前节点托管、远程托管、待接管任务数量
- 展示最近发生运行变化的任务和日志摘要

### Task page

- 展示进程态、托管模式、日志访问方式
- 支持任务实时日志
- 支持运行轨迹 checkpoint 时间线
- 支持从任务跳转到对应节点

### Node page

- 支持搜索、状态筛选、重新均衡
- 展示节点承载任务、最近运维事件、迁移报告
- 支持从节点跳回任务详情

## Current Limitation

当前任务进程仍为演示型进程，用来验证：

- 任务独立进程运行
- 任务运行状态推进
- 任务日志实时输出
- 节点生命周期和任务迁移闭环

后续接入真实 CDC consumer 时，可以保留整个任务、日志、状态和节点调度模型，只替换任务进程内部执行器。
