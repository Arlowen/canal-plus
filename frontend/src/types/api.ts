export type Role = "admin" | "operator";
export type DatasourceStatus = "untested" | "online" | "offline";

export interface User {
  id: string;
  name: string;
  username: string;
  role: Role;
}

export interface Datasource {
  id: string;
  name: string;
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

export interface ClusterNodeInput {
  id?: string;
  name: string;
  endpoint: string;
  sshPort?: number;
  sshUser?: string;
  authMode?: NodeAuthMode;
  password?: string;
  privateKey?: string;
  installDir?: string;
  version?: string;
  zone?: string;
  role?: string;
  capacity?: number;
  cpuPercent?: number;
  memoryPercent?: number;
}

export interface NodeConnectionTestResult {
  success: boolean;
  message: string;
  checkedAt: string;
  latencyMs: number;
}

export interface NodeOperationStep {
  key: string;
  label: string;
  status: "done" | "failed";
  detail: string;
}

export interface NodeOperationResult {
  action: "deploy" | "upgrade" | "uninstall";
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
