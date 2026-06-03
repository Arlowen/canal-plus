export type Role = "admin" | "operator" | "readonly";
export type DatasourceStatus = "untested" | "available" | "failed" | "stale";
export type DatasourceType = "mysql";
export type DatasourcePurpose = "source" | "target" | "general";
export type DatasourceAuthType = "password" | "none";

export interface User {
  id: string;
  name: string;
  username: string;
  role: Role;
}

export interface Datasource {
  id: string;
  name: string;
  type: DatasourceType;
  purpose?: DatasourcePurpose;
  host: string;
  port: number;
  version?: string;
  username: string;
  defaultSchema?: string;
  remark?: string;
  connectionStatus: DatasourceStatus;
  lastTestedAt?: string;
  lastTestMessage?: string;
  lastTestLatencyMs?: number;
  hasPassword: boolean;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DatasourceInput {
  id?: string;
  nodeId?: string;
  name: string;
  type: DatasourceType;
  purpose?: DatasourcePurpose;
  authType?: DatasourceAuthType;
  host: string;
  port: number;
  username: string;
  password?: string;
  defaultSchema?: string;
  remark?: string;
}

export interface DatasourceTestResult {
  success: boolean;
  status: DatasourceStatus;
  version?: string;
  latencyMs: number;
  testedAt: string;
  message: string;
}

export interface DatasourceDatabasesResponse {
  datasourceId: string;
  databases: string[];
}

export interface DatasourceTablesResponse {
  datasourceId: string;
  database: string;
  tables: string[];
}

export interface DatasourceColumn {
  name: string;
  type?: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue?: string;
}

export interface DatasourceColumnsResponse {
  datasourceId: string;
  database: string;
  table: string;
  columns: DatasourceColumn[];
}

export type ChannelStatus = "draft" | "ready" | "running" | "warning" | "failed" | "stopped" | "archived";
export type ChannelKind = "sync" | "check";
export type ChannelTaskType = "schema_migration" | "full_migration" | "incremental_sync" | "schema_compare" | "data_validation" | "data_correction";
export type ChannelTaskStatus = "draft" | "ready" | "disabled" | "queued" | "running" | "stopping" | "stopped" | "success" | "failed" | "canceled";
export type TaskRunStatus = "running" | "stopped" | "success" | "failed" | "canceled";

export interface Channel {
  id: string;
  name: string;
  description?: string;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceDatasourceType?: DatasourceType;
  targetDatasourceType?: DatasourceType;
  runNodeId?: string;
  resourceSpec?: string;
  kind?: ChannelKind;
  status: ChannelStatus;
  owner?: string;
  tags: string[];
  mappingVersion: number;
  taskCount: number;
  runningTaskCount: number;
  lastRunId?: string;
  lastRunStatus?: TaskRunStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export interface ChannelInput {
  name: string;
  description?: string;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceDatasourceType?: DatasourceType;
  targetDatasourceType?: DatasourceType;
  runNodeId?: string;
  resourceSpec?: string;
  kind?: ChannelKind;
  tags?: string[];
}

export interface ChannelTableMapping {
  id: string;
  channelId: string;
  mappingVersion: number;
  sourceSchema?: string;
  sourceTable: string;
  targetSchema?: string;
  targetTable: string;
  primaryKeys: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelColumnMapping {
  id: string;
  channelId: string;
  tableMappingId: string;
  mappingVersion: number;
  sourceColumn: string;
  sourceType?: string;
  targetColumn: string;
  targetType?: string;
  isPrimaryKey: boolean;
  nullable: boolean;
  defaultValue?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelColumnMappingInput {
  id?: string;
  sourceColumn: string;
  sourceType?: string;
  targetColumn: string;
  targetType?: string;
  isPrimaryKey?: boolean;
  nullable?: boolean;
  defaultValue?: string;
  enabled?: boolean;
}

export interface ChannelTableMappingInput {
  id?: string;
  sourceSchema?: string;
  sourceTable: string;
  targetSchema?: string;
  targetTable: string;
  primaryKeys?: string[];
  enabled?: boolean;
  columns?: ChannelColumnMappingInput[];
}

export interface ChannelMappingsInput {
  tables: ChannelTableMappingInput[];
}

export interface ChannelMappingsResponse {
  channelId: string;
  mappingVersion: number;
  tables: ChannelTableMapping[];
  columns: ChannelColumnMapping[];
}

export interface ChannelTask {
  id: string;
  channelId: string;
  name: string;
  type: ChannelTaskType;
  status: ChannelTaskStatus;
  enabled: boolean;
  dependsOn: string[];
  mappingVersion: number;
  config: Record<string, string>;
  lastRunId?: string;
  lastRunStatus?: TaskRunStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelTaskInput {
  name: string;
  type: ChannelTaskType;
  enabled?: boolean;
  dependsOn?: string[];
  config?: Record<string, string>;
}

export interface TaskRun {
  id: string;
  channelId: string;
  taskId: string;
  taskType: ChannelTaskType;
  status: TaskRunStatus;
  startedAt: string;
  finishedAt?: string;
  readRows: number;
  writtenRows: number;
  failedRows: number;
  diffRows: number;
  errorMessage?: string;
  createdBy: string;
}

export interface TaskLog {
  id: string;
  channelId: string;
  taskId?: string;
  runId?: string;
  level: "info" | "warn" | "error";
  thread: string;
  message: string;
  createdAt: string;
}

export interface ChannelPrecheckItem {
  key: string;
  label: string;
  success: boolean;
  severity?: "pass" | "warning" | "blocker";
  message: string;
}

export interface ChannelPrecheckResult {
  success: boolean;
  checkedAt: string;
  items: ChannelPrecheckItem[];
}

export interface OperationLog {
  id: string;
  actor: string;
  action: string;
  targetType: "datasource" | "auth" | "cluster_node" | "alert_rule" | "channel" | "channel_task" | string;
  targetId?: string;
  detail: string;
  createdAt: string;
}

export interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  webhookUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRuleInput {
  name: string;
  enabled?: boolean;
  webhookUrl?: string;
}

export interface AlertRuleEvaluation {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  reasons: string[];
  updatedAt: string;
}

export type AlertEventStatus = "triggered" | "recovered";
export type AlertNotificationStatus = "skipped" | "recorded";

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  status: AlertEventStatus;
  reasons: string[];
  notificationStatus: AlertNotificationStatus;
  notificationTarget?: string;
  message: string;
  createdAt: string;
}

export type NodeStatus = "online" | "offline";
export type NodeAuthMode = "password" | "private_key";
export type NodeRole = "master" | "standby";

export interface ClusterNode {
  id: string;
  name: string;
  endpoint: string;
  sshPort: number;
  sshUser: string;
  authMode: NodeAuthMode;
  installDir: string;
  version: string;
  zone: string;
  status: NodeStatus;
  role: NodeRole | string;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  networkThroughputMBps: number;
  capacity: number;
  lastHeartbeatAt: string;
  startedAt: string;
  updatedAt: string;
}

export type NodeMetricRange = "30m" | "1h" | "3h" | "6h" | "12h" | "1d" | "3d" | "1w" | "1mo";

export interface NodeMetricSample {
  nodeId: string;
  collectedAt: string;
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  networkThroughputMBps: number;
}

export interface NodeMetricHistoryResponse {
  nodeId: string;
  range: NodeMetricRange;
  generatedAt: string;
  samples: NodeMetricSample[];
}

export interface NodeOperationStep {
  key: string;
  label: string;
  status: "done" | "failed";
  detail: string;
}

export interface NodeOperationResult {
  action: "upgrade" | "uninstall";
  success: boolean;
  message: string;
  finishedAt: string;
  node?: ClusterNode;
  removedNodeId?: string;
  before?: ClusterSnapshot;
  after?: ClusterSnapshot;
  steps: NodeOperationStep[];
}

export interface NodeStatusChangeResult {
  id: string;
  action: "online" | "offline";
  node: ClusterNode;
  success: boolean;
  message: string;
  before: ClusterSnapshot;
  after: ClusterSnapshot;
  changedAt: string;
}

export interface ClusterSnapshot {
  nodes: ClusterNode[];
  localNodeId?: string;
  localNodeName?: string;
  masterNodeId?: string;
  masterNodeName?: string;
  masterNodeCount: number;
  onlineNodes: number;
  totalNodes: number;
  degradedNodes: number;
  heartbeatTimeoutSeconds: number;
}

export interface LoginResponse {
  token: string;
  user: User;
}
