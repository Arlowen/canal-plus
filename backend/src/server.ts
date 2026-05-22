import "dotenv/config";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { createStore } from "./store.js";
import { defaultStrategy } from "./seed.js";
import { encryptText, toPublicDatasource, verifyPassword } from "./security.js";
import { listColumns, listSchemas, listTables, testDatasource } from "./mysqlMetadata.js";
import { datasourceSchema, loginSchema, skipErrorSchema, taskSchema } from "./validators.js";
import type { DashboardSummary, SyncTask } from "./types.js";

const app = express();
const store = createStore();
const port = Number(process.env.PORT || 4100);
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const allowedOrigins = new Set(frontendOrigin.split(",").map((origin) => origin.trim()).filter(Boolean));

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));

function asyncHandler(handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>) {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function currentUser(request: Request) {
  const header = request.header("authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token.startsWith("dev-token:")) {
    return undefined;
  }
  const userId = token.slice("dev-token:".length);
  return store.users().find((user) => user.id === userId);
}

function requireAuth(request: Request, response: Response, next: NextFunction) {
  const user = currentUser(request);
  if (!user) {
    response.status(401).json({ message: "未登录或登录已失效" });
    return;
  }
  response.locals.user = user;
  next();
}

function taskWithRuntime(task: SyncTask) {
  return {
    ...task,
    runtime: store.runtime(task.id),
    sourceDatasource: store.getDatasource(task.sourceDatasourceId)
      ? toPublicDatasource(store.getDatasource(task.sourceDatasourceId)!)
      : undefined,
    targetDatasource: store.getDatasource(task.targetDatasourceId)
      ? toPublicDatasource(store.getDatasource(task.targetDatasourceId)!)
      : undefined
  };
}

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "canal-plus-backend",
    time: new Date().toISOString()
  });
});

app.post("/api/auth/login", (request, response) => {
  const input = loginSchema.parse(request.body);
  const user = store.users().find((item) => item.username === input.username);

  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    response.status(401).json({ message: "账号或密码错误" });
    return;
  }

  response.json({
    token: `dev-token:${user.id}`,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role
    }
  });
});

app.use("/api", requireAuth);

app.get("/api/me", (request, response) => {
  const user = response.locals.user;
  response.json({
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role
  });
});

app.get("/api/dashboard/summary", (_request, response) => {
  const snapshot = store.snapshot();
  const runtimes = snapshot.runtimeStates;
  const runningTasks = snapshot.syncTasks.filter((task) => task.status === "incremental_running" || task.status === "full_syncing");
  const failedTasks = snapshot.syncTasks.filter((task) => task.status === "failed");
  const fullTasks = runtimes.filter((runtime) => runtime.fullTotalRows > 0);
  const fullSyncProgress = fullTasks.length
    ? Math.round(
      fullTasks.reduce((sum, runtime) => sum + (runtime.fullSyncedRows / runtime.fullTotalRows) * 100, 0) / fullTasks.length
    )
    : 0;
  const last24Hours = Date.now() - 24 * 60 * 60 * 1000;
  const summary: DashboardSummary = {
    taskTotal: snapshot.syncTasks.length,
    runningTasks: runningTasks.length,
    failedTasks: failedTasks.length,
    averageDelaySeconds: runningTasks.length
      ? Math.round(
        runningTasks.reduce((sum, task) => sum + (runtimes.find((runtime) => runtime.taskId === task.id)?.delaySeconds ?? 0), 0) /
        runningTasks.length
      )
      : 0,
    eventsPerSecond: runtimes.reduce((sum, runtime) => sum + runtime.eventsPerSecond, 0),
    failuresLast24Hours: snapshot.errorEvents.filter((event) => new Date(event.createdAt).getTime() >= last24Hours).length,
    fullSyncProgress
  };
  response.json(summary);
});

app.get("/api/datasources", (_request, response) => {
  response.json(store.datasources().map(toPublicDatasource));
});

app.post("/api/datasources", (request, response) => {
  const input = datasourceSchema.parse(request.body);
  const datasource = store.createDatasource({
    name: input.name,
    purpose: input.purpose,
    host: input.host,
    port: input.port,
    username: input.username,
    passwordSecret: encryptText(input.password || ""),
    defaultSchema: input.defaultSchema
  });
  response.status(201).json(toPublicDatasource(datasource));
});

app.get("/api/datasources/:id", (request, response) => {
  const datasource = store.getDatasource(request.params.id);
  if (!datasource) {
    response.status(404).json({ message: "数据源不存在" });
    return;
  }
  response.json(toPublicDatasource(datasource));
});

app.put("/api/datasources/:id", (request, response) => {
  const input = datasourceSchema.partial().parse(request.body);
  const patch = {
    ...input,
    passwordSecret: input.password ? encryptText(input.password) : undefined
  };
  delete (patch as { password?: string }).password;
  const datasource = store.updateDatasource(request.params.id, patch);
  if (!datasource) {
    response.status(404).json({ message: "数据源不存在" });
    return;
  }
  response.json(toPublicDatasource(datasource));
});

app.delete("/api/datasources/:id", (request, response) => {
  const deleted = store.deleteDatasource(request.params.id);
  response.status(deleted ? 204 : 404).send();
});

app.post("/api/datasources/:id/test", asyncHandler(async (request, response) => {
  const datasource = store.getDatasource(request.params.id);
  if (!datasource) {
    response.status(404).json({ message: "数据源不存在" });
    return;
  }

  try {
    const result = await testDatasource(datasource);
    const updated = store.markDatasourceTest(datasource.id, result.ok, result.message)!;
    response.json(toPublicDatasource(updated));
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接失败";
    const updated = store.markDatasourceTest(datasource.id, false, message)!;
    response.status(422).json({ ...toPublicDatasource(updated), message });
  }
}));

app.get("/api/datasources/:id/schemas", asyncHandler(async (request, response) => {
  const datasource = store.getDatasource(request.params.id);
  if (!datasource) {
    response.status(404).json({ message: "数据源不存在" });
    return;
  }
  response.json(await listSchemas(datasource));
}));

app.get("/api/datasources/:id/schemas/:schema/tables", asyncHandler(async (request, response) => {
  const datasource = store.getDatasource(request.params.id);
  if (!datasource) {
    response.status(404).json({ message: "数据源不存在" });
    return;
  }
  response.json(await listTables(datasource, request.params.schema));
}));

app.get("/api/datasources/:id/schemas/:schema/tables/:table/columns", asyncHandler(async (request, response) => {
  const datasource = store.getDatasource(request.params.id);
  if (!datasource) {
    response.status(404).json({ message: "数据源不存在" });
    return;
  }
  response.json(await listColumns(datasource, request.params.schema, request.params.table));
}));

app.get("/api/sync-tasks", (request, response) => {
  const status = request.query.status?.toString();
  const owner = request.query.owner?.toString().toLowerCase();
  const keyword = request.query.keyword?.toString().toLowerCase();
  const tasks = store.tasks()
    .filter((task) => !status || task.status === status)
    .filter((task) => !owner || task.owner.toLowerCase().includes(owner))
    .filter((task) => !keyword || task.name.toLowerCase().includes(keyword) || task.description.toLowerCase().includes(keyword))
    .map(taskWithRuntime);

  response.json(tasks);
});

app.post("/api/sync-tasks", (request, response) => {
  const input = taskSchema.parse(request.body);
  const task = store.createTask({
    ...input,
    tableMappings: input.tableMappings.map((mapping) => ({ ...mapping, id: mapping.id || randomUUID() }))
  });
  response.status(201).json(taskWithRuntime(task));
});

app.get("/api/sync-tasks/:id", (request, response) => {
  const task = store.getTask(request.params.id);
  if (!task) {
    response.status(404).json({ message: "同步任务不存在" });
    return;
  }
  response.json(taskWithRuntime(task));
});

app.put("/api/sync-tasks/:id", (request, response) => {
  const input = taskSchema.partial().parse(request.body);
  const patch = {
    ...input,
    tableMappings: input.tableMappings?.map((mapping) => ({ ...mapping, id: mapping.id || randomUUID() }))
  };
  const task = store.updateTask(request.params.id, patch);
  if (!task) {
    response.status(404).json({ message: "同步任务不存在" });
    return;
  }
  response.json(taskWithRuntime(task));
});

app.delete("/api/sync-tasks/:id", (request, response) => {
  const deleted = store.deleteTask(request.params.id);
  response.status(deleted ? 204 : 404).send();
});

for (const action of ["start", "pause", "resume", "stop"] as const) {
  app.post(`/api/sync-tasks/:id/${action}`, (request, response) => {
    const task = store.transitionTask(request.params.id, action);
    if (!task) {
      response.status(404).json({ message: "同步任务不存在" });
      return;
    }
    response.json(taskWithRuntime(task));
  });
}

app.post("/api/sync-tasks/:id/copy", (request, response) => {
  const task = store.copyTask(request.params.id);
  if (!task) {
    response.status(404).json({ message: "同步任务不存在" });
    return;
  }
  response.status(201).json(taskWithRuntime(task));
});

app.get("/api/sync-tasks/:id/runtime", (request, response) => {
  const task = store.getTask(request.params.id);
  if (!task) {
    response.status(404).json({ message: "同步任务不存在" });
    return;
  }
  response.json(store.runtime(request.params.id));
});

app.get("/api/sync-tasks/:id/logs", (request, response) => {
  response.json(store.logs().filter((log) => log.targetId === request.params.id));
});

app.get("/api/error-events", (request, response) => {
  const status = request.query.status?.toString();
  const events = store.errorEvents().filter((event) => !status || event.status === status);
  response.json(events);
});

app.get("/api/error-events/:id", (request, response) => {
  const event = store.getErrorEvent(request.params.id);
  if (!event) {
    response.status(404).json({ message: "错误事件不存在" });
    return;
  }
  response.json(event);
});

app.post("/api/error-events/:id/retry", (request, response) => {
  const event = store.retryError(request.params.id);
  if (!event) {
    response.status(404).json({ message: "错误事件不存在" });
    return;
  }
  response.json(event);
});

app.post("/api/error-events/:id/skip", (request, response) => {
  const input = skipErrorSchema.parse(request.body);
  const event = store.skipError(request.params.id, input.reason);
  if (!event) {
    response.status(404).json({ message: "错误事件不存在" });
    return;
  }
  response.json(event);
});

app.post("/api/error-events/batch-retry", (request, response) => {
  const ids: unknown[] = Array.isArray(request.body?.ids) ? request.body.ids : [];
  const events = ids.map((id) => store.retryError(String(id))).filter(Boolean);
  response.json(events);
});

app.get("/api/operation-logs", (_request, response) => {
  response.json(store.logs().slice(0, 200));
});

app.get("/api/alert-rules", (_request, response) => {
  response.json(store.alertRules());
});

app.get("/api/sync-strategy/default", (_request, response) => {
  response.json(defaultStrategy());
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const status = error instanceof Error && error.name === "ZodError" ? 400 : 500;
  response.status(status).json({
    message: error instanceof Error ? error.message : "服务异常"
  });
});

app.listen(port, () => {
  console.log(`Canal Plus backend listening on http://localhost:${port}`);
});
