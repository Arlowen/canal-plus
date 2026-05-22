# Canal Plus

Canal Plus 是一个面向 MySQL CDC 同步的前后端项目。当前版本按照 `docs/canal-plus-prd.md` 的 MVP 范围实现了控制台和 API 骨架，目标是用可视化任务流替代 Canal 多配置文件操作。

## 目录结构

```text
canal-plus/
  backend/   # Go API
  frontend/  # Vite + React + Tailwind 控制台
  docs/      # PRD 和产品文档
```

## 已实现能力

- 登录鉴权：默认账号 `admin`，默认密码 `admin123`。
- 数据源管理：新增、连接测试、schema/table/column 元数据读取。
- 同步任务：列表、详情、创建向导、启动、暂停、恢复、停止、复制。
- 运行监控：任务数量、异常数量、延迟、吞吐、binlog 位点、全量进度。
- 分布式部署：内置 node 节点、任务 lease、心跳超时下线、任务自动接管和重新均衡 API。
- 产品模块：任务中心、结构迁移、数据校验订正、订阅变更、节点集群、错误中心、操作审计。
- 错误中心：错误事件展示、重试、跳过并记录原因。
- 操作日志：关键操作审计。
- 持久化：Go 后端默认使用 `backend/data/store.json` 保存演示数据和运行态。

## 本地启动

```bash
npm install
npm run dev
```

启动后访问：

- Frontend: http://localhost:5173
- Backend: http://localhost:4100/api/health

如果 `5173` 已被占用，Vite 会自动切到下一个可用端口，例如 http://localhost:5174。

## 环境变量

Go 后端可复制 `backend/.env.example` 为 `backend/.env`：

```bash
cp backend/.env.example backend/.env
```

常用变量：

- `PORT`: 后端端口，默认 `4100`。
- `FRONTEND_ORIGIN`: 前端跨域来源，默认 `http://localhost:5173`。
- `CANAL_PLUS_SECRET`: 数据源密码加密密钥。
- `CANAL_PLUS_DATA_FILE`: 后端数据文件路径，默认 `./data/store.json`。
- `CANAL_PLUS_EMBEDDED_NODE_HEARTBEAT`: 本地演示内置 node 心跳，默认开启；真实多节点部署可设为 `false`，由各 worker 调用 heartbeat API。

前端可设置：

- `VITE_API_BASE_URL`: API 地址，默认 `http://localhost:4100/api`。

## 当前边界

当前实现是产品控制台和 API MVP，任务运行态使用模拟推进逻辑，已经预留全量、增量、checkpoint、错误队列、目标端适配器、node lease 和故障接管所需的数据模型。后续要接真实同步链路时，可以在 `backend/internal/app/store.go` 的任务状态机之外增加独立 worker，并将 checkpoint 与目标写入结果绑定。

## 分布式接管 API

- `GET /api/cluster`: 查看节点、租约和接管次数。
- `GET /api/cluster/nodes`: 查看 node 状态、心跳时间和运行任务数。
- `GET /api/cluster/leases`: 查看任务租约、epoch 和接管次数。
- `POST /api/cluster/nodes/{id}/heartbeat`: 上报 node 心跳，超时未上报会自动下线并触发接管。
- `POST /api/cluster/nodes/{id}/offline`: 模拟节点故障，任务会迁移到其他在线节点。
- `POST /api/cluster/nodes/{id}/online`: 恢复节点心跳。
- `POST /api/cluster/nodes/{id}/drain`: 标记节点排空。
- `POST /api/cluster/rebalance`: 按当前节点负载重新均衡任务。

## 下一步建议

- 接入真实 MySQL binlog consumer，优先评估 Canal 封装或 Debezium Embedded。
- 将 JSON 文件存储替换为 MySQL 元数据库。
- 完善用户权限和任务授权。
- 增加 API 自动化测试和同步 worker 集成测试。
