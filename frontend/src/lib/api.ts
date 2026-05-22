import type {
  AlertRule,
  AlertRuleEvaluation,
  AlertRuleInput,
  CapabilityJob,
  CapabilityJobType,
  ClusterRebalanceReport,
  DashboardSummary,
  ClusterSnapshot,
  ClusterNode,
  ClusterNodeInput,
  Datasource,
  ErrorEvent,
  FailoverDrillReport,
  LoginResponse,
  NodeDrainReport,
  OperationLog,
  PositionResetInput,
  QualityDiff,
  QualityDiffCorrectionInput,
  StructureDDL,
  StructureDDLApplyInput,
  SyncStrategy,
  SyncTask,
  TableColumn,
  TableInfo,
  TaskExport,
  TaskCheckpoint,
  TaskOperationResult,
  TaskParameterPatch,
  TaskPreflightReport,
  TaskRevision,
  User
} from "../types/api";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4100/api";
const TOKEN_KEY = "canal-plus-token";

type SyncTaskInput = Omit<SyncTask, "id" | "status" | "configVersion" | "createdAt" | "updatedAt" | "runtime" | "sourceDatasource" | "targetDatasource">;

export function getToken() {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || "请求失败");
  }
  return body as T;
}

export const api = {
  login(input: { username: string; password: string }) {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  me() {
    return request<User>("/me");
  },
  summary() {
    return request<DashboardSummary>("/dashboard/summary");
  },
  datasources() {
    return request<Datasource[]>("/datasources");
  },
  createDatasource(input: {
    name: string;
    purpose: string;
    host: string;
    port: number;
    username: string;
    password: string;
    defaultSchema?: string;
  }) {
    return request<Datasource>("/datasources", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateDatasource(id: string, input: {
    name?: string;
    purpose?: string;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    defaultSchema?: string;
  }) {
    return request<Datasource>(`/datasources/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },
  deleteDatasource(id: string) {
    return request<void>(`/datasources/${id}`, { method: "DELETE" });
  },
  testDatasource(id: string) {
    return request<Datasource>(`/datasources/${id}/test`, { method: "POST" });
  },
  schemas(datasourceId: string) {
    return request<string[]>(`/datasources/${datasourceId}/schemas`);
  },
  tables(datasourceId: string, schema: string) {
    return request<TableInfo[]>(`/datasources/${datasourceId}/schemas/${schema}/tables`);
  },
  columns(datasourceId: string, schema: string, table: string) {
    return request<TableColumn[]>(`/datasources/${datasourceId}/schemas/${schema}/tables/${table}/columns`);
  },
  tasks() {
    return request<SyncTask[]>("/sync-tasks");
  },
  createTask(input: SyncTaskInput) {
    return request<SyncTask>("/sync-tasks", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  preflightTask(input: SyncTaskInput) {
    return request<TaskPreflightReport>("/sync-tasks/preflight", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  taskAction(id: string, action: "start" | "pause" | "resume" | "stop" | "copy") {
    return request<SyncTask>(`/sync-tasks/${id}/${action}`, { method: "POST" });
  },
  rerunTask(id: string) {
    return request<TaskOperationResult>(`/sync-tasks/${id}/rerun`, { method: "POST" });
  },
  deleteTask(id: string) {
    return request<void>(`/sync-tasks/${id}`, { method: "DELETE" });
  },
  updateTaskParams(id: string, input: TaskParameterPatch) {
    return request<TaskOperationResult>(`/sync-tasks/${id}/params`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  resetTaskPosition(id: string, input: PositionResetInput) {
    return request<TaskOperationResult>(`/sync-tasks/${id}/reset-position`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  exportTask(id: string) {
    return request<TaskExport>(`/sync-tasks/${id}/export`);
  },
  taskRevisions(id: string) {
    return request<TaskRevision[]>(`/sync-tasks/${id}/revisions`);
  },
  taskCheckpoints(id: string) {
    return request<TaskCheckpoint[]>(`/sync-tasks/${id}/checkpoints`);
  },
  rollbackTaskRevision(id: string, version: number) {
    return request<TaskOperationResult>(`/sync-tasks/${id}/revisions/${version}/rollback`, { method: "POST" });
  },
  defaultStrategy() {
    return request<SyncStrategy>("/sync-strategy/default");
  },
  errors() {
    return request<ErrorEvent[]>("/error-events");
  },
  retryError(id: string) {
    return request<ErrorEvent>(`/error-events/${id}/retry`, { method: "POST" });
  },
  retryErrors(ids: string[]) {
    return request<ErrorEvent[]>("/error-events/batch-retry", {
      method: "POST",
      body: JSON.stringify({ ids })
    });
  },
  skipError(id: string, reason: string) {
    return request<ErrorEvent>(`/error-events/${id}/skip`, {
      method: "POST",
      body: JSON.stringify({ reason })
    });
  },
  logs() {
    return request<OperationLog[]>("/operation-logs");
  },
  alertRules() {
    return request<AlertRule[]>("/alert-rules");
  },
  alertEvaluations() {
    return request<AlertRuleEvaluation[]>("/alert-rules/evaluations");
  },
  createAlertRule(input: AlertRuleInput) {
    return request<AlertRule>("/alert-rules", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateAlertRule(id: string, input: AlertRuleInput) {
    return request<AlertRule>(`/alert-rules/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },
  deleteAlertRule(id: string) {
    return request<void>(`/alert-rules/${id}`, { method: "DELETE" });
  },
  capabilityJobs(type?: CapabilityJobType) {
    const query = type ? `?type=${type}` : "";
    return request<CapabilityJob[]>(`/capability-jobs${query}`);
  },
  createCapabilityJob(input: {
    type: CapabilityJobType;
    taskId: string;
    name?: string;
    mode?: string;
    schedule?: string;
    autoStart?: boolean;
  }) {
    return request<CapabilityJob>("/capability-jobs", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  runCapabilityJob(id: string) {
    return request<CapabilityJob>(`/capability-jobs/${id}/run`, { method: "POST" });
  },
  structureDDLs(jobId: string) {
    return request<StructureDDL[]>(`/capability-jobs/${jobId}/structure-ddl`);
  },
  applyStructureDDLs(jobId: string, input: StructureDDLApplyInput = {}) {
    return request<CapabilityJob>(`/capability-jobs/${jobId}/structure-ddl/apply`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  qualityDiffs(jobId: string) {
    return request<QualityDiff[]>(`/capability-jobs/${jobId}/quality-diffs`);
  },
  correctQualityDiffs(jobId: string, input: QualityDiffCorrectionInput = {}) {
    return request<CapabilityJob>(`/capability-jobs/${jobId}/quality-diffs/correct`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  cluster() {
    return request<ClusterSnapshot>("/cluster");
  },
  registerNode(input: ClusterNodeInput) {
    return request<ClusterNode>("/cluster/nodes", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  nodeAction(id: string, action: "online" | "offline" | "heartbeat") {
    return request<ClusterSnapshot | unknown>(`/cluster/nodes/${id}/${action}`, { method: "POST" });
  },
  drainNode(id: string) {
    return request<NodeDrainReport>(`/cluster/nodes/${id}/drain`, { method: "POST" });
  },
  failoverDrill(id: string) {
    return request<FailoverDrillReport>(`/cluster/nodes/${id}/failover-drill`, { method: "POST" });
  },
  rebalanceCluster() {
    return request<ClusterRebalanceReport>("/cluster/rebalance", { method: "POST" });
  }
};
