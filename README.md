# Canal Plus

Canal Plus 是一个轻量级 Web 控制台，聚焦数据源、节点和告警配置管理。

## 目录

```text
canal-plus/
  backend/   # Go API
  frontend/  # Vite + React 控制台
  docs/      # 产品文档
```

## 功能

- 数据源：新增、编辑、测试连接、删除。
- 节点：启动注册、升级、卸载、上线、下线。
- 设置：告警规则。

## 启动

```bash
npm install
npm run dev
```

访问：

- Frontend: [http://localhost:8999](http://localhost:8999)
- Backend: [http://localhost:4100/api/health](http://localhost:4100/api/health)

## 打包

```bash
./all_build.sh
```

输出：

- `output/canal-plus-frontend.tar.gz`
- `output/canal-plus-backend.tar.gz`

## 环境变量

后端：

- `PORT`: 后端端口，默认 `4100`
- `FRONTEND_ORIGIN`: 允许跨域的前端地址
- `CANAL_PLUS_SECRET`: 数据源密码加密密钥
- `CANAL_PLUS_METADATA_DSN`: 元数据 MySQL DSN
- `CANAL_PLUS_METADATA_TABLE_PREFIX`: ORM 表前缀，默认 `canal_plus`
- `CANAL_PLUS_NODE_ID`: 当前控制节点 ID
- `CANAL_PLUS_NODE_NAME`: 当前控制节点名称，默认跟随节点 ID
- `CANAL_PLUS_NODE_ENDPOINT`: 当前控制节点访问地址，默认 `127.0.0.1:${PORT}`
- `CANAL_PLUS_NODE_ROLE`: 当前控制节点角色，默认 `scheduler+worker`
- `CANAL_PLUS_NODE_ZONE`: 当前控制节点可用区，默认 `local`
- `CANAL_PLUS_NODE_CAPACITY`: 当前控制节点容量，默认 `1`
- `CANAL_PLUS_CLUSTER_SUPERVISOR`: 集群巡检开关
- `CANAL_PLUS_CLUSTER_SUPERVISOR_INTERVAL_SECONDS`: 集群巡检间隔秒
- `CANAL_PLUS_EMBEDDED_NODE_HEARTBEAT`: 当前节点心跳开关
- `CANAL_PLUS_EMBEDDED_NODE_HEARTBEAT_INTERVAL_SECONDS`: 当前节点心跳间隔秒

前端：

- `VITE_API_BASE_URL`: API 地址，默认 `http://localhost:4100/api`

## 接口

数据源：

- `GET /api/datasources`
- `POST /api/datasources`
- `PUT /api/datasources/{id}`
- `DELETE /api/datasources/{id}`
- `POST /api/datasources/{id}/test`

节点：

- `GET /api/cluster`
- `POST /api/cluster/nodes/{id}/online|offline`
- `POST /api/cluster/nodes/{id}/upgrade`
- `POST /api/cluster/nodes/{id}/uninstall`

新增节点：

- 在新机器启动后端服务。
- 连接同一个 `CANAL_PLUS_METADATA_DSN`。
- 使用唯一 `CANAL_PLUS_NODE_ID`。

告警：

- `GET /api/alert-rules`
- `POST /api/alert-rules`
- `PUT /api/alert-rules/{id}`
- `DELETE /api/alert-rules/{id}`
- `GET /api/alert-rules/evaluations`
- `GET /api/alert-rules/events`
