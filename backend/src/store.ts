import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AlertRule,
  DatabaseShape,
  Datasource,
  ErrorEvent,
  OperationLog,
  SyncTask,
  TaskRuntimeState
} from "./types.js";
import { createSeedData } from "./seed.js";

const now = () => new Date().toISOString();

export class FileStore {
  private data: DatabaseShape;

  constructor(private readonly filePath: string) {
    const absolutePath = resolve(filePath);
    mkdirSync(dirname(absolutePath), { recursive: true });

    if (existsSync(absolutePath)) {
      this.data = JSON.parse(readFileSync(absolutePath, "utf8")) as DatabaseShape;
    } else {
      this.data = createSeedData();
      this.save();
    }
  }

  snapshot() {
    this.refreshRuntimeStates();
    return structuredClone(this.data);
  }

  save() {
    const absolutePath = resolve(this.filePath);
    const tempPath = `${absolutePath}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(this.data, null, 2)}\n`);
    renameSync(tempPath, absolutePath);
  }

  users() {
    return this.data.users;
  }

  datasources() {
    return this.data.datasources;
  }

  getDatasource(id: string) {
    return this.data.datasources.find((datasource) => datasource.id === id);
  }

  createDatasource(input: Omit<Datasource, "id" | "createdAt" | "updatedAt" | "connectionStatus" | "isDemo">) {
    const timestamp = now();
    const datasource: Datasource = {
      ...input,
      id: randomUUID(),
      connectionStatus: "untested",
      isDemo: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.data.datasources.unshift(datasource);
    this.log("admin", "create", "datasource", datasource.id, `创建数据源 ${datasource.name}`);
    this.save();
    return datasource;
  }

  updateDatasource(id: string, patch: Partial<Datasource>) {
    const datasource = this.getDatasource(id);
    if (!datasource) return undefined;
    Object.assign(datasource, patch, { updatedAt: now() });
    this.log("admin", "update", "datasource", id, `更新数据源 ${datasource.name}`);
    this.save();
    return datasource;
  }

  deleteDatasource(id: string) {
    const inUse = this.data.syncTasks.some(
      (task) => task.sourceDatasourceId === id || task.targetDatasourceId === id
    );
    if (inUse) {
      throw new Error("数据源已被同步任务引用，不能删除");
    }
    const before = this.data.datasources.length;
    this.data.datasources = this.data.datasources.filter((datasource) => datasource.id !== id);
    if (this.data.datasources.length !== before) {
      this.log("admin", "delete", "datasource", id, "删除数据源");
      this.save();
      return true;
    }
    return false;
  }

  tasks() {
    this.refreshRuntimeStates();
    return this.data.syncTasks;
  }

  getTask(id: string) {
    this.refreshRuntimeStates();
    return this.data.syncTasks.find((task) => task.id === id);
  }

  createTask(input: Omit<SyncTask, "id" | "status" | "configVersion" | "createdAt" | "updatedAt"> & { status?: SyncTask["status"] }) {
    const timestamp = now();
    const task: SyncTask = {
      ...input,
      id: randomUUID(),
      status: input.status ?? "pending",
      configVersion: 1,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.data.syncTasks.unshift(task);
    this.data.runtimeStates.unshift(this.defaultRuntime(task.id));
    this.log("admin", "create", "sync_task", task.id, `创建同步任务 ${task.name}`);
    this.save();
    return task;
  }

  updateTask(id: string, patch: Partial<SyncTask>) {
    const task = this.getTask(id);
    if (!task) return undefined;
    Object.assign(task, patch, {
      configVersion: patch.tableMappings || patch.strategy ? task.configVersion + 1 : task.configVersion,
      updatedAt: now()
    });
    this.log("admin", "update", "sync_task", id, `更新同步任务 ${task.name}`);
    this.save();
    return task;
  }

  deleteTask(id: string) {
    const before = this.data.syncTasks.length;
    this.data.syncTasks = this.data.syncTasks.filter((task) => task.id !== id);
    this.data.runtimeStates = this.data.runtimeStates.filter((runtime) => runtime.taskId !== id);
    if (this.data.syncTasks.length !== before) {
      this.log("admin", "delete", "sync_task", id, "删除同步任务");
      this.save();
      return true;
    }
    return false;
  }

  copyTask(id: string) {
    const source = this.getTask(id);
    if (!source) return undefined;
    return this.createTask({
      ...structuredClone(source),
      name: `${source.name} 副本`,
      status: "draft"
    });
  }

  transitionTask(id: string, action: "start" | "pause" | "resume" | "stop") {
    const task = this.getTask(id);
    if (!task) return undefined;
    const runtime = this.ensureRuntime(id);
    const timestamp = now();

    if (action === "start" || action === "resume") {
      task.status = task.strategy.initMode === "full_then_incremental" && runtime.fullSyncedRows < runtime.fullTotalRows
        ? "full_syncing"
        : "incremental_running";
      runtime.phase = task.status === "full_syncing" ? "full" : "incremental";
      runtime.startedAt = runtime.startedAt ?? timestamp;
      runtime.updatedAt = timestamp;
    }

    if (action === "pause") {
      task.status = "paused";
      runtime.phase = "paused";
      runtime.eventsPerSecond = 0;
      runtime.updatedAt = timestamp;
    }

    if (action === "stop") {
      task.status = "stopped";
      runtime.phase = "stopped";
      runtime.eventsPerSecond = 0;
      runtime.updatedAt = timestamp;
    }

    task.updatedAt = timestamp;
    this.log("admin", action, "sync_task", id, `${action} 同步任务 ${task.name}`);
    this.save();
    return task;
  }

  runtime(taskId: string) {
    this.refreshRuntimeStates();
    return this.ensureRuntime(taskId);
  }

  errorEvents() {
    return this.data.errorEvents;
  }

  getErrorEvent(id: string) {
    return this.data.errorEvents.find((event) => event.id === id);
  }

  retryError(id: string) {
    const event = this.getErrorEvent(id);
    if (!event) return undefined;
    event.status = "resolved";
    event.updatedAt = now();
    const task = this.getTask(event.taskId);
    const runtime = this.ensureRuntime(event.taskId);
    if (task && task.status === "failed") {
      task.status = "incremental_running";
      task.updatedAt = now();
      runtime.phase = "incremental";
      runtime.lastErrorId = undefined;
      runtime.eventsPerSecond = 84;
    }
    this.log("admin", "retry", "error_event", id, `重试错误事件 ${id}`);
    this.save();
    return event;
  }

  skipError(id: string, reason: string) {
    const event = this.getErrorEvent(id);
    if (!event) return undefined;
    event.status = "skipped";
    event.handledBy = "admin";
    event.handledReason = reason;
    event.updatedAt = now();
    const task = this.getTask(event.taskId);
    const runtime = this.ensureRuntime(event.taskId);
    if (task && task.status === "failed") {
      task.status = "incremental_running";
      task.updatedAt = now();
      runtime.phase = "incremental";
      runtime.lastErrorId = undefined;
      runtime.eventsPerSecond = 64;
    }
    this.log("admin", "skip", "error_event", id, `跳过错误事件：${reason}`);
    this.save();
    return event;
  }

  logs() {
    return this.data.operationLogs;
  }

  alertRules() {
    return this.data.alertRules;
  }

  upsertAlertRule(rule: AlertRule) {
    const index = this.data.alertRules.findIndex((item) => item.id === rule.id);
    if (index >= 0) {
      this.data.alertRules[index] = rule;
    } else {
      this.data.alertRules.unshift(rule);
    }
    this.save();
  }

  markDatasourceTest(id: string, online: boolean, message: string) {
    const datasource = this.getDatasource(id);
    if (!datasource) return undefined;
    datasource.connectionStatus = online ? "online" : "offline";
    datasource.lastTestedAt = now();
    datasource.lastTestMessage = message;
    datasource.updatedAt = now();
    this.log("admin", "test", "datasource", id, `测试数据源：${message}`);
    this.save();
    return datasource;
  }

  private defaultRuntime(taskId: string): TaskRuntimeState {
    const timestamp = now();
    return {
      taskId,
      phase: "idle",
      fullTotalRows: 50000 + Math.floor(Math.random() * 90000),
      fullSyncedRows: 0,
      delaySeconds: 0,
      eventsPerSecond: 0,
      binlogFile: "mysql-bin.000001",
      binlogPosition: 4,
      updatedAt: timestamp
    };
  }

  private ensureRuntime(taskId: string) {
    let runtime = this.data.runtimeStates.find((item) => item.taskId === taskId);
    if (!runtime) {
      runtime = this.defaultRuntime(taskId);
      this.data.runtimeStates.unshift(runtime);
    }
    return runtime;
  }

  private refreshRuntimeStates() {
    const timestamp = now();
    let changed = false;

    for (const task of this.data.syncTasks) {
      const runtime = this.ensureRuntime(task.id);

      if (task.status === "full_syncing") {
        const previous = runtime.fullSyncedRows;
        const next = Math.min(runtime.fullTotalRows, previous + 2500 + Math.floor(Math.random() * 2500));
        runtime.fullSyncedRows = next;
        runtime.eventsPerSecond = 220 + Math.floor(Math.random() * 90);
        runtime.delaySeconds = 0;
        runtime.phase = "full";
        runtime.updatedAt = timestamp;
        changed = true;

        if (next >= runtime.fullTotalRows) {
          task.status = "incremental_running";
          task.updatedAt = timestamp;
          runtime.phase = "incremental";
          runtime.eventsPerSecond = 90 + Math.floor(Math.random() * 80);
          changed = true;
        }
      }

      if (task.status === "incremental_running") {
        runtime.phase = "incremental";
        runtime.fullSyncedRows = runtime.fullTotalRows;
        runtime.delaySeconds = 2 + Math.floor(Math.random() * 12);
        runtime.eventsPerSecond = 60 + Math.floor(Math.random() * 120);
        runtime.binlogPosition += 1200 + Math.floor(Math.random() * 4200);
        runtime.updatedAt = timestamp;
        changed = true;
      }
    }

    if (changed) {
      this.save();
    }
  }

  private log(actor: string, action: string, targetType: OperationLog["targetType"], targetId: string | undefined, detail: string) {
    this.data.operationLogs.unshift({
      id: randomUUID(),
      actor,
      action,
      targetType,
      targetId,
      detail,
      createdAt: now()
    });
  }
}

export function createStore() {
  return new FileStore(process.env.CANAL_PLUS_DATA_FILE || "./data/store.json");
}
