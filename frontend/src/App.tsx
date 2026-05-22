import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowsClockwise,
  BellRinging,
  CheckCircle,
  Cloud,
  ClipboardText,
  Database,
  FileText,
  FlowArrow,
  Gauge,
  GearSix,
  GitBranch,
  Plus,
  Pulse,
  ShieldCheck,
  SignOut,
  Stack,
  Table,
  WarningCircle,
  XCircle
} from "@phosphor-icons/react";
import { StatusBadge } from "./components/StatusBadge";
import { api, clearToken, getToken, setToken } from "./lib/api";
import { cx, formatDate, formatNumber } from "./lib/format";
import { CapabilityView } from "./views/CapabilityView";
import { ClusterView } from "./views/ClusterView";
import { TaskView } from "./views/TaskView";
import type {
  CapabilityJob,
  DashboardSummary,
  ClusterSnapshot,
  Datasource,
  ErrorEvent,
  FieldMapping,
  OperationLog,
  SyncStrategy,
  SyncTask,
  TableColumn,
  TableInfo,
  User
} from "./types/api";

type View = "dashboard" | "datasources" | "tasks" | "wizard" | "structure" | "quality" | "subscription" | "cluster" | "errors" | "logs" | "settings";

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

const navItems: Array<{ id: View; label: string; icon: typeof Gauge }> = [
  { id: "dashboard", label: "作战室", icon: Gauge },
  { id: "datasources", label: "数据源", icon: Database },
  { id: "tasks", label: "任务中心", icon: FlowArrow },
  { id: "wizard", label: "新建任务", icon: Plus },
  { id: "structure", label: "结构迁移", icon: Stack },
  { id: "quality", label: "校验订正", icon: ShieldCheck },
  { id: "subscription", label: "订阅变更", icon: GitBranch },
  { id: "cluster", label: "节点集群", icon: Cloud },
  { id: "errors", label: "错误中心", icon: WarningCircle },
  { id: "logs", label: "操作日志", icon: ClipboardText },
  { id: "settings", label: "系统设置", icon: GearSix }
];

function App() {
  const [tokenState, setTokenState] = useState(getToken());
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [tasks, setTasks] = useState<SyncTask[]>([]);
  const [errors, setErrors] = useState<ErrorEvent[]>([]);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [cluster, setCluster] = useState<ClusterSnapshot | null>(null);
  const [capabilityJobs, setCapabilityJobs] = useState<CapabilityJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!getToken()) return;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [nextSummary, nextDatasources, nextTasks, nextErrors, nextLogs, nextCluster, nextCapabilityJobs] = await Promise.all([
        api.summary(),
        api.datasources(),
        api.tasks(),
        api.errors(),
        api.logs(),
        api.cluster(),
        api.capabilityJobs()
      ]);
      setSummary(nextSummary);
      setDatasources(nextDatasources);
      setTasks(nextTasks);
      setErrors(nextErrors);
      setLogs(nextLogs);
      setCluster(nextCluster);
      setCapabilityJobs(nextCapabilityJobs);
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

  const handleLogin = async (username: string, password: string) => {
    const response = await api.login({ username, password });
    setToken(response.token);
    setTokenState(response.token);
    setUser(response.user);
    setView("dashboard");
    setNotice("登录成功");
  };

  const handleLogout = () => {
    clearToken();
    setTokenState(null);
    setUser(null);
    setNotice(null);
  };

  const handleTaskAction = async (task: SyncTask, action: "start" | "pause" | "resume" | "stop" | "copy") => {
    await api.taskAction(task.id, action);
    setNotice(action === "copy" ? "任务已复制为草稿" : "任务状态已更新");
    await refresh(true);
  };

  if (!tokenState) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-[100dvh] bg-mist text-ink">
      <div className="mx-auto grid min-h-[100dvh] max-w-[1500px] grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-b border-line bg-[#fdfdf9] px-4 py-4 lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
          <div className="flex items-center justify-between lg:block">
            <div>
              <div className="text-xl font-semibold tracking-tight text-coal">Canal Plus</div>
              <div className="mt-1 text-xs text-muted">MySQL CDC 控制台</div>
            </div>
            <button
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-zinc-600 transition active:scale-[0.98] lg:hidden"
              onClick={handleLogout}
              title="退出登录"
            >
              <SignOut size={18} />
            </button>
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

          <div className="mt-8 hidden border-t border-line pt-5 lg:block">
            <div className="text-xs uppercase tracking-[0.16em] text-muted">当前账号</div>
            <div className="mt-3 rounded-lg border border-line bg-white p-3">
              <div className="text-sm font-medium text-coal">{user?.name || "admin"}</div>
              <div className="mt-1 text-xs text-muted">{user?.role === "admin" ? "管理员" : "普通用户"}</div>
            </div>
            <button
              onClick={handleLogout}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98]"
            >
              <SignOut size={16} />
              退出登录
            </button>
          </div>
        </aside>

        <main className="min-w-0 px-4 py-5 md:px-6 lg:px-8 lg:py-7">
          <Header view={view} user={user} onRefresh={() => refresh()} />

          {notice && (
            <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle size={18} />
              <span>{notice}</span>
              <button className="ml-auto text-emerald-700" onClick={() => setNotice(null)}>关闭</button>
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
                <Dashboard summary={summary} tasks={tasks} errors={errors} logs={logs} cluster={cluster} />
              )}
              {view === "datasources" && (
                <DatasourceView datasources={datasources} onChanged={() => refresh(true)} />
              )}
              {view === "tasks" && (
                <TaskView tasks={tasks} errors={errors} logs={logs} cluster={cluster} onAction={handleTaskAction} onChanged={() => refresh(true)} />
              )}
              {view === "wizard" && (
                <TaskWizard datasources={datasources} onCreated={() => {
                  setNotice("同步任务已创建");
                  setView("tasks");
                  refresh(true);
                }} />
              )}
              {view === "structure" && (
                <CapabilityView mode="structure" tasks={tasks} datasources={datasources} jobs={capabilityJobs} onChanged={() => refresh(true)} />
              )}
              {view === "quality" && (
                <CapabilityView mode="quality" tasks={tasks} datasources={datasources} jobs={capabilityJobs} onChanged={() => refresh(true)} />
              )}
              {view === "subscription" && (
                <CapabilityView mode="subscription" tasks={tasks} datasources={datasources} jobs={capabilityJobs} onChanged={() => refresh(true)} />
              )}
              {view === "cluster" && (
                <ClusterView cluster={cluster} tasks={tasks} onChanged={() => refresh(true)} />
              )}
              {view === "errors" && (
                <ErrorCenter errors={errors} onChanged={() => refresh(true)} />
              )}
              {view === "logs" && (
                <OperationLogs logs={logs} />
              )}
              {view === "settings" && (
                <SettingsView />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Header({ view, user, onRefresh }: { view: View; user: User | null; onRefresh: () => void }) {
  const title = navItems.find((item) => item.id === view)?.label || "控制台";
  return (
    <div className="mb-6 flex flex-col gap-4 border-b border-line pb-5 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="text-sm text-muted">Canal Plus / {title}</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-coal md:text-4xl">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-600 md:block">
          {user?.name || "admin"}
        </div>
        <button
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98]"
        >
          <ArrowsClockwise size={16} />
          刷新
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
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-sm text-accent">
            <Pulse size={16} />
            MySQL CDC 控制台
          </div>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-coal md:text-6xl">
            用任务向导管理 binlog 同步
          </h1>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {["无配置文件创建任务", "全量与增量运行态", "错误重试与跳过", "数据源连接探测"].map((item) => (
              <div key={item} className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-zinc-700 shadow-panel">
                {item}
              </div>
            ))}
          </div>
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
  logs,
  cluster
}: {
  summary: DashboardSummary | null;
  tasks: SyncTask[];
  errors: ErrorEvent[];
  logs: OperationLog[];
  cluster: ClusterSnapshot | null;
}) {
  const highDelayTask = [...tasks].sort((a, b) => (b.runtime?.delaySeconds ?? 0) - (a.runtime?.delaySeconds ?? 0))[0];
  const failedTasks = tasks.filter((task) => task.status === "failed");
  const metrics = [
    { label: "任务总数", value: summary?.taskTotal ?? 0, detail: `${summary?.runningTasks ?? 0} 个运行中` },
    { label: "异常任务", value: summary?.failedTasks ?? 0, detail: `${summary?.failuresLast24Hours ?? 0} 条 24h 错误` },
    { label: "平均延迟", value: `${summary?.averageDelaySeconds ?? 0}s`, detail: "运行中任务" },
    { label: "事件吞吐", value: `${formatNumber(summary?.eventsPerSecond ?? 0)}/s`, detail: "当前估算" },
    { label: "在线节点", value: `${summary?.onlineNodes ?? 0}/${summary?.totalNodes ?? 0}`, detail: `${summary?.failoverCount ?? 0} 次接管` }
  ];

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-[1.4rem] border border-line bg-[#111412] p-5 text-white shadow-panel">
        <div className="absolute inset-y-0 right-0 w-1/2 opacity-30 [background:radial-gradient(circle_at_65%_35%,#66d0a0,transparent_32%),linear-gradient(135deg,transparent,#ffffff12)]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-emerald-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
              <Pulse size={15} />
              分布式数据管道作战室
            </div>
            <h2 className="mt-5 max-w-3xl text-3xl font-semibold leading-tight tracking-tight md:text-5xl">
              从任务编排、结构准备到数据质量，统一在一张运行图里处理。
            </h2>
          </div>
          <div className="grid gap-2 rounded-xl border border-white/10 bg-white/10 p-4 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
            {(cluster?.nodes ?? []).slice(0, 3).map((node) => (
              <div key={node.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/10 px-3 py-2">
                <span className="font-medium">{node.name}</span>
                <span className="font-mono text-xs text-emerald-100">{node.runningTasks}/{node.capacity} tasks</span>
                <span className={cx("h-2.5 w-2.5 rounded-full", node.status === "online" ? "bg-emerald-300" : node.status === "draining" ? "bg-amber-300" : "bg-red-300")} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.55fr_0.9fr]">
      <section className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-lg border border-line bg-white p-4 shadow-panel">
              <div className="text-sm text-muted">{metric.label}</div>
              <div className="mt-3 font-mono text-3xl font-semibold text-coal">{metric.value}</div>
              <div className="mt-2 text-xs text-zinc-500">{metric.detail}</div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-coal">任务运行面</h2>
              <p className="mt-1 text-sm text-muted">当前同步阶段、延迟和位点</p>
            </div>
            <div className="rounded-lg bg-zinc-100 px-3 py-2 font-mono text-sm text-zinc-700">
              全量 {summary?.fullSyncProgress ?? 0}%
            </div>
          </div>

          <div className="mt-5 divide-y divide-line">
            {tasks.slice(0, 6).map((task) => (
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
            <h2 className="font-semibold tracking-tight">风险队列</h2>
          </div>
          <div className="mt-4 space-y-3">
            {failedTasks.length === 0 && errors.length === 0 ? (
              <EmptyState title="暂无待处理异常" description="任务运行态正常" />
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
          <h2 className="font-semibold tracking-tight text-coal">最高延迟</h2>
          {highDelayTask ? (
            <div className="mt-4">
              <div className="text-sm text-muted">{highDelayTask.name}</div>
              <div className="mt-2 font-mono text-4xl font-semibold text-coal">{highDelayTask.runtime?.delaySeconds ?? 0}s</div>
              <div className="mt-2 text-sm text-zinc-600">{highDelayTask.runtime?.binlogFile}</div>
            </div>
          ) : (
            <EmptyState title="暂无任务" description="创建任务后展示同步延迟" />
          )}
        </div>

        <div className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <h2 className="font-semibold tracking-tight text-coal">最近操作</h2>
          <div className="mt-4 space-y-3">
            {logs.slice(0, 5).map((log) => (
              <div key={log.id} className="border-l border-line pl-3">
                <div className="text-sm text-coal">{log.detail}</div>
                <div className="mt-1 text-xs text-muted">{formatDate(log.createdAt)} / {log.actor}</div>
              </div>
            ))}
          </div>
        </div>
      </aside>
      </div>
    </div>
  );
}

function DatasourceView({ datasources, onChanged }: { datasources: Datasource[]; onChanged: () => Promise<void> | void }) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    purpose: "source",
    host: "",
    port: 3306,
    username: "",
    password: "",
    defaultSchema: ""
  });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    await api.createDatasource(form);
    setFormOpen(false);
    setForm({ name: "", purpose: "source", host: "", port: 3306, username: "", password: "", defaultSchema: "" });
    await onChanged();
  };

  const test = async (datasource: Datasource) => {
    setMessage(null);
    setError(null);
    try {
      const next = await api.testDatasource(datasource.id);
      setMessage(`${next.name}: ${next.lastTestMessage || "连接成功"}`);
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "连接失败");
      await onChanged();
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <section className="rounded-xl border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-coal">数据源</h2>
            <div className="mt-1 text-sm text-muted">源端与目标端连接资产</div>
          </div>
          <button
            onClick={() => setFormOpen((value) => !value)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98]"
          >
            <Plus size={16} />
            新增
          </button>
        </div>

        <div className="divide-y divide-line">
          {datasources.map((datasource) => (
            <div key={datasource.id} className="grid gap-3 p-5 md:grid-cols-[1fr_0.7fr_0.7fr_auto] md:items-center">
              <div>
                <div className="flex items-center gap-2">
                  <Database size={18} className="text-accent" />
                  <span className="font-medium text-coal">{datasource.name}</span>
                  <span className={cx(
                    "rounded-full border px-2 py-0.5 text-xs",
                    datasource.connectionStatus === "online" && "border-emerald-200 bg-emerald-50 text-emerald-700",
                    datasource.connectionStatus === "offline" && "border-red-200 bg-red-50 text-red-700",
                    datasource.connectionStatus === "untested" && "border-zinc-200 bg-zinc-50 text-zinc-600"
                  )}>
                    {datasource.connectionStatus === "online" ? "在线" : datasource.connectionStatus === "offline" ? "离线" : "未测试"}
                  </span>
                </div>
                <div className="mt-1 text-sm text-muted">{datasource.host}:{datasource.port} / {datasource.username}</div>
              </div>
              <div className="text-sm text-zinc-600">用途：{purposeLabel(datasource.purpose)}</div>
              <div className="text-sm text-zinc-600">库：{datasource.defaultSchema || "-"}</div>
              <button
                onClick={() => test(datasource)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98]"
              >
                <Pulse size={16} />
                测试
              </button>
            </div>
          ))}
        </div>
      </section>

      <aside className="space-y-4">
        {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {formOpen ? (
          <form onSubmit={submit} className="rounded-xl border border-line bg-white p-5 shadow-panel">
            <h2 className="font-semibold tracking-tight text-coal">新增数据源</h2>
            <div className="mt-4 space-y-4">
              <Field label="名称">
                <input className="control" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
              </Field>
              <Field label="用途">
                <select className="control" value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })}>
                  <option value="source">源端</option>
                  <option value="target">目标端</option>
                  <option value="both">源端和目标端</option>
                </select>
              </Field>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <Field label="Host">
                  <input className="control" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} required />
                </Field>
                <Field label="Port">
                  <input className="control" type="number" value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} required />
                </Field>
              </div>
              <Field label="账号">
                <input className="control" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
              </Field>
              <Field label="密码">
                <input className="control" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
              </Field>
              <Field label="默认库">
                <input className="control" value={form.defaultSchema} onChange={(event) => setForm({ ...form, defaultSchema: event.target.value })} />
              </Field>
              <button className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2.5 text-sm text-white transition active:scale-[0.98]">
                <Plus size={16} />
                保存数据源
              </button>
            </div>
          </form>
        ) : (
          <div className="rounded-xl border border-line bg-[#fcfcf8] p-5 shadow-panel">
            <h2 className="font-semibold tracking-tight text-coal">连接规则</h2>
            <div className="mt-4 space-y-3 text-sm text-zinc-600">
              <div className="border-l border-line pl-3">密码只在后端加密保存，前端不读取明文。</div>
              <div className="border-l border-line pl-3">真实 MySQL 可读取 schema、table 和 column 元数据。</div>
              <div className="border-l border-line pl-3">被任务引用的数据源由后端阻止删除。</div>
            </div>
          </div>
        )}
      </aside>
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.defaultStrategy().then(setStrategy).catch(() => undefined);
  }, []);

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

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.createTask({
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
      onCreated();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "创建任务失败");
    } finally {
      setLoading(false);
    }
  };

  const stepTitles = ["任务", "源端", "目标端", "映射", "策略", "预览"];

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
            <SectionTitle title="配置预览" subtitle="发布后生成待启动任务" />
            <div className="rounded-lg border border-line bg-[#fcfcf8] p-4 text-sm">
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-700">
{JSON.stringify({
  name: draft.name,
  owner: draft.owner,
  source: `${draft.sourceSchema}.${draft.sourceTable}`,
  target: `${draft.targetSchema}.${draft.targetTable}`,
  fields: fieldMappings.filter((field) => !field.ignored).map((field) => `${field.sourceField} -> ${field.targetField}`),
  strategy
}, null, 2)}
              </pre>
            </div>
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
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckCircle size={16} />
              {loading ? "发布中" : "发布任务"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function ErrorCenter({ errors, onChanged }: { errors: ErrorEvent[]; onChanged: () => Promise<void> | void }) {
  const retry = async (event: ErrorEvent) => {
    await api.retryError(event.id);
    await onChanged();
  };

  const skip = async (event: ErrorEvent) => {
    const reason = window.prompt("跳过原因");
    if (!reason) return;
    await api.skipError(event.id, reason);
    await onChanged();
  };

  return (
    <section className="rounded-xl border border-line bg-white shadow-panel">
      <div className="border-b border-line p-5">
        <h2 className="text-lg font-semibold tracking-tight text-coal">错误事件</h2>
        <div className="mt-1 text-sm text-muted">失败事件、binlog 位点和处理动作</div>
      </div>
      {errors.length === 0 ? (
        <div className="p-8">
          <EmptyState title="暂无错误事件" description="运行异常会进入这里" />
        </div>
      ) : (
        <div className="divide-y divide-line">
          {errors.map((event) => (
            <div key={event.id} className="grid gap-4 p-5 xl:grid-cols-[1fr_0.8fr_auto] xl:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-coal">{event.sourceTable}</span>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">{event.status}</span>
                </div>
                <div className="mt-1 text-sm text-red-700">{event.reason}</div>
                <div className="mt-2 font-mono text-xs text-muted">{event.rawEventSummary}</div>
              </div>
              <div className="font-mono text-sm text-zinc-700">
                {event.binlogFile}:{event.binlogPosition}
                <div className="mt-1 text-xs text-muted">PK {event.primaryKeyValue}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => retry(event)} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm transition hover:bg-zinc-50 active:scale-[0.98]">
                  <ArrowsClockwise size={16} />
                  重试
                </button>
                <button onClick={() => skip(event)} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm transition hover:bg-zinc-50 active:scale-[0.98]">
                  <ArrowRight size={16} />
                  跳过
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function OperationLogs({ logs }: { logs: OperationLog[] }) {
  return (
    <section className="rounded-xl border border-line bg-white shadow-panel">
      <div className="border-b border-line p-5">
        <h2 className="text-lg font-semibold tracking-tight text-coal">操作日志</h2>
        <div className="mt-1 text-sm text-muted">关键操作审计</div>
      </div>
      <div className="divide-y divide-line">
        {logs.map((log) => (
          <div key={log.id} className="grid gap-2 p-5 md:grid-cols-[160px_130px_1fr_140px] md:items-center">
            <div className="text-sm text-muted">{formatDate(log.createdAt)}</div>
            <div className="font-mono text-sm text-zinc-700">{log.actor}</div>
            <div className="text-sm text-coal">{log.detail}</div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted">{log.action}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsView() {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-coal">
          <BellRinging size={20} />
          <h2 className="font-semibold tracking-tight">告警</h2>
        </div>
        <div className="mt-4 grid gap-4">
          <Field label="默认延迟阈值秒">
            <input className="control" defaultValue={300} type="number" />
          </Field>
          <Field label="错误次数阈值">
            <input className="control" defaultValue={1} type="number" />
          </Field>
          <Field label="Webhook">
            <input className="control" placeholder="https://example.com/webhook" />
          </Field>
        </div>
      </section>
      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center gap-2 text-coal">
          <FileText size={20} />
          <h2 className="font-semibold tracking-tight">版本边界</h2>
        </div>
        <div className="mt-4 space-y-3 text-sm text-zinc-600">
          <div className="border-l border-line pl-3">当前实现为控制台和 API MVP。</div>
          <div className="border-l border-line pl-3">binlog worker 已在任务运行态中预留状态模型。</div>
          <div className="border-l border-line pl-3">下一步可以接入真实 Canal 或 Debezium Embedded。</div>
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

function purposeLabel(purpose: Datasource["purpose"]) {
  if (purpose === "source") return "源端";
  if (purpose === "target") return "目标端";
  return "源端和目标端";
}

export default App;
