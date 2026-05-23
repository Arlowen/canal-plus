import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
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
import { api, clearToken, getToken, setToken } from "./lib/api";
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
  SyncStrategy,
  SyncTask,
  TableColumn,
  TableInfo,
  TaskCheckpoint,
  TaskLogEntry,
  TaskPreflightReport,
  TaskRuntimeState,
  User
} from "./types/api";

type Page = "dashboard" | "datasources" | "tasks" | "nodes" | "settings";
type NoticeTone = "success" | "error" | "warning";
type TaskBlueprintType = "full_migration" | "incremental_sync" | "data_validation" | "data_correction" | "structure_compare";
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
  { id: "dashboard", label: "工作台", icon: SquaresFour },
  { id: "datasources", label: "数据源", icon: Database },
  { id: "tasks", label: "任务", icon: FlowArrow },
  { id: "nodes", label: "节点", icon: HardDrives },
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
  const [page, setPage] = useState<Page>("dashboard");
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [datasourceCreateToken, setDatasourceCreateToken] = useState(0);
  const [taskCreateToken, setTaskCreateToken] = useState(0);
  const [nodeCreateToken, setNodeCreateToken] = useState(0);
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
      setGlobalError(requestError instanceof Error ? requestError.message : "加载失败");
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
    void refresh();
  }, [refresh, tokenState]);

  useEffect(() => {
    if (!tokenState) return;
    const timer = window.setInterval(() => {
      void refresh(true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [refresh, tokenState]);

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
    setPage("dashboard");
    pushNotice({ tone: "success", message: "已进入控制台" });
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

  const openNodeCreator = () => {
    setPage("nodes");
    setNodeCreateToken((value) => value + 1);
  };

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

            <nav className="mt-4 grid gap-2">
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

            <div className="mt-5 rounded-3xl border border-line bg-slate-50/80 p-4">
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
                <div className="text-xs font-medium uppercase tracking-[0.22em] text-slate-500">Workspace</div>
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
              />
            ) : page === "nodes" ? (
              <NodesPage
                cluster={cluster}
                tasks={tasks}
                canManage={canManage}
                onChanged={refresh}
                pushNotice={pushNotice}
                openCreateToken={nodeCreateToken}
              />
            ) : (
              <SettingsPage
                user={user}
                tasks={tasks}
                logs={logs}
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
  onOpenNodes: () => void;
}) {
  const visibleCapabilityJobs = capabilityJobs.filter((job) => job.type !== "subscription");
  const recentWorkloads = buildWorkloads(tasks, visibleCapabilityJobs).slice(0, 6);
  const runningGovernance = visibleCapabilityJobs.filter((job) => job.status === "running").length;
  const failedTasks = tasks.filter((task) => task.status === "failed").length;
  const pendingErrors = errors.filter((item) => item.status === "pending").length;
  const onlineNodes = cluster?.onlineNodes ?? summary?.onlineNodes ?? 0;
  const totalNodes = cluster?.totalNodes ?? summary?.totalNodes ?? 0;
  const hasCreatedTasks = tasks.length > 0;
  const localNodeLabel = cluster?.localNodeName || cluster?.localNodeId || "当前节点";

  return (
    <div className="space-y-5">
      <section className="surface overflow-hidden p-6">
        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="chip border-blue-200 bg-blue-50 text-blue-700">工作台</div>
            <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-coal md:text-4xl">
              {hasCreatedTasks ? "聚焦运行状态，减少无关干扰。" : "核心链路先清晰，再扩展能力。"}
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
              {hasCreatedTasks
                ? "已有任务后，工作台只保留运行概览、异常和常用操作。需要扩展链路时，再进入任务或节点页面。"
                : "先添加数据源，再创建迁移或同步任务。校验、订正和结构对比会围绕已有同步链路展开，避免首次进入就面对一堆无关入口。"}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={onCreateDatasource} className="btn-primary">
                <Database size={16} />
                添加数据源
              </button>
              <button onClick={onCreateTask} className="btn-secondary">
                <FlowArrow size={16} />
                创建任务
              </button>
              <button onClick={onCreateNode} className="btn-secondary">
                <HardDrives size={16} />
                添加节点
              </button>
            </div>
          </div>

          {hasCreatedTasks ? (
            <div className="surface-muted p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-coal">当前重点</div>
                  <div className="mt-1 text-sm text-slate-500">优先关注运行中任务、异常和节点可用性。</div>
                </div>
                <WarningCircle size={20} className="text-blue-600" />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                <DetailCard label="运行中任务" value={`${(summary?.runningTasks ?? 0) + runningGovernance} 条`} />
                <DetailCard label="待处理异常" value={`${failedTasks + pendingErrors} 条`} />
                <DetailCard label="在线节点" value={`${onlineNodes}/${totalNodes}`} />
              </div>
            </div>
          ) : (
            <div className="surface-muted p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-coal">新用户路径</div>
                  <div className="mt-1 text-sm text-slate-500">按主路径完成第一条链路。</div>
                </div>
                <RocketLaunch size={20} className="text-blue-600" />
              </div>
              <div className="mt-5 grid gap-3">
                {[
                  "添加数据源",
                  "测试连接",
                  "创建任务",
                  "选择任务类型",
                  "配置任务",
                  "启动任务",
                  "查看运行状态"
                ].map((label, index) => (
                  <div key={label} className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">
                      {index + 1}
                    </div>
                    <div className="text-sm text-coal">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="数据源" value={summary?.taskTotal !== undefined ? datasources.length : datasources.length} detail="可用连接资产" tone="neutral" icon={Database} />
        <MetricCard label="任务" value={(summary?.taskTotal ?? tasks.length) + visibleCapabilityJobs.length} detail={`${tasks.length} 条同步任务，${visibleCapabilityJobs.length} 条治理任务`} tone="blue" icon={FlowArrow} />
        <MetricCard label="运行中" value={(summary?.runningTasks ?? 0) + runningGovernance} detail="同步与治理任务合计" tone="blue" icon={Play} />
        <MetricCard label="异常" value={failedTasks + pendingErrors} detail={`${failedTasks} 条任务异常，${pendingErrors} 条待处理错误`} tone={failedTasks + pendingErrors > 0 ? "red" : "green"} icon={WarningCircle} />
      </div>

      {datasources.length === 0 ? (
        <EmptyPanel
          icon={Database}
          title="先添加第一个数据源"
          description="添加数据源后，即可创建迁移、同步、校验、订正和结构对比任务。"
          action={
            <button onClick={onCreateDatasource} className="btn-primary">
              <Plus size={16} />
              添加数据源
            </button>
          }
        />
      ) : tasks.length === 0 ? (
        <section className="grid gap-5 xl:grid-cols-[1fr_0.95fr]">
          <div className="surface p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold tracking-tight text-coal">创建第一条任务</h3>
                <p className="mt-2 text-sm text-slate-500">先确定任务目标，再按类型进入对应配置。</p>
              </div>
              <button onClick={onCreateTask} className="btn-primary">
                <Plus size={16} />
                创建任务
              </button>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {taskBlueprints.map((item) => (
                <div key={item.type} className="rounded-3xl border border-line bg-slate-50/70 p-4">
                  <div className="chip border-blue-100 bg-white text-blue-700">{item.tag}</div>
                  <div className="mt-4 text-lg font-semibold text-coal">{item.name}</div>
                  <div className="mt-2 text-sm text-slate-500">{item.description}</div>
                  <div className="mt-2 text-sm text-slate-500">{item.scenario}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="surface p-6">
            <h3 className="text-xl font-semibold tracking-tight text-coal">下一步建议</h3>
            <div className="mt-5 grid gap-3">
              <NextStepCard
                title="先验证连接"
                description="至少保留一个源端和一个目标端数据源，并完成连接测试。"
                actionLabel="查看数据源"
                onClick={onCreateDatasource}
              />
              <NextStepCard
                title="优先跑全量迁移"
                description="新链路建议先完成存量导入，再决定是否追加增量同步。"
                actionLabel="创建任务"
                onClick={onCreateTask}
              />
            </div>
          </div>
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <section className="surface p-6">
            <SectionHeader
              title="最近任务"
              description="按最近更新时间排序。"
              action={
                <button onClick={onOpenTasks} className="btn-secondary">
                  查看全部
                </button>
              }
            />
            <div className="mt-5 divide-y divide-line overflow-hidden rounded-3xl border border-line">
              {recentWorkloads.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">暂无任务</div>
              ) : recentWorkloads.map((item) => (
                <div key={item.key} className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-coal">{item.title}</span>
                      <TypeBadge type={item.type} />
                    </div>
                    <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-coal">{item.statusText}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatDate(item.updatedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="space-y-5">
            <section className="surface p-6">
              <SectionHeader title="下一步" description="把高频操作留在主路径。" />
              <div className="mt-5 grid gap-3">
                {datasources.length < 2 && (
                  <NextStepCard
                    title="补齐源端和目标端"
                    description="至少准备两个可用数据源，才能建立稳定链路。"
                    actionLabel="添加数据源"
                    onClick={onCreateDatasource}
                  />
                )}
                {onlineNodes === 0 && (
                  <NextStepCard
                    title="部署节点"
                    description="没有在线节点时，任务无法启动或接管。"
                    actionLabel="添加节点"
                    onClick={onCreateNode}
                  />
                )}
                {pendingErrors > 0 && (
                  <NextStepCard
                    title="处理异常"
                    description={`当前有 ${pendingErrors} 条待处理错误事件。`}
                    actionLabel="查看任务"
                    onClick={onOpenTasks}
                  />
                )}
                {failedTasks === 0 && pendingErrors === 0 && onlineNodes > 0 && (
                  <NextStepCard
                    title="链路状态稳定"
                    description="可以继续补充校验、订正或结构对比任务。"
                    actionLabel="创建任务"
                    onClick={onCreateTask}
                  />
                )}
              </div>
            </section>

            <section className="surface p-6">
              <SectionHeader title="节点状态" description="关注在线节点和承载能力。" />
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <MetricMini label="在线节点" value={`${onlineNodes}/${totalNodes}`} />
                <MetricMini label="运行任务" value={`${summary?.runningTasks ?? 0}`} />
                <MetricMini label="24h 异常" value={`${summary?.failuresLast24Hours ?? 0}`} />
              </div>
              <div className="mt-4 rounded-2xl border border-line bg-slate-50/70 px-4 py-3 text-sm text-slate-500">
                当前控制节点：<span className="font-medium text-coal">{localNodeLabel}</span>
              </div>
              <button onClick={onOpenNodes} className="btn-secondary mt-4 w-full">
                查看节点
              </button>
            </section>
          </div>
        </div>
      )}
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
      return matchesKeyword && matchesStatus;
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
  onCreateDatasource
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
}) {
  const visibleCapabilityJobs = capabilityJobs.filter((job) => job.type !== "subscription");
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [qualityDiffs, setQualityDiffs] = useState<Array<{ id: string; sourceTable: string; targetTable: string; fieldName: string; status: string; severity: string }>>([]);
  const [structureItems, setStructureItems] = useState<Array<{ id: string; sourceObject: string; targetObject: string; changeType: string; status: string; riskLevel: string }>>([]);

  useEffect(() => {
    if (openCreateToken === 0) return;
    setCreatorOpen(true);
  }, [openCreateToken]);

  const workloads = buildWorkloads(tasks, visibleCapabilityJobs);
  const filtered = workloads.filter((item) => {
    const matchesKeyword = !keyword.trim() || `${item.title} ${item.detail} ${item.type}`.toLowerCase().includes(keyword.trim().toLowerCase());
    const matchesType = typeFilter === "all" || item.type === typeFilter;
    return matchesKeyword && matchesType;
  });
  const selected = filtered.find((item) => item.key === selectedKey) ?? filtered[0];

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
      await api.taskAction(task.id, action);
      pushNotice({ tone: "success", message: `任务已${actionText(action)}` });
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
      await api.rerunTask(task.id);
      pushNotice({ tone: "success", message: "任务已重跑" });
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
  const typeCounts = filteredTypeCounts(workloads);

  return (
    <div className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr]">
      <section className="surface min-w-0 p-6">
        <SectionHeader
          title="任务列表"
          description="创建入口收敛为五类任务。"
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

        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
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
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <FilterChip active={typeFilter === "all"} onClick={() => setTypeFilter("all")} label={`全部 ${workloads.length}`} />
          {Object.entries(typeCounts).map(([label, count]) => (
            <FilterChip key={label} active={typeFilter === label} onClick={() => setTypeFilter(label)} label={`${label} ${count}`} />
          ))}
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
              return (
                <div key={item.key} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                  <button onClick={() => setSelectedKey(item.key)} className="min-w-0 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-coal">{item.title}</span>
                      <TypeBadge type={item.type} />
                      {task && <StatusBadge status={task.status} />}
                      {job && <Badge tone={capabilityJobTone(job.status)}>{capabilityJobStatusText(job.status)}</Badge>}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">{item.detail}</div>
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
          <SectionHeader title="任务详情" description="配置、运行状态和关键结果。" />
          {!selected ? (
            <div className="mt-5 text-sm text-slate-500">选择一条任务查看详情。</div>
          ) : selected.rawTask ? (
            <SyncTaskDetail task={selected.rawTask} errors={errors} cluster={cluster} />
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
  canManage,
  onChanged,
  pushNotice,
  openCreateToken
}: {
  cluster: ClusterSnapshot | null;
  tasks: SyncTask[];
  canManage: boolean;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
  openCreateToken: number;
}) {
  const nodes = cluster?.nodes ?? emptyNodes;
  const [selectedId, setSelectedId] = useState<string | null>(nodes[0]?.id ?? null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [operationResult, setOperationResult] = useState<NodeOperationResult | null>(null);
  const [handoffReport, setHandoffReport] = useState<ClusterHandoffReport | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const localNodeId = cluster?.localNodeId;
  const localNodeName = cluster?.localNodeName || localNodeId;

  useEffect(() => {
    if (openCreateToken === 0) return;
    setCreatorOpen(true);
  }, [openCreateToken]);

  useEffect(() => {
    if (nodes.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !nodes.some((item) => item.id === selectedId)) {
      setSelectedId(nodes[0].id);
    }
  }, [nodes, selectedId]);

  const selected = nodes.find((item) => item.id === selectedId) ?? nodes[0];
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
          <MetricMini label="Failover" value={`${cluster?.failovers ?? 0}`} />
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
            {nodes.map((node) => {
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
                        <StatusBadge status={task.status} />
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {(task.sourceDatasource?.name || task.sourceDatasourceId)} to {(task.targetDatasource?.name || task.targetDatasourceId)}
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
          <SectionHeader title="基础配置" description="保留当前运行所需配置。" />
          <div className="mt-5 grid gap-3">
            <DetailCard label="当前用户" value={`${user?.name || "-"} · ${roleLabel(user?.role)}`} />
            <DetailCard label="任务数量" value={`${tasks.length} 条`} />
            <DetailCard label="默认策略" value="优先使用短文案、少步骤和蓝白灰主题。" />
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
  errors,
  cluster
}: {
  task: SyncTask;
  errors: ErrorEvent[];
  cluster: ClusterSnapshot | null;
}) {
  const [runtime, setRuntime] = useState(task.runtime);
  const [checkpoints, setCheckpoints] = useState<TaskCheckpoint[]>([]);
  const [taskLogs, setTaskLogs] = useState<TaskLogEntry[]>([]);
  const [logConnected, setLogConnected] = useState(false);
  const [logNotice, setLogNotice] = useState<string | null>(null);
  const progress = runtime && runtime.fullTotalRows > 0 ? Math.min(100, Math.round((runtime.fullSyncedRows / runtime.fullTotalRows) * 100)) : 0;
  const taskErrors = errors.filter((item) => item.taskId === task.id).slice(0, 4);
  const localNodeId = cluster?.localNodeId;
  const runtimeNode = runtime?.nodeId;
  const runtimeNodeLabel = runtime?.executionNodeName || cluster?.nodes.find((node) => node.id === runtimeNode)?.name || runtimeNode;
  const remoteManaged = runtime?.managedByLocalNode === false || Boolean(localNodeId && runtimeNode && runtimeNode !== localNodeId);

  useEffect(() => {
    setRuntime(task.runtime);
  }, [task.id, task.runtime]);

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
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TypeBadge type={syncTaskTypeText(task)} />
        <StatusBadge status={task.status} />
        <Badge tone={taskProcessTone(runtime?.processStatus)}>{taskProcessStatusText(runtime?.processStatus)}</Badge>
        {remoteManaged && <Badge tone="yellow">远程托管</Badge>}
      </div>
      <div className="text-lg font-semibold text-coal">{task.name}</div>
      <div className="text-sm text-slate-500">
        {(task.sourceDatasource?.name || task.sourceDatasourceId)} to {(task.targetDatasource?.name || task.targetDatasourceId)}
      </div>
      <div className="grid gap-3">
        <DetailCard label="负责人" value={task.owner} />
        <DetailCard label="配置版本" value={`v${task.configVersion}`} mono />
        <DetailCard label="更新时间" value={formatDateTime(task.updatedAt)} />
        <DetailCard label="运行节点" value={runtime?.nodeId || "待分配"} mono />
      </div>
      <div className="rounded-3xl border border-line bg-slate-50/70 p-4">
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
      <div className="rounded-3xl border border-line bg-slate-50/70 p-4">
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
      </div>
      <div className="rounded-3xl border border-line bg-slate-50/70 p-4">
        <div className="font-medium text-coal">运行轨迹</div>
        <div className="mt-3 grid gap-3">
          {checkpoints.length === 0 ? (
            <div className="text-sm text-slate-500">当前没有可展示的运行轨迹。</div>
          ) : checkpoints.map((checkpoint) => (
            <div key={checkpoint.id} className="rounded-2xl border border-line bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={checkpointReasonTone(checkpoint.reason)}>{checkpointReasonText(checkpoint.reason)}</Badge>
                    <span className="text-sm font-medium text-coal">{taskRuntimePhaseText(checkpoint.phase)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="rounded-full border border-line bg-slate-50 px-2 py-1">{checkpoint.nodeId || "待分配"}</span>
                    {checkpoint.previousNodeId && checkpoint.previousNodeId !== checkpoint.nodeId && (
                      <>
                        <ArrowRight size={14} className="text-slate-400" />
                        <span className="rounded-full border border-line bg-slate-50 px-2 py-1">{checkpoint.previousNodeId}</span>
                      </>
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
      </div>
      <div className="rounded-3xl border border-line bg-slate-50/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="font-medium text-coal">实时日志</div>
          <Badge tone={remoteManaged ? "yellow" : logConnected ? "green" : "yellow"}>
            {remoteManaged ? "远程节点" : logConnected ? "实时连接" : "等待连接"}
          </Badge>
        </div>
        <div className="mt-3 rounded-2xl border border-line bg-white">
          <div className="max-h-[320px] overflow-auto px-4 py-3">
            {logNotice ? (
              <div className="text-sm text-slate-500">{logNotice}</div>
            ) : taskLogs.length === 0 ? (
              <div className="text-sm text-slate-500">当前还没有任务进程日志。</div>
            ) : (
              <div className="grid gap-2">
                {taskLogs.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-line bg-slate-50/70 px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={taskLogTone(entry.level)}>{entry.level}</Badge>
                      {entry.phase && <span className="mono text-slate-500">{entry.phase}</span>}
                      <span className="mono text-slate-400">{formatDateTime(entry.createdAt)}</span>
                    </div>
                    <div className="mt-2 break-words text-sm text-coal">{entry.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="rounded-3xl border border-line bg-slate-50/70 p-4">
        <div className="font-medium text-coal">最近异常</div>
        <div className="mt-3 grid gap-3">
          {taskErrors.length === 0 ? (
            <div className="text-sm text-slate-500">当前没有待展示的错误事件。</div>
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
      </div>
    </div>
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

function buildWorkloads(tasks: SyncTask[], capabilityJobs: CapabilityJob[]): WorkloadItem[] {
  const items: WorkloadItem[] = tasks.map((task) => ({
    id: task.id,
    key: `sync:${task.id}`,
    kind: "sync",
    type: syncTaskTypeText(task),
    title: task.name,
    detail: `${task.sourceDatasource?.name || task.sourceDatasourceId} to ${task.targetDatasource?.name || task.targetDatasourceId}`,
    updatedAt: task.updatedAt,
    statusText: taskStatusText[task.status],
    rawTask: task
  }));
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
  if (page === "dashboard") return "工作台";
  if (page === "datasources") return "数据源";
  if (page === "tasks") return "任务";
  if (page === "nodes") return "节点";
  return "系统设置";
}

function pageDescription(page: Page) {
  if (page === "dashboard") return "聚合当前链路状态，并给出明确的下一步动作。";
  if (page === "datasources") return "把连接资产收敛到一个入口，先配置，再测试。";
  if (page === "tasks") return "用清晰的任务类型承接迁移、同步、校验、订正和结构对比。";
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
  return "未启动";
}

function taskProcessTone(status?: TaskRuntimeState["processStatus"]) {
  if (status === "running") return "blue";
  if (status === "remote") return "yellow";
  if (status === "starting" || status === "stopping") return "yellow";
  if (status === "failed") return "red";
  return "neutral";
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

function actionText(action: "start" | "pause" | "resume" | "stop") {
  if (action === "start") return "启动";
  if (action === "pause") return "暂停";
  if (action === "resume") return "恢复";
  return "停止";
}

function nodeActionTitle(action: NodeOperationResult["action"]) {
  if (action === "deploy") return "部署结果";
  if (action === "upgrade") return "升级结果";
  return "卸载结果";
}

export default App;
