# Canal Plus Runtime Architecture

当前运行时由 Web 控制台、API Server、元数据存储和节点心跳/巡检组成。

```text
Node
  ├── Web UI
  ├── API Server
  ├── Datasource Management
  ├── Node Management
  ├── Alert Settings
  └── Embedded Heartbeat
```

## Backend

- API Server 负责鉴权、CORS、数据源、节点、告警和操作日志接口。
- Metadata Store 使用 MySQL RDB 表存储用户、数据源、节点、告警和操作日志。
- Cluster Supervisor 维护节点心跳状态。
