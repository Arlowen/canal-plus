import type {
  DashboardSummary,
  ClusterSnapshot,
  Datasource,
  ErrorEvent,
  LoginResponse,
  OperationLog,
  SyncStrategy,
  SyncTask,
  TableColumn,
  TableInfo,
  User
} from "../types/api";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4100/api";
const TOKEN_KEY = "canal-plus-token";

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
  createTask(input: Omit<SyncTask, "id" | "status" | "configVersion" | "createdAt" | "updatedAt" | "runtime" | "sourceDatasource" | "targetDatasource">) {
    return request<SyncTask>("/sync-tasks", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },
  taskAction(id: string, action: "start" | "pause" | "resume" | "stop" | "copy") {
    return request<SyncTask>(`/sync-tasks/${id}/${action}`, { method: "POST" });
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
  skipError(id: string, reason: string) {
    return request<ErrorEvent>(`/error-events/${id}/skip`, {
      method: "POST",
      body: JSON.stringify({ reason })
    });
  },
  logs() {
    return request<OperationLog[]>("/operation-logs");
  },
  cluster() {
    return request<ClusterSnapshot>("/cluster");
  },
  nodeAction(id: string, action: "online" | "offline" | "drain" | "heartbeat") {
    return request<ClusterSnapshot | unknown>(`/cluster/nodes/${id}/${action}`, { method: "POST" });
  },
  rebalanceCluster() {
    return request<ClusterSnapshot>("/cluster/rebalance", { method: "POST" });
  }
};
