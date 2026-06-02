import type {
  AlertRule,
  AlertEvent,
  AlertRuleEvaluation,
  AlertRuleInput,
  Channel,
  ChannelInput,
  ChannelMappingsInput,
  ChannelMappingsResponse,
  ChannelPrecheckResult,
  ChannelTask,
  ChannelTaskInput,
  ClusterSnapshot,
  ClusterNode,
  Datasource,
  DatasourceDatabasesResponse,
  DatasourceInput,
  DatasourceTablesResponse,
  DatasourceTestResult,
  LoginResponse,
  NodeMetricHistoryResponse,
  NodeMetricRange,
  OperationLog,
  TaskLog,
  TaskRun,
  User
} from "../types/api";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4100/api";
const TOKEN_KEY = "canal-plus-token";
const SERVICE_UNAVAILABLE_MESSAGE = "后端服务暂时不可用，请稍后重试。";

type BackendAvailabilityListener = (available: boolean) => void;

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

function isAbortError(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
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
    if (isAbortError(error)) {
      throw error;
    }
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
      if (!error.isServiceUnavailable) {
        publishBackendAvailability(true);
      }
      throw error;
    }
    publishBackendAvailability(true);
    return body as T;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const normalizedError = normalizeRequestError(error);
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
  datasources() {
    return request<Datasource[]>("/datasources");
  },
  createDatasource(input: DatasourceInput) {
    return request<Datasource>("/datasources", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateDatasource(id: string, input: DatasourceInput) {
    return request<Datasource>(`/datasources/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },
  deleteDatasource(id: string) {
    return request<void>(`/datasources/${id}`, { method: "DELETE" });
  },
  testDatasourceInput(input: DatasourceInput) {
    return request<DatasourceTestResult>("/datasources/test", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  testDatasource(id: string, input: { nodeId?: string } = {}) {
    return request<DatasourceTestResult>(`/datasources/${id}/test`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  datasourceDatabases(id: string, input: { nodeId?: string } = {}) {
    const params = new URLSearchParams();
    if (input.nodeId) params.set("nodeId", input.nodeId);
    const query = params.toString();
    return request<DatasourceDatabasesResponse>(`/datasources/${id}/databases${query ? `?${query}` : ""}`);
  },
  datasourceTables(id: string, input: { nodeId?: string; database: string }) {
    const params = new URLSearchParams();
    if (input.nodeId) params.set("nodeId", input.nodeId);
    params.set("database", input.database);
    return request<DatasourceTablesResponse>(`/datasources/${id}/tables?${params.toString()}`);
  },
  channels() {
    return request<Channel[]>("/channels");
  },
  channel(id: string) {
    return request<Channel>(`/channels/${id}`);
  },
  createChannel(input: ChannelInput) {
    return request<Channel>("/channels", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateChannel(id: string, input: ChannelInput) {
    return request<Channel>(`/channels/${id}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },
  deleteChannel(id: string) {
    return request<void>(`/channels/${id}`, { method: "DELETE" });
  },
  archiveChannel(id: string) {
    return request<Channel>(`/channels/${id}/archive`, { method: "POST" });
  },
  precheckChannel(id: string) {
    return request<ChannelPrecheckResult>(`/channels/${id}/precheck`, { method: "POST" });
  },
  channelMappings(id: string) {
    return request<ChannelMappingsResponse>(`/channels/${id}/mappings`);
  },
  saveChannelMappings(id: string, input: ChannelMappingsInput) {
    return request<ChannelMappingsResponse>(`/channels/${id}/mappings`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },
  channelTasks(id: string) {
    return request<ChannelTask[]>(`/channels/${id}/tasks`);
  },
  createChannelTask(id: string, input: ChannelTaskInput) {
    return request<ChannelTask>(`/channels/${id}/tasks`, {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  updateChannelTask(channelId: string, taskId: string, input: ChannelTaskInput) {
    return request<ChannelTask>(`/channels/${channelId}/tasks/${taskId}`, {
      method: "PUT",
      body: JSON.stringify(input)
    });
  },
  deleteChannelTask(channelId: string, taskId: string) {
    return request<void>(`/channels/${channelId}/tasks/${taskId}`, { method: "DELETE" });
  },
  startChannelTask(channelId: string, taskId: string) {
    return request<ChannelTask>(`/channels/${channelId}/tasks/${taskId}/start`, { method: "POST" });
  },
  stopChannelTask(channelId: string, taskId: string) {
    return request<ChannelTask>(`/channels/${channelId}/tasks/${taskId}/stop`, { method: "POST" });
  },
  rerunChannelTask(channelId: string, taskId: string) {
    return request<ChannelTask>(`/channels/${channelId}/tasks/${taskId}/rerun`, { method: "POST" });
  },
  channelRuns(id: string) {
    return request<TaskRun[]>(`/channels/${id}/runs`);
  },
  channelLogs(id: string) {
    return request<TaskLog[]>(`/channels/${id}/logs`);
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
  cluster() {
    return request<ClusterSnapshot>("/cluster");
  },
  nodeMetrics(id: string, range: NodeMetricRange) {
    return request<NodeMetricHistoryResponse>(`/cluster/nodes/${id}/metrics?range=${encodeURIComponent(range)}`);
  },
  updateMasterNodeCount(masterNodeCount: number) {
    return request<ClusterSnapshot>("/cluster/master-node-count", {
      method: "POST",
      body: JSON.stringify({ masterNodeCount })
    });
  },
  updateNodeName(id: string, name: string) {
    return request<ClusterNode>(`/cluster/nodes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name })
    });
  },
  deleteNode(id: string) {
    return request<void>(`/cluster/nodes/${id}`, { method: "DELETE" });
  }
};
