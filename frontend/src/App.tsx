import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowsClockwise,
  BellRinging,
  CheckCircle,
  Cloud,
  ClipboardText,
  Database,
  FlowArrow,
  Gauge,
  GearSix,
  GitBranch,
  Pulse,
  ShieldCheck,
  SignOut,
  Stack,
  Table,
  WarningCircle,
  XCircle
} from "@phosphor-icons/react";
import { StatusBadge } from "./components/StatusBadge";
import { PermissionNotice } from "./components/PermissionNotice";
import { api, clearToken, getToken, setToken } from "./lib/api";
import { cx, formatDate, formatNumber } from "./lib/format";
import { canManageConfig, roleLabel } from "./lib/permissions";
import { CapabilityView } from "./views/CapabilityView";
import { ClusterView } from "./views/ClusterView";
import { DatasourceView } from "./views/DatasourceView";
import { ErrorCenterView } from "./views/ErrorCenterView";
import { OperationLogsView } from "./views/OperationLogsView";
import { SettingsView } from "./views/SettingsView";
import { TaskView } from "./views/TaskView";
import type {
  AlertRule,
  AlertEvent,
  AlertRuleEvaluation,
  CapabilityJob,
  DashboardSummary,
  ClusterSnapshot,
  Datasource,
  ErrorEvent,
  FieldMapping,
  OperationLog,
  TaskPreflightCheck,
  TaskPreflightReport,
  SyncStrategy,
  SyncTask,
  TableColumn,
  TableInfo,
  User
} from "./types/api";

type View = "dashboard" | "datasources" | "tasks" | "wizard" | "structure" | "quality" | "subscription" | "cluster" | "errors" | "logs" | "settings";
type NavView = Exclude<View, "wizard">;

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

const navItems: Array<{ id: NavView; label: string; icon: typeof Gauge }> = [
  { id: "dashboard", label: "概览", icon: Gauge },
  { id: "datasources", label: "数据源", icon: Database },
  { id: "tasks", label: "任务", icon: FlowArrow },
  { id: "structure", label: "结构迁移", icon: Stack },
  { id: "quality", label: "校验订正", icon: ShieldCheck },
  { id: "subscription", label: "订阅变更", icon: GitBranch },
  { id: "cluster", label: "节点", icon: Cloud },
  { id: "errors", label: "错误", icon: WarningCircle },
  { id: "logs", label: "日志", icon: ClipboardText },
  { id: "settings", label: "设置", icon: GearSix }
];

const viewTitles: Record<View, string> = {
  dashboard: "概览",
  datasources: "数据源",
  tasks: "任务",
  wizard: "新建任务",
  structure: "结构迁移",
  quality: "校验订正",
  subscription: "订阅变更",
  cluster: "节点",
  errors: "错误",
  logs: "日志",
  settings: "设置"
};

function App() {
  const [tokenState, setTokenState] = useState(getToken());
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>("tasks");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
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
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = canManageConfig(user);

  const refresh = useCallback(async (quiet = false) => {
    if (!getToken()) return;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [nextSummary, nextDatasources, nextTasks, nextErrors, nextLogs, nextCluster, nextCapabilityJobs, nextAlertRules, nextAlertState] = await Promise.all([
        api.summary(),
        api.datasources(),
        api.tasks(),
        api.errors(),
        api.logs(),
        api.cluster(),
        api.capabilityJobs(),
        api.alertRules(),
        api.alertEvaluations().then(async (evaluations) => ({
          evaluations,
          events: await api.alertEvents()
        }))
      ]);
      setSummary(nextSummary);
      setDatasources(nextDatasources);
      setTasks(nextTasks);
      setErrors(nextErrors);
      setLogs(nextLogs);
      setCluster(nextCluster);
      setCapabilityJobs(nextCapabilityJobs);
      setAlertRules(nextAlertRules);
      setAlertEvents(nextAlertState.events);
      setAlertEvaluations(nextAlertState.evaluations);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!tokenState) return;
    api.me()
      .then(setUser)
      .catch(() => {
        clearToken();
        setTokenState(null);
      });
    refresh();
  }, [refresh, tokenState]);

  useEffect(() => {
    if (!tokenState) return;
    const timer = window.setInterval(() => refresh(true), 6000);
    return () => window.clearInterval(timer);
  }, [refresh, tokenState]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleLogin = async (username: string, password: string) => {
    const response = await api.login({ username, password });
    setToken(response.token);
    setTokenState(response.token);
    setUser(response.user);
    setView("tasks");
    setNotice("登录成功");
  };

  const handleLogout = () => {
    clearToken();
    setTokenState(null);
    setUser(null);
    setNotice(null);
  };

  const handleTaskAction = async (task: SyncTask, action: "start" | "pause" | "resume" | "stop" | "copy") => {
    if (action === "copy" && !canManage) {
      setError("复制任务会创建新配置，需要管理员权限");
      return;
    }
    setError(null);
    try {
      await api.taskAction(task.id, action);
      setNotice(action === "copy" ? "任务已复制为草稿" : "任务状态已更新");
      await refresh(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "任务操作失败");
    }
  };

  if (!tokenState) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-[100dvh] bg-mist text-ink">
      <div className="mx-auto grid min-h-[100dvh] max-w-[1500px] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-b border-line bg-[#fdfdf9] px-4 py-4 lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
          <div>
            <div className="text-xl font-semibold tracking-tight text-coal">canal-plus</div>
          </div>

          <nav className="mt-5 flex gap-2 overflow-x-auto lg:block lg:space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={cx(
                    "inline-flex min-w-max items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition active:scale-[0.98] lg:w-full",
                    view === item.id
                      ? "bg-coal text-white shadow-panel"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-coal"
                  )}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 px-4 py-5 md:px-6 lg:px-8 lg:py-7">
          <Header view={view} user={user} onRefresh={() => refresh()} onLogout={handleLogout} />

          {notice && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle size={18} />
              <span>{notice}</span>
            </div>
          )}

          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <XCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {loading && !summary ? (
            <SkeletonPage />
          ) : (
            <>
              {view === "dashboard" && (
                <Dashboard summary={summary} tasks={tasks} errors={errors} cluster={cluster} />
              )}
              {view === "datasources" && (
                <DatasourceView datasources={datasources} tasks={tasks} canManage={canManage} onChanged={() => refresh(true)} />
              )}
              {view === "tasks" && (
                <TaskView
                  tasks={tasks}
                  errors={errors}
                  logs={logs}
                  cluster={cluster}
                  canManage={canManage}
                  onAction={handleTaskAction}
                  onCreate={() => setView("wizard")}
                  onChanged={() => refresh(true)}
                />
              )}
              {view === "wizard" && (
                canManage ? (
                  <TaskWizard datasources={datasources} onCreated={() => {
                    setNotice("同步任务已创建");
                    setView("tasks");
                    refresh(true);
                  }} />
                ) : (
                  <PermissionNotice
                    title="新建任务需要管理员"
                    description="运维操作员可以启停任务、处理错误和查看运行态；新增同步链路会改变配置版本，需要管理员执行。"
                  />
                )
              )}
              {view === "structure" && (
                <CapabilityView mode="structure" tasks={tasks} datasources={datasources} jobs={capabilityJobs} canManage={canManage} onChanged={() => refresh(true)} />
              )}
              {view === "quality" && (
                <CapabilityView mode="quality" tasks={tasks} datasources={datasources} jobs={capabilityJobs} canManage={canManage} onChanged={() => refresh(true)} />
              )}
              {view === "subscription" && (
                <CapabilityView mode="subscription" tasks={tasks} datasources={datasources} jobs={capabilityJobs} canManage={canManage} onChanged={() => refresh(true)} />
              )}
              {view === "cluster" && (
                <ClusterView cluster={cluster} tasks={tasks} canManage={canManage} onChanged={() => refresh(true)} />
              )}
              {view === "errors" && (
                <ErrorCenterView errors={errors} tasks={tasks} onChanged={() => refresh(true)} />
              )}
              {view === "logs" && (
                <OperationLogsView logs={logs} />
              )}
              {view === "settings" && (
                <SettingsView alertRules={alertRules} alertEvents={alertEvents} evaluations={alertEvaluations} tasks={tasks} canManage={canManage} onChanged={() => refresh(true)} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Header({
  view,
  user,
  onRefresh,
  onLogout
}: {
  view: View;
  user: User | null;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const title = viewTitles[view] || "控制台";
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-line pb-5 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-coal md:text-4xl">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-600 sm:block">
          {user?.name || "admin"} · {roleLabel(user?.role)}
        </div>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98]"
        >
          <ArrowsClockwise size={16} />
          刷新
        </button>
        <button
          onClick={onLogout}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98]"
        >
          <SignOut size={16} />
          退出
        </button>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await onLogin(username, password);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-mist px-4 py-8 text-ink">
      <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-coal md:text-6xl">
            canal-plus
          </h1>
        </section>

        <form onSubmit={submit} className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <div className="text-xl font-semibold tracking-tight text-coal">登录</div>
          <div className="mt-5 space-y-4">
            <Field label="账号">
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 outline-none transition focus:border-accent"
              />
            </Field>
            <Field label="密码">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 outline-none transition focus:border-accent"
              />
            </Field>
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-coal px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ArrowRight size={16} />
              {loading ? "登录中" : "进入控制台"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Dashboard({
  summary,
  tasks,
  errors,
  cluster
}: {
  summary: DashboardSummary | null;
  tasks: SyncTask[];
  errors: ErrorEvent[];
  cluster: ClusterSnapshot | null;
}) {
  const highDelayTask = [...tasks].sort((a, b) => (b.runtime?.delaySeconds ?? 0) - (a.runtime?.delaySeconds ?? 0))[0];
  const activeTasks = [...tasks]
    .sort((left, right) => (right.runtime?.delaySeconds ?? 0) - (left.runtime?.delaySeconds ?? 0))
    .slice(0, 6);
  const failedTasks = tasks.filter((task) => task.status === "failed");
  const runningTasks = tasks.filter((task) => task.status === "incremental_running" || task.status === "full_syncing").length;
  const metrics = [
    { label: "任务", value: summary?.taskTotal ?? 0, detail: "总量" },
    { label: "运行中", value: runningTasks, detail: "当前运行" },
    { label: "异常", value: summary?.failedTasks ?? 0, detail: "待处理" },
    { label: "在线节点", value: `${summary?.onlineNodes ?? 0}/${summary?.totalNodes ?? 0}`, detail: "集群状态" }
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-lg border border-line bg-white p-4 shadow-panel">
            <div className="text-sm text-muted">{metric.label}</div>
            <div className="mt-3 font-mono text-3xl font-semibold text-coal">{metric.value}</div>
            <div className="mt-2 text-xs text-zinc-500">{metric.detail}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_0.9fr]">
      <section className="space-y-5">
        <div className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-coal">关键任务</h2>
            </div>
            <div className="rounded-lg bg-zinc-100 px-3 py-2 font-mono text-sm text-zinc-700">
              峰值延迟 {highDelayTask?.runtime?.delaySeconds ?? 0}s
            </div>
          </div>

          <div className="mt-5 divide-y divide-line">
            {activeTasks.map((task) => (
              <div key={task.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_minmax(230px,auto)] md:items-center">
                <div>
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                    <span className="font-medium text-coal">{task.name}</span>
                    <StatusBadge status={task.status} />
                  </div>
                  <div className="mt-1 text-sm text-muted">{task.sourceDatasource?.name} 到 {task.targetDatasource?.name}</div>
                </div>
                <div className="grid gap-2 text-sm text-zinc-600 sm:grid-cols-[minmax(120px,1fr)_auto_auto] sm:items-center">
                  <div className="break-all font-mono text-zinc-700">
                    {task.runtime?.binlogFile}:{task.runtime?.binlogPosition}
                  </div>
                  <div className="whitespace-nowrap">
                    延迟 <span className="font-mono text-coal">{task.runtime?.delaySeconds ?? 0}s</span>
                  </div>
                  <div className="whitespace-nowrap">
                    <span className="font-mono text-coal">{task.runtime?.eventsPerSecond ?? 0}</span> /s
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <aside className="space-y-5">
        <div className="rounded-xl border border-line bg-[#fcfcf8] p-5 shadow-panel">
          <div className="flex items-center gap-2 text-coal">
            <BellRinging size={20} />
            <h2 className="font-semibold tracking-tight">异常</h2>
          </div>
          <div className="mt-4 space-y-3">
            {failedTasks.length === 0 && errors.length === 0 ? (
              <EmptyState title="暂无异常" description="当前运行正常" />
            ) : (
              <>
                {failedTasks.map((task) => (
                  <div key={task.id} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {task.name} 处于异常状态
                  </div>
                ))}
                {errors.slice(0, 3).map((event) => (
                  <div key={event.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    {event.sourceTable} / {event.reason}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <h2 className="font-semibold tracking-tight text-coal">节点</h2>
          <div className="mt-4 space-y-3">
            {(cluster?.nodes ?? []).slice(0, 4).map((node) => (
              <div key={node.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-[#fcfcf8] px-3 py-2 text-sm">
                <span className="font-medium text-coal">{node.name}</span>
                <span className="font-mono text-xs text-zinc-600">{node.runningTasks}/{node.capacity}</span>
                <span className={cx("h-2.5 w-2.5 rounded-full", node.status === "online" ? "bg-emerald-400" : node.status === "draining" ? "bg-amber-400" : "bg-red-400")} />
              </div>
            ))}
          </div>
        </div>
      </aside>
      </div>
    </div>
  );
}

function TaskWizard({ datasources, onCreated }: { datasources: Datasource[]; onCreated: () => void }) {
  const sourceOptions = datasources.filter((item) => item.purpose === "source" || item.purpose === "both");
  const targetOptions = datasources.filter((item) => item.purpose === "target" || item.purpose === "both");
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState({
    name: "客户订单同步",
    description: "通过向导创建的 MySQL 到 MySQL 同步任务",
    owner: "数据平台",
    sourceDatasourceId: sourceOptions[0]?.id || "",
    targetDatasourceId: targetOptions[0]?.id || "",
    sourceSchema: "",
    sourceTable: "",
    targetSchema: "",
    targetTable: ""
  });
  const [strategy, setStrategy] = useState<SyncStrategy>(defaultStrategy);
  const [sourceSchemas, setSourceSchemas] = useState<string[]>([]);
  const [targetSchemas, setTargetSchemas] = useState<string[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [columns, setColumns] = useState<TableColumn[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [preflight, setPreflight] = useState<TaskPreflightReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.defaultStrategy().then(setStrategy).catch(() => undefined);
  }, []);

  useEffect(() => {
    setPreflight(null);
  }, [draft, fieldMappings, strategy]);

  useEffect(() => {
    if (!draft.sourceDatasourceId) return;
    api.schemas(draft.sourceDatasourceId)
      .then((schemas) => {
        setSourceSchemas(schemas);
        setDraft((value) => ({ ...value, sourceSchema: value.sourceSchema || schemas[0] || "" }));
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "读取源库失败"));
  }, [draft.sourceDatasourceId]);

  useEffect(() => {
    if (!draft.targetDatasourceId) return;
    api.schemas(draft.targetDatasourceId)
      .then((schemas) => {
        setTargetSchemas(schemas);
        setDraft((value) => ({ ...value, targetSchema: value.targetSchema || schemas[0] || "" }));
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "读取目标库失败"));
  }, [draft.targetDatasourceId]);

  useEffect(() => {
    if (!draft.sourceDatasourceId || !draft.sourceSchema) return;
    api.tables(draft.sourceDatasourceId, draft.sourceSchema)
      .then((nextTables) => {
        setTables(nextTables);
        setDraft((value) => ({ ...value, sourceTable: value.sourceTable || nextTables[0]?.name || "" }));
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "读取表失败"));
  }, [draft.sourceDatasourceId, draft.sourceSchema]);

  useEffect(() => {
    if (!draft.sourceDatasourceId || !draft.sourceSchema || !draft.sourceTable) return;
    api.columns(draft.sourceDatasourceId, draft.sourceSchema, draft.sourceTable)
      .then((nextColumns) => {
        setColumns(nextColumns);
        setFieldMappings(nextColumns.map((column) => ({
          sourceField: column.name,
          targetField: column.name,
          sourceType: column.type,
          targetType: column.type,
          primaryKey: column.primaryKey,
          nullable: column.nullable,
          ignored: false
        })));
        setDraft((value) => ({
          ...value,
          targetTable: value.targetTable || `ods_${value.sourceTable}`
        }));
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "读取字段失败"));
  }, [draft.sourceDatasourceId, draft.sourceSchema, draft.sourceTable]);

  const buildTaskInput = () => ({
    name: draft.name,
    description: draft.description,
    owner: draft.owner,
    sourceDatasourceId: draft.sourceDatasourceId,
    targetDatasourceId: draft.targetDatasourceId,
    tableMappings: [
      {
        sourceSchema: draft.sourceSchema,
        sourceTable: draft.sourceTable,
        targetSchema: draft.targetSchema,
        targetTable: draft.targetTable,
        fields: fieldMappings
      }
    ],
    strategy
  });

  const runPreflight = async () => {
    setChecking(true);
    setError(null);
    try {
      const report = await api.preflightTask(buildTaskInput());
      setPreflight(report);
      setStep(5);
      if (!report.ok) {
        setError("预检未通过，请处理失败项后再发布。");
      }
      return report;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "预检失败");
      return null;
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const report = preflight ?? await api.preflightTask(buildTaskInput());
      setPreflight(report);
      if (!report.ok) {
        setStep(5);
        setError("预检未通过，请处理失败项后再发布。");
        return;
      }
      await api.createTask(buildTaskInput());
      onCreated();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "创建任务失败");
    } finally {
      setLoading(false);
    }
  };

  const stepTitles = ["任务", "源端", "目标端", "映射", "策略", "预检"];

  return (
    <div className="grid gap-5 xl:grid-cols-[260px_1fr]">
      <aside className="rounded-xl border border-line bg-white p-4 shadow-panel">
        <div className="space-y-2">
          {stepTitles.map((title, index) => (
            <button
              key={title}
              onClick={() => setStep(index)}
              className={cx(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition active:scale-[0.98]",
                step === index ? "bg-coal text-white" : "text-zinc-600 hover:bg-zinc-50"
              )}
            >
              <span className="font-mono">{index + 1}</span>
              <span>{title}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {step === 0 && (
          <div className="space-y-4">
            <SectionTitle title="任务信息" subtitle="任务名称、负责人和描述" />
            <Field label="任务名称">
              <input className="control" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label="负责人">
              <input className="control" value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} />
            </Field>
            <Field label="描述">
              <textarea className="control min-h-24" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <SectionTitle title="源端 MySQL" subtitle="选择库表并读取字段" />
            <Field label="源数据源">
              <select className="control" value={draft.sourceDatasourceId} onChange={(event) => setDraft({ ...draft, sourceDatasourceId: event.target.value, sourceSchema: "", sourceTable: "" })}>
                {sourceOptions.map((datasource) => <option key={datasource.id} value={datasource.id}>{datasource.name}</option>)}
              </select>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="源库">
                <select className="control" value={draft.sourceSchema} onChange={(event) => setDraft({ ...draft, sourceSchema: event.target.value, sourceTable: "" })}>
                  {sourceSchemas.map((schema) => <option key={schema} value={schema}>{schema}</option>)}
                </select>
              </Field>
              <Field label="源表">
                <select className="control" value={draft.sourceTable} onChange={(event) => setDraft({ ...draft, sourceTable: event.target.value })}>
                  {tables.map((tableInfo) => <option key={tableInfo.name} value={tableInfo.name}>{tableInfo.name}</option>)}
                </select>
              </Field>
            </div>
            <ColumnPreview columns={columns} />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <SectionTitle title="目标 MySQL" subtitle="确认目标库表策略" />
            <Field label="目标数据源">
              <select className="control" value={draft.targetDatasourceId} onChange={(event) => setDraft({ ...draft, targetDatasourceId: event.target.value, targetSchema: "" })}>
                {targetOptions.map((datasource) => <option key={datasource.id} value={datasource.id}>{datasource.name}</option>)}
              </select>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="目标库">
                <select className="control" value={draft.targetSchema} onChange={(event) => setDraft({ ...draft, targetSchema: event.target.value })}>
                  {targetSchemas.map((schema) => <option key={schema} value={schema}>{schema}</option>)}
                </select>
              </Field>
              <Field label="目标表">
                <input className="control" value={draft.targetTable} onChange={(event) => setDraft({ ...draft, targetTable: event.target.value })} />
              </Field>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <SectionTitle title="字段映射" subtitle="同名字段已自动映射" />
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-zinc-50 text-xs uppercase tracking-[0.12em] text-muted">
                  <tr>
                    <th className="px-3 py-3">源字段</th>
                    <th className="px-3 py-3">目标字段</th>
                    <th className="px-3 py-3">类型</th>
                    <th className="px-3 py-3">主键</th>
                    <th className="px-3 py-3">忽略</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {fieldMappings.map((field, index) => (
                    <tr key={field.sourceField}>
                      <td className="px-3 py-3 font-mono text-zinc-700">{field.sourceField}</td>
                      <td className="px-3 py-3">
                        <input
                          className="w-full rounded-md border border-line px-2 py-1.5 outline-none focus:border-accent"
                          value={field.targetField}
                          onChange={(event) => {
                            const next = [...fieldMappings];
                            next[index] = { ...field, targetField: event.target.value };
                            setFieldMappings(next);
                          }}
                        />
                      </td>
                      <td className="px-3 py-3 text-zinc-600">{field.sourceType}</td>
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
        )}

        {step === 4 && (
          <div className="space-y-4">
            <SectionTitle title="同步策略" subtitle="初始化、写入模式和失败重试" />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="初始化策略">
                <select className="control" value={strategy.initMode} onChange={(event) => setStrategy({ ...strategy, initMode: event.target.value as SyncStrategy["initMode"] })}>
                  <option value="full_then_incremental">先全量后增量</option>
                  <option value="incremental_only">仅增量</option>
                </select>
              </Field>
              <Field label="冲突策略">
                <select className="control" value={strategy.conflictStrategy} onChange={(event) => setStrategy({ ...strategy, conflictStrategy: event.target.value as SyncStrategy["conflictStrategy"] })}>
                  <option value="overwrite">覆盖</option>
                  <option value="ignore">忽略</option>
                  <option value="fail">失败停止</option>
                </select>
              </Field>
              <Field label="删除策略">
                <select className="control" value={strategy.deleteStrategy} onChange={(event) => setStrategy({ ...strategy, deleteStrategy: event.target.value as SyncStrategy["deleteStrategy"] })}>
                  <option value="physical">物理删除</option>
                  <option value="soft_delete">软删除字段更新</option>
                  <option value="ignore">忽略删除</option>
                </select>
              </Field>
              <Field label="批量写入大小">
                <input className="control" type="number" value={strategy.batchSize} onChange={(event) => setStrategy({ ...strategy, batchSize: Number(event.target.value) })} />
              </Field>
              <Field label="失败重试次数">
                <input className="control" type="number" value={strategy.retryTimes} onChange={(event) => setStrategy({ ...strategy, retryTimes: Number(event.target.value) })} />
              </Field>
              <Field label="重试间隔秒">
                <input className="control" type="number" value={strategy.retryIntervalSeconds} onChange={(event) => setStrategy({ ...strategy, retryIntervalSeconds: Number(event.target.value) })} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-3">
              {(["insert", "update", "delete"] as const).map((mode) => (
                <label key={mode} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-zinc-700">
                  <input
                    type="checkbox"
                    checked={strategy.writeMode[mode]}
                    onChange={(event) => setStrategy({
                      ...strategy,
                      writeMode: { ...strategy.writeMode, [mode]: event.target.checked }
                    })}
                  />
                  {mode}
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <SectionTitle title="发布前预检" subtitle="连接性、表结构、策略、重复订阅和 node 承载能力" />
            <PreflightPanel report={preflight} checking={checking} onRun={runPreflight} />
          </div>
        )}

        <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:justify-between">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm text-zinc-700 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            上一步
          </button>
          {step < stepTitles.length - 1 ? (
            <button
              onClick={() => setStep(Math.min(stepTitles.length - 1, step + 1))}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-4 py-2 text-sm text-white transition active:scale-[0.98]"
            >
              下一步
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={loading || checking}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckCircle size={16} />
              {loading ? "发布中" : preflight?.ok ? "发布任务" : "预检并发布"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-zinc-700">{label}</span>
      {children}
    </label>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight text-coal">{title}</h2>
      <div className="mt-1 text-sm text-muted">{subtitle}</div>
    </div>
  );
}

const preflightStatusText: Record<TaskPreflightCheck["status"], string> = {
  passed: "通过",
  warning: "注意",
  failed: "失败"
};

function preflightStatusClass(status: TaskPreflightCheck["status"]) {
  if (status === "failed") return "border-red-200 bg-red-50 text-red-700";
  if (status === "warning") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function PreflightStatusIcon({ status }: { status: TaskPreflightCheck["status"] }) {
  if (status === "failed") return <XCircle size={17} />;
  if (status === "warning") return <WarningCircle size={17} />;
  return <CheckCircle size={17} />;
}

function PreflightPanel({
  report,
  checking,
  onRun
}: {
  report: TaskPreflightReport | null;
  checking: boolean;
  onRun: () => Promise<TaskPreflightReport | null>;
}) {
  if (!report) {
    return (
      <div className="rounded-xl border border-line bg-[#fcfcf8] p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-coal">
              <ShieldCheck size={20} />
              <h3 className="font-semibold tracking-tight">等待预检</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              发布前会检查源端连接、目标结构、字段兼容性、重复订阅、策略参数和 node 容量。预检通过后才会创建同步任务。
            </p>
          </div>
          <button
            onClick={() => void onRun()}
            disabled={checking}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-4 py-2 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Pulse size={16} />
            {checking ? "预检中" : "运行预检"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={cx(
        "rounded-xl border p-5",
        report.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"
      )}>
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={cx(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium",
                report.ok ? "border-emerald-300 bg-white text-emerald-800" : "border-red-300 bg-white text-red-700"
              )}>
                {report.ok ? <CheckCircle size={17} /> : <XCircle size={17} />}
                {report.ok ? "可发布" : "不可发布"}
              </span>
              <span className="font-mono text-sm text-zinc-600">score {report.score}</span>
              <span className="text-sm text-muted">{formatDate(report.generatedAt)}</span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <InfoPill label="通过" value={report.summary.passed} />
              <InfoPill label="注意" value={report.summary.warnings} />
              <InfoPill label="失败" value={report.summary.failed} />
              <InfoPill label="估算行数" value={formatNumber(report.estimatedRows)} />
            </div>
          </div>
          <button
            onClick={() => void onRun()}
            disabled={checking}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Pulse size={16} />
            {checking ? "预检中" : "重新预检"}
          </button>
        </div>
      </div>

      <div className="divide-y divide-line rounded-xl border border-line bg-white">
        {report.checks.map((check) => (
          <div key={check.id} className="grid gap-3 p-4 lg:grid-cols-[140px_minmax(0,1fr)_auto] lg:items-start">
            <div className="text-xs uppercase tracking-[0.14em] text-muted">{check.category}</div>
            <div className="min-w-0">
              <div className="font-medium text-coal">{check.title}</div>
              <div className="mt-1 text-sm text-zinc-600">{check.message}</div>
              {check.detail && check.detail.length > 0 && (
                <div className="mt-3 grid gap-2">
                  {check.detail.slice(0, 4).map((item) => (
                    <div key={item} className="rounded-lg border border-line bg-[#fcfcf8] px-3 py-2 font-mono text-xs text-zinc-600">
                      {item}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <span className={cx("inline-flex items-center justify-center gap-1 rounded-full border px-2.5 py-1 text-xs", preflightStatusClass(check.status))}>
              <PreflightStatusIcon status={check.status} />
              {preflightStatusText[check.status]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/70 bg-white px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-coal">{value}</div>
    </div>
  );
}

function ColumnPreview({ columns }: { columns: TableColumn[] }) {
  if (columns.length === 0) {
    return <EmptyState title="未读取到字段" description="选择可访问的源表" />;
  }
  return (
    <div className="rounded-lg border border-line">
      <div className="grid grid-cols-[1fr_0.8fr_80px] border-b border-line bg-zinc-50 px-3 py-2 text-xs uppercase tracking-[0.12em] text-muted">
        <span>字段</span>
        <span>类型</span>
        <span>主键</span>
      </div>
      {columns.map((column) => (
        <div key={column.name} className="grid grid-cols-[1fr_0.8fr_80px] border-b border-line px-3 py-2 text-sm last:border-b-0">
          <span className="font-mono text-zinc-700">{column.name}</span>
          <span className="text-zinc-600">{column.type}</span>
          <span>{column.primaryKey ? "是" : "否"}</span>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-[#fcfcf8] p-6 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-zinc-500">
        <Table size={18} />
      </div>
      <div className="mt-3 font-medium text-coal">{title}</div>
      <div className="mt-1 text-sm text-muted">{description}</div>
    </div>
  );
}

function SkeletonPage() {
  return (
    <div className="grid gap-4 lg:grid-cols-[1.5fr_0.9fr]">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-32 rounded-lg border border-line bg-white p-4">
              <div className="skeleton h-4 w-24 rounded" />
              <div className="skeleton mt-6 h-9 w-28 rounded" />
            </div>
          ))}
        </div>
        <div className="h-96 rounded-xl border border-line bg-white p-5">
          <div className="skeleton h-5 w-36 rounded" />
          <div className="mt-8 space-y-4">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="skeleton h-12 rounded" />)}
          </div>
        </div>
      </div>
      <div className="skeleton h-96 rounded-xl" />
    </div>
  );
}

export default App;
