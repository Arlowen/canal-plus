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
  nodeId?: string;
  leaseExpiresAt?: string;
  failoverCount: number;
  lastTakeoverAt?: string;
  startedAt?: string;
  updatedAt: string;
  lastErrorId?: string;
}

export interface TaskOperationResult {
  task: SyncTask;
  message: string;
  meta?: Record<string, string>;
}

export interface TaskExport {
  exportedAt: string;
  task: SyncTask;
  runtime: TaskRuntimeState;
  checksum: string;
}

export type PreflightStatus = "passed" | "warning" | "failed";

export interface TaskPreflightCheck {
  id: string;
  category: string;
  title: string;
  status: PreflightStatus;
  message: string;
  detail?: string[];
}

export interface TaskPreflightSummary {
  passed: number;
  warnings: number;
  failed: number;
}

export interface TaskPreflightReport {
  ok: boolean;
  score: number;
  generatedAt: string;
  estimatedRows: number;
  summary: TaskPreflightSummary;
  checks: TaskPreflightCheck[];
}

export interface TaskParameterPatch {
  initMode?: SyncStrategy["initMode"];
  writeMode?: Partial<SyncStrategy["writeMode"]>;
  conflictStrategy?: SyncStrategy["conflictStrategy"];
  deleteStrategy?: SyncStrategy["deleteStrategy"];
  batchSize?: number;
  retryTimes?: number;
  retryIntervalSeconds?: number;
}

export interface PositionResetInput {
  binlogFile: string;
  binlogPosition: number;
  serverId?: string;
  reason?: string;
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
  targetType: "datasource" | "sync_task" | "error_event" | "auth" | "cluster_node" | "capability_job" | "alert_rule";
  targetId?: string;
  detail: string;
  createdAt: string;
}

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  taskId?: string;
  delayThresholdSeconds: number;
  errorThreshold: number;
  webhookUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRuleInput {
  name: string;
  enabled?: boolean;
  taskId?: string;
  delayThresholdSeconds: number;
  errorThreshold: number;
  webhookUrl?: string;
}

export interface AlertRuleEvaluation {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  matchedTasks: number;
  maxDelaySeconds: number;
  pendingErrors: number;
  reasons: string[];
  updatedAt: string;
}

export type CapabilityJobType = "structure" | "quality" | "subscription";
export type CapabilityJobStatus = "draft" | "running" | "completed" | "failed";

export interface CapabilityStep {
  name: string;
  status: "waiting" | "running" | "done" | string;
  detail: string;
}

export interface CapabilityJobSummary {
  tables: number;
  columns: number;
  ddlCount: number;
  diffRows: number;
  correctedRows: number;
  addedTables: number;
  removedTables: number;
  riskLevel: "low" | "medium" | "high" | string;
}

export interface CapabilityJob {
  id: string;
  type: CapabilityJobType;
  name: string;
  taskId: string;
  mode: string;
  status: CapabilityJobStatus;
  progressPercent: number;
  currentStep: number;
  steps: CapabilityStep[];
  summary: CapabilityJobSummary;
  schedule?: string;
  autoStart: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSummary {
  taskTotal: number;
  runningTasks: number;
  failedTasks: number;
  averageDelaySeconds: number;
  eventsPerSecond: number;
  failuresLast24Hours: number;
  fullSyncProgress: number;
  onlineNodes: number;
  totalNodes: number;
  failoverCount: number;
}

export type NodeStatus = "online" | "offline" | "draining";

export interface ClusterNode {
  id: string;
  name: string;
  endpoint: string;
  zone: string;
  status: NodeStatus;
  role: string;
  cpuPercent: number;
  memoryPercent: number;
  runningTasks: number;
  capacity: number;
  lastHeartbeatAt: string;
  startedAt: string;
  updatedAt: string;
}

export interface TaskLease {
  taskId: string;
  nodeId: string;
  epoch: number;
  status: string;
  acquiredAt: string;
  expiresAt: string;
  takeoverCount: number;
  updatedAt: string;
}

export interface FailoverDrillTask {
  taskId: string;
  taskName: string;
  previousNodeId: string;
  newNodeId: string;
  leaseEpoch: number;
  takeoverCount: number;
}

export interface FailoverDrillReport {
  id: string;
  drilledAt: string;
  node: ClusterNode;
  success: boolean;
  message: string;
  affectedTasks: FailoverDrillTask[];
  before: ClusterSnapshot;
  after: ClusterSnapshot;
}

export interface ClusterSnapshot {
  nodes: ClusterNode[];
  leases: TaskLease[];
  onlineNodes: number;
  totalNodes: number;
  degradedNodes: number;
  failovers: number;
  heartbeatTimeoutSeconds: number;
}

export interface LoginResponse {
  token: string;
  user: User;
}
