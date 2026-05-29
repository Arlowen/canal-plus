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

export interface OperationLog {
  id: string;
  actor: string;
  action: string;
  targetType: "datasource" | "auth" | "cluster_node" | "alert_rule" | string;
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
  role: string;
  cpuPercent: number;
  memoryPercent: number;
  capacity: number;
  lastHeartbeatAt: string;
  startedAt: string;
  updatedAt: string;
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
  onlineNodes: number;
  totalNodes: number;
  degradedNodes: number;
  heartbeatTimeoutSeconds: number;
}

export interface LoginResponse {
  token: string;
  user: User;
}
