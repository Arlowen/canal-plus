# Canal Plus

Canal Plus 是一个轻量级数据同步、数据迁移、数据校验工具。当前版本已经收敛为 Node 节点自带控制台的架构：每个节点同时提供 Web UI、API、任务进程管理、运行日志采集和节点运维能力。

## 目录结构

```text
canal-plus/
  backend/   # Go API、节点管理、任务进程与运行态
  frontend/  # Vite + React 控制台
  docs/      # 产品文档与运行架构说明
```

## 当前产品结构

- 工作台：展示运行模型、最近任务、待接管任务、节点状态和下一步操作。
- 数据源：新增、编辑、测试连接、删除保护、使用统计。
- 任务：按五类任务创建，同步任务运行状态、实时日志、运行轨迹、节点托管语义。
- 节点：部署、升级、卸载、上线、下线、排空、故障演练、重新均衡，并展示任务迁移报告。
- 设置：告警规则、基础配置、最近操作记录。

## 当前架构

Canal Plus 不再假设独立 Console 服务。正确模型是：

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

关键点：

- 每个同步任务由独立子进程运行。
- 任务运行日志通过 `TaskLogService` 聚合，并通过 API 与 SSE 提供给前端。
- 任务运行态由 `TaskStatusService` 维护，前端可看到进程状态、托管节点、待接管状态和运行轨迹。
- 节点变更会触发 lease 重分配和任务迁移报告。
- 当前控制节点会明确标识，且不能从本机控制台执行自身下线、卸载或故障演练。

更完整的运行模型见 [docs/runtime-architecture.md](/Users/pika/codex-cli-worker/canal-plus/docs/runtime-architecture.md)。

## 已实现能力

- 登录与权限：内置 `admin` / `admin123`、`operator` / `operator123`。
- 数据源管理：新增、编辑、连接测试、删除保护、默认库、用途分类。
- 任务创建：统一收敛为五类任务。
  - 全量迁移
  - 增量同步
  - 数据校验
  - 数据订正
  - 结构对比
- 同步任务运行：启动、暂停、恢复、停止、重跑、删除、位点重置。
- 运行状态：进程状态、托管模式、执行节点、待接管、远程托管、本地日志可见性。
- 实时日志：任务进程日志支持实时流式查看。
- 运行轨迹：checkpoint 时间线展示位点、lease epoch、节点切换和生命周期原因。
- 节点运维：部署、升级、卸载、手动上下线、排空、故障演练、重新均衡。
- 迁移报告：节点生命周期操作会返回受影响任务、迁移方向、恢复位点、接管次数。
- 告警与审计：告警规则、最近操作、节点运维事件。

## 本地启动

```bash
npm install
npm run dev
```

启动后访问：

- Frontend: [http://localhost:8999](http://localhost:8999)
- Backend health: [http://localhost:4100/api/health](http://localhost:4100/api/health)

## 打包发布

执行根目录脚本：

```bash
./all_build.sh
```

脚本会自动构建并输出两个压缩包到 `output/`：

- `output/canal-plus-frontend.tar.gz`：前端静态资源包
- `output/canal-plus-backend.tar.gz`：后端可执行程序和运行配置包

## 环境变量

复制 `backend/.env.example`：

```bash
cp backend/.env.example backend/.env
```

常用变量：

- `PORT`: 后端端口，默认 `4100`
- `FRONTEND_ORIGIN`: 允许跨域的前端地址，默认 `http://localhost:8999`
- `CANAL_PLUS_SECRET`: 数据源密码加密密钥
- `CANAL_PLUS_DATA_FILE`: 未启用 MySQL 元数据存储时，本地元数据与运行态文件路径，默认 `./data/store.json`
- `CANAL_PLUS_METADATA_DSN`: 元数据 MySQL DSN。设置后，后端会把元数据和运行态持久化到 MySQL，而不是 `store.json`
- `CANAL_PLUS_METADATA_TABLE`: 元数据表名，默认 `canal_plus_metadata`
- `CANAL_PLUS_NODE_ID`: 当前控制节点 ID。未设置时会自动选择一个在线节点作为当前节点
- `CANAL_PLUS_CLUSTER_SUPERVISOR`: 集群巡检开关，默认开启
- `CANAL_PLUS_CLUSTER_SUPERVISOR_INTERVAL_SECONDS`: 集群巡检间隔秒
- `CANAL_PLUS_EMBEDDED_NODE_HEARTBEAT`: 当前节点心跳开关，默认开启
- `CANAL_PLUS_EMBEDDED_NODE_HEARTBEAT_INTERVAL_SECONDS`: 当前节点心跳间隔秒
- `CANAL_PLUS_TASK_PROCESS_SUPERVISOR_INTERVAL_SECONDS`: 本地任务进程协调与重分配检查间隔秒

前端变量：

- `VITE_API_BASE_URL`: API 地址，默认 `http://localhost:4100/api`

启用 MySQL 元数据存储示例：

```env
CANAL_PLUS_METADATA_DSN=root:password@tcp(127.0.0.1:3306)/canal_plus?parseTime=true
CANAL_PLUS_METADATA_TABLE=canal_plus_metadata
```

首次切换到 MySQL 时，如果目标表还没有数据而本地 `store.json` 已存在，后端会自动把现有文件数据导入 MySQL。

## 关键接口

任务相关：

- `GET /api/sync-tasks`
- `POST /api/sync-tasks`
- `POST /api/sync-tasks/{id}/start|pause|resume|stop`
- `POST /api/sync-tasks/{id}/rerun`
- `POST /api/sync-tasks/{id}/params`
- `POST /api/sync-tasks/{id}/reset-position`
- `GET /api/sync-tasks/{id}/runtime`
- `GET /api/sync-tasks/{id}/logs`
- `GET /api/sync-tasks/{id}/logs/stream`
- `GET /api/sync-tasks/{id}/checkpoints`

节点相关：

- `GET /api/cluster`
- `POST /api/cluster/nodes`
- `POST /api/cluster/nodes/test-connection`
- `POST /api/cluster/nodes/{id}/online|offline`
- `POST /api/cluster/nodes/{id}/drain`
- `POST /api/cluster/nodes/{id}/failover-drill`
- `POST /api/cluster/nodes/{id}/upgrade`
- `POST /api/cluster/nodes/{id}/uninstall`
- `POST /api/cluster/rebalance`

## 当前边界

当前版本已经具备：

- 独立任务进程模型
- 任务实时日志流
- 节点级 lease 调度与迁移报告
- 节点恢复上线后的重分配
- 控制节点与远程托管语义区分

仍然是演示型运行时，未接入真实 CDC 执行引擎。当前任务进程会按模拟数据推进位点、吞吐、延迟和日志，以便验证控制台、节点管理和运行模型。后续如接入真实 MySQL binlog consumer，可以直接复用现有的任务进程、日志、状态和节点调度框架。

## 下一步建议

- 接入真实 MySQL CDC 执行引擎，替换当前模拟任务进程。
- 将单表 JSON 元数据存储升级为结构化元数据库 schema。
- 完善节点回归后的更细粒度任务重分配策略。
- 为节点操作和任务运行补充更完整的集成测试。
