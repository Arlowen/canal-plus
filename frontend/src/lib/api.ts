import type {
  AlertRule,
  AlertEvent,
  AlertRuleEvaluation,
  AlertRuleInput,
  ClusterSnapshot,
  ClusterNode,
  ClusterNodeInput,
  Datasource,
  LoginResponse,
  NodeConnectionTestResult,
  NodeOperationResult,
  NodeStatusChangeResult,
  OperationLog,
  TableColumn,
  TableInfo,
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
  createDatasource(input: {
    name: string;
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
  schemas(datasourceId: string, options?: RequestInit) {
    return request<string[]>(`/datasources/${datasourceId}/schemas`, options);
  },
  tables(datasourceId: string, schema: string, options?: RequestInit) {
    return request<TableInfo[]>(`/datasources/${datasourceId}/schemas/${schema}/tables`, options);
  },
  columns(datasourceId: string, schema: string, table: string, options?: RequestInit) {
    return request<TableColumn[]>(`/datasources/${datasourceId}/schemas/${schema}/tables/${table}/columns`, options);
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
  }
};
