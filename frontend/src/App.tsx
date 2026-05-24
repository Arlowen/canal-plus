import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowsClockwise,
  ArrowRight,
  CheckCircle,
  ClipboardText,
  Database,
  DotsThree,
  FlowArrow,
  GearSix,
  HardDrives,
  MagnifyingGlass,
  Pause,
  PencilSimple,
  Play,
  Plus,
  RocketLaunch,
  ShieldCheck,
  SignOut,
  SquaresFour,
  Stop,
  Trash,
  WarningCircle,
  XCircle
} from "@phosphor-icons/react";
import { PermissionNotice } from "./components/PermissionNotice";
import { StatusBadge } from "./components/StatusBadge";
import {
  api,
  checkBackendHealth,
  clearToken,
  getToken,
  isServiceUnavailableError,
  setToken,
  subscribeBackendAvailability
} from "./lib/api";
import { cx, formatDate, formatDateTime, formatNumber, secondsSince } from "./lib/format";
import { canManageConfig, roleLabel } from "./lib/permissions";
import { taskStatusText } from "./lib/taskStatus";
import type {
  AlertEvent,
  AlertRule,
  AlertRuleEvaluation,
  AlertRuleInput,
  CapabilityJob,
  ClusterRebalanceReport,
  ClusterNode,
  ClusterNodeInput,
  ClusterSnapshot,
  DashboardSummary,
  Datasource,
  DatasourcePurpose,
  DatasourceStatus,
  ErrorEvent,
  FieldMapping,
  FailoverDrillReport,
  FailoverDrillTask,
  NodeConnectionTestResult,
  NodeDrainReport,
  NodeOperationResult,
  NodeStatusChangeResult,
  OperationLog,
  RuntimeConfig,
  SyncStrategy,
  SyncTask,
  TableColumn,
  TableInfo,
  TaskCheckpoint,
  TaskLogEntry,
  TaskPreflightReport,
  TaskRevision,
  TaskRuntimeState,
  User
} from "./types/api";

type Page = "dashboard" | "datasources" | "tasks" | "nodes" | "settings";
type NoticeTone = "success" | "error" | "warning";
type TaskBlueprintType = "full_migration" | "incremental_sync" | "data_validation" | "data_correction" | "structure_compare";
type TaskStateFilter = "all" | "running" | "awaiting" | "remote" | "failed" | "stopped";
type WorkloadItem = {
  id: string;
  key: string;
  kind: "sync" | "capability";
  type: string;
  title: string;
  detail: string;
  updatedAt: string;
  statusText: string;
  rawTask?: SyncTask;
  rawJob?: CapabilityJob;
};

type Notice = {
  tone: NoticeTone;
  message: string;
};

type ClusterHandoffReport = {
  id: string;
  kind: "drain" | "drill" | "rebalance" | "offline" | "online";
  happenedAt: string;
  node?: ClusterNode;
  success: boolean;
  message: string;
  affectedTasks: FailoverDrillTask[];
  before: ClusterSnapshot;
  after: ClusterSnapshot;
};

const navItems: Array<{ id: Page; label: string; icon: typeof SquaresFour }> = [
  { id: "tasks", label: "任务中心", icon: FlowArrow },
  { id: "datasources", label: "数据源", icon: Database },
  { id: "nodes", label: "节点", icon: HardDrives },
  { id: "dashboard", label: "总览", icon: SquaresFour },
  { id: "settings", label: "设置", icon: GearSix }
];

const taskBlueprints: Array<{
  type: TaskBlueprintType;
  name: string;
  description: string;
  scenario: string;
  tag: string;
}> = [
  {
    type: "full_migration",
    name: "全量迁移",
    description: "一次性迁移存量数据。",
    scenario: "适合新库初始化或历史数据搬迁。",
    tag: "首次上线"
  },
  {
    type: "incremental_sync",
    name: "增量同步",
    description: "持续同步变更数据。",
    scenario: "适合生产链路跟随源端变化。",
    tag: "常驻任务"
  },
  {
    type: "data_validation",
    name: "数据校验",
    description: "比对源端和目标端是否一致。",
    scenario: "适合迁移后核验和周期巡检。",
    tag: "质量核验"
  },
  {
    type: "data_correction",
    name: "数据订正",
    description: "修复源端和目标端差异。",
    scenario: "适合校验失败后的批量修复。",
    tag: "自动修复"
  },
  {
    type: "structure_compare",
    name: "结构对比",
    description: "比较表结构差异。",
    scenario: "适合迁移前检查和变更评估。",
    tag: "变更评估"
  }
];

const defaultStrategy: SyncStrategy = {
  initMode: "full_then_incremental",
  writeMode: {
    insert: true,
    update: true,
    delete: true
  },
  conflictStrategy: "overwrite",
  deleteStrategy: "physical",
  batchSize: 1000,
  retryTimes: 3,
  retryIntervalSeconds: 10
};

const emptyDatasourceForm = {
  name: "",
  purpose: "source" as DatasourcePurpose,
  host: "",
  port: 3306,
  username: "",
  password: "",
  defaultSchema: ""
};

const emptyNodeForm: ClusterNodeInput = {
  name: "",
  endpoint: "",
  sshPort: 22,
  sshUser: "",
  authMode: "password",
  password: "",
  privateKey: "",
  installDir: "/opt/canal-plus",
  version: "v1.0.0",
  zone: "default",
  role: "worker",
  capacity: 4
};

const emptyNodes: ClusterNode[] = [];

function App() {
  const [tokenState, setTokenState] = useState(getToken());
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>("tasks");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [tasks, setTasks] = useState<SyncTask[]>([]);
  const [errors, setErrors] = useState<ErrorEvent[]>([]);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [cluster, setCluster] = useState<ClusterSnapshot | null>(null);
  const [capabilityJobs, setCapabilityJobs] = useState<CapabilityJob[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([]);
  const [alertEvaluations, setAlertEvaluations] = useState<AlertRuleEvaluation[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const [serviceRecoveryPending, setServiceRecoveryPending] = useState(false);
  const [datasourceCreateToken, setDatasourceCreateToken] = useState(0);
  const [taskCreateToken, setTaskCreateToken] = useState(0);
  const [nodeCreateToken, setNodeCreateToken] = useState(0);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const previousServiceUnavailable = useRef(false);
  const canManage = canManageConfig(user);

  const pushNotice = useCallback((next: Notice) => {
    setNotice(next);
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!getToken()) return;
    if (!quiet) setLoading(true);
    setGlobalError(null);
    try {
      const [
        nextSummary,
        nextRuntimeConfig,
        nextDatasources,
        nextTasks,
        nextErrors,
        nextLogs,
        nextCluster,
        nextCapabilityJobs,
        nextAlertRules,
        nextAlertEvaluations,
        nextAlertEvents
      ] = await Promise.all([
        api.summary(),
        api.runtimeConfig(),
        api.datasources(),
        api.tasks(),
        api.errors(),
        api.logs(),
        api.cluster(),
        api.capabilityJobs(),
        api.alertRules(),
        api.alertEvaluations(),
        api.alertEvents()
      ]);
      setSummary(nextSummary);
      setRuntimeConfig(nextRuntimeConfig);
      setDatasources(nextDatasources);
      setTasks(nextTasks);
      setErrors(nextErrors);
      setLogs(nextLogs);
      setCluster(nextCluster);
      setCapabilityJobs(nextCapabilityJobs);
      setAlertRules(nextAlertRules);
      setAlertEvaluations(nextAlertEvaluations);
      setAlertEvents(nextAlertEvents);
    } catch (requestError) {
      if (isServiceUnavailableError(requestError)) {
        return;
      }
      setGlobalError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const restoreAuthenticatedState = useCallback(async () => {
    if (!getToken()) {
      return;
    }
    try {
      const nextUser = await api.me();
      setUser(nextUser);
      await refresh(true);
    } catch (requestError) {
      if (isServiceUnavailableError(requestError)) {
        return;
      }
      clearToken();
      setTokenState(null);
      setUser(null);
    }
  }, [refresh]);

  const retryServiceConnection = useCallback(async () => {
    setServiceRecoveryPending(true);
    try {
      await checkBackendHealth();
      if (getToken()) {
        await restoreAuthenticatedState();
      }
    } finally {
      setServiceRecoveryPending(false);
    }
  }, [restoreAuthenticatedState]);

  useEffect(() => subscribeBackendAvailability((available) => {
    setServiceUnavailable(!available);
    if (available) {
      setGlobalError(null);
    }
  }), []);

  useEffect(() => {
    if (!tokenState) return;
    api.me()
      .then(setUser)
      .catch((requestError) => {
        if (isServiceUnavailableError(requestError)) {
          return;
        }
        clearToken();
        setTokenState(null);
        setUser(null);
      });
    void refresh();
  }, [refresh, tokenState]);

  useEffect(() => {
    if (!tokenState || serviceUnavailable) return;
    const timer = window.setInterval(() => {
      void refresh(true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [refresh, serviceUnavailable, tokenState]);

  useEffect(() => {
    void checkBackendHealth().catch(() => undefined);
    const timer = window.setInterval(() => {
      void checkBackendHealth().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (previousServiceUnavailable.current && !serviceUnavailable && tokenState) {
      void restoreAuthenticatedState();
    }
    previousServiceUnavailable.current = serviceUnavailable;
  }, [restoreAuthenticatedState, serviceUnavailable, tokenState]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleLogin = async (username: string, password: string) => {
    const response = await api.login({ username, password });
    setToken(response.token);
    setTokenState(response.token);
    setUser(response.user);
    setPage("tasks");
    pushNotice({ tone: "success", message: "已进入任务中心" });
  };

  const handleLogout = () => {
    clearToken();
    setTokenState(null);
    setUser(null);
    setNotice(null);
  };

  const openDatasourceCreator = () => {
    setPage("datasources");
    setDatasourceCreateToken((value) => value + 1);
  };

  const openTaskCreator = () => {
    setPage("tasks");
    setTaskCreateToken((value) => value + 1);
  };

  const openTaskDetail = (taskID: string) => {
    setFocusedTaskId(taskID);
    setPage("tasks");
  };

  const openNodeCreator = () => {
    setPage("nodes");
    setNodeCreateToken((value) => value + 1);
  };

  const openNodeDetail = (nodeID: string) => {
    setFocusedNodeId(nodeID);
    setPage("nodes");
  };

  if (serviceUnavailable) {
    return <BackendUnavailableScreen retrying={serviceRecoveryPending} onRetry={retryServiceConnection} />;
  }

  if (!tokenState) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-[100dvh] bg-mist text-ink">
      <div className="page-shell">
        <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="surface h-fit p-4 lg:sticky lg:top-5">
            <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.22em] text-slate-500">Canal Plus</div>
                <div className="mt-2 text-lg font-semibold tracking-tight text-coal">数据任务平台</div>
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
                {user?.role === "admin" ? "Admin" : "Operator"}
              </div>
            </div>

            <nav className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => setPage(item.id)}
                    className={cx(
                      "flex items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm font-medium transition",
                      page === item.id
                        ? "bg-blue-600 text-white shadow-panel"
                        : "text-slate-600 hover:bg-slate-50 hover:text-coal"
                    )}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="mt-4 flex items-center justify-between gap-3 rounded-3xl border border-line bg-slate-50/80 p-4 lg:hidden">
              <div>
                <div className="text-sm font-medium text-coal">{user?.name || "admin"}</div>
                <div className="mt-1 text-sm text-slate-500">{roleLabel(user?.role)}</div>
              </div>
              <button onClick={handleLogout} className="btn-secondary">
                <SignOut size={16} />
                退出
              </button>
            </div>

            <div className="mt-5 hidden rounded-3xl border border-line bg-slate-50/80 p-4 lg:block">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">当前账号</div>
              <div className="mt-3 text-sm font-medium text-coal">{user?.name || "admin"}</div>
              <div className="mt-1 text-sm text-slate-500">{roleLabel(user?.role)}</div>
              <button onClick={handleLogout} className="btn-secondary mt-4 w-full">
                <SignOut size={16} />
                退出
              </button>
            </div>
          </aside>

          <main className="min-w-0">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.22em] text-slate-500">当前页面</div>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-coal md:text-4xl">
                  {pageTitle(page)}
                </h1>
                <p className="mt-2 text-sm text-slate-500">
                  {pageDescription(page)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => void refresh()} className="btn-secondary">
                  <ArrowsClockwise size={16} />
                  刷新
                </button>
                {page === "datasources" && canManage && (
                  <button onClick={openDatasourceCreator} className="btn-primary">
                    <Plus size={16} />
                    添加数据源
                  </button>
                )}
                {page === "tasks" && canManage && (
                  <button onClick={openTaskCreator} className="btn-primary">
                    <Plus size={16} />
                    创建任务
                  </button>
                )}
                {page === "nodes" && canManage && (
                  <button onClick={openNodeCreator} className="btn-primary">
                    <Plus size={16} />
                    添加节点
                  </button>
                )}
              </div>
            </div>

            {notice && (
              <NoticeBanner tone={notice.tone}>
                {notice.message}
              </NoticeBanner>
            )}

            {globalError && (
              <NoticeBanner tone="error">
                {globalError}
              </NoticeBanner>
            )}

            {loading && !summary && datasources.length === 0 && tasks.length === 0 ? (
              <ShellSkeleton />
            ) : page === "dashboard" ? (
              <DashboardPage
                summary={summary}
                datasources={datasources}
                tasks={tasks}
                capabilityJobs={capabilityJobs}
                errors={errors}
                cluster={cluster}
                onCreateDatasource={openDatasourceCreator}
                onCreateTask={openTaskCreator}
                onCreateNode={openNodeCreator}
                onOpenTasks={() => setPage("tasks")}
                onOpenTask={openTaskDetail}
                onOpenNodes={() => setPage("nodes")}
              />
            ) : page === "datasources" ? (
              <DatasourcePage
                datasources={datasources}
                tasks={tasks}
                canManage={canManage}
                onChanged={refresh}
                pushNotice={pushNotice}
                openCreateToken={datasourceCreateToken}
              />
            ) : page === "tasks" ? (
              <TasksPage
                datasources={datasources}
                tasks={tasks}
                capabilityJobs={capabilityJobs}
                errors={errors}
                cluster={cluster}
                canManage={canManage}
                onChanged={refresh}
                pushNotice={pushNotice}
                openCreateToken={taskCreateToken}
                onCreateDatasource={openDatasourceCreator}
                onOpenNode={openNodeDetail}
                focusedTaskId={focusedTaskId}
              />
            ) : page === "nodes" ? (
              <NodesPage
                cluster={cluster}
                tasks={tasks}
                logs={logs}
                canManage={canManage}
                onChanged={refresh}
                pushNotice={pushNotice}
                openCreateToken={nodeCreateToken}
                focusedNodeId={focusedNodeId}
                onOpenTask={openTaskDetail}
              />
            ) : (
              <SettingsPage
                user={user}
                tasks={tasks}
                logs={logs}
                runtimeConfig={runtimeConfig}
                alertRules={alertRules}
                alertEvents={alertEvents}
                evaluations={alertEvaluations}
                canManage={canManage}
                onChanged={refresh}
                pushNotice={pushNotice}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function DashboardPage({
  summary,
  datasources,
  tasks,
  capabilityJobs,
  errors,
  cluster,
  onCreateDatasource,
  onCreateTask,
  onCreateNode,
  onOpenTasks,
  onOpenTask,
  onOpenNodes
}: {
  summary: DashboardSummary | null;
  datasources: Datasource[];
  tasks: SyncTask[];
  capabilityJobs: CapabilityJob[];
  errors: ErrorEvent[];
  cluster: ClusterSnapshot | null;
  onCreateDatasource: () => void;
  onCreateTask: () => void;
  onCreateNode: () => void;
  onOpenTasks: () => void;
  onOpenTask: (taskID: string) => void;
  onOpenNodes: () => void;
}) {
  const visibleCapabilityJobs = capabilityJobs.filter((job) => job.type !== "subscription");
  const runtimeTasks = tasks.filter((task) => task.runtime);
  const runningGovernance = visibleCapabilityJobs.filter((job) => job.status === "running").length;
  const failedTasks = tasks.filter((task) => task.status === "failed").length;
  const awaitingTasks = tasks.filter(taskAwaitingNode).length;
  const localHostedTasks = runtimeTasks.filter((task) => task.runtime?.managedByLocalNode !== false && Boolean(task.runtime?.nodeId)).length;
  const remoteHostedTasks = runtimeTasks.filter((task) => task.runtime?.managedByLocalNode === false).length;
  const pendingErrors = errors.filter((item) => item.status === "pending").length;
  const onlineNodes = cluster?.onlineNodes ?? summary?.onlineNodes ?? 0;
  const totalNodes = cluster?.totalNodes ?? summary?.totalNodes ?? 0;
  const hasCreatedTasks = tasks.length > 0;
  const localNodeLabel = cluster?.localNodeName || cluster?.localNodeId || "当前节点";
  const readyDatasources = datasources.filter((item) => item.connectionStatus === "online").length;
  const attentionTasks = [...tasks]
    .filter((task) => task.status === "failed" || taskAwaitingNode(task) || (task.runtime?.delaySeconds ?? 0) >= 180)
    .sort((left, right) => new Date(taskActivityAt(right)).getTime() - new Date(taskActivityAt(left)).getTime())
    .slice(0, 4);

  const overviewActions: Array<{ title: string; description: string; actionLabel: string; onClick: () => void }> = [];
  if (datasources.length < 2) {
    overviewActions.push({
      title: "先补齐数据源",
      description: "至少保留一个源端和一个目标端，并完成连接测试后再建链路。",
      actionLabel: "管理数据源",
      onClick: onCreateDatasource
    });
  }
  if (onlineNodes === 0) {
    overviewActions.push({
      title: "当前没有在线节点",
      description: "任务无法启动或接管时，先恢复节点在线状态和容量。",
      actionLabel: "查看节点",
      onClick: onOpenNodes
    });
  }
  if (awaitingTasks > 0) {
    overviewActions.push({
      title: "存在待接管任务",
      description: `当前有 ${awaitingTasks} 条任务没有执行节点，应该先消掉这类阻塞。`,
      actionLabel: "进入任务中心",
      onClick: onOpenTasks
    });
  }
  if (failedTasks + pendingErrors > 0) {
    overviewActions.push({
      title: "异常需要处理",
      description: `${failedTasks} 条任务异常，${pendingErrors} 条错误事件待处理。`,
      actionLabel: "查看任务",
      onClick: onOpenTasks
    });
  }
  if (overviewActions.length === 0) {
    overviewActions.push({
      title: hasCreatedTasks ? "主链路稳定" : "可以开始建第一条链路",
      description: hasCreatedTasks
        ? "总览不再重复展示任务列表，后续操作直接进入任务中心处理。"
        : "先补齐数据源和节点，再创建第一条同步任务。",
      actionLabel: hasCreatedTasks ? "进入任务中心" : "创建任务",
      onClick: hasCreatedTasks ? onOpenTasks : onCreateTask
    });
  }

  return (
    <div className="space-y-5">
      <section className="surface overflow-hidden p-6">
        <div className="grid gap-5 xl:grid-cols-[1.12fr_0.88fr]">
          <div>
            <div className="chip border-blue-200 bg-blue-50 text-blue-700">总览</div>
            <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-coal md:text-4xl">
              任务是主入口，总览只保留全局状态。
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
              总览不再重复承载任务列表和配置入口，只回答三个问题：链路能不能跑、现在卡在哪里、下一步该去哪个页面处理。
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={onOpenTasks} className="btn-primary">
                <FlowArrow size={16} />
                进入任务中心
              </button>
              <button onClick={onOpenNodes} className="btn-secondary">
                <HardDrives size={16} />
                查看节点
              </button>
              {!hasCreatedTasks && (
                <button onClick={onCreateTask} className="btn-secondary">
                  <Plus size={16} />
                  创建任务
                </button>
              )}
              {datasources.length < 2 && (
                <button onClick={onCreateDatasource} className="btn-secondary">
                  <Database size={16} />
                  添加数据源
                </button>
              )}
              {onlineNodes === 0 && (
                <button onClick={onCreateNode} className="btn-secondary">
                  <Plus size={16} />
                  添加节点
                </button>
              )}
            </div>
          </div>
          <div className="surface-muted p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-coal">当前重点</div>
                <div className="mt-1 text-sm text-slate-500">把真正会阻塞主链路的事项单独拎出来。</div>
              </div>
              {hasCreatedTasks ? <WarningCircle size={20} className="text-blue-600" /> : <RocketLaunch size={20} className="text-blue-600" />}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <DetailCard label="运行中任务" value={`${(summary?.runningTasks ?? 0) + runningGovernance} 条`} />
              <DetailCard label="待处理异常" value={`${failedTasks + pendingErrors} 条`} />
              <DetailCard label="在线节点" value={`${onlineNodes}/${totalNodes}`} />
              <DetailCard label="可用数据源" value={`${readyDatasources}/${datasources.length || 0}`} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="同步任务" value={tasks.length} detail="只保留主链路，不再把派生能力拆成独立列表项" tone="neutral" icon={FlowArrow} />
        <MetricCard label="扩展任务" value={visibleCapabilityJobs.length} detail="校验、订正、结构对比会挂到对应同步任务下" tone="blue" icon={ClipboardText} />
        <MetricCard label="运行中" value={(summary?.runningTasks ?? 0) + runningGovernance} detail="同步与治理任务合计" tone="blue" icon={Play} />
        <MetricCard label="异常" value={failedTasks + pendingErrors} detail={`${failedTasks} 条任务异常，${pendingErrors} 条待处理错误`} tone={failedTasks + pendingErrors > 0 ? "red" : "green"} icon={WarningCircle} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
        <section className="surface p-6">
          <SectionHeader
            title="当前阻塞"
            description="这里只保留会影响主链路推进的事项。"
            action={hasCreatedTasks ? (
              <button onClick={onOpenTasks} className="btn-secondary">
                进入任务中心
              </button>
            ) : undefined}
          />
          <div className="mt-5 grid gap-3">
            {overviewActions.map((item) => (
              <NextStepCard
                key={item.title}
                title={item.title}
                description={item.description}
                actionLabel={item.actionLabel}
                onClick={item.onClick}
              />
            ))}
          </div>
        </section>

        <section className="surface p-6">
          <SectionHeader title="资源准备度" description="总览只看链路是否具备开工条件。" />
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <MetricMini label="数据源就绪" value={`${readyDatasources}/${datasources.length || 0}`} />
            <MetricMini label="在线节点" value={`${onlineNodes}/${totalNodes}`} />
            <MetricMini label="当前节点托管" value={`${localHostedTasks}`} />
            <MetricMini label="待接管" value={`${awaitingTasks}`} />
          </div>
          <div className="mt-4 rounded-2xl border border-line bg-slate-50/70 px-4 py-4 text-sm text-slate-500">
            当前控制节点：<span className="font-medium text-coal">{localNodeLabel}</span>
          </div>
          <div className="mt-3 rounded-2xl border border-line bg-white px-4 py-4 text-sm text-slate-500">
            {remoteHostedTasks > 0
              ? `当前有 ${remoteHostedTasks} 条任务由远程节点托管，任务详情中会明确标出日志是否能在当前节点直接查看。`
              : "当前没有远程托管任务，任务日志默认在任务详情顶部直接查看。"}
          </div>
        </section>
      </div>

      <section className="surface p-6">
        <SectionHeader title="需要关注的任务" description="总览不展开列表，只点出异常、待接管和高延迟任务。" />
        {attentionTasks.length === 0 ? (
          <EmptyPanel
            icon={ShieldCheck}
            title="当前没有高优先级风险任务"
            description="后续操作直接进入任务中心处理即可。"
            action={
              <button onClick={onOpenTasks} className="btn-primary">
                <FlowArrow size={16} />
                进入任务中心
              </button>
            }
          />
        ) : (
          <div className="mt-5 grid gap-3">
            {attentionTasks.map((task) => (
              <button key={task.id} onClick={() => onOpenTask(task.id)} className="rounded-3xl border border-line bg-white px-5 py-4 text-left transition hover:border-blue-200 hover:bg-blue-50/40">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-coal">{task.name}</span>
                  <StatusBadge status={task.status} />
                  <Badge tone={taskProcessTone(task.runtime?.processStatus)}>{taskProcessStatusText(task.runtime?.processStatus)}</Badge>
                  {taskAwaitingNode(task) && <Badge tone="yellow">待接管</Badge>}
                </div>
                <div className="mt-2 text-sm text-slate-500">
                  {task.runtime?.executionNodeName || task.runtime?.nodeId || "待分配"} · {task.runtime?.lastLogMessage || "暂无运行日志摘要"}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {formatDateTime(task.runtime?.lastLogAt || task.runtime?.updatedAt || task.updatedAt)}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DatasourcePage({
  datasources,
  tasks,
  canManage,
  onChanged,
  pushNotice,
  openCreateToken
}: {
  datasources: Datasource[];
  tasks: SyncTask[];
  canManage: boolean;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
  openCreateToken: number;
}) {
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | DatasourceStatus>("all");
  const [purposeFilter, setPurposeFilter] = useState<"all" | DatasourcePurpose>("all");
  const [selectedId, setSelectedId] = useState<string | null>(datasources[0]?.id ?? null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyDatasourceForm });
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  useEffect(() => {
    if (openCreateToken === 0) return;
    setEditorOpen(true);
    setEditingId(null);
    setForm({ ...emptyDatasourceForm });
  }, [openCreateToken]);

  useEffect(() => {
    if (datasources.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !datasources.some((item) => item.id === selectedId)) {
      setSelectedId(datasources[0].id);
    }
  }, [datasources, selectedId]);

  const visibleDatasources = datasources
    .filter((item) => {
      const matchesKeyword = !keyword.trim() || datasourceSearchText(item).includes(keyword.trim().toLowerCase());
      const matchesStatus = statusFilter === "all" || item.connectionStatus === statusFilter;
      const matchesPurpose = purposeFilter === "all" || item.purpose === purposeFilter;
      return matchesKeyword && matchesStatus && matchesPurpose;
    })
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));

  const selected = visibleDatasources.find((item) => item.id === selectedId) ?? visibleDatasources[0];

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...emptyDatasourceForm });
    setEditorOpen(true);
  };

  const openEdit = (item: Datasource) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      purpose: item.purpose,
      host: item.host,
      port: item.port,
      username: item.username,
      password: "",
      defaultSchema: item.defaultSchema || ""
    });
    setEditorOpen(true);
  };

  const saveDatasource = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage) {
      pushNotice({ tone: "warning", message: "新增和编辑数据源需要管理员权限" });
      return;
    }
    setSubmitting(true);
    try {
      if (editingId) {
        await api.updateDatasource(editingId, form);
        pushNotice({ tone: "success", message: "数据源已保存" });
      } else {
        await api.createDatasource(form);
        pushNotice({ tone: "success", message: "数据源已创建" });
      }
      setEditorOpen(false);
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "保存失败" });
    } finally {
      setSubmitting(false);
    }
  };

  const testConnection = async (item: Datasource) => {
    setTestingId(item.id);
    try {
      const tested = await api.testDatasource(item.id);
      pushNotice({
        tone: tested.connectionStatus === "online" ? "success" : "warning",
        message: tested.lastTestMessage || `${item.name} 已完成连接测试`
      });
      await onChanged(true);
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "连接测试失败" });
    } finally {
      setTestingId(null);
    }
  };

  const removeDatasource = async (item: Datasource) => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "删除数据源需要管理员权限" });
      return;
    }
    if (!window.confirm(`确认删除数据源“${item.name}”吗？`)) return;
    try {
      await api.deleteDatasource(item.id);
      pushNotice({ tone: "success", message: "数据源已删除" });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "删除失败" });
    }
  };

  const usageCount = (item: Datasource) => tasks.filter((task) => task.sourceDatasourceId === item.id || task.targetDatasourceId === item.id).length;
  const onlineCount = datasources.filter((item) => item.connectionStatus === "online").length;
  const offlineCount = datasources.filter((item) => item.connectionStatus === "offline").length;
  const untestedCount = datasources.filter((item) => item.connectionStatus === "untested").length;
  const sourceCount = datasources.filter((item) => item.purpose === "source").length;
  const targetCount = datasources.filter((item) => item.purpose === "target").length;
  const bothCount = datasources.filter((item) => item.purpose === "both").length;

  return (
    <div className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
      <section className="surface min-w-0 p-6">
        <SectionHeader
          title="数据源列表"
          description="常用操作保留在主路径。"
          action={canManage ? (
            <button onClick={openCreate} className="btn-primary">
              <Plus size={16} />
              添加数据源
            </button>
          ) : undefined}
        />

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricMini label="数据源总数" value={`${datasources.length}`} />
          <MetricMini label="在线" value={`${onlineCount}`} />
          <MetricMini label="离线" value={`${offlineCount}`} />
          <MetricMini label="未测试" value={`${untestedCount}`} />
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
          <label className="block">
            <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">搜索</span>
            <span className="relative block">
              <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                className="input pl-9"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="名称、地址、库名"
              />
            </span>
          </label>
          <Field label="状态">
            <select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | DatasourceStatus)}>
              <option value="all">全部状态</option>
              <option value="online">在线</option>
              <option value="offline">离线</option>
              <option value="untested">未测试</option>
            </select>
          </Field>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <Field label="用途">
            <select className="select" value={purposeFilter} onChange={(event) => setPurposeFilter(event.target.value as "all" | DatasourcePurpose)}>
              <option value="all">全部用途</option>
              <option value="source">源端</option>
              <option value="target">目标端</option>
              <option value="both">源端和目标端</option>
            </select>
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <FilterChip active={purposeFilter === "all"} onClick={() => setPurposeFilter("all")} label={`全部 ${datasources.length}`} />
            <FilterChip active={purposeFilter === "source"} onClick={() => setPurposeFilter("source")} label={`源端 ${sourceCount}`} />
            <FilterChip active={purposeFilter === "target"} onClick={() => setPurposeFilter("target")} label={`目标端 ${targetCount}`} />
            <FilterChip active={purposeFilter === "both"} onClick={() => setPurposeFilter("both")} label={`双向 ${bothCount}`} />
          </div>
        </div>

        {datasources.length === 0 ? (
          <EmptyPanel
            icon={Database}
            title="暂无数据源"
            description="添加数据源后，即可创建迁移、同步、校验等任务。"
            action={canManage ? (
              <button onClick={openCreate} className="btn-primary">
                <Plus size={16} />
                添加数据源
              </button>
            ) : <PermissionNotice compact description="当前角色可查看和测试连接；新增数据源需要管理员权限。" />}
          />
        ) : (
          <div className="table-shell mt-5">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">名称</th>
                  <th className="px-4 py-3">用途</th>
                  <th className="px-4 py-3">连接</th>
                  <th className="px-4 py-3">地址</th>
                  <th className="px-4 py-3">任务</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleDatasources.map((item) => (
                  <tr key={item.id} className="table-row hover:bg-slate-50/70">
                    <td className="px-4 py-4">
                      <button onClick={() => setSelectedId(item.id)} className="text-left">
                        <div className="font-medium text-coal">{item.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.defaultSchema || "未设置默认库"}</div>
                      </button>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{purposeText(item.purpose)}</td>
                    <td className="px-4 py-4">
                      <Badge tone={datasourceTone(item.connectionStatus)}>
                        {datasourceStatusText(item.connectionStatus)}
                      </Badge>
                    </td>
                    <td className="px-4 py-4">
                      <div className="mono text-slate-700">{item.host}:{item.port}</div>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{usageCount(item)}</td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => void testConnection(item)}
                          disabled={testingId === item.id}
                          className="btn-secondary px-3 py-2 text-xs"
                        >
                          {testingId === item.id ? <ArrowsClockwise size={14} /> : <ShieldCheck size={14} />}
                          {testingId === item.id ? "测试中" : "测试连接"}
                        </button>
                        <button
                          onClick={() => openEdit(item)}
                          disabled={!canManage}
                          className="btn-secondary px-3 py-2 text-xs"
                        >
                          <PencilSimple size={14} />
                          编辑
                        </button>
                        <ActionMenu
                          items={[
                            {
                              label: "删除",
                              danger: true,
                              disabled: !canManage,
                              onSelect: () => void removeDatasource(item)
                            }
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="space-y-5">
        <section className="surface p-6">
          <SectionHeader title="当前数据源" description="连接状态和使用范围。" />
          {selected ? (
            <div className="mt-5 grid gap-3">
              <DetailCard label="名称" value={selected.name} />
              <DetailCard label="用途" value={purposeText(selected.purpose)} />
              <DetailCard label="连接状态" value={datasourceStatusText(selected.connectionStatus)} />
              <DetailCard label="地址" value={`${selected.host}:${selected.port}`} mono />
              <DetailCard label="默认库" value={selected.defaultSchema || "未设置"} mono />
              <DetailCard label="最近测试" value={`${formatDateTime(selected.lastTestedAt)}${selected.lastTestMessage ? ` · ${selected.lastTestMessage}` : ""}`} />
              <DetailCard label="关联任务" value={`${usageCount(selected)} 条`} />
            </div>
          ) : (
            <div className="mt-5 text-sm text-slate-500">选择一条数据源查看详情。</div>
          )}
        </section>

        {!canManage && (
          <PermissionNotice
            compact
            description="当前角色可查看和测试连接；新增、编辑、删除数据源需要管理员权限。"
          />
        )}
      </div>

      <Modal
        open={editorOpen}
        title={editingId ? "编辑数据源" : "添加数据源"}
        description={editingId ? "保持字段简洁，只保留任务创建必需信息。" : "添加数据源后，即可创建迁移、同步、校验等任务。"}
        onClose={() => setEditorOpen(false)}
      >
        <form onSubmit={saveDatasource} className="grid gap-4">
          <Field label="名称">
            <input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </Field>
          <Field label="用途">
            <select className="select" value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value as DatasourcePurpose })}>
              <option value="source">源端</option>
              <option value="target">目标端</option>
              <option value="both">源端和目标端</option>
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_130px]">
            <Field label="主机地址">
              <input className="input" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} required />
            </Field>
            <Field label="端口">
              <input className="input" type="number" value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} required />
            </Field>
          </div>
          <Field label="账号">
            <input className="input" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
          </Field>
          <Field label="密码">
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required={!editingId}
              placeholder={editingId ? "留空表示不修改" : ""}
            />
          </Field>
          <Field label="默认库">
            <input className="input" value={form.defaultSchema} onChange={(event) => setForm({ ...form, defaultSchema: event.target.value })} />
          </Field>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setEditorOpen(false)} className="btn-secondary">
              取消
            </button>
            <button disabled={submitting} className="btn-primary">
              {submitting ? <ArrowsClockwise size={16} /> : <CheckCircle size={16} />}
              {submitting ? "保存中" : "保存"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function TasksPage({
  datasources,
  tasks,
  capabilityJobs,
  errors,
  cluster,
  canManage,
  onChanged,
  pushNotice,
  openCreateToken,
  onCreateDatasource,
  onOpenNode,
  focusedTaskId
}: {
  datasources: Datasource[];
  tasks: SyncTask[];
  capabilityJobs: CapabilityJob[];
  errors: ErrorEvent[];
  cluster: ClusterSnapshot | null;
  canManage: boolean;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
  openCreateToken: number;
  onCreateDatasource: () => void;
  onOpenNode: (nodeID: string) => void;
  focusedTaskId: string | null;
}) {
  const visibleCapabilityJobs = capabilityJobs.filter((job) => job.type !== "subscription");
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState<TaskStateFilter>("all");
  const [hostingFilter, setHostingFilter] = useState<"all" | "local" | "remote" | "unassigned">("all");
  const [showCapabilityJobs, setShowCapabilityJobs] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [qualityDiffs, setQualityDiffs] = useState<Array<{ id: string; sourceTable: string; targetTable: string; fieldName: string; status: string; severity: string }>>([]);
  const [structureItems, setStructureItems] = useState<Array<{ id: string; sourceObject: string; targetObject: string; changeType: string; status: string; riskLevel: string }>>([]);

  useEffect(() => {
    if (openCreateToken === 0) return;
    setCreatorOpen(true);
  }, [openCreateToken]);

  const workloads = showCapabilityJobs ? buildWorkloads(tasks, visibleCapabilityJobs) : buildTaskItems(tasks);
  const filtered = workloads.filter((item) => {
    const matchesKeyword = !keyword.trim() || `${item.title} ${item.detail} ${item.type}`.toLowerCase().includes(keyword.trim().toLowerCase());
    const matchesType = typeFilter === "all" || item.type === typeFilter;
    const matchesState = item.rawTask
      ? stateFilter === "all"
        || (stateFilter === "running" && (item.rawTask.status === "full_syncing" || item.rawTask.status === "incremental_running"))
        || (stateFilter === "awaiting" && taskAwaitingNode(item.rawTask))
        || (stateFilter === "remote" && item.rawTask.runtime?.managedByLocalNode === false)
        || (stateFilter === "failed" && item.rawTask.status === "failed")
        || (stateFilter === "stopped" && item.rawTask.status === "stopped")
      : stateFilter === "all";
    const matchesHosting = item.rawTask
      ? hostingFilter === "all"
        || (hostingFilter === "local" && item.rawTask.runtime?.managedByLocalNode !== false && Boolean(item.rawTask.runtime?.nodeId))
        || (hostingFilter === "remote" && item.rawTask.runtime?.managedByLocalNode === false)
        || (hostingFilter === "unassigned" && !item.rawTask.runtime?.nodeId)
      : hostingFilter === "all";
    return matchesKeyword && matchesType && matchesState && matchesHosting;
  });
  const selected = filtered.find((item) => item.key === selectedKey) ?? filtered[0];

  useEffect(() => {
    if (!focusedTaskId) return;
    setSelectedKey(`sync:${focusedTaskId}`);
  }, [focusedTaskId]);

  useEffect(() => {
    if (filtered.length === 0) {
      setSelectedKey(null);
      return;
    }
    if (!selectedKey || !filtered.some((item) => item.key === selectedKey)) {
      setSelectedKey(filtered[0].key);
    }
  }, [filtered, selectedKey]);

  useEffect(() => {
    if (!selected?.rawJob) {
      setQualityDiffs([]);
      setStructureItems([]);
      return;
    }
    if (selected.rawJob.type === "quality") {
      api.qualityDiffs(selected.rawJob.id)
        .then((items) => {
          setQualityDiffs(items.slice(0, 6).map((item) => ({
            id: item.id,
            sourceTable: item.sourceTable,
            targetTable: item.targetTable,
            fieldName: item.fieldName,
            status: item.status,
            severity: item.severity
          })));
        })
        .catch(() => setQualityDiffs([]));
      setStructureItems([]);
      return;
    }
    if (selected.rawJob.type === "structure") {
      api.structureDDLs(selected.rawJob.id)
        .then((items) => {
          setStructureItems(items.slice(0, 6).map((item) => ({
            id: item.id,
            sourceObject: item.sourceObject,
            targetObject: item.targetObject,
            changeType: item.changeType,
            status: item.status,
            riskLevel: item.riskLevel
          })));
        })
        .catch(() => setStructureItems([]));
      setQualityDiffs([]);
      return;
    }
    setQualityDiffs([]);
    setStructureItems([]);
  }, [selected]);

  const runTaskAction = async (task: SyncTask, action: "start" | "pause" | "resume" | "stop") => {
    setBusyKey(`${task.id}:${action}`);
    try {
      const updated = await api.taskAction(task.id, action);
      pushNotice({ tone: "success", message: taskActionNotice(updated, action) });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "任务操作失败" });
    } finally {
      setBusyKey(null);
    }
  };

  const rerunTask = async (task: SyncTask) => {
    setBusyKey(`${task.id}:rerun`);
    try {
      const result = await api.rerunTask(task.id);
      const message = result.task?.runtime?.processStatus === "awaiting_takeover" || taskAwaitingNode(result.task)
        ? "任务已重跑，等待节点接管"
        : "任务已重跑";
      pushNotice({ tone: "success", message });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "重跑失败" });
    } finally {
      setBusyKey(null);
    }
  };

  const deleteTask = async (task: SyncTask) => {
    if (!window.confirm(`确认删除任务“${task.name}”吗？`)) return;
    setBusyKey(`${task.id}:delete`);
    try {
      await api.deleteTask(task.id);
      pushNotice({ tone: "success", message: "任务已删除" });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "删除失败" });
    } finally {
      setBusyKey(null);
    }
  };

  const rerunJob = async (job: CapabilityJob) => {
    setBusyKey(`${job.id}:job`);
    try {
      await api.runCapabilityJob(job.id);
      pushNotice({ tone: "success", message: "治理任务已启动" });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "启动失败" });
    } finally {
      setBusyKey(null);
    }
  };

  const pendingErrors = errors.filter((item) => item.status === "pending").length;
  const awaitingTasks = tasks.filter(taskAwaitingNode).length;
  const typeCounts = filteredTypeCounts(workloads);
  const stateCounts = {
    running: tasks.filter((task) => task.status === "full_syncing" || task.status === "incremental_running").length,
    awaiting: awaitingTasks,
    remote: tasks.filter((task) => task.runtime?.managedByLocalNode === false).length,
    failed: tasks.filter((task) => task.status === "failed").length,
    stopped: tasks.filter((task) => task.status === "stopped").length
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[0.88fr_1.12fr]">
      <section className="surface min-w-0 p-6">
        <SectionHeader
          title="同步任务"
          description="同步任务是主线，校验、订正和结构对比默认挂在对应同步任务下。"
          action={canManage ? (
            <button onClick={() => setCreatorOpen(true)} className="btn-primary">
              <Plus size={16} />
              创建任务
            </button>
          ) : undefined}
        />

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricMini label="同步任务" value={`${tasks.length}`} />
          <MetricMini label="治理任务" value={`${visibleCapabilityJobs.length}`} />
          <MetricMini label="运行中" value={`${tasks.filter((task) => task.status === "full_syncing" || task.status === "incremental_running").length + visibleCapabilityJobs.filter((job) => job.status === "running").length}`} />
          <MetricMini label="待处理错误" value={`${pendingErrors}`} />
        </div>

        <div className="mt-5 flex flex-col gap-3 rounded-3xl border border-line bg-slate-50/70 p-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-sm font-medium text-coal">列表视角</div>
            <div className="mt-1 text-sm text-slate-500">
              默认只展示同步任务，避免一条链路拆成多条重复列表项。
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterChip active={!showCapabilityJobs} onClick={() => setShowCapabilityJobs(false)} label="只看同步任务" />
            <FilterChip active={showCapabilityJobs} onClick={() => setShowCapabilityJobs(true)} label={`显示扩展任务 ${visibleCapabilityJobs.length}`} />
          </div>
        </div>

        {awaitingTasks > 0 && (
          <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
            当前有 {awaitingTasks} 条任务等待节点接管。优先检查节点在线状态、容量和排空中的任务迁移结果。
          </div>
        )}

        {!showCapabilityJobs && visibleCapabilityJobs.length > 0 && (
          <div className="mt-5 rounded-3xl border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-800">
            已将 {visibleCapabilityJobs.length} 条扩展任务收进对应同步任务详情，主列表只保留真正需要操作的同步链路。
          </div>
        )}

        <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_180px_180px_180px]">
          <label className="block">
            <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">搜索</span>
            <span className="relative block">
              <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                className="input pl-9"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="名称、类型、数据源"
              />
            </span>
          </label>
          <Field label="类型">
            <select className="select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">全部类型</option>
              {Object.keys(typeCounts).map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </Field>
          <Field label="运行视角">
            <select className="select" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as TaskStateFilter)}>
              <option value="all">全部状态</option>
              <option value="running">运行中</option>
              <option value="awaiting">待接管</option>
              <option value="remote">远程托管</option>
              <option value="failed">异常</option>
              <option value="stopped">已停止</option>
            </select>
          </Field>
          <Field label="托管范围">
            <select className="select" value={hostingFilter} onChange={(event) => setHostingFilter(event.target.value as "all" | "local" | "remote" | "unassigned")}>
              <option value="all">全部任务</option>
              <option value="local">当前节点托管</option>
              <option value="remote">远程节点托管</option>
              <option value="unassigned">待分配</option>
            </select>
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
          <span className="rounded-full border border-line bg-slate-50 px-3 py-1.5">运行中 {stateCounts.running}</span>
          <span className="rounded-full border border-line bg-slate-50 px-3 py-1.5">待接管 {stateCounts.awaiting}</span>
          <span className="rounded-full border border-line bg-slate-50 px-3 py-1.5">远程托管 {stateCounts.remote}</span>
          <span className="rounded-full border border-line bg-slate-50 px-3 py-1.5">异常 {stateCounts.failed}</span>
          <span className="rounded-full border border-line bg-slate-50 px-3 py-1.5">已停止 {stateCounts.stopped}</span>
        </div>

        {datasources.length === 0 ? (
          <EmptyPanel
            icon={Database}
            title="先添加数据源"
            description="没有数据源时，不展示空表格。先准备源端和目标端，再创建任务。"
            action={
              <button onClick={onCreateDatasource} className="btn-primary">
                <Plus size={16} />
                添加数据源
              </button>
            }
          />
        ) : workloads.length === 0 ? (
          <EmptyPanel
            icon={ClipboardText}
            title="暂无任务"
            description="创建一个任务开始使用。"
            action={canManage ? (
              <button onClick={() => setCreatorOpen(true)} className="btn-primary">
                <Plus size={16} />
                创建任务
              </button>
            ) : <PermissionNotice compact description="当前角色可查看任务运行态；新增任务需要管理员权限。" />}
          />
        ) : (
          <div className="mt-5 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-white">
            {filtered.map((item) => {
              const task = item.rawTask;
              const job = item.rawJob;
              const primaryAction = task ? taskPrimaryAction(task) : null;
              const executionNode = task?.runtime?.executionNodeName || task?.runtime?.nodeId;
              return (
                <div key={item.key} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                  <button onClick={() => setSelectedKey(item.key)} className="min-w-0 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-coal">{item.title}</span>
                      <TypeBadge type={item.type} />
                      {task && <StatusBadge status={task.status} />}
                      {task && taskAwaitingNode(task) && <Badge tone="yellow">待接管</Badge>}
                      {task && <Badge tone={taskProcessTone(task.runtime?.processStatus)}>{taskProcessStatusText(task.runtime?.processStatus)}</Badge>}
                      {task && task.runtime?.managedByLocalNode === false && <Badge tone="yellow">远程托管</Badge>}
                      {job && <Badge tone={capabilityJobTone(job.status)}>{capabilityJobStatusText(job.status)}</Badge>}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
                    {task && (
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span className="rounded-full border border-line bg-slate-50 px-2 py-1">
                          {executionNode ? `节点 ${executionNode}` : "待分配节点"}
                        </span>
                        <span className="rounded-full border border-line bg-slate-50 px-2 py-1">
                          {task.runtime?.localLogAccessible === false ? "切换节点看日志" : "本地可看日志"}
                        </span>
                      </div>
                    )}
                    {task && (
                      <div className="mt-2 rounded-2xl border border-line bg-slate-50/80 px-3 py-2 text-xs text-slate-600">
                        {task.runtime?.lastLogMessage || "暂无运行日志摘要，右侧详情已把实时日志置顶。"}
                      </div>
                    )}
                    <div className="mt-2 text-xs text-slate-500">{formatDate(item.updatedAt)}</div>
                  </button>
                  <div className="flex flex-wrap justify-end gap-2">
                    {task && primaryAction && (
                      <button
                        onClick={() => void runTaskAction(task, primaryAction)}
                        disabled={busyKey === `${task.id}:${primaryAction}`}
                        className="btn-secondary px-3 py-2 text-xs"
                      >
                        {primaryAction === "start" || primaryAction === "resume" ? <Play size={14} /> : primaryAction === "pause" ? <Pause size={14} /> : <Stop size={14} />}
                        {taskActionLabel(primaryAction)}
                      </button>
                    )}
                    {job && (
                      <button
                        onClick={() => void rerunJob(job)}
                        disabled={job.status === "running" || busyKey === `${job.id}:job`}
                        className="btn-secondary px-3 py-2 text-xs"
                      >
                        <Play size={14} />
                        {job.status === "running" ? "运行中" : "重跑"}
                      </button>
                    )}
                    <ActionMenu
                      items={task ? [
                        { label: "重跑", onSelect: () => void rerunTask(task), disabled: !(task.status === "stopped" || task.status === "failed") },
                        { label: "删除", onSelect: () => void deleteTask(task), danger: true, disabled: !canManage }
                      ] : []}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="space-y-5">
        <section className="surface p-6">
          <SectionHeader title={selected?.rawJob ? "扩展任务详情" : "任务详情"} description="运行日志默认置顶，配置和轨迹放到后面。" />
          {!selected ? (
            <div className="mt-5 text-sm text-slate-500">选择一条任务查看详情。</div>
          ) : selected.rawTask ? (
            <SyncTaskDetail
              task={selected.rawTask}
              relatedJobs={visibleCapabilityJobs.filter((job) => job.taskId === selected.rawTask!.id)}
              errors={errors}
              cluster={cluster}
              canManage={canManage}
              onOpenNode={onOpenNode}
              onRunJob={(job) => void rerunJob(job)}
              busyActionKey={busyKey}
              onChanged={onChanged}
              pushNotice={pushNotice}
            />
          ) : selected.rawJob ? (
            <CapabilityJobDetail job={selected.rawJob} qualityDiffs={qualityDiffs} structureItems={structureItems} tasks={tasks} />
          ) : null}
        </section>
        {!canManage && (
          <PermissionNotice compact description="当前角色可查看运行态和执行结果；新建、删除和修改任务需要管理员权限。" />
        )}
      </div>

      <TaskCreatorModal
        open={creatorOpen}
        datasources={datasources}
        tasks={tasks}
        canManage={canManage}
        onClose={() => setCreatorOpen(false)}
        onChanged={onChanged}
        pushNotice={pushNotice}
      />
    </div>
  );
}

function handoffTitle(kind: ClusterHandoffReport["kind"]) {
  if (kind === "drain") return "排空结果";
  if (kind === "drill") return "故障演练结果";
  if (kind === "offline") return "节点下线结果";
  if (kind === "online") return "节点上线结果";
  return "重新均衡结果";
}

function handoffTrackTitle(kind: ClusterHandoffReport["kind"]) {
  if (kind === "drill") return "故障切换路径";
  if (kind === "drain") return "排空迁移路径";
  if (kind === "offline") return "下线迁移路径";
  if (kind === "online") return "上线接管路径";
  return "任务重新分布";
}

function fromDrainReport(report: NodeDrainReport): ClusterHandoffReport {
  return {
    id: report.id,
    kind: "drain",
    happenedAt: report.drainedAt,
    node: report.node,
    success: report.success,
    message: report.message,
    affectedTasks: report.affectedTasks,
    before: report.before,
    after: report.after
  };
}

function fromFailoverDrillReport(report: FailoverDrillReport): ClusterHandoffReport {
  return {
    id: report.id,
    kind: "drill",
    happenedAt: report.drilledAt,
    node: report.node,
    success: report.success,
    message: report.message,
    affectedTasks: report.affectedTasks,
    before: report.before,
    after: report.after
  };
}

function fromRebalanceReport(report: ClusterRebalanceReport): ClusterHandoffReport {
  return {
    id: report.id,
    kind: "rebalance",
    happenedAt: report.rebalancedAt,
    success: report.success,
    message: report.message,
    affectedTasks: report.movedTasks,
    before: report.before,
    after: report.after
  };
}

function fromNodeStatusChangeResult(report: NodeStatusChangeResult): ClusterHandoffReport {
  return {
    id: report.id,
    kind: report.action,
    happenedAt: report.changedAt,
    node: report.node,
    success: report.success,
    message: report.message,
    affectedTasks: report.affectedTasks,
    before: report.before,
    after: report.after
  };
}

function NodesPage({
  cluster,
  tasks,
  logs,
  canManage,
  onChanged,
  pushNotice,
  openCreateToken,
  focusedNodeId,
  onOpenTask
}: {
  cluster: ClusterSnapshot | null;
  tasks: SyncTask[];
  logs: OperationLog[];
  canManage: boolean;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
  openCreateToken: number;
  focusedNodeId: string | null;
  onOpenTask: (taskID: string) => void;
}) {
  const nodes = cluster?.nodes ?? emptyNodes;
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ClusterNode["status"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(nodes[0]?.id ?? null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [operationResult, setOperationResult] = useState<NodeOperationResult | null>(null);
  const [handoffReport, setHandoffReport] = useState<ClusterHandoffReport | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const localNodeId = cluster?.localNodeId;
  const localNodeName = cluster?.localNodeName || localNodeId;
  const awaitingTasks = tasks.filter(taskAwaitingNode);

  useEffect(() => {
    if (openCreateToken === 0) return;
    setCreatorOpen(true);
  }, [openCreateToken]);

  useEffect(() => {
    if (!focusedNodeId) return;
    setSelectedId(focusedNodeId);
  }, [focusedNodeId]);

  const visibleNodes = nodes.filter((node) => {
    const matchesKeyword = !keyword.trim()
      || `${node.name} ${node.endpoint} ${node.zone} ${node.role} ${node.installDir}`.toLowerCase().includes(keyword.trim().toLowerCase());
    const matchesStatus = statusFilter === "all" || node.status === statusFilter;
    return matchesKeyword && matchesStatus;
  });

  useEffect(() => {
    if (visibleNodes.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visibleNodes.some((item) => item.id === selectedId)) {
      setSelectedId(visibleNodes[0].id);
    }
  }, [selectedId, visibleNodes]);

  const selected = visibleNodes.find((item) => item.id === selectedId) ?? visibleNodes[0];
  const taskByNodeId = new Map<string, SyncTask[]>();
  tasks.forEach((task) => {
    if (!task.runtime?.nodeId) return;
    const list = taskByNodeId.get(task.runtime.nodeId) || [];
    list.push(task);
    taskByNodeId.set(task.runtime.nodeId, list);
  });
  const nodeName = (nodeID?: string) => {
    if (!nodeID) return "待分配";
    return nodes.find((node) => node.id === nodeID)?.name || nodeID;
  };
  const nodeEvents = selected
    ? logs.filter((log) => {
      if (log.targetType === "cluster_node" && log.targetId === selected.id) {
        return true;
      }
      if (log.targetType === "sync_task") {
        return log.detail.includes(selected.id) || log.detail.includes(selected.name);
      }
      return false;
    }).slice(0, 8)
    : [];

  const runQuickAction = async (node: ClusterNode, action: "upgrade" | "uninstall") => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "节点运维需要管理员权限" });
      return;
    }
    setBusyKey(`${node.id}:${action}`);
    try {
      const result = action === "upgrade" ? await api.upgradeNode(node.id) : await api.uninstallNode(node.id);
      setOperationResult(result);
      pushNotice({ tone: result.success ? "success" : "warning", message: result.message });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "节点操作失败" });
    } finally {
      setBusyKey(null);
    }
  };

  const runMoreAction = async (node: ClusterNode, action: "drain" | "offline" | "online" | "drill") => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "节点运维需要管理员权限" });
      return;
    }
    setBusyKey(`${node.id}:${action}`);
    try {
      if (action === "drain") {
        const report = await api.drainNode(node.id);
        setHandoffReport(fromDrainReport(report));
        pushNotice({ tone: report.success ? "success" : "warning", message: report.message });
      } else if (action === "drill") {
        const report = await api.failoverDrill(node.id);
        setHandoffReport(fromFailoverDrillReport(report));
        pushNotice({ tone: report.success ? "success" : "warning", message: report.message });
      } else {
        const result = await api.nodeAction(node.id, action);
        if ("affectedTasks" in result) {
          setHandoffReport(fromNodeStatusChangeResult(result));
          pushNotice({ tone: result.success ? "success" : "warning", message: result.message });
        } else {
          pushNotice({ tone: "success", message: action === "online" ? "节点已上线" : "节点已下线" });
        }
      }
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "节点操作失败" });
    } finally {
      setBusyKey(null);
    }
  };

  const rebalanceCluster = async () => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "节点运维需要管理员权限" });
      return;
    }
    setBusyKey("rebalance");
    try {
      const report = await api.rebalanceCluster();
      setHandoffReport(fromRebalanceReport(report));
      pushNotice({ tone: report.success ? "success" : "warning", message: report.message });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "集群均衡失败" });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
      <section className="surface min-w-0 p-6">
        <SectionHeader
          title="节点列表"
          description={localNodeName ? `当前控制节点：${localNodeName}` : "部署、升级、卸载都在页面完成。"}
          action={canManage ? (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void rebalanceCluster()} disabled={busyKey === "rebalance"} className="btn-secondary">
                <ArrowsClockwise size={16} />
                {busyKey === "rebalance" ? "均衡中" : "重新均衡"}
              </button>
              <button onClick={() => setCreatorOpen(true)} className="btn-primary">
                <Plus size={16} />
                添加节点
              </button>
            </div>
          ) : undefined}
        />

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricMini label="节点总数" value={`${cluster?.totalNodes ?? 0}`} />
          <MetricMini label="在线节点" value={`${cluster?.onlineNodes ?? 0}`} />
          <MetricMini label="运行任务" value={`${tasks.filter((task) => task.runtime?.nodeId).length}`} />
          <MetricMini label="待接管" value={`${awaitingTasks.length}`} />
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <label className="block">
            <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">搜索</span>
            <span className="relative block">
              <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                className="input pl-9"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="节点名、地址、角色"
              />
            </span>
          </label>
          <Field label="状态">
            <select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | ClusterNode["status"])}>
              <option value="all">全部状态</option>
              <option value="online">在线</option>
              <option value="draining">排空中</option>
              <option value="offline">离线</option>
            </select>
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <FilterChip active={statusFilter === "all"} onClick={() => setStatusFilter("all")} label={`全部 ${nodes.length}`} />
          <FilterChip active={statusFilter === "online"} onClick={() => setStatusFilter("online")} label={`在线 ${nodes.filter((node) => node.status === "online").length}`} />
          <FilterChip active={statusFilter === "draining"} onClick={() => setStatusFilter("draining")} label={`排空中 ${nodes.filter((node) => node.status === "draining").length}`} />
          <FilterChip active={statusFilter === "offline"} onClick={() => setStatusFilter("offline")} label={`离线 ${nodes.filter((node) => node.status === "offline").length}`} />
        </div>

        {nodes.length === 0 ? (
          <EmptyPanel
            icon={HardDrives}
            title="暂无节点"
            description="填写机器信息并测试连接后，即可部署第一个节点。"
            action={canManage ? (
              <button onClick={() => setCreatorOpen(true)} className="btn-primary">
                <Plus size={16} />
                添加节点
              </button>
            ) : <PermissionNotice compact description="当前角色可查看节点状态；部署、升级、卸载节点需要管理员权限。" />}
          />
        ) : (
          <div className="mt-5 grid gap-4">
            {visibleNodes.map((node) => {
              const isCurrentNode = localNodeId === node.id;
              return (
                <div key={node.id} className="rounded-3xl border border-line bg-white p-4">
                  <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-start">
                    <button onClick={() => setSelectedId(node.id)} className="min-w-0 text-left">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-coal">{node.name}</div>
                        <Badge tone={nodeTone(node.status)}>{nodeStatusText(node.status)}</Badge>
                        {isCurrentNode && <Badge tone="blue">当前节点</Badge>}
                        <div className="chip border-slate-200 bg-slate-50 text-slate-600">{node.version}</div>
                      </div>
                      <div className="mt-1 text-sm text-slate-500">{node.endpoint} · {node.installDir}</div>
                      <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-4">
                        <span>SSH {node.sshUser}@{node.sshPort}</span>
                        <span>任务 {node.runningTasks}/{node.capacity}</span>
                        <span>CPU {node.cpuPercent}%</span>
                        <span>内存 {node.memoryPercent}%</span>
                      </div>
                      {isCurrentNode && (
                        <div className="mt-3 text-xs text-slate-500">
                          当前控制节点支持查看、升级和排空，不支持从本机控制台执行下线、卸载或故障演练。
                        </div>
                      )}
                    </button>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        onClick={() => void runQuickAction(node, "upgrade")}
                        disabled={!canManage || busyKey === `${node.id}:upgrade`}
                        className="btn-secondary px-3 py-2 text-xs"
                      >
                        <ArrowsClockwise size={14} />
                        升级
                      </button>
                      <button
                        onClick={() => void runQuickAction(node, "uninstall")}
                        disabled={!canManage || isCurrentNode || busyKey === `${node.id}:uninstall`}
                        className="btn-danger px-3 py-2 text-xs"
                      >
                        <Trash size={14} />
                        卸载
                      </button>
                      <ActionMenu
                        items={[
                          { label: "维护排空", onSelect: () => void runMoreAction(node, "drain"), disabled: !canManage || node.status === "offline" },
                          { label: node.status === "online" ? "手动下线" : "恢复上线", onSelect: () => void runMoreAction(node, node.status === "online" ? "offline" : "online"), disabled: !canManage || (isCurrentNode && node.status === "online") },
                          { label: "故障演练", onSelect: () => void runMoreAction(node, "drill"), disabled: !canManage || node.status !== "online" || isCurrentNode }
                        ]}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="space-y-5">
        <section className="surface p-6">
          <SectionHeader title="节点详情" description="查看版本、SSH 与承载任务。" />
          {selected ? (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-semibold text-coal">{selected.name}</span>
                <Badge tone={nodeTone(selected.status)}>{nodeStatusText(selected.status)}</Badge>
                {localNodeId === selected.id && <Badge tone="blue">当前节点</Badge>}
              </div>
              <div className="grid gap-3">
                <DetailCard label="主机地址" value={selected.endpoint} mono />
                <DetailCard label="SSH" value={`${selected.sshUser}@${selected.sshPort} · ${selected.authMode === "private_key" ? "私钥" : "密码"}`} mono />
                <DetailCard label="安装目录" value={selected.installDir} mono />
                <DetailCard label="版本" value={selected.version} mono />
                <DetailCard label="最近心跳" value={`${formatDateTime(selected.lastHeartbeatAt)} · ${secondsSince(selected.lastHeartbeatAt)} 秒前`} />
                <DetailCard label="运行任务" value={`${selected.runningTasks}/${selected.capacity}`} />
                <DetailCard label="控制节点" value={localNodeId === selected.id ? "是" : "否"} />
              </div>
              {localNodeId === selected.id && (
                <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                  当前控制节点负责提供 Web UI、API 和本地任务进程管理。请在其他节点控制台执行本节点卸载、下线或故障演练。
                </div>
              )}
              <div className="rounded-3xl border border-line bg-slate-50/70 p-4">
                <div className="text-sm font-medium text-coal">承载任务</div>
                <div className="mt-3 grid gap-2">
                  {(taskByNodeId.get(selected.id) || []).length === 0 ? (
                    <div className="text-sm text-slate-500">当前没有承载运行中任务。</div>
                  ) : (taskByNodeId.get(selected.id) || []).map((task) => (
                    <div key={task.id} className="rounded-2xl border border-line bg-white px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-coal">{task.name}</div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={task.status} />
                          <Badge tone={taskProcessTone(task.runtime?.processStatus)}>{taskProcessStatusText(task.runtime?.processStatus)}</Badge>
                        </div>
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {(task.sourceDatasource?.name || task.sourceDatasourceId)} to {(task.targetDatasource?.name || task.targetDatasourceId)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span className="rounded-full border border-line bg-slate-50 px-2 py-1">
                          {task.runtime?.managedByLocalNode === false ? "远程托管" : "当前节点托管"}
                        </span>
                        <span className="rounded-full border border-line bg-slate-50 px-2 py-1">
                          {task.runtime?.processId ? `PID ${task.runtime.processId}` : "无本地 PID"}
                        </span>
                        <span className="rounded-full border border-line bg-slate-50 px-2 py-1">
                          {task.runtime?.binlogFile ? `${task.runtime.binlogFile}:${task.runtime.binlogPosition}` : "无位点"}
                        </span>
                      </div>
                      {task.runtime?.lastLogMessage && (
                        <div className="mt-2 rounded-2xl border border-line bg-slate-50/70 px-3 py-3 text-xs text-slate-600">
                          {task.runtime.lastLogMessage}
                        </div>
                      )}
                      <div className="mt-3 flex justify-end">
                        <button type="button" onClick={() => onOpenTask(task.id)} className="btn-secondary px-3 py-2 text-xs">
                          <FlowArrow size={14} />
                          查看任务
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-5 text-sm text-slate-500">选择一个节点查看详情。</div>
          )}
        </section>
        {selected && (
          <section className="surface p-6">
            <SectionHeader title="待接管任务" description="当前没有承载节点、需要重新接管的任务。" />
            <div className="mt-4 grid gap-3">
              {awaitingTasks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line bg-slate-50/70 px-4 py-6 text-sm text-slate-500">
                  当前没有待接管任务。
                </div>
              ) : awaitingTasks.slice(0, 6).map((task) => (
                <div key={task.id} className="rounded-2xl border border-line bg-white px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-coal">{task.name}</div>
                    <Badge tone="yellow">待接管</Badge>
                  </div>
                  <div className="mt-2 text-sm text-slate-500">
                    {(task.sourceDatasource?.name || task.sourceDatasourceId)} to {(task.targetDatasource?.name || task.targetDatasourceId)}
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button type="button" onClick={() => onOpenTask(task.id)} className="btn-secondary px-3 py-2 text-xs">
                      <FlowArrow size={14} />
                      查看任务
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        {selected && (
          <section className="surface p-6">
            <SectionHeader title="最近运维事件" description="围绕当前节点的操作和任务迁移。" />
            <div className="mt-4 grid gap-3">
              {nodeEvents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line bg-slate-50/70 px-4 py-6 text-sm text-slate-500">
                  当前没有可展示的节点运维事件。
                </div>
              ) : nodeEvents.map((log) => (
                <div key={log.id} className="rounded-2xl border border-line bg-white px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={log.targetType === "cluster_node" ? "blue" : "yellow"}>{log.action}</Badge>
                    <span className="text-xs text-slate-500">{formatDateTime(log.createdAt)}</span>
                  </div>
                  <div className="mt-2 text-sm text-coal">{log.detail}</div>
                  <div className="mt-2 text-xs text-slate-500">{log.actor}</div>
                </div>
              ))}
            </div>
          </section>
        )}
        {!canManage && (
          <PermissionNotice compact description="当前角色可查看节点状态；部署、升级、卸载节点需要管理员权限。" />
        )}
      </div>

      <NodeCreatorModal
        open={creatorOpen}
        canManage={canManage}
        onClose={() => setCreatorOpen(false)}
        onChanged={onChanged}
        pushNotice={pushNotice}
      />

      <Modal
        open={Boolean(handoffReport)}
        title={handoffReport ? handoffTitle(handoffReport.kind) : ""}
        description={handoffReport?.message || ""}
        onClose={() => setHandoffReport(null)}
      >
        {handoffReport && (
          <div className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <DetailCard label="发生时间" value={formatDateTime(handoffReport.happenedAt)} />
              <DetailCard label="在线节点" value={`${handoffReport.after.onlineNodes}/${handoffReport.after.totalNodes}`} />
              <DetailCard label="影响任务" value={`${handoffReport.affectedTasks.length} 条`} />
            </div>

            <div className="rounded-3xl border border-line bg-slate-50/70 p-4">
              <div className="text-sm font-medium text-coal">{handoffTrackTitle(handoffReport.kind)}</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div className="rounded-2xl border border-line bg-white px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {handoffReport.kind === "drill"
                      ? "故障节点"
                      : handoffReport.kind === "drain"
                        ? "排空节点"
                        : handoffReport.kind === "offline"
                          ? "下线节点"
                          : handoffReport.kind === "online"
                            ? "恢复节点"
                            : "原承载节点"}
                  </div>
                  <div className="mt-2 text-sm font-medium text-coal">
                    {handoffReport.node ? nodeName(handoffReport.node.id) : "多节点"}
                  </div>
                </div>
                <div className="hidden justify-center sm:flex">
                  <ArrowRight size={18} className="text-slate-400" />
                </div>
                <div className="rounded-2xl border border-line bg-white px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">接管结果</div>
                  <div className="mt-2 text-sm font-medium text-coal">
                    {handoffReport.affectedTasks.length === 0 ? "无任务迁移" : Array.from(new Set(handoffReport.affectedTasks.map((item) => nodeName(item.newNodeId)))).join(" / ")}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              {handoffReport.affectedTasks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-line bg-slate-50/70 px-4 py-6 text-center text-sm text-slate-500">
                  {handoffReport.kind === "rebalance"
                    ? "当前集群已经均衡，没有任务需要迁移。"
                    : handoffReport.kind === "online"
                      ? "节点已上线，当前没有待接管任务。"
                      : "当前节点没有承载任务，本次操作只更新节点状态。"}
                </div>
              ) : handoffReport.affectedTasks.map((item) => (
                <div key={item.taskId} className="rounded-3xl border border-line bg-white p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="font-medium text-coal">{item.taskName}</div>
                        <Badge tone={item.newNodeId ? "green" : "red"}>{item.newNodeId ? "已接管" : "待处理"}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="rounded-full border border-line bg-slate-50 px-2 py-1">{nodeName(item.previousNodeId)}</span>
                        <ArrowRight size={14} className="text-slate-400" />
                        <span className="rounded-full border border-line bg-slate-50 px-2 py-1">{nodeName(item.newNodeId)}</span>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-line bg-slate-50/70 px-4 py-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">恢复位点</div>
                      <div className="mt-2 mono text-coal">{item.recoveryBinlogFile}:{formatNumber(item.recoveryBinlogPosition)}</div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-4">
                    <DetailCard label="运行阶段" value={taskRuntimePhaseText(item.runtimePhase)} />
                    <DetailCard label="Lease" value={`${item.previousLeaseEpoch} -> ${item.leaseEpoch}`} mono />
                    <DetailCard label="延迟" value={`${item.recoveryDelaySeconds}s`} />
                    <DetailCard label="接管次数" value={`${item.takeoverCount}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(operationResult)}
        title={operationResult ? nodeActionTitle(operationResult.action) : ""}
        description={operationResult?.message || ""}
        onClose={() => setOperationResult(null)}
      >
        {operationResult && (
          <div className="grid gap-4">
            {operationResult.before && operationResult.after && (
              <div className="grid gap-3 sm:grid-cols-3">
                <DetailCard label="发生时间" value={formatDateTime(operationResult.finishedAt)} />
                <DetailCard label="在线节点" value={`${operationResult.after.onlineNodes}/${operationResult.after.totalNodes}`} />
                <DetailCard label="影响任务" value={`${operationResult.affectedTasks?.length || 0} 条`} />
              </div>
            )}

            {operationResult.affectedTasks && operationResult.affectedTasks.length > 0 && (
              <div className="rounded-3xl border border-line bg-slate-50/70 p-4">
                <div className="text-sm font-medium text-coal">
                  {operationResult.action === "upgrade" ? "升级前任务迁移" : "卸载前任务迁移"}
                </div>
                <div className="mt-3 grid gap-3">
                  {operationResult.affectedTasks.map((task) => (
                    <div key={task.taskId} className="rounded-2xl border border-line bg-white p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-medium text-coal">{task.taskName}</div>
                            <Badge tone={task.newNodeId ? "green" : "red"}>{task.newNodeId ? "已接管" : "待处理"}</Badge>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="rounded-full border border-line bg-slate-50 px-2 py-1">{nodeName(task.previousNodeId)}</span>
                            <ArrowRight size={14} className="text-slate-400" />
                            <span className="rounded-full border border-line bg-slate-50 px-2 py-1">{nodeName(task.newNodeId)}</span>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-line bg-slate-50/70 px-4 py-3">
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">恢复位点</div>
                          <div className="mt-2 mono text-coal">{task.recoveryBinlogFile}:{formatNumber(task.recoveryBinlogPosition)}</div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-4">
                        <DetailCard label="运行阶段" value={taskRuntimePhaseText(task.runtimePhase)} />
                        <DetailCard label="Lease" value={`${task.previousLeaseEpoch} -> ${task.leaseEpoch}`} mono />
                        <DetailCard label="延迟" value={`${task.recoveryDelaySeconds}s`} />
                        <DetailCard label="接管次数" value={`${task.takeoverCount}`} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-3">
              {operationResult.steps.map((step) => (
                <div key={step.key} className="rounded-2xl border border-line bg-slate-50/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-coal">{step.label}</div>
                    <Badge tone={step.status === "done" ? "green" : "red"}>{step.status === "done" ? "完成" : "失败"}</Badge>
                  </div>
                  <div className="mt-2 text-sm text-slate-500">{step.detail}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function SettingsPage({
  user,
  tasks,
  logs,
  runtimeConfig,
  alertRules,
  alertEvents,
  evaluations,
  canManage,
  onChanged,
  pushNotice
}: {
  user: User | null;
  tasks: SyncTask[];
  logs: OperationLog[];
  runtimeConfig: RuntimeConfig | null;
  alertRules: AlertRule[];
  alertEvents: AlertEvent[];
  evaluations: AlertRuleEvaluation[];
  canManage: boolean;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(alertRules[0]?.id ?? null);
  const editing = alertRules.find((item) => item.id === editingId) || null;
  const [form, setForm] = useState<AlertRuleInput>({
    name: "",
    enabled: true,
    taskId: "",
    delayThresholdSeconds: 300,
    errorThreshold: 1,
    webhookUrl: ""
  });

  useEffect(() => {
    if (!editing) {
      setForm({
        name: "",
        enabled: true,
        taskId: "",
        delayThresholdSeconds: 300,
        errorThreshold: 1,
        webhookUrl: ""
      });
      return;
    }
    setForm({
      name: editing.name,
      enabled: editing.enabled,
      taskId: editing.taskId || "",
      delayThresholdSeconds: editing.delayThresholdSeconds,
      errorThreshold: editing.errorThreshold,
      webhookUrl: editing.webhookUrl || ""
    });
  }, [editing]);

  const saveRule = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage) {
      pushNotice({ tone: "warning", message: "保存告警规则需要管理员权限" });
      return;
    }
    try {
      if (editing) {
        await api.updateAlertRule(editing.id, form);
        pushNotice({ tone: "success", message: "告警规则已保存" });
      } else {
        const created = await api.createAlertRule(form);
        setEditingId(created.id);
        pushNotice({ tone: "success", message: "告警规则已创建" });
      }
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "保存失败" });
    }
  };

  const removeRule = async () => {
    if (!editing) return;
    if (!canManage) {
      pushNotice({ tone: "warning", message: "删除告警规则需要管理员权限" });
      return;
    }
    if (!window.confirm(`确认删除规则“${editing.name}”吗？`)) return;
    try {
      await api.deleteAlertRule(editing.id);
      setEditingId(null);
      pushNotice({ tone: "success", message: "告警规则已删除" });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "删除失败" });
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[0.98fr_1.02fr]">
      <div className="space-y-5">
        <section className="surface p-6">
          <SectionHeader title="用户配置" description="当前登录用户与基础运行范围。" />
          <div className="mt-5 grid gap-3">
            <DetailCard label="当前用户" value={`${user?.name || "-"} · ${roleLabel(user?.role)}`} />
            <DetailCard label="任务数量" value={`${tasks.length} 条`} />
            <DetailCard label="默认策略" value="优先使用短文案、少步骤和蓝白灰主题。" />
          </div>
        </section>

        <section className="surface p-6">
          <SectionHeader title="部署配置" description="当前节点、端口和运行巡检参数。" />
          <div className="mt-5 grid gap-3">
            <DetailCard label="当前节点" value={runtimeConfig?.localNodeId || "-"} mono />
            <DetailCard label="后端端口" value={runtimeConfig?.backendPort || "-"} mono />
            <DetailCard label="前端来源" value={runtimeConfig?.frontendOrigins.join(", ") || "-"} />
            <DetailCard label="数据文件" value={runtimeConfig?.dataFile || "-"} mono />
            <DetailCard label="集群巡检" value={runtimeConfig ? `${runtimeConfig.clusterSupervisorEnabled ? "开启" : "关闭"} · ${runtimeConfig.clusterSupervisorIntervalSeconds}s` : "-"} />
            <DetailCard label="节点心跳" value={runtimeConfig ? `${runtimeConfig.embeddedHeartbeatEnabled ? "开启" : "关闭"} · ${runtimeConfig.embeddedHeartbeatIntervalSeconds}s` : "-"} />
            <DetailCard label="进程协调" value={runtimeConfig ? `${runtimeConfig.taskProcessSupervisorIntervalSeconds}s` : "-"} />
          </div>
        </section>

        <section className="surface p-6">
          <SectionHeader title="最近操作" description="保留关键审计，不再单独占用主导航。" />
          <div className="mt-5 grid gap-3">
            {logs.slice(0, 6).map((log) => (
              <div key={log.id} className="rounded-2xl border border-line bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{log.targetType}</Badge>
                  <span className="text-sm font-medium text-coal">{log.action}</span>
                </div>
                <div className="mt-2 text-sm text-slate-500">{log.detail}</div>
                <div className="mt-2 text-xs text-slate-500">{log.actor} · {formatDate(log.createdAt)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="surface p-6">
        <SectionHeader
          title="告警规则"
          description="把系统配置收敛在同一页。"
          action={canManage ? (
            <button onClick={() => setEditingId(null)} className="btn-secondary">
              <Plus size={16} />
              新增规则
            </button>
          ) : undefined}
        />

        <div className="mt-5 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
          <div className="grid gap-3">
            {alertRules.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line bg-slate-50/70 px-4 py-6 text-sm text-slate-500">暂无告警规则</div>
            ) : alertRules.map((rule) => {
              const evaluation = evaluations.find((item) => item.ruleId === rule.id);
              return (
                <button
                  key={rule.id}
                  onClick={() => setEditingId(rule.id)}
                  className={cx(
                    "rounded-2xl border px-4 py-4 text-left transition",
                    editingId === rule.id ? "border-blue-200 bg-blue-50" : "border-line bg-white hover:bg-slate-50"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-coal">{rule.name}</span>
                    <Badge tone={evaluation?.triggered ? "red" : "green"}>{evaluation?.triggered ? "触发中" : "正常"}</Badge>
                  </div>
                  <div className="mt-2 text-sm text-slate-500">{rule.taskId ? tasks.find((task) => task.id === rule.taskId)?.name || rule.taskId : "全部任务"}</div>
                  <div className="mt-2 text-xs text-slate-500">延迟 {rule.delayThresholdSeconds}s · 错误 {rule.errorThreshold}</div>
                </button>
              );
            })}
          </div>

          <div>
            {!canManage && (
              <PermissionNotice compact description="当前角色可查看规则与事件；创建、编辑、删除告警规则需要管理员权限。" />
            )}
            <form onSubmit={saveRule} className="mt-4 grid gap-4 xl:mt-0">
              <Field label="规则名称">
                <input className="input" value={form.name} disabled={!canManage} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
              <Field label="作用范围">
                <select className="select" value={form.taskId || ""} disabled={!canManage} onChange={(event) => setForm({ ...form, taskId: event.target.value })}>
                  <option value="">全部任务</option>
                  {tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
                </select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="延迟阈值秒">
                  <input className="input" type="number" min={1} value={form.delayThresholdSeconds} disabled={!canManage} onChange={(event) => setForm({ ...form, delayThresholdSeconds: Number(event.target.value) })} />
                </Field>
                <Field label="错误次数阈值">
                  <input className="input" type="number" min={0} value={form.errorThreshold} disabled={!canManage} onChange={(event) => setForm({ ...form, errorThreshold: Number(event.target.value) })} />
                </Field>
              </div>
              <Field label="Webhook">
                <input className="input" value={form.webhookUrl || ""} disabled={!canManage} onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })} placeholder="https://example.com/webhook" />
              </Field>
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={Boolean(form.enabled)} disabled={!canManage} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
                启用规则
              </label>
              <div className="flex flex-wrap justify-end gap-3 pt-2">
                {editing && (
                  <button type="button" onClick={removeRule} disabled={!canManage} className="btn-danger">
                    <Trash size={16} />
                    删除
                  </button>
                )}
                <button disabled={!canManage} className="btn-primary">
                  <CheckCircle size={16} />
                  保存
                </button>
              </div>
            </form>

            <div className="mt-6 rounded-3xl border border-line bg-slate-50/70 p-4">
              <div className="text-sm font-medium text-coal">最近告警事件</div>
              <div className="mt-3 grid gap-3">
                {alertEvents.slice(0, 4).map((event) => (
                  <div key={event.id} className="rounded-2xl border border-line bg-white px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={event.status === "triggered" ? "red" : "green"}>
                        {event.status === "triggered" ? "触发" : "恢复"}
                      </Badge>
                      <span className="font-medium text-coal">{event.ruleName}</span>
                    </div>
                    <div className="mt-2 text-sm text-slate-500">{event.message}</div>
                    <div className="mt-2 text-xs text-slate-500">{formatDate(event.createdAt)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await onLogin(username, password);
    } catch (requestError) {
      if (isServiceUnavailableError(requestError)) {
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-mist px-4 py-8 text-ink">
      <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.12fr_0.88fr]">
        <section className="surface overflow-hidden p-8 md:p-10">
          <div className="chip border-blue-200 bg-blue-50 text-blue-700">Developer Data Platform</div>
          <h1 className="mt-5 max-w-3xl text-5xl font-semibold tracking-tight text-coal md:text-6xl">
            canal-plus
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-500">
            面向数据迁移、同步、校验、订正和结构对比的分布式任务平台。入口更少，流程更清晰，适合开发者和数据工程师直接上手。
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <MetricMini label="任务类型" value="5" />
            <MetricMini label="主路径" value="7 步" />
            <MetricMini label="节点运维" value="页面化" />
          </div>
        </section>

        <form onSubmit={submit} className="surface p-6 md:p-8">
          <div className="text-2xl font-semibold tracking-tight text-coal">登录</div>
          <div className="mt-6 grid gap-4">
            <Field label="账号">
              <input className="input" value={username} onChange={(event) => setUsername(event.target.value)} />
            </Field>
            <Field label="密码">
              <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            {error && <NoticeBanner tone="error">{error}</NoticeBanner>}
            <button disabled={loading} className="btn-primary w-full">
              {loading ? <ArrowsClockwise size={16} /> : <ArrowRight size={16} />}
              {loading ? "登录中" : "进入控制台"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TaskCreatorModal({
  open,
  datasources,
  tasks,
  canManage,
  onClose,
  onChanged,
  pushNotice
}: {
  open: boolean;
  datasources: Datasource[];
  tasks: SyncTask[];
  canManage: boolean;
  onClose: () => void;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
}) {
  const sourceOptions = datasources.filter((item) => item.purpose === "source" || item.purpose === "both");
  const targetOptions = datasources.filter((item) => item.purpose === "target" || item.purpose === "both");
  const executableTasks = tasks.filter((task) => task.status !== "draft");
  const [step, setStep] = useState(0);
  const [selectedType, setSelectedType] = useState<TaskBlueprintType>("full_migration");
  const [syncDraft, setSyncDraft] = useState({
    name: "",
    owner: "数据平台",
    sourceDatasourceId: sourceOptions[0]?.id || "",
    targetDatasourceId: targetOptions[0]?.id || "",
    sourceSchema: "",
    sourceTable: "",
    targetSchema: "",
    targetTable: ""
  });
  const [capabilityDraft, setCapabilityDraft] = useState({
    name: "",
    taskId: executableTasks[0]?.id || ""
  });
  const [strategy, setStrategy] = useState<SyncStrategy>(defaultStrategy);
  const [sourceSchemas, setSourceSchemas] = useState<string[]>([]);
  const [targetSchemas, setTargetSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [columns, setColumns] = useState<TableColumn[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [preflight, setPreflight] = useState<TaskPreflightReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isSyncType = selectedType === "full_migration" || selectedType === "incremental_sync";

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSelectedType("full_migration");
    setFormError(null);
    setPreflight(null);
    setStrategy(defaultStrategy);
    setSyncDraft({
      name: "",
      owner: "数据平台",
      sourceDatasourceId: sourceOptions[0]?.id || "",
      targetDatasourceId: targetOptions[0]?.id || "",
      sourceSchema: "",
      sourceTable: "",
      targetSchema: "",
      targetTable: ""
    });
    setCapabilityDraft({
      name: "",
      taskId: executableTasks[0]?.id || ""
    });
  }, [open, sourceOptions, targetOptions, executableTasks]);

  useEffect(() => {
    api.defaultStrategy().then(setStrategy).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!syncDraft.sourceDatasourceId) return;
    api.schemas(syncDraft.sourceDatasourceId)
      .then((items) => {
        setSourceSchemas(items);
        setSyncDraft((current) => ({ ...current, sourceSchema: current.sourceSchema || items[0] || "" }));
      })
      .catch(() => setSourceSchemas([]));
  }, [syncDraft.sourceDatasourceId]);

  useEffect(() => {
    if (!syncDraft.targetDatasourceId) return;
    api.schemas(syncDraft.targetDatasourceId)
      .then((items) => {
        setTargetSchemas(items);
        setSyncDraft((current) => ({ ...current, targetSchema: current.targetSchema || items[0] || "" }));
      })
      .catch(() => setTargetSchemas([]));
  }, [syncDraft.targetDatasourceId]);

  useEffect(() => {
    if (!syncDraft.sourceDatasourceId || !syncDraft.sourceSchema) return;
    api.tables(syncDraft.sourceDatasourceId, syncDraft.sourceSchema)
      .then((items) => {
        setTables(items);
        setSyncDraft((current) => ({ ...current, sourceTable: current.sourceTable || items[0]?.name || "" }));
      })
      .catch(() => setTables([]));
  }, [syncDraft.sourceDatasourceId, syncDraft.sourceSchema]);

  useEffect(() => {
    if (!syncDraft.sourceDatasourceId || !syncDraft.sourceSchema || !syncDraft.sourceTable) return;
    api.columns(syncDraft.sourceDatasourceId, syncDraft.sourceSchema, syncDraft.sourceTable)
      .then((items) => {
        setColumns(items);
        setFieldMappings(items.map((column) => ({
          sourceField: column.name,
          targetField: column.name,
          sourceType: column.type,
          targetType: column.type,
          primaryKey: column.primaryKey,
          nullable: column.nullable,
          ignored: false
        })));
        setSyncDraft((current) => ({
          ...current,
          targetTable: current.targetTable || `ods_${current.sourceTable}`
        }));
      })
      .catch(() => {
        setColumns([]);
        setFieldMappings([]);
      });
  }, [syncDraft.sourceDatasourceId, syncDraft.sourceSchema, syncDraft.sourceTable]);

  useEffect(() => {
    setPreflight(null);
    setFormError(null);
  }, [selectedType, syncDraft, fieldMappings, capabilityDraft, strategy]);

  const buildSyncInput = () => {
    const mode = selectedType === "full_migration" ? "full_only" : "incremental_only";
    const source = datasources.find((item) => item.id === syncDraft.sourceDatasourceId);
    const target = datasources.find((item) => item.id === syncDraft.targetDatasourceId);
    return {
      name: syncDraft.name || `${source?.name || "源端"} to ${target?.name || "目标端"} ${selectedType === "full_migration" ? "全量迁移" : "增量同步"}`,
      description: selectedType === "full_migration" ? "一次性迁移存量数据" : "持续同步变更数据",
      owner: syncDraft.owner,
      sourceDatasourceId: syncDraft.sourceDatasourceId,
      targetDatasourceId: syncDraft.targetDatasourceId,
      tableMappings: [
        {
          sourceSchema: syncDraft.sourceSchema,
          sourceTable: syncDraft.sourceTable,
          targetSchema: syncDraft.targetSchema,
          targetTable: syncDraft.targetTable,
          fields: fieldMappings
        }
      ],
      strategy: {
        ...strategy,
        initMode: mode
      } as SyncStrategy
    };
  };

  const runPreflight = async () => {
    setChecking(true);
    setFormError(null);
    try {
      const report = await api.preflightTask(buildSyncInput());
      setPreflight(report);
      if (!report.ok) {
        setFormError("预检未通过，请先处理失败项。");
      }
      return report;
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "预检失败");
      return null;
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "创建任务需要管理员权限" });
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      if (isSyncType) {
        const report = preflight ?? await api.preflightTask(buildSyncInput());
        setPreflight(report);
        if (!report.ok) {
          setFormError("预检未通过，请先处理失败项。");
          return;
        }
        const created = await api.createTask(buildSyncInput());
        await api.taskAction(created.id, "start");
        pushNotice({ tone: "success", message: `${created.name} 已创建并启动` });
      } else {
        const mode = selectedType === "structure_compare"
          ? "schema_prepare"
          : selectedType === "data_validation"
            ? "verify_only"
            : "verify_then_correct";
        const selectedTask = tasks.find((task) => task.id === capabilityDraft.taskId);
        if (!selectedTask) {
          setFormError("请先选择关联同步任务");
          return;
        }
        await api.createCapabilityJob({
          type: selectedType === "structure_compare" ? "structure" : "quality",
          taskId: selectedTask.id,
          name: capabilityDraft.name || `${selectedTask.name}${selectedType === "structure_compare" ? "结构对比" : selectedType === "data_validation" ? "数据校验" : "数据订正"}`,
          mode,
          autoStart: true
        });
        pushNotice({ tone: "success", message: "治理任务已创建并启动" });
      }
      onClose();
      await onChanged();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="创建任务"
      description="按任务类型逐步配置，不再把所有参数堆在同一页。"
      onClose={onClose}
    >
      <div className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {["选择类型", "配置任务", "确认启动"].map((label, index) => (
            <div key={label} className={cx("rounded-2xl border px-4 py-3 text-sm", step === index ? "border-blue-200 bg-blue-50 text-blue-700" : "border-line bg-slate-50/70 text-slate-500")}>
              {index + 1}. {label}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {taskBlueprints.map((item) => (
              <button
                key={item.type}
                onClick={() => setSelectedType(item.type)}
                className={cx(
                  "rounded-3xl border p-5 text-left transition",
                  selectedType === item.type ? "border-blue-200 bg-blue-50" : "border-line bg-white hover:bg-slate-50"
                )}
              >
                <div className="chip border-slate-200 bg-white text-slate-600">{item.tag}</div>
                <div className="mt-4 text-lg font-semibold text-coal">{item.name}</div>
                <div className="mt-2 text-sm text-slate-500">{item.description}</div>
                <div className="mt-2 text-sm text-slate-500">{item.scenario}</div>
              </button>
            ))}
          </div>
        )}

        {step === 1 && isSyncType && (
          <div className="grid gap-4">
            <Field label="任务名称">
              <input className="input" value={syncDraft.name} onChange={(event) => setSyncDraft({ ...syncDraft, name: event.target.value })} placeholder={selectedType === "full_migration" ? "例如：订单历史全量迁移" : "例如：订单增量同步"} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="负责人">
                <input className="input" value={syncDraft.owner} onChange={(event) => setSyncDraft({ ...syncDraft, owner: event.target.value })} />
              </Field>
              <Field label="目标表">
                <input className="input" value={syncDraft.targetTable} onChange={(event) => setSyncDraft({ ...syncDraft, targetTable: event.target.value })} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-4">
                <Field label="源端数据源">
                  <select className="select" value={syncDraft.sourceDatasourceId} onChange={(event) => setSyncDraft({ ...syncDraft, sourceDatasourceId: event.target.value, sourceSchema: "", sourceTable: "" })}>
                    {sourceOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="源库">
                    <select className="select" value={syncDraft.sourceSchema} onChange={(event) => setSyncDraft({ ...syncDraft, sourceSchema: event.target.value, sourceTable: "" })}>
                      {sourceSchemas.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </Field>
                  <Field label="源表">
                    <select className="select" value={syncDraft.sourceTable} onChange={(event) => setSyncDraft({ ...syncDraft, sourceTable: event.target.value })}>
                      {tables.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
              <div className="grid gap-4">
                <Field label="目标端数据源">
                  <select className="select" value={syncDraft.targetDatasourceId} onChange={(event) => setSyncDraft({ ...syncDraft, targetDatasourceId: event.target.value, targetSchema: "" })}>
                    {targetOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </Field>
                <Field label="目标库">
                  <select className="select" value={syncDraft.targetSchema} onChange={(event) => setSyncDraft({ ...syncDraft, targetSchema: event.target.value })}>
                    {targetSchemas.map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                </Field>
              </div>
            </div>
            <div className="rounded-3xl border border-line bg-slate-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-coal">字段映射</div>
                  <div className="mt-1 text-sm text-slate-500">默认按同名字段填充，必要时再精简或忽略。</div>
                </div>
                <div className="chip border-slate-200 bg-white text-slate-600">{columns.length} 列</div>
              </div>
              <div className="mt-4 overflow-auto rounded-2xl border border-line bg-white">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-3 py-3">源字段</th>
                      <th className="px-3 py-3">目标字段</th>
                      <th className="px-3 py-3">类型</th>
                      <th className="px-3 py-3">主键</th>
                      <th className="px-3 py-3">忽略</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fieldMappings.map((field, index) => (
                      <tr key={field.sourceField} className="border-b border-line last:border-b-0">
                        <td className="px-3 py-3 mono text-slate-700">{field.sourceField}</td>
                        <td className="px-3 py-3">
                          <input
                            className="input py-2"
                            value={field.targetField}
                            onChange={(event) => {
                              const next = [...fieldMappings];
                              next[index] = { ...field, targetField: event.target.value };
                              setFieldMappings(next);
                            }}
                          />
                        </td>
                        <td className="px-3 py-3 text-slate-500">{field.sourceType}</td>
                        <td className="px-3 py-3">{field.primaryKey ? "是" : "否"}</td>
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            checked={field.ignored}
                            onChange={(event) => {
                              const next = [...fieldMappings];
                              next[index] = { ...field, ignored: event.target.checked };
                              setFieldMappings(next);
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {step === 1 && !isSyncType && (
          executableTasks.length === 0 ? (
            <EmptyPanel
              icon={FlowArrow}
              title="先准备一条同步任务"
              description="数据校验、数据订正和结构对比都依赖已有同步链路。"
            />
          ) : (
            <div className="grid gap-4">
              <Field label="关联同步任务">
                <select className="select" value={capabilityDraft.taskId} onChange={(event) => setCapabilityDraft({ ...capabilityDraft, taskId: event.target.value })}>
                  {executableTasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
                </select>
              </Field>
              <Field label="任务名称">
                <input className="input" value={capabilityDraft.name} onChange={(event) => setCapabilityDraft({ ...capabilityDraft, name: event.target.value })} placeholder="可留空，系统会自动生成" />
              </Field>
            </div>
          )
        )}

        {step === 2 && (
          <div className="grid gap-4">
            <div className="rounded-3xl border border-line bg-slate-50/70 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <TypeBadge type={taskBlueprints.find((item) => item.type === selectedType)?.name || selectedType} />
                <span className="font-medium text-coal">{taskBlueprints.find((item) => item.type === selectedType)?.description}</span>
              </div>
              {isSyncType ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <DetailCard label="负责人" value={syncDraft.owner || "未填写"} />
                  <DetailCard label="数据源" value={`${datasources.find((item) => item.id === syncDraft.sourceDatasourceId)?.name || "-"} to ${datasources.find((item) => item.id === syncDraft.targetDatasourceId)?.name || "-"}`} />
                  <DetailCard label="源表" value={`${syncDraft.sourceSchema}.${syncDraft.sourceTable}`} mono />
                  <DetailCard label="目标表" value={`${syncDraft.targetSchema}.${syncDraft.targetTable}`} mono />
                  <DetailCard label="初始化方式" value={selectedType === "full_migration" ? "仅全量" : "仅增量"} />
                  <DetailCard label="字段数" value={`${fieldMappings.filter((item) => !item.ignored).length}`} />
                </div>
              ) : (
                <div className="mt-4 grid gap-3">
                  <DetailCard label="关联同步任务" value={tasks.find((task) => task.id === capabilityDraft.taskId)?.name || "-"} />
                  <DetailCard label="执行方式" value={selectedType === "structure_compare" ? "结构对比" : selectedType === "data_validation" ? "仅校验" : "校验后订正"} />
                </div>
              )}
            </div>

            {isSyncType && preflight && (
              <div className={cx("rounded-3xl border p-5", preflight.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50")}>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={preflight.ok ? "green" : "red"}>{preflight.ok ? "预检通过" : "预检未通过"}</Badge>
                  <span className="text-sm text-slate-600">评分 {preflight.score}</span>
                  <span className="text-sm text-slate-600">估算行数 {formatNumber(preflight.estimatedRows)}</span>
                </div>
                <div className="mt-4 grid gap-2">
                  {preflight.checks.slice(0, 4).map((check) => (
                    <div key={check.id} className="rounded-2xl border border-white/70 bg-white px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={check.status === "failed" ? "red" : check.status === "warning" ? "yellow" : "green"}>
                          {check.status === "failed" ? "失败" : check.status === "warning" ? "注意" : "通过"}
                        </Badge>
                        <span className="font-medium text-coal">{check.title}</span>
                      </div>
                      <div className="mt-2 text-sm text-slate-500">{check.message}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {formError && <NoticeBanner tone="error">{formError}</NoticeBanner>}

        <div className="flex flex-wrap justify-between gap-3 border-t border-line pt-4">
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-secondary">取消</button>
            {step > 0 && (
              <button type="button" onClick={() => setStep((value) => Math.max(0, value - 1))} className="btn-secondary">
                上一步
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {step < 2 ? (
              <button
                type="button"
                onClick={() => setStep((value) => Math.min(2, value + 1))}
                className="btn-primary"
              >
                下一步
              </button>
            ) : (
              <>
                {isSyncType && (
                  <button type="button" onClick={() => void runPreflight()} disabled={checking} className="btn-secondary">
                    {checking ? <ArrowsClockwise size={16} /> : <ShieldCheck size={16} />}
                    {checking ? "预检中" : "运行预检"}
                  </button>
                )}
                <button type="button" onClick={() => void submit()} disabled={submitting} className="btn-primary">
                  {submitting ? <ArrowsClockwise size={16} /> : <RocketLaunch size={16} />}
                  {submitting ? "启动中" : "创建并启动"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function NodeCreatorModal({
  open,
  canManage,
  onClose,
  onChanged,
  pushNotice
}: {
  open: boolean;
  canManage: boolean;
  onClose: () => void;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
}) {
  const [form, setForm] = useState<ClusterNodeInput>({ ...emptyNodeForm });
  const [testing, setTesting] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [testResult, setTestResult] = useState<NodeConnectionTestResult | null>(null);
  const [deployResult, setDeployResult] = useState<NodeOperationResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({ ...emptyNodeForm });
    setTesting(false);
    setDeploying(false);
    setTestResult(null);
    setDeployResult(null);
  }, [open]);

  const runTest = async () => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "节点部署需要管理员权限" });
      return;
    }
    setTesting(true);
    try {
      const result = await api.testNodeConnection(form);
      setTestResult(result);
      pushNotice({ tone: result.success ? "success" : "warning", message: result.message });
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "测试失败" });
    } finally {
      setTesting(false);
    }
  };

  const deploy = async () => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "节点部署需要管理员权限" });
      return;
    }
    setDeploying(true);
    try {
      const result = await api.deployNode(form);
      setDeployResult(result);
      pushNotice({ tone: result.success ? "success" : "warning", message: result.message });
      if (result.success) {
        await onChanged();
      }
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "部署失败" });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <Modal
      open={open}
      title="添加节点"
      description="填写机器信息，先测试连接，再一键部署。"
      onClose={onClose}
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="节点名称">
            <input className="input" value={form.name || ""} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="主机地址">
            <input className="input" value={form.endpoint || ""} onChange={(event) => setForm({ ...form, endpoint: event.target.value })} placeholder="例如：10.18.4.24" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[130px_minmax(0,1fr)]">
          <Field label="SSH 端口">
            <input className="input" type="number" value={form.sshPort || 22} onChange={(event) => setForm({ ...form, sshPort: Number(event.target.value) })} />
          </Field>
          <Field label="SSH 用户">
            <input className="input" value={form.sshUser || ""} onChange={(event) => setForm({ ...form, sshUser: event.target.value })} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="认证方式">
            <select className="select" value={form.authMode || "password"} onChange={(event) => setForm({ ...form, authMode: event.target.value as "password" | "private_key" })}>
              <option value="password">密码</option>
              <option value="private_key">私钥</option>
            </select>
          </Field>
          <Field label="安装目录">
            <input className="input" value={form.installDir || ""} onChange={(event) => setForm({ ...form, installDir: event.target.value })} />
          </Field>
        </div>
        {form.authMode === "private_key" ? (
          <Field label="私钥">
            <textarea className="textarea" value={form.privateKey || ""} onChange={(event) => setForm({ ...form, privateKey: event.target.value })} />
          </Field>
        ) : (
          <Field label="密码">
            <input className="input" type="password" value={form.password || ""} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="节点角色">
            <select className="select" value={form.role || "worker"} onChange={(event) => setForm({ ...form, role: event.target.value })}>
              <option value="worker">worker</option>
              <option value="scheduler+worker">scheduler+worker</option>
            </select>
          </Field>
          <Field label="可承载任务数">
            <input className="input" type="number" value={form.capacity || 4} onChange={(event) => setForm({ ...form, capacity: Number(event.target.value) })} />
          </Field>
          <Field label="版本">
            <input className="input" value={form.version || "v1.0.0"} onChange={(event) => setForm({ ...form, version: event.target.value })} />
          </Field>
        </div>

        {testResult && (
          <div className={cx("rounded-2xl border px-4 py-3 text-sm", testResult.success ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
            {testResult.message} · 延迟 {testResult.latencyMs}ms
          </div>
        )}

        {deployResult && (
          <div className="grid gap-3">
            {deployResult.steps.map((step) => (
              <div key={step.key} className="rounded-2xl border border-line bg-slate-50/70 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-coal">{step.label}</div>
                  <Badge tone={step.status === "done" ? "green" : "red"}>{step.status === "done" ? "完成" : "失败"}</Badge>
                </div>
                <div className="mt-2 text-sm text-slate-500">{step.detail}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">关闭</button>
          <button type="button" onClick={() => void runTest()} disabled={testing} className="btn-secondary">
            {testing ? <ArrowsClockwise size={16} /> : <ShieldCheck size={16} />}
            {testing ? "测试中" : "测试连接"}
          </button>
          <button type="button" onClick={() => void deploy()} disabled={deploying} className="btn-primary">
            {deploying ? <ArrowsClockwise size={16} /> : <RocketLaunch size={16} />}
            {deploying ? "部署中" : "部署节点"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SyncTaskDetail({
  task,
  relatedJobs,
  errors,
  cluster,
  canManage,
  onOpenNode,
  onRunJob,
  busyActionKey,
  onChanged,
  pushNotice
}: {
  task: SyncTask;
  relatedJobs: CapabilityJob[];
  errors: ErrorEvent[];
  cluster: ClusterSnapshot | null;
  canManage: boolean;
  onOpenNode: (nodeID: string) => void;
  onRunJob: (job: CapabilityJob) => void;
  busyActionKey: string | null;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
}) {
  const [runtime, setRuntime] = useState(task.runtime);
  const [checkpoints, setCheckpoints] = useState<TaskCheckpoint[]>([]);
  const [revisions, setRevisions] = useState<TaskRevision[]>([]);
  const [taskLogs, setTaskLogs] = useState<TaskLogEntry[]>([]);
  const [logConnected, setLogConnected] = useState(false);
  const [logNotice, setLogNotice] = useState<string | null>(null);
  const [rollingBackVersion, setRollingBackVersion] = useState<number | null>(null);
  const [savingParams, setSavingParams] = useState(false);
  const [resettingPosition, setResettingPosition] = useState(false);
  const [paramsDraft, setParamsDraft] = useState({
    batchSize: task.strategy.batchSize,
    retryTimes: task.strategy.retryTimes,
    retryIntervalSeconds: task.strategy.retryIntervalSeconds,
    conflictStrategy: task.strategy.conflictStrategy,
    deleteStrategy: task.strategy.deleteStrategy
  });
  const [positionDraft, setPositionDraft] = useState({
    binlogFile: task.runtime?.binlogFile || "mysql-bin.000001",
    binlogPosition: task.runtime?.binlogPosition || 4
  });
  const progress = runtime && runtime.fullTotalRows > 0 ? Math.min(100, Math.round((runtime.fullSyncedRows / runtime.fullTotalRows) * 100)) : 0;
  const taskErrors = errors.filter((item) => item.taskId === task.id).slice(0, 4);
  const localNodeId = cluster?.localNodeId;
  const runtimeNode = runtime?.nodeId;
  const runtimeNodeLabel = runtime?.executionNodeName || cluster?.nodes.find((node) => node.id === runtimeNode)?.name || runtimeNode;
  const remoteManaged = runtime?.managedByLocalNode === false || Boolean(localNodeId && runtimeNode && runtimeNode !== localNodeId);
  const checkpointNodeName = (nodeID?: string) => cluster?.nodes.find((node) => node.id === nodeID)?.name || nodeID || "待分配";
  const hostingModeText = runtime?.managedByLocalNode === false ? "远程节点托管" : runtime?.nodeId ? "当前节点托管" : "待分配";
  const logAccessText = runtime?.localLogAccessible === false
    ? runtime?.logAccessMessage || "需切换到执行节点查看"
    : remoteManaged
      ? runtime?.logAccessMessage || "执行节点可查看"
      : "当前节点可查看";

  useEffect(() => {
    setRuntime(task.runtime);
    setParamsDraft({
      batchSize: task.strategy.batchSize,
      retryTimes: task.strategy.retryTimes,
      retryIntervalSeconds: task.strategy.retryIntervalSeconds,
      conflictStrategy: task.strategy.conflictStrategy,
      deleteStrategy: task.strategy.deleteStrategy
    });
    setPositionDraft({
      binlogFile: task.runtime?.binlogFile || "mysql-bin.000001",
      binlogPosition: task.runtime?.binlogPosition || 4
    });
  }, [
    task.id,
    task.runtime,
    task.strategy.batchSize,
    task.strategy.retryTimes,
    task.strategy.retryIntervalSeconds,
    task.strategy.conflictStrategy,
    task.strategy.deleteStrategy
  ]);

  useEffect(() => {
    let cancelled = false;
    api.taskRevisions(task.id)
      .then((items) => {
        if (!cancelled) {
          setRevisions(items.slice(0, 8));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRevisions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  useEffect(() => {
    let cancelled = false;
    api.taskCheckpoints(task.id)
      .then((items) => {
        if (!cancelled) {
          setCheckpoints(items.slice(0, 8));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCheckpoints([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  const rollbackRevision = async (version: number) => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "回滚任务版本需要管理员权限" });
      return;
    }
    setRollingBackVersion(version);
    try {
      await api.rollbackTaskRevision(task.id, version);
      pushNotice({ tone: "success", message: `任务已回滚到 v${version}` });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "回滚失败" });
    } finally {
      setRollingBackVersion(null);
    }
  };

  const saveRuntimeParams = async () => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "修改运行参数需要管理员权限" });
      return;
    }
    setSavingParams(true);
    try {
      await api.updateTaskParams(task.id, {
        batchSize: Number(paramsDraft.batchSize),
        retryTimes: Number(paramsDraft.retryTimes),
        retryIntervalSeconds: Number(paramsDraft.retryIntervalSeconds),
        conflictStrategy: paramsDraft.conflictStrategy,
        deleteStrategy: paramsDraft.deleteStrategy
      });
      pushNotice({ tone: "success", message: "运行参数已保存" });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "保存参数失败" });
    } finally {
      setSavingParams(false);
    }
  };

  const resetPosition = async () => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "重置位点需要管理员权限" });
      return;
    }
    setResettingPosition(true);
    try {
      await api.resetTaskPosition(task.id, {
        binlogFile: positionDraft.binlogFile,
        binlogPosition: Number(positionDraft.binlogPosition)
      });
      pushNotice({ tone: "success", message: "位点已重置" });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "重置位点失败" });
    } finally {
      setResettingPosition(false);
    }
  };

  useEffect(() => {
    if (remoteManaged) {
      setTaskLogs([]);
      setLogNotice(runtime?.logAccessMessage || `当前任务由节点 ${runtimeNodeLabel} 托管，请切换到该节点查看实时日志。`);
      setLogConnected(false);
      return;
    }
    let cancelled = false;
    api.taskLogs(task.id, 120)
      .then((items) => {
        if (!cancelled) {
          setTaskLogs(items);
          setLogNotice(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTaskLogs([]);
          setLogNotice(error instanceof Error ? error.message : "日志加载失败");
        }
      });

    const stream = new EventSource(api.taskLogsStreamUrl(task.id));
    stream.onopen = () => {
      if (!cancelled) {
        setLogConnected(true);
      }
    };
    stream.onmessage = (event) => {
      if (cancelled) return;
      try {
        const entry = JSON.parse(event.data) as TaskLogEntry;
        setTaskLogs((current) => [...current.slice(-119), entry]);
        setLogNotice(null);
      } catch {
        return;
      }
    };
    stream.onerror = () => {
      if (!cancelled) {
        setLogConnected(false);
      }
    };

    return () => {
      cancelled = true;
      setLogConnected(false);
      stream.close();
    };
  }, [remoteManaged, runtime?.logAccessMessage, runtimeNodeLabel, task.id]);

  useEffect(() => {
    const active = task.status === "full_syncing" || task.status === "incremental_running" || runtime?.processStatus === "starting" || runtime?.processStatus === "running";
    if (!active) {
      return;
    }
    let cancelled = false;
    const syncRuntime = async () => {
      try {
        const latest = await api.taskRuntime(task.id);
        if (!cancelled) {
          setRuntime(latest);
        }
      } catch {
        return;
      }
    };
    void syncRuntime();
    const timer = window.setInterval(() => {
      void syncRuntime();
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [runtime?.processStatus, task.id, task.status]);

  return (
    <div className="mt-5 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge type={syncTaskTypeText(task)} />
        <StatusBadge status={task.status} />
        <Badge tone={taskProcessTone(runtime?.processStatus)}>{taskProcessStatusText(runtime?.processStatus)}</Badge>
        {remoteManaged && <Badge tone="yellow">远程托管</Badge>}
      </div>
      <section className="rounded-[2rem] border border-line bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-2xl font-semibold tracking-tight text-coal">{task.name}</div>
            <div className="mt-2 text-sm text-slate-500">
              {(task.sourceDatasource?.name || task.sourceDatasourceId)} to {(task.targetDatasource?.name || task.targetDatasourceId)}
            </div>
          </div>
          {runtime?.nodeId && (
            <button type="button" onClick={() => onOpenNode(runtime.nodeId!)} className="btn-secondary">
              <HardDrives size={16} />
              查看节点
            </button>
          )}
        </div>
      </section>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="order-2 space-y-5 2xl:order-1">
          <section className="rounded-[2rem] border border-line bg-white p-5 shadow-panel">
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <DetailCard label="负责人" value={task.owner} />
              <DetailCard label="配置版本" value={`v${task.configVersion}`} mono />
              <DetailCard label="更新时间" value={formatDateTime(task.updatedAt)} />
              <DetailCard label="运行节点" value={runtimeNodeLabel || "待分配"} mono />
              <DetailCard label="托管模式" value={hostingModeText} />
              <DetailCard label="日志访问" value={logAccessText} />
            </div>

            <div className="mt-5 rounded-3xl border border-line bg-slate-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-coal">运行状态</div>
                <div className="text-sm text-slate-500">{progress}%</div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <DetailCard label="延迟" value={`${runtime?.delaySeconds ?? 0}s`} />
                <DetailCard label="吞吐" value={`${runtime?.eventsPerSecond ?? 0} eps`} />
                <DetailCard label="位点" value={`${runtime?.binlogFile || "-"}:${runtime?.binlogPosition || 0}`} mono />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <DetailCard label="进程 PID" value={runtime?.processId ? `${runtime.processId}` : "-"} mono />
                <DetailCard label="最近心跳" value={runtime?.lastHeartbeatAt ? formatDateTime(runtime.lastHeartbeatAt) : "-"} />
                <DetailCard label="最近日志" value={runtime?.lastLogAt ? formatDateTime(runtime.lastLogAt) : "-"} />
              </div>
              <div className="mt-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm text-slate-500">
                {runtime?.lastLogMessage || "暂无运行日志摘要。"}
              </div>
            </div>
          </section>

          {relatedJobs.length > 0 && (
            <section className="rounded-3xl border border-line bg-slate-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-coal">扩展任务</div>
                  <div className="mt-1 text-sm text-slate-500">校验、订正和结构对比挂在当前同步任务下面，避免主列表重复。</div>
                </div>
                <Badge tone="blue">{`${relatedJobs.length} 条`}</Badge>
              </div>
              <div className="mt-3 grid gap-3">
                {relatedJobs
                  .slice()
                  .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
                  .map((job) => (
                    <div key={job.id} className="rounded-2xl border border-line bg-white p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <TypeBadge type={capabilityJobTypeText(job)} />
                            <Badge tone={capabilityJobTone(job.status)}>{capabilityJobStatusText(job.status)}</Badge>
                          </div>
                          <div className="mt-3 font-medium text-coal">{job.name}</div>
                          <div className="mt-2 text-sm text-slate-500">{capabilityJobSummaryText(job)}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="rounded-2xl border border-line bg-slate-50 px-3 py-2 text-xs text-slate-500">
                            {job.progressPercent}%
                          </div>
                          <button
                            type="button"
                            onClick={() => onRunJob(job)}
                            disabled={job.status === "running" || busyActionKey === `${job.id}:job`}
                            className="btn-secondary px-3 py-2 text-xs"
                          >
                            <Play size={14} />
                            {job.status === "running" ? "运行中" : "重跑"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </div>

        <TaskLiveLogPanel
          className="order-1 2xl:order-2"
          remoteManaged={remoteManaged}
          logConnected={logConnected}
          logNotice={logNotice}
          taskLogs={taskLogs}
          lastLogAt={runtime?.lastLogAt}
        />
      </div>

      <div className="grid gap-5 2xl:grid-cols-2">
        <section className="rounded-3xl border border-line bg-slate-50/70 p-4">
          <div className="font-medium text-coal">表映射</div>
          <div className="mt-3 grid gap-3">
            {task.tableMappings.map((mapping) => (
              <div key={`${mapping.sourceSchema}.${mapping.sourceTable}.${mapping.targetTable}`} className="rounded-2xl border border-line bg-white px-4 py-3">
                <div className="font-medium text-coal">
                  {mapping.sourceSchema}.{mapping.sourceTable}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  to {mapping.targetSchema}.{mapping.targetTable}
                </div>
                <div className="mt-2 text-xs text-slate-500">{mapping.fields.filter((item) => !item.ignored).length} 个字段</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-line bg-slate-50/70 p-4">
          <div className="font-medium text-coal">最近异常</div>
          <div className="mt-3 grid gap-3">
            {taskErrors.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line bg-white px-4 py-6 text-sm text-slate-500">
                当前没有待展示的错误事件。
              </div>
            ) : taskErrors.map((item) => (
              <div key={item.id} className="rounded-2xl border border-line bg-white px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="red">{item.eventType.toUpperCase()}</Badge>
                  <span className="font-medium text-coal">{item.sourceTable}</span>
                </div>
                <div className="mt-2 text-sm text-slate-500">{item.reason}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {canManage && (
        <div className="grid gap-5 2xl:grid-cols-2">
          <section className="rounded-3xl border border-line bg-slate-50/70 p-4">
            <div className="font-medium text-coal">运行参数</div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="批量写入">
                <input className="input" type="number" value={paramsDraft.batchSize} onChange={(event) => setParamsDraft({ ...paramsDraft, batchSize: Number(event.target.value) })} />
              </Field>
              <Field label="重试次数">
                <input className="input" type="number" value={paramsDraft.retryTimes} onChange={(event) => setParamsDraft({ ...paramsDraft, retryTimes: Number(event.target.value) })} />
              </Field>
              <Field label="重试间隔秒">
                <input className="input" type="number" value={paramsDraft.retryIntervalSeconds} onChange={(event) => setParamsDraft({ ...paramsDraft, retryIntervalSeconds: Number(event.target.value) })} />
              </Field>
              <Field label="冲突策略">
                <select className="select" value={paramsDraft.conflictStrategy} onChange={(event) => setParamsDraft({ ...paramsDraft, conflictStrategy: event.target.value as SyncStrategy["conflictStrategy"] })}>
                  <option value="overwrite">覆盖</option>
                  <option value="ignore">忽略</option>
                  <option value="fail">失败停止</option>
                </select>
              </Field>
              <Field label="删除策略">
                <select className="select" value={paramsDraft.deleteStrategy} onChange={(event) => setParamsDraft({ ...paramsDraft, deleteStrategy: event.target.value as SyncStrategy["deleteStrategy"] })}>
                  <option value="physical">物理删除</option>
                  <option value="soft_delete">软删除字段更新</option>
                  <option value="ignore">忽略删除</option>
                </select>
              </Field>
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => void saveRuntimeParams()} disabled={savingParams} className="btn-secondary">
                {savingParams ? <ArrowsClockwise size={16} /> : <CheckCircle size={16} />}
                {savingParams ? "保存中" : "保存参数"}
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-line bg-slate-50/70 p-4">
            <div className="font-medium text-coal">位点控制</div>
            <div className="mt-2 text-sm text-slate-500">仅已停止任务允许重置位点。</div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Binlog 文件">
                <input className="input mono" value={positionDraft.binlogFile} onChange={(event) => setPositionDraft({ ...positionDraft, binlogFile: event.target.value })} />
              </Field>
              <Field label="Binlog Position">
                <input className="input mono" type="number" value={positionDraft.binlogPosition} onChange={(event) => setPositionDraft({ ...positionDraft, binlogPosition: Number(event.target.value) })} />
              </Field>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => void resetPosition()}
                disabled={resettingPosition || task.status !== "stopped"}
                className="btn-secondary"
              >
                {resettingPosition ? <ArrowsClockwise size={16} /> : <ArrowRight size={16} />}
                {resettingPosition ? "重置中" : "重置位点"}
              </button>
            </div>
          </section>
        </div>
      )}

      <section className="rounded-3xl border border-line bg-slate-50/70 p-4">
        <div className="font-medium text-coal">配置版本</div>
        <div className="mt-3 grid gap-3">
          {revisions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-white px-4 py-6 text-sm text-slate-500">
              当前没有可展示的版本历史。
            </div>
          ) : revisions.map((revision) => (
            <div key={revision.id} className="rounded-2xl border border-line bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={revision.version === task.configVersion ? "blue" : "neutral"}>{`v${revision.version}`}</Badge>
                    <span className="text-sm font-medium text-coal">{revision.summary}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>{revision.actor}</span>
                    <span>{revision.changeType}</span>
                    <span>{formatDateTime(revision.createdAt)}</span>
                  </div>
                </div>
                {canManage && revision.version !== task.configVersion && (
                  <button
                    type="button"
                    onClick={() => void rollbackRevision(revision.version)}
                    disabled={rollingBackVersion === revision.version}
                    className="btn-secondary px-3 py-2 text-xs"
                  >
                    {rollingBackVersion === revision.version ? <ArrowsClockwise size={14} /> : <ArrowRight size={14} />}
                    {rollingBackVersion === revision.version ? "回滚中" : "回滚到此版本"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-line bg-slate-50/70 p-4">
        <div className="font-medium text-coal">运行轨迹</div>
        <div className="mt-3 grid gap-3">
          {checkpoints.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-white px-4 py-6 text-sm text-slate-500">
              当前没有可展示的运行轨迹。
            </div>
          ) : checkpoints.map((checkpoint) => (
            <div key={checkpoint.id} className="rounded-2xl border border-line bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={checkpointReasonTone(checkpoint.reason)}>{checkpointReasonText(checkpoint.reason)}</Badge>
                    <span className="text-sm font-medium text-coal">{taskRuntimePhaseText(checkpoint.phase)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {checkpoint.previousNodeId && checkpoint.previousNodeId !== checkpoint.nodeId ? (
                      <>
                        <span className="rounded-full border border-line bg-slate-50 px-2 py-1">{checkpointNodeName(checkpoint.previousNodeId)}</span>
                        <ArrowRight size={14} className="text-slate-400" />
                        <span className="rounded-full border border-line bg-slate-50 px-2 py-1">{checkpointNodeName(checkpoint.nodeId)}</span>
                      </>
                    ) : (
                      <span className="rounded-full border border-line bg-slate-50 px-2 py-1">{checkpointNodeName(checkpoint.nodeId)}</span>
                    )}
                    <span>{formatDateTime(checkpoint.createdAt)}</span>
                  </div>
                </div>
                <div className="rounded-2xl border border-line bg-slate-50/70 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">位点</div>
                  <div className="mt-2 mono text-coal">{checkpoint.binlogFile}:{checkpoint.binlogPosition}</div>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <DetailCard label="Lease Epoch" value={`${checkpoint.leaseEpoch}`} mono />
                <DetailCard label="延迟" value={`${checkpoint.delaySeconds}s`} />
                <DetailCard label="吞吐" value={`${checkpoint.eventsPerSecond} eps`} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TaskLiveLogPanel({
  className,
  remoteManaged,
  logConnected,
  logNotice,
  taskLogs,
  lastLogAt
}: {
  className?: string;
  remoteManaged: boolean;
  logConnected: boolean;
  logNotice: string | null;
  taskLogs: TaskLogEntry[];
  lastLogAt?: string;
}) {
  return (
    <section className={cx("rounded-[2rem] border border-slate-800 bg-slate-950 p-4 text-slate-100 shadow-panel", className)}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">实时日志</div>
          <div className="mt-1 text-xs text-slate-400">
            {lastLogAt ? `最近更新 ${formatDateTime(lastLogAt)}` : "任务一旦启动，这里直接滚动显示进程日志。"}
          </div>
        </div>
        <Badge tone={remoteManaged ? "yellow" : logConnected ? "green" : "neutral"}>
          {remoteManaged ? "远程节点" : logConnected ? "实时连接" : "等待连接"}
        </Badge>
      </div>
      <div className="mt-4 rounded-[1.5rem] border border-slate-800 bg-slate-900/80">
        <div className="max-h-[560px] overflow-auto px-4 py-4">
          {logNotice ? (
            <div className="text-sm leading-6 text-slate-300">{logNotice}</div>
          ) : taskLogs.length === 0 ? (
            <div className="text-sm leading-6 text-slate-300">当前还没有任务进程日志。</div>
          ) : (
            <div className="grid gap-3">
              {taskLogs.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-slate-800 bg-slate-950/80 px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={taskLogTone(entry.level)}>{entry.level}</Badge>
                    {entry.phase && <span className="mono text-slate-400">{entry.phase}</span>}
                    <span className="mono text-slate-500">{formatDateTime(entry.createdAt)}</span>
                  </div>
                  <div className="mt-2 break-words text-sm leading-6 text-slate-100">{entry.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CapabilityJobDetail({
  job,
  qualityDiffs,
  structureItems,
  tasks
}: {
  job: CapabilityJob;
  qualityDiffs: Array<{ id: string; sourceTable: string; targetTable: string; fieldName: string; status: string; severity: string }>;
  structureItems: Array<{ id: string; sourceObject: string; targetObject: string; changeType: string; status: string; riskLevel: string }>;
  tasks: SyncTask[];
}) {
  const linkedTask = tasks.find((task) => task.id === job.taskId);
  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge type={capabilityJobTypeText(job)} />
        <Badge tone={capabilityJobTone(job.status)}>{capabilityJobStatusText(job.status)}</Badge>
      </div>
      <div className="text-lg font-semibold text-coal">{job.name}</div>
      <div className="text-sm text-slate-500">关联任务：{linkedTask?.name || job.taskId}</div>
      <div className="rounded-3xl border border-line bg-slate-50/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-coal">执行进度</div>
          <div className="text-sm text-slate-500">{job.progressPercent}%</div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${job.progressPercent}%` }} />
        </div>
        <div className="mt-4 grid gap-3">
          {job.steps.map((step, index) => (
            <div key={`${job.id}-${step.name}`} className="rounded-2xl border border-line bg-white px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-coal">{index + 1}. {step.name}</div>
                <div className="text-xs text-slate-500">{step.status}</div>
              </div>
              <div className="mt-2 text-sm text-slate-500">{step.detail}</div>
            </div>
          ))}
        </div>
      </div>
      {qualityDiffs.length > 0 && (
        <div className="rounded-3xl border border-line bg-slate-50/70 p-4">
          <div className="font-medium text-coal">差异预览</div>
          <div className="mt-3 grid gap-3">
            {qualityDiffs.map((item) => (
              <div key={item.id} className="rounded-2xl border border-line bg-white px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={item.severity === "high" ? "red" : item.severity === "medium" ? "yellow" : "green"}>{item.severity}</Badge>
                  <span className="font-medium text-coal">{item.fieldName}</span>
                </div>
                <div className="mt-2 text-sm text-slate-500">{item.sourceTable} to {item.targetTable}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {structureItems.length > 0 && (
        <div className="rounded-3xl border border-line bg-slate-50/70 p-4">
          <div className="font-medium text-coal">结构差异预览</div>
          <div className="mt-3 grid gap-3">
            {structureItems.map((item) => (
              <div key={item.id} className="rounded-2xl border border-line bg-white px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={item.riskLevel === "high" ? "red" : item.riskLevel === "medium" ? "yellow" : "green"}>{item.riskLevel}</Badge>
                  <span className="font-medium text-coal">{item.changeType}</span>
                </div>
                <div className="mt-2 text-sm text-slate-500">{item.sourceObject} to {item.targetObject}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-coal">{title}</h2>
        {description && <p className="mt-2 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
  icon: Icon
}: {
  label: string;
  value: number | string;
  detail: string;
  tone: "blue" | "green" | "red" | "neutral";
  icon: typeof Database;
}) {
  const toneClass = tone === "blue"
    ? "border-blue-100 bg-blue-50 text-blue-700"
    : tone === "green"
      ? "border-emerald-100 bg-emerald-50 text-emerald-700"
      : tone === "red"
        ? "border-red-100 bg-red-50 text-red-700"
        : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <div className="surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500">{label}</div>
          <div className="mt-3 text-3xl font-semibold tracking-tight text-coal">{value}</div>
        </div>
        <div className={cx("rounded-2xl border px-3 py-2", toneClass)}>
          <Icon size={18} />
        </div>
      </div>
      <div className="mt-3 text-sm text-slate-500">{detail}</div>
    </div>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-slate-50/70 px-4 py-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-coal">{value}</div>
    </div>
  );
}

function DetailCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-white px-4 py-4">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={cx("mt-2 text-sm font-medium text-coal", mono && "mono")}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function EmptyPanel({
  icon: Icon,
  title,
  description,
  action
}: {
  icon: typeof Database;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mt-5 rounded-3xl border border-dashed border-line bg-slate-50/70 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-white text-blue-700">
        <Icon size={20} />
      </div>
      <div className="mt-4 text-lg font-semibold text-coal">{title}</div>
      <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">{description}</div>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

function NoticeBanner({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  const className = tone === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-red-200 bg-red-50 text-red-700";
  return (
    <div className={cx("mb-5 flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm", className)}>
      {tone === "success" ? <CheckCircle size={18} /> : tone === "warning" ? <WarningCircle size={18} /> : <XCircle size={18} />}
      <div>{children}</div>
    </div>
  );
}

function BackendUnavailableScreen({
  retrying,
  onRetry
}: {
  retrying: boolean;
  onRetry: () => Promise<void>;
}) {
  return (
    <div className="min-h-[100dvh] bg-mist px-4 py-8 text-ink">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-3xl items-center justify-center">
        <section className="surface w-full p-8 text-center md:p-12">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-red-100 bg-red-50 text-red-600">
            <WarningCircle size={28} />
          </div>
          <div className="mt-6 text-xs font-medium uppercase tracking-[0.28em] text-slate-500">Canal Plus</div>
          <div className="mt-4 text-6xl font-semibold tracking-tight text-coal md:text-7xl">500</div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-coal md:text-3xl">后端服务暂时不可用</h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-500 md:text-base">
            当前无法连接 Canal Plus API。请确认后端服务已经启动，或等待服务恢复后重试。
          </p>
          <div className="mt-8 flex justify-center">
            <button onClick={() => void onRetry()} disabled={retrying} className="btn-primary min-w-40 justify-center">
              <ArrowsClockwise size={16} />
              {retrying ? "重新连接中" : "重试连接"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  label,
  onClick
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "chip transition",
        active ? "border-blue-200 bg-blue-50 text-blue-700" : "border-line bg-white text-slate-600 hover:bg-slate-50"
      )}
    >
      {label}
    </button>
  );
}

function Badge({ tone, children }: { tone: "blue" | "green" | "yellow" | "red" | "neutral"; children: ReactNode }) {
  const className = tone === "blue"
    ? "border-blue-200 bg-blue-50 text-blue-700"
    : tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "yellow"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-slate-200 bg-slate-100 text-slate-600";
  return <span className={cx("chip", className)}>{children}</span>;
}

function TypeBadge({ type }: { type: string }) {
  return <Badge tone="blue">{type}</Badge>;
}

function NextStepCard({
  title,
  description,
  actionLabel,
  onClick
}: {
  title: string;
  description: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <div className="rounded-3xl border border-line bg-white p-4">
      <div className="text-base font-semibold text-coal">{title}</div>
      <div className="mt-2 text-sm text-slate-500">{description}</div>
      <button onClick={onClick} className="btn-secondary mt-4">
        <ArrowRight size={16} />
        {actionLabel}
      </button>
    </div>
  );
}

function Modal({
  open,
  title,
  description,
  children,
  onClose
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-8">
      <div className="surface max-h-[90dvh] w-full max-w-5xl overflow-auto p-6 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-coal">{title}</h3>
            {description && <p className="mt-2 text-sm text-slate-500">{description}</p>}
          </div>
          <button onClick={onClose} className="btn-secondary px-3 py-2 text-xs">
            关闭
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function ActionMenu({
  items
}: {
  items: Array<{ label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }>;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <details className="relative">
      <summary className="btn-secondary list-none px-3 py-2 text-xs">
        <DotsThree size={14} />
        更多
      </summary>
      <div className="absolute right-0 top-11 z-20 w-40 rounded-2xl border border-line bg-white p-2 shadow-panel">
        {items.map((item) => (
          <button
            key={item.label}
            onClick={item.onSelect}
            disabled={item.disabled}
            className={cx(
              "block w-full rounded-xl px-3 py-2 text-left text-sm transition",
              item.danger ? "text-red-700 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50",
              item.disabled && "cursor-not-allowed opacity-45"
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}

function ShellSkeleton() {
  return (
    <div className="grid gap-5">
      <div className="surface h-52 p-6">
        <div className="skeleton h-4 w-32 rounded" />
        <div className="skeleton mt-5 h-10 w-2/3 rounded" />
        <div className="skeleton mt-4 h-5 w-4/5 rounded" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="surface h-36 p-5">
            <div className="skeleton h-4 w-20 rounded" />
            <div className="skeleton mt-5 h-9 w-24 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function datasourceSearchText(item: Datasource) {
  return [
    item.name,
    item.host,
    item.defaultSchema,
    item.username,
    purposeText(item.purpose)
  ].filter(Boolean).join(" ").toLowerCase();
}

function taskAwaitingNode(task: SyncTask) {
  return !task.runtime?.nodeId && (
    task.status === "pending"
    || task.status === "full_syncing"
    || task.status === "incremental_running"
    || task.status === "failed"
  );
}

function taskActivityAt(task: SyncTask) {
  return task.runtime?.updatedAt || task.updatedAt;
}

function buildTaskItems(tasks: SyncTask[]): WorkloadItem[] {
  return tasks
    .map((task) => ({
      id: task.id,
      key: `sync:${task.id}`,
      kind: "sync" as const,
      type: syncTaskTypeText(task),
      title: task.name,
      detail: `${task.sourceDatasource?.name || task.sourceDatasourceId} to ${task.targetDatasource?.name || task.targetDatasourceId}`,
      updatedAt: taskActivityAt(task),
      statusText: taskStatusText[task.status],
      rawTask: task
    }))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

function buildWorkloads(tasks: SyncTask[], capabilityJobs: CapabilityJob[]): WorkloadItem[] {
  const items: WorkloadItem[] = buildTaskItems(tasks);
  capabilityJobs.forEach((job) => {
    items.push({
      id: job.id,
      key: `capability:${job.id}`,
      kind: "capability",
      type: capabilityJobTypeText(job),
      title: job.name,
      detail: `关联同步任务 ${job.taskId}`,
      updatedAt: job.updatedAt,
      statusText: capabilityJobStatusText(job.status),
      rawJob: job
    });
  });
  items.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  return items;
}

function filteredTypeCounts(items: WorkloadItem[]) {
  const counts: Record<string, number> = {};
  items.forEach((item) => {
    counts[item.type] = (counts[item.type] || 0) + 1;
  });
  return counts;
}

function pageTitle(page: Page) {
  if (page === "dashboard") return "总览";
  if (page === "datasources") return "数据源";
  if (page === "tasks") return "任务中心";
  if (page === "nodes") return "节点";
  return "系统设置";
}

function pageDescription(page: Page) {
  if (page === "dashboard") return "只看全局状态、阻塞项和下一步去哪个页面处理。";
  if (page === "datasources") return "把连接资产收敛到一个入口，先配置，再测试。";
  if (page === "tasks") return "同步任务是主入口，日志、状态和派生能力都围绕任务展开。";
  if (page === "nodes") return "围绕机器接入、部署、升级和卸载组织节点管理流程。";
  return "保留必要的系统配置、告警规则和审计记录。";
}

function purposeText(value: DatasourcePurpose) {
  if (value === "source") return "源端";
  if (value === "target") return "目标端";
  return "源端和目标端";
}

function datasourceStatusText(value: DatasourceStatus) {
  if (value === "online") return "在线";
  if (value === "offline") return "离线";
  return "未测试";
}

function datasourceTone(value: DatasourceStatus) {
  if (value === "online") return "green";
  if (value === "offline") return "red";
  return "neutral";
}

function syncTaskTypeText(task: SyncTask) {
  if (task.strategy.initMode === "full_only") return "全量迁移";
  return "增量同步";
}

function capabilityJobTypeText(job: CapabilityJob) {
  if (job.type === "structure") return "结构对比";
  if (job.type === "quality" && job.mode === "verify_then_correct") return "数据订正";
  if (job.type === "quality") return "数据校验";
  return "订阅变更";
}

function capabilityJobStatusText(status: CapabilityJob["status"]) {
  if (status === "running") return "运行中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  return "草稿";
}

function capabilityJobTone(status: CapabilityJob["status"]) {
  if (status === "running") return "blue";
  if (status === "completed") return "green";
  if (status === "failed") return "red";
  return "neutral";
}

function capabilityJobSummaryText(job: CapabilityJob) {
  if (job.type === "structure") {
    return `${job.summary.ddlCount} 条 DDL，风险 ${job.summary.riskLevel}`;
  }
  if (job.type === "quality" && job.mode === "verify_then_correct") {
    return `${job.summary.diffRows} 条差异，已订正 ${job.summary.correctedRows} 条`;
  }
  if (job.type === "quality") {
    return `${job.summary.diffRows} 条差异待核验`;
  }
  return job.schedule ? `调度 ${job.schedule}` : "订阅变更";
}

function nodeStatusText(status: ClusterNode["status"]) {
  if (status === "online") return "在线";
  if (status === "draining") return "排空中";
  return "离线";
}

function nodeTone(status: ClusterNode["status"]) {
  if (status === "online") return "green";
  if (status === "draining") return "yellow";
  return "neutral";
}

function taskProcessStatusText(status?: TaskRuntimeState["processStatus"]) {
  if (status === "starting") return "启动中";
  if (status === "running") return "运行中";
  if (status === "stopping") return "停止中";
  if (status === "stopped") return "已停止";
  if (status === "failed") return "异常退出";
  if (status === "remote") return "远程节点";
  if (status === "awaiting_takeover") return "待接管";
  return "未启动";
}

function taskProcessTone(status?: TaskRuntimeState["processStatus"]) {
  if (status === "running") return "blue";
  if (status === "remote") return "yellow";
  if (status === "awaiting_takeover") return "yellow";
  if (status === "starting" || status === "stopping") return "yellow";
  if (status === "failed") return "red";
  return "neutral";
}

function taskActionNotice(task: SyncTask, action: "start" | "pause" | "resume" | "stop") {
  if ((action === "start" || action === "resume") && (task.runtime?.processStatus === "awaiting_takeover" || taskAwaitingNode(task))) {
    return "任务等待节点接管";
  }
  if (action === "pause") return "任务已暂停";
  if (action === "resume") return "任务已恢复";
  if (action === "stop") return "任务已停止";
  return "任务已启动";
}

function taskRuntimePhaseText(phase?: string) {
  if (phase === "full") return "全量";
  if (phase === "incremental") return "增量";
  if (phase === "paused") return "暂停";
  if (phase === "failed") return "异常";
  if (phase === "stopped") return "停止";
  return "空闲";
}

function checkpointReasonText(reason: string) {
  if (reason === "create") return "创建任务";
  if (reason === "rerun") return "任务重跑";
  if (reason === "manual_reset") return "重置位点";
  if (reason === "full_completed") return "全量完成";
  if (reason === "lease_assign") return "分配节点";
  if (reason === "failover_takeover") return "故障接管";
  if (reason === "lease_unassigned") return "等待接管";
  if (reason.startsWith("lifecycle_")) {
    const action = reason.replace("lifecycle_", "");
    if (action === "start") return "启动任务";
    if (action === "pause") return "暂停任务";
    if (action === "resume") return "恢复任务";
    if (action === "stop") return "停止任务";
  }
  return reason;
}

function checkpointReasonTone(reason: string) {
  if (reason === "failover_takeover") return "yellow";
  if (reason === "lease_unassigned") return "red";
  if (reason === "manual_reset") return "blue";
  if (reason === "full_completed") return "green";
  return "neutral";
}

function taskLogTone(level: string) {
  if (level === "error") return "red";
  if (level === "warn") return "yellow";
  return "blue";
}

function taskPrimaryAction(task: SyncTask): "start" | "pause" | "resume" | "stop" | null {
  if (task.status === "draft" || task.status === "pending" || task.status === "failed" || task.status === "stopped") return "start";
  if (task.status === "paused") return "resume";
  if (task.status === "full_syncing" || task.status === "incremental_running") return "pause";
  return null;
}

function taskActionLabel(action: "start" | "pause" | "resume" | "stop" | null) {
  if (action === "start") return "启动";
  if (action === "resume") return "恢复";
  if (action === "pause") return "暂停";
  if (action === "stop") return "停止";
  return "";
}

function nodeActionTitle(action: NodeOperationResult["action"]) {
  if (action === "deploy") return "部署结果";
  if (action === "upgrade") return "升级结果";
  return "卸载结果";
}

export default App;
