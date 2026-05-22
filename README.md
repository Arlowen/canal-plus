# Canal Plus

Canal Plus 是一个面向 MySQL CDC 同步的前后端项目。当前版本按照 `docs/canal-plus-prd.md` 的 MVP 范围实现了控制台和 API 骨架，目标是用可视化任务流替代 Canal 多配置文件操作。

## 目录结构

```text
canal-plus/
  backend/   # Node.js + TypeScript + Express API
  frontend/  # Vite + React + Tailwind 控制台
  docs/      # PRD 和产品文档
```

## 已实现能力

- 登录鉴权：默认账号 `admin`，默认密码 `admin123`。
- 数据源管理：新增、连接测试、schema/table/column 元数据读取。
- 同步任务：列表、详情、创建向导、启动、暂停、恢复、停止、复制。
- 运行监控：任务数量、异常数量、延迟、吞吐、binlog 位点、全量进度。
- 错误中心：错误事件展示、重试、跳过并记录原因。
- 操作日志：关键操作审计。
- 持久化：后端默认使用 `backend/data/store.json` 保存演示数据和运行态。

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

后端可复制 `backend/.env.example` 为 `backend/.env`：

```bash
cp backend/.env.example backend/.env
```

常用变量：

- `PORT`: 后端端口，默认 `4100`。
- `FRONTEND_ORIGIN`: 前端跨域来源，默认 `http://localhost:5173`。
- `CANAL_PLUS_SECRET`: 数据源密码加密密钥。
- `CANAL_PLUS_DATA_FILE`: 后端数据文件路径，默认 `./data/store.json`。

前端可设置：

- `VITE_API_BASE_URL`: API 地址，默认 `http://localhost:4100/api`。

## 当前边界

当前实现是产品控制台和 API MVP，任务运行态使用模拟推进逻辑，已经预留全量、增量、checkpoint、错误队列和目标端适配器所需的数据模型。后续要接真实同步链路时，可以在 `backend/src/store.ts` 的任务状态机之外增加独立 worker，并将 checkpoint 与目标写入结果绑定。

## 下一步建议

- 接入真实 MySQL binlog consumer，优先评估 Canal 封装或 Debezium Embedded。
- 将 JSON 文件存储替换为 MySQL 元数据库。
- 完善用户权限和任务授权。
- 增加 API 自动化测试和同步 worker 集成测试。
