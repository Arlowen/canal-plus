export type Role = "admin" | "operator";
export type DatasourcePurpose = "source" | "target" | "both";
export type DatasourceStatus = "untested" | "online" | "offline";
export type TaskStatus = "draft" | "pending" | "full_syncing" | "incremental_running" | "paused" | "failed" | "stopped";
export type ErrorStatus = "pending" | "retried" | "skipped" | "resolved";

export interface User {
  id: string;
  name: string;
  username: string;
  role: Role;
}

export interface Datasource {
  id: string;
  name: string;
  purpose: DatasourcePurpose;
  host: string;
  port: number;
  username: string;
  defaultSchema?: string;
  connectionStatus: DatasourceStatus;
  lastTestedAt?: string;
  lastTestMessage?: string;
  hasPassword: boolean;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue?: string | null;
}

export interface TableInfo {
  schema: string;
  name: string;
  engine?: string;
  rows?: number;
}

export interface FieldMapping {
  sourceField: string;
  targetField: string;
  sourceType: string;
  targetType: string;
  primaryKey: boolean;
  nullable: boolean;
  ignored: boolean;
  constantValue?: string;
}

export interface TableMapping {
  id?: string;
  sourceSchema: string;
  sourceTable: string;
  targetSchema: string;
  targetTable: string;
  fields: FieldMapping[];
}

export interface SyncStrategy {
  initMode: "full_then_incremental" | "incremental_only";
  writeMode: {
    insert: boolean;
    update: boolean;
    delete: boolean;
  };
  conflictStrategy: "overwrite" | "ignore" | "fail";
  deleteStrategy: "physical" | "soft_delete" | "ignore";
  batchSize: number;
  retryTimes: number;
  retryIntervalSeconds: number;
}

export interface TaskRuntimeState {
  taskId: string;
  phase: "idle" | "full" | "incremental" | "paused" | "failed" | "stopped";
  fullTotalRows: number;
  fullSyncedRows: number;
  delaySeconds: number;
  eventsPerSecond: number;
  binlogFile: string;
  binlogPosition: number;
  startedAt?: string;
  updatedAt: string;
  lastErrorId?: string;
}

export interface SyncTask {
  id: string;
  name: string;
  description: string;
  owner: string;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  status: TaskStatus;
  tableMappings: TableMapping[];
  strategy: SyncStrategy;
  configVersion: number;
  createdAt: string;
  updatedAt: string;
  runtime?: TaskRuntimeState;
  sourceDatasource?: Datasource;
  targetDatasource?: Datasource;
}

export interface ErrorEvent {
  id: string;
  taskId: string;
  sourceTable: string;
  targetTable: string;
  eventType: "insert" | "update" | "delete" | "ddl";
  primaryKeyValue: string;
  reason: string;
  rawEventSummary: string;
  status: ErrorStatus;
  binlogFile: string;
  binlogPosition: number;
  createdAt: string;
  updatedAt: string;
  handledBy?: string;
  handledReason?: string;
}

export interface OperationLog {
  id: string;
  actor: string;
  action: string;
  targetType: "datasource" | "sync_task" | "error_event" | "auth";
  targetId?: string;
  detail: string;
  createdAt: string;
}

export interface DashboardSummary {
  taskTotal: number;
  runningTasks: number;
  failedTasks: number;
  averageDelaySeconds: number;
  eventsPerSecond: number;
  failuresLast24Hours: number;
  fullSyncProgress: number;
}

export interface LoginResponse {
  token: string;
  user: User;
}
