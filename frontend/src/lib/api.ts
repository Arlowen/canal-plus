import type {
  AlertRule,
  AlertEvent,
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
  NodeConnectionTestResult,
  NodeDrainReport,
  NodeOperationResult,
  NodeStatusChangeResult,
  OperationLog,
  PositionResetInput,
  QualityDiff,
  QualityDiffCorrectionInput,
  RuntimeConfig,
  SubscriptionChange,
  StructureDDL,
  StructureDDLApplyInput,
  SyncStrategy,
  SyncTask,
  TableColumn,
  TableInfo,
  TaskExport,
  TaskCheckpoint,
  TaskLogEntry,
  TaskOperationResult,
  TaskParameterPatch,
  TaskPreflightReport,
  TaskRuntimeState,
  TaskRevision,
  User
} from "../types/api";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4100/api";
const TOKEN_KEY = "canal-plus-token";
const SERVICE_UNAVAILABLE_MESSAGE = "后端服务暂时不可用，请稍后重试。";

type BackendAvailabilityListener = (available: boolean) => void;

type SyncTaskInput = Omit<SyncTask, "id" | "status" | "configVersion" | "createdAt" | "updatedAt" | "runtime" | "sourceDatasource" | "targetDatasource">;

const backendAvailabilityListeners = new Set<BackendAvailabilityListener>();
let lastKnownBackendAvailability: boolean | null = null;

export class ApiError extends Error {
  status?: number;
  isServiceUnavailable: boolean;

  constructor(message: string, options: { status?: number; isServiceUnavailable?: boolean } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.isServiceUnavailable = options.isServiceUnavailable ?? false;
  }
}

function publishBackendAvailability(available: boolean) {
  if (lastKnownBackendAvailability === available) {
    return;
  }
  lastKnownBackendAvailability = available;
  backendAvailabilityListeners.forEach((listener) => listener(available));
}

function isServiceUnavailableStatus(status: number) {
  return status >= 500;
}

function createResponseError(status: number, fallbackMessage: string, body: unknown) {
  const message = typeof body === "object" && body && "message" in body && typeof body.message === "string"
    ? body.message
    : fallbackMessage;
  return new ApiError(message, {
    status,
    isServiceUnavailable: isServiceUnavailableStatus(status)
  });
}

function normalizeRequestError(error: unknown) {
  if (error instanceof ApiError) {
    return error;
  }
  return new ApiError(SERVICE_UNAVAILABLE_MESSAGE, { isServiceUnavailable: true });
}

export function getToken() {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}

export function subscribeBackendAvailability(listener: BackendAvailabilityListener) {
  backendAvailabilityListeners.add(listener);
  return () => {
    backendAvailabilityListeners.delete(listener);
  };
}

export function isServiceUnavailableError(error: unknown) {
  return error instanceof ApiError && error.isServiceUnavailable;
}

export async function checkBackendHealth() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = createResponseError(response.status, SERVICE_UNAVAILABLE_MESSAGE, body);
      if (error.isServiceUnavailable) {
        publishBackendAvailability(false);
      } else {
        publishBackendAvailability(true);
      }
      throw error;
    }
    publishBackendAvailability(true);
    return response.json().catch(() => ({}));
  } catch (error) {
    const normalizedError = normalizeRequestError(error);
    if (normalizedError.isServiceUnavailable) {
      publishBackendAvailability(false);
    }
    throw normalizedError;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      }
    });

    if (response.status === 204) {
      publishBackendAvailability(true);
      return undefined as T;
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = createResponseError(response.status, "请求失败", body);
      if (error.isServiceUnavailable) {
        publishBackendAvailability(false);
      } else {
        publishBackendAvailability(true);
      }
      throw error;
    }
    publishBackendAvailability(true);
    return body as T;
  } catch (error) {
    const normalizedError = normalizeRequestError(error);
    if (normalizedError.isServiceUnavailable) {
      publishBackendAvailability(false);
    }
    throw normalizedError;
  }
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
  runtimeConfig() {
    return request<RuntimeConfig>("/runtime/config");
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
  taskRuntime(id: string) {
    return request<TaskRuntimeState>(`/sync-tasks/${id}/runtime`);
  },
  taskLogs(id: string, limit = 120) {
    return request<TaskLogEntry[]>(`/sync-tasks/${id}/logs?limit=${limit}`);
  },
  taskLogsStreamUrl(id: string) {
    const token = getToken();
    const search = token ? `?access_token=${encodeURIComponent(token)}` : "";
    return `${API_BASE}/sync-tasks/${id}/logs/stream${search}`;
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
  alertEvents(ruleId?: string) {
    const query = ruleId ? `?ruleId=${encodeURIComponent(ruleId)}` : "";
    return request<AlertEvent[]>(`/alert-rules/events${query}`);
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
  subscriptionChanges(jobId: string) {
    return request<SubscriptionChange[]>(`/capability-jobs/${jobId}/subscription-changes`);
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
  testNodeConnection(input: ClusterNodeInput) {
    return request<NodeConnectionTestResult>("/cluster/nodes/test-connection", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  deployNode(input: ClusterNodeInput) {
    return request<NodeOperationResult>("/cluster/nodes/deploy", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  upgradeNode(id: string) {
    return request<NodeOperationResult>(`/cluster/nodes/${id}/upgrade`, { method: "POST" });
  },
  uninstallNode(id: string) {
    return request<NodeOperationResult>(`/cluster/nodes/${id}/uninstall`, { method: "POST" });
  },
  nodeAction(id: string, action: "online" | "offline" | "heartbeat") {
    return request<NodeStatusChangeResult | ClusterNode>(`/cluster/nodes/${id}/${action}`, { method: "POST" });
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
