import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from "react";
import {
  ArrowsClockwise,
  ArrowRight,
  CheckCircle,
  Database,
  DotsThree,
  GearSix,
  HardDrives,
  MagnifyingGlass,
  Plus,
  RocketLaunch,
  ShieldCheck,
  SignOut,
  Trash,
  WarningCircle,
  XCircle
} from "@phosphor-icons/react";
import { PermissionNotice } from "./components/PermissionNotice";
import { Button, CheckboxInput, SelectInput, TextareaInput, TextInput } from "./components/ui";
import {
  api,
  checkBackendHealth,
  clearToken,
  getToken,
  isServiceUnavailableError,
  setToken,
  subscribeBackendAvailability
} from "./lib/api";
import { cx, formatDate, formatDateTime, secondsSince } from "./lib/format";
import { canManageConfig, roleLabel } from "./lib/permissions";
import type {
  AlertEvent,
  AlertRule,
  AlertRuleEvaluation,
  AlertRuleInput,
  ClusterNode,
  ClusterNodeInput,
  ClusterSnapshot,
  Datasource,
  DatasourceStatus,
  NodeConnectionTestResult,
  NodeOperationResult,
  NodeStatusChangeResult,
  OperationLog,
  User
} from "./types/api";

type MainPage = "datasources" | "nodes" | "settings";
type Page = MainPage | "datasourceDetail" | "nodeDetail";
type NoticeTone = "success" | "error" | "warning";

type Notice = {
  tone: NoticeTone;
  message: string;
};

type ConfirmationDialogState = {
  title: string;
  description: string;
  confirmLabel: string;
  confirmTone?: "danger" | "primary";
  onConfirm: () => void;
};

type ClusterHandoffReport = {
  id: string;
  kind: "offline" | "online";
  happenedAt: string;
  node?: ClusterNode;
  success: boolean;
  message: string;
  before: ClusterSnapshot;
  after: ClusterSnapshot;
};

const navItems: Array<{ id: MainPage; label: string; icon: typeof Database }> = [
  { id: "datasources", label: "数据源", icon: Database },
  { id: "nodes", label: "节点", icon: HardDrives }
];

const emptyDatasourceForm = {
  name: "",
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

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

type ParticlePoint = {
  x: number;
  y: number;
  size: number;
  opacity: number;
  seed: number;
};

type AnimatedParticle = ParticlePoint & {
  currentX: number;
  currentY: number;
  velocityX: number;
  velocityY: number;
};

const loginDisplayFont = "\"Arial Black\", \"Avenir Next\", \"Segoe UI Variable Display\", \"PingFang SC\", \"Helvetica Neue\", sans-serif";

function particleNoise(x: number, y: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function createWordmarkParticles(wordmark: string, width: number, height: number) {
  if (typeof document === "undefined") return [];
  const label = wordmark.replace(/\s+/g, " ").trim();
  const desktop = width >= 900;
  const centerX = desktop ? width * 0.29 : width * 0.5;
  const centerY = desktop ? height * 0.5 : height * 0.67;
  const availableWidth = desktop ? Math.max(420, width * 0.55) : Math.max(280, width - 24);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return [];
  canvas.width = width;
  canvas.height = height;

  let fontSize = Math.min(Math.max(92, Math.round(width * 0.19)), Math.round(height * 0.42));
  context.font = `900 ${fontSize}px ${loginDisplayFont}`;
  const maxLineWidth = context.measureText(label).width;
  if (maxLineWidth > availableWidth) {
    fontSize = Math.max(58, Math.floor(fontSize * (availableWidth / maxLineWidth)));
  }

  context.clearRect(0, 0, width, height);
  context.font = `900 ${fontSize}px ${loginDisplayFont}`;
  context.textBaseline = "middle";
  context.fillStyle = "#ffffff";
  const metrics = context.measureText(label);
  context.fillText(label, centerX - metrics.width / 2, centerY);

  const step = width < 640 ? 3 : 3;
  const limit = width < 640 ? 3600 : 5200;
  const samples: ParticlePoint[] = [];
  const pixels = context.getImageData(0, 0, width, height).data;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha < 32) continue;
      const seed = particleNoise(x * 0.37, y * 0.41);
      if (seed < 0.04) continue;
      samples.push({
        x: x + (seed - 0.5) * 0.9,
        y: y + (0.5 - seed) * 0.9,
        size: seed > 0.76 ? 2.15 : seed > 0.42 ? 1.85 : 1.55,
        opacity: seed > 0.72 ? 1 : seed > 0.48 ? 0.92 : 0.82,
        seed
      });
    }
  }

  const stride = Math.max(1, Math.ceil(samples.length / limit));
  return samples.filter((_, index) => index % stride === 0).slice(0, limit);
}

function ParticleWordmark({ wordmark }: { wordmark: string }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<AnimatedParticle[]>([]);
  const phaseRef = useRef<"merge" | "hold" | "explode">("merge");
  const phaseStartedAtRef = useRef(0);
  const frameIdRef = useRef(0);
  const lastFrameAtRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0 });
  const pointerInsideRef = useRef(false);

  const createAnimatedParticles = useCallback((width: number, height: number) => {
    const centerX = width / 2;
    const centerY = height / 2;
    return createWordmarkParticles(wordmark, width, height).map((point) => {
      const angle = point.seed * Math.PI * 2;
      const burstRadius = Math.max(width, height) * (0.48 + point.seed * 0.44);
      const startX = centerX + Math.cos(angle) * burstRadius;
      const startY = centerY + Math.sin(angle) * burstRadius;
      return {
        ...point,
        currentX: startX,
        currentY: startY,
        velocityX: Math.cos(angle) * (2.4 + point.seed * 3.8),
        velocityY: Math.sin(angle) * (2.4 + point.seed * 3.8)
      };
    });
  }, [wordmark]);

  const explodeParticles = useCallback((originX?: number, originY?: number) => {
    const { width, height } = sizeRef.current;
    const sourceX = originX ?? width / 2;
    const sourceY = originY ?? height / 2;
    particlesRef.current = particlesRef.current.map((particle) => {
      const fallbackAngle = particle.seed * Math.PI * 2;
      const angle = Math.atan2(particle.currentY - sourceY, particle.currentX - sourceX) || fallbackAngle;
      const speed = 5 + particle.seed * 10;
      return {
        ...particle,
        velocityX: Math.cos(angle + (particle.seed - 0.5) * 0.6) * speed,
        velocityY: Math.sin(angle + (particle.seed - 0.5) * 0.6) * speed
      };
    });
    phaseRef.current = "explode";
    phaseStartedAtRef.current = performance.now();
  }, []);

  const mergeParticles = useCallback(() => {
    pointerInsideRef.current = false;
    phaseRef.current = "merge";
    phaseStartedAtRef.current = performance.now();
  }, []);

  const markPointerInside = useCallback(() => {
    pointerInsideRef.current = true;
  }, []);

  const handleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = frameRef.current?.getBoundingClientRect();
    explodeParticles(rect ? event.clientX - rect.left : undefined, rect ? event.clientY - rect.top : undefined);
  }, [explodeParticles]);

  useEffect(() => {
    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      const frame = frameRef.current;
      if (!canvas || !frame) return;
      const rect = frame.getBoundingClientRect();
      const width = Math.max(320, Math.round(rect.width));
      const height = Math.max(240, Math.round(rect.height));
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { width, height };
      particlesRef.current = createAnimatedParticles(width, height);
      phaseRef.current = "merge";
      phaseStartedAtRef.current = performance.now();
      lastFrameAtRef.current = 0;
    };

    const drawFrame = (now: number) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const { width, height } = sizeRef.current;
      const delta = lastFrameAtRef.current ? Math.min(2, (now - lastFrameAtRef.current) / 16.6667) : 1;
      lastFrameAtRef.current = now;
      const elapsed = now - phaseStartedAtRef.current;

      context.clearRect(0, 0, width, height);

      let maxDistance = 0;
      particlesRef.current.forEach((particle, index) => {
        if (phaseRef.current === "explode") {
          particle.currentX += particle.velocityX * delta;
          particle.currentY += particle.velocityY * delta;
          particle.velocityX *= 0.94;
          particle.velocityY *= 0.94;
        } else {
          const spring = 0.075 + particle.seed * 0.08;
          particle.velocityX += (particle.x - particle.currentX) * spring * delta;
          particle.velocityY += (particle.y - particle.currentY) * spring * delta;
          particle.velocityX *= 0.78;
          particle.velocityY *= 0.78;
          particle.currentX += particle.velocityX * delta;
          particle.currentY += particle.velocityY * delta;
          const distance = Math.hypot(particle.x - particle.currentX, particle.y - particle.currentY);
          if (distance > maxDistance) maxDistance = distance;
        }

        const pulse = phaseRef.current === "hold" ? 0.9 + Math.sin(now / 320 + index * 0.45) * 0.12 : 1;
        context.globalAlpha = particle.opacity * 0.2;
        context.fillStyle = "#bfdbfe";
        context.beginPath();
        context.arc(particle.currentX, particle.currentY, particle.size * 2.1 * pulse, 0, Math.PI * 2);
        context.fill();

        context.globalAlpha = particle.opacity;
        context.fillStyle = "#2563eb";
        context.beginPath();
        context.arc(particle.currentX, particle.currentY, particle.size * pulse, 0, Math.PI * 2);
        context.fill();
      });

      context.globalAlpha = 1;

      if (phaseRef.current === "merge" && elapsed > 1200 && maxDistance < 5.5) {
        phaseRef.current = "hold";
        phaseStartedAtRef.current = now;
      } else if (phaseRef.current === "explode" && elapsed > 1300 && !pointerInsideRef.current) {
        phaseRef.current = "merge";
        phaseStartedAtRef.current = now;
      }

      frameIdRef.current = window.requestAnimationFrame(drawFrame);
    };

    resizeCanvas();
    const handleResize = () => {
      window.cancelAnimationFrame(frameIdRef.current);
      resizeCanvas();
      frameIdRef.current = window.requestAnimationFrame(drawFrame);
    };
    frameIdRef.current = window.requestAnimationFrame(drawFrame);
    window.addEventListener("resize", handleResize);
    return () => {
      window.cancelAnimationFrame(frameIdRef.current);
      window.removeEventListener("resize", handleResize);
    };
  }, [createAnimatedParticles]);

  return (
    <div
      ref={frameRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 select-none"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full select-none" />
      <div
        onClick={handleClick}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={markPointerInside}
        onMouseLeave={mergeParticles}
        onPointerEnter={markPointerInside}
        onPointerLeave={mergeParticles}
        className="pointer-events-auto absolute left-0 top-[54%] h-[32%] w-full -translate-y-1/2 cursor-default select-none md:top-[55%] lg:top-1/2 lg:w-[58%]"
      />
    </div>
  );
}

function App() {
  const [tokenState, setTokenState] = useState(getToken());
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>("datasources");
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [cluster, setCluster] = useState<ClusterSnapshot | null>(null);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([]);
  const [alertEvaluations, setAlertEvaluations] = useState<AlertRuleEvaluation[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const [serviceRecoveryPending, setServiceRecoveryPending] = useState(false);
  const [datasourceCreateToken, setDatasourceCreateToken] = useState(0);
  const [nodeCreateToken, setNodeCreateToken] = useState(0);
  const [focusedDatasourceId, setFocusedDatasourceId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
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
        nextDatasources,
        nextLogs,
        nextCluster,
        nextAlertRules,
        nextAlertEvaluations,
        nextAlertEvents
      ] = await Promise.all([
        api.datasources(),
        api.logs(),
        api.cluster(),
        api.alertRules(),
        api.alertEvaluations(),
        api.alertEvents()
      ]);
      setDatasources(nextDatasources);
      setLogs(nextLogs);
      setCluster(nextCluster);
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
    setPage("datasources");
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

  const openDatasourceDetail = (datasourceId: string) => {
    setFocusedDatasourceId(datasourceId);
    setPage("datasourceDetail");
  };

  const openNodeCreator = () => {
    setPage("nodes");
    setNodeCreateToken((value) => value + 1);
  };

  const openNodeDetail = (nodeID: string) => {
    setFocusedNodeId(nodeID);
    setPage("nodeDetail");
  };

  if (!tokenState) {
    if (serviceUnavailable) {
      return <BackendUnavailableScreen retrying={serviceRecoveryPending} onRetry={retryServiceConnection} />;
    }
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-[100dvh] bg-mist text-ink">
      <div className="page-shell">
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="surface flex h-fit flex-col p-3 lg:sticky lg:top-3 lg:min-h-[calc(100dvh-1.5rem)]">
            <div className="border-b border-line/80 px-2 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-coal text-sm font-semibold text-white">
                  CP
                </div>
                <div>
                  <div className="brand-wordmark" aria-label="Canal Plus">
                    <span>Canal</span>
                    <span>Plus</span>
                  </div>
                  <div className="mt-1 text-xs font-medium text-slate-500">Control Plane</div>
                </div>
              </div>
            </div>

            <nav className="mt-4 grid grid-cols-3 gap-2 lg:grid-cols-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.id}
                    onClick={() => setPage(item.id)}
                    className={cx(
                      "flex min-h-12 items-center justify-start gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium transition",
                      navPage(page) === item.id
                        ? "border border-blue-100 bg-blue-50 text-accent shadow-[inset_3px_0_0_#2563eb]"
                        : "border border-transparent text-slate-600 hover:border-line hover:bg-slate-50 hover:text-coal"
                    )}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </Button>
                );
              })}
            </nav>

            <div className="mt-4 rounded-lg border border-line/80 bg-slate-50/80 p-4">
              <div className="label">状态</div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-coal">
                    {serviceUnavailable ? "异常" : "运行中"}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {cluster?.onlineNodes ?? 0}/{cluster?.totalNodes ?? 0} 节点
                  </div>
                </div>
                <span className={cx(
                  "h-2.5 w-2.5 rounded-full",
                  serviceUnavailable ? "bg-red-500" : "bg-emerald-500"
                )} />
              </div>
            </div>

            <UserProfileMenu
              user={user}
              onOpenSettings={() => setPage("settings")}
              onLogout={handleLogout}
            />
          </aside>

          <main className="min-w-0">
            <div className="surface mb-4 flex flex-col gap-5 p-5 md:p-6 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="label">Console</div>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-coal md:text-4xl">
                  {pageTitle(page)}
                </h1>
                {pageDescription(page) && (
                  <p className="mt-2 text-sm text-slate-500">
                    {pageDescription(page)}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 xl:justify-end">
                <Button onClick={() => void refresh()} className="btn-secondary">
                  <ArrowsClockwise size={16} />
                  刷新
                </Button>
                {page === "datasources" && canManage && (
                  <Button onClick={openDatasourceCreator} className="btn-primary">
                    <Plus size={16} />
                    新增
                  </Button>
                )}
                {page === "nodes" && canManage && (
                  <Button onClick={openNodeCreator} className="btn-primary">
                    <Plus size={16} />
                    新增
                  </Button>
                )}
              </div>
            </div>

            <SystemOverview
              datasources={datasources}
              cluster={cluster}
              alertEvents={alertEvents}
              serviceUnavailable={serviceUnavailable}
            />

            {serviceUnavailable && (
              <NoticeBanner
                tone="warning"
                action={(
                  <Button onClick={() => void retryServiceConnection()} disabled={serviceRecoveryPending} className="btn-compact">
                    <ArrowsClockwise size={14} />
                    {serviceRecoveryPending ? "重试中" : "重试连接"}
                  </Button>
                )}
              >
                后端暂时不可用，当前界面会保留；恢复后再重试。
              </NoticeBanner>
            )}

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

            {loading && datasources.length === 0 ? (
              <ShellSkeleton />
            ) : page === "datasources" ? (
              <DatasourcePage
                datasources={datasources}
                canManage={canManage}
                onChanged={refresh}
                pushNotice={pushNotice}
                openCreateToken={datasourceCreateToken}
                onOpenDatasource={openDatasourceDetail}
              />
            ) : page === "datasourceDetail" ? (
              <DatasourceDetailPage
                datasources={datasources}
                canManage={canManage}
                onChanged={refresh}
                pushNotice={pushNotice}
                datasourceId={focusedDatasourceId}
                onBack={() => setPage("datasources")}
              />
            ) : page === "nodes" ? (
              <NodesPage
                cluster={cluster}
                canManage={canManage}
                onChanged={refresh}
                pushNotice={pushNotice}
                openCreateToken={nodeCreateToken}
                onOpenNode={openNodeDetail}
              />
            ) : page === "nodeDetail" ? (
              <NodeDetailPage
                nodeId={focusedNodeId}
                cluster={cluster}
                logs={logs}
                onBack={() => setPage("nodes")}
              />
            ) : (
              <SettingsPage
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

function SystemOverview({
  datasources,
  cluster,
  alertEvents,
  serviceUnavailable
}: {
  datasources: Datasource[];
  cluster: ClusterSnapshot | null;
  alertEvents: AlertEvent[];
  serviceUnavailable: boolean;
}) {
  const datasourceOnline = datasources.filter((item) => item.connectionStatus === "online").length;
  const datasourceTotal = datasources.length;
  const nodeOnline = cluster?.onlineNodes ?? 0;
  const nodeTotal = cluster?.totalNodes ?? 0;
  const triggeredAlerts = alertEvents.filter((event) => event.status === "triggered").length;
  const nodeRatio = percent(nodeOnline, nodeTotal);
  const datasourceRatio = percent(datasourceOnline, datasourceTotal);
  const healthText = serviceUnavailable
    ? "API 异常"
    : triggeredAlerts > 0
      ? "需关注"
      : "健康";

  return (
    <section className="mb-5 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
      <div className="surface p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="label">运行概览</div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-coal">集群控制台</h2>
          </div>
          <Badge tone={serviceUnavailable ? "red" : triggeredAlerts > 0 ? "yellow" : "green"}>{healthText}</Badge>
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-[1.15fr_0.85fr]">
          <OverviewGauge
            label="节点在线"
            value={`${nodeOnline}/${nodeTotal}`}
            ratio={nodeRatio}
            tone={serviceUnavailable ? "red" : nodeRatio >= 80 ? "green" : "yellow"}
          />
          <OverviewGauge
            label="数据源"
            value={`${datasourceOnline}/${datasourceTotal}`}
            ratio={datasourceRatio}
            tone={datasourceRatio >= 80 || datasourceTotal === 0 ? "green" : "yellow"}
          />
        </div>
      </div>

      <div className="surface p-5 md:p-6">
        <div className="label">事件</div>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <OverviewStat label="告警" value={`${triggeredAlerts}`} />
          <OverviewStat label="刷新" value="8s" />
        </div>
        <div className="mt-5 border-t border-line pt-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-500">后端</span>
            <span className={cx("font-medium", serviceUnavailable ? "text-red-700" : "text-emerald-700")}>
              {serviceUnavailable ? "断开" : "可用"}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function OverviewGauge({
  label,
  value,
  ratio,
  tone
}: {
  label: string;
  value: string;
  ratio: number;
  tone: "green" | "yellow" | "red";
}) {
  const barClass = tone === "green" ? "bg-emerald-500" : tone === "yellow" ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="border-t border-line pt-4">
      <div className="flex items-end justify-between gap-4">
        <div className="text-sm font-medium text-slate-600">{label}</div>
        <div className="font-mono text-2xl font-semibold tracking-tight text-coal">{value}</div>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={cx("h-full rounded-full transition-all", barClass)} style={{ width: `${Math.min(100, Math.max(0, ratio))}%` }} />
      </div>
    </div>
  );
}

function OverviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-line pt-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-2 font-mono text-2xl font-semibold tracking-tight text-coal">{value}</div>
    </div>
  );
}

function DatasourcePage({
  datasources,
  canManage,
  onChanged,
  pushNotice,
  openCreateToken,
  onOpenDatasource
}: {
  datasources: Datasource[];
  canManage: boolean;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
  openCreateToken: number;
  onOpenDatasource: (datasourceId: string) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | DatasourceStatus>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyDatasourceForm });
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);

  useEffect(() => {
    if (openCreateToken === 0) return;
    setEditorOpen(true);
    setEditingId(null);
    setForm({ ...emptyDatasourceForm });
  }, [openCreateToken]);

  const visibleDatasources = datasources
    .filter((item) => {
      const matchesKeyword = !keyword.trim() || datasourceSearchText(item).includes(keyword.trim().toLowerCase());
      const matchesStatus = statusFilter === "all" || item.connectionStatus === statusFilter;
      return matchesKeyword && matchesStatus;
    })
    .sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));

  const openEdit = (item: Datasource) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
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
        pushNotice({ tone: "success", message: "已保存" });
      } else {
        await api.createDatasource(form);
        pushNotice({ tone: "success", message: "已创建" });
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

  const executeRemoveDatasource = async (item: Datasource) => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "删除数据源需要管理员权限" });
      return;
    }
    try {
      await api.deleteDatasource(item.id);
      pushNotice({ tone: "success", message: "已删除" });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "删除失败" });
    }
  };

  const requestRemoveDatasource = (item: Datasource) => {
    setConfirmation({
      title: `删除数据源“${item.name}”`,
      description: "删除后无法恢复。确认继续吗？",
      confirmLabel: "确认删除",
      confirmTone: "danger",
      onConfirm: () => {
        void executeRemoveDatasource(item);
      }
    });
  };

  return (
    <div className="space-y-5">
      <section className="surface min-w-0 p-6">
        <SectionHeader title="连接池" description="MySQL 接入与连通性" />

        <div className="mt-5 grid gap-3 rounded-lg border border-line bg-slate-50/70 p-3 lg:grid-cols-[minmax(0,1fr)_180px]">
          <label className="block">
            <span className="label mb-2 block">搜索</span>
            <span className="relative block">
              <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <TextInput
                className="input pl-9"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="名称 / 地址 / 库名"
              />
            </span>
          </label>
          <Field label="状态">
            <SelectInput className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | DatasourceStatus)}>
              <option value="all">全部</option>
              <option value="online">在线</option>
              <option value="offline">离线</option>
              <option value="untested">未测试</option>
            </SelectInput>
          </Field>
        </div>

        {datasources.length === 0 ? (
          <EmptyPanel
            icon={Database}
            title="无数据源"
            action={canManage ? (
              <Button onClick={() => {
                setEditingId(null);
                setForm({ ...emptyDatasourceForm });
                setEditorOpen(true);
              }} className="btn-primary">
                <Plus size={16} />
                新增
              </Button>
            ) : <PermissionNotice compact description="仅管理员可新增数据源。" />}
          />
        ) : (
          <div className="table-shell mt-5">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.18em] text-slate-500">
                <tr>
	                  <th className="px-4 py-3">名称</th>
	                  <th className="px-4 py-3">连接</th>
                  <th className="px-4 py-3">地址</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleDatasources.map((item) => (
                  <tr key={item.id} className="table-row hover:bg-slate-50/70">
                    <td className="px-4 py-4">
                      <Button onClick={() => onOpenDatasource(item.id)} className="link-button">
                        <div className="font-medium text-coal">{item.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{item.defaultSchema || "未设置默认库"}</div>
                      </Button>
                    </td>
	                    <td className="px-4 py-4">
                      <Badge tone={datasourceTone(item.connectionStatus)}>
                        {datasourceStatusText(item.connectionStatus)}
                      </Badge>
                    </td>
                    <td className="px-4 py-4">
                      <div className="mono text-slate-700">{item.host}:{item.port}</div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <Button
                          onClick={() => void testConnection(item)}
                          disabled={testingId === item.id}
                          className="btn-compact"
                        >
                          {testingId === item.id ? <ArrowsClockwise size={14} /> : <ShieldCheck size={14} />}
                          {testingId === item.id ? "测试中" : "测试"}
                        </Button>
                        <ActionMenu
                          items={[
                            {
                              label: "编辑",
                              disabled: !canManage,
                              onSelect: () => openEdit(item)
                            },
                            {
                              label: "删除",
                              danger: true,
                              disabled: !canManage,
                              onSelect: () => requestRemoveDatasource(item)
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

      <Modal
        open={editorOpen}
        title={editingId ? "编辑数据源" : "添加数据源"}
        onClose={() => setEditorOpen(false)}
      >
        <form onSubmit={saveDatasource} className="grid gap-4">
          <Field label="名称">
            <TextInput className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_130px]">
            <Field label="主机地址">
              <TextInput className="input" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} required />
            </Field>
            <Field label="端口">
              <TextInput className="input" type="number" value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} required />
            </Field>
          </div>
          <Field label="账号">
            <TextInput className="input" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
          </Field>
          <Field label="密码">
            <TextInput
              className="input"
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              required={!editingId}
              placeholder={editingId ? "留空表示不修改" : ""}
            />
          </Field>
          <Field label="默认库">
            <TextInput className="input" value={form.defaultSchema} onChange={(event) => setForm({ ...form, defaultSchema: event.target.value })} />
          </Field>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" onClick={() => setEditorOpen(false)} className="btn-secondary">
              取消
            </Button>
            <Button disabled={submitting} className="btn-primary">
              {submitting ? <ArrowsClockwise size={16} /> : <CheckCircle size={16} />}
              {submitting ? "保存中" : "保存"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmation?.title || ""}
        description={confirmation?.description || ""}
        confirmLabel={confirmation?.confirmLabel || "确认"}
        confirmTone={confirmation?.confirmTone}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const action = confirmation?.onConfirm;
          setConfirmation(null);
          action?.();
        }}
      />
    </div>
  );
}

function DatasourceDetailPage({
  datasources,
  canManage,
  onChanged,
  pushNotice,
  datasourceId,
  onBack
}: {
  datasources: Datasource[];
  canManage: boolean;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
  datasourceId: string | null;
  onBack: () => void;
}) {
  const selected = datasources.find((item) => item.id === datasourceId) || null;
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState({ ...emptyDatasourceForm });
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);

  useEffect(() => {
    if (!selected) return;
    setForm({
      name: selected.name,
      host: selected.host,
      port: selected.port,
      username: selected.username,
      password: "",
      defaultSchema: selected.defaultSchema || ""
    });
  }, [selected]);

  const saveDatasource = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !canManage) return;
    setSubmitting(true);
    try {
      await api.updateDatasource(selected.id, form);
      pushNotice({ tone: "success", message: "已保存" });
      setEditorOpen(false);
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "保存失败" });
    } finally {
      setSubmitting(false);
    }
  };

  const testConnection = async () => {
    if (!selected) return;
    setTesting(true);
    try {
      const tested = await api.testDatasource(selected.id);
      pushNotice({
        tone: tested.connectionStatus === "online" ? "success" : "warning",
        message: tested.lastTestMessage || `${selected.name} 已完成连接测试`
      });
      await onChanged(true);
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "连接测试失败" });
    } finally {
      setTesting(false);
    }
  };

  const executeRemoveDatasource = async () => {
    if (!selected || !canManage) return;
    try {
      await api.deleteDatasource(selected.id);
      pushNotice({ tone: "success", message: "已删除" });
      onBack();
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "删除失败" });
    }
  };

  const requestRemoveDatasource = () => {
    if (!selected) return;
    setConfirmation({
      title: `删除数据源“${selected.name}”`,
      description: "删除后无法恢复。确认继续吗？",
      confirmLabel: "确认删除",
      confirmTone: "danger",
      onConfirm: () => {
        void executeRemoveDatasource();
      }
    });
  };

  if (!selected) {
    return (
      <section className="surface p-6">
        <DetailPageHeader title="数据源详情" onBack={onBack} />
        <div className="mt-5 text-sm text-slate-500">数据源不存在或已删除。</div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="surface p-6">
        <DetailPageHeader
          title={selected.name}
          subtitle="数据源详情"
          onBack={onBack}
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void testConnection()} disabled={testing} className="btn-secondary">
                {testing ? <ArrowsClockwise size={16} /> : <ShieldCheck size={16} />}
                {testing ? "测试中" : "测试连接"}
              </Button>
              {canManage && (
                <>
                  <Button onClick={() => setEditorOpen(true)} className="btn-secondary">
                    编辑
                  </Button>
                  <Button onClick={requestRemoveDatasource} className="btn-danger">
                    删除
                  </Button>
                </>
              )}
            </div>
          )}
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <DetailCard label="连接状态" value={datasourceStatusText(selected.connectionStatus)} />
          <DetailCard label="地址" value={`${selected.host}:${selected.port}`} mono />
          <DetailCard label="账号" value={selected.username} mono />
          <DetailCard label="默认库" value={selected.defaultSchema || "未设置"} mono />
        </div>
        <div className="mt-4 border-l border-line bg-slate-50/60 px-4 py-4 text-sm text-slate-500">
          {selected.lastTestMessage
            ? `最近测试：${formatDateTime(selected.lastTestedAt)} · ${selected.lastTestMessage}`
            : "暂无测试记录。"}
        </div>
      </section>

      <Modal
        open={editorOpen}
        title="编辑数据源"
        onClose={() => setEditorOpen(false)}
      >
        <form onSubmit={saveDatasource} className="grid gap-4">
          <Field label="名称">
            <TextInput className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_130px]">
            <Field label="主机地址">
              <TextInput className="input" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} required />
            </Field>
            <Field label="端口">
              <TextInput className="input" type="number" value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} required />
            </Field>
          </div>
          <Field label="账号">
            <TextInput className="input" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
          </Field>
          <Field label="密码">
            <TextInput
              className="input"
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              placeholder="留空表示不修改"
            />
          </Field>
          <Field label="默认库">
            <TextInput className="input" value={form.defaultSchema} onChange={(event) => setForm({ ...form, defaultSchema: event.target.value })} />
          </Field>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" onClick={() => setEditorOpen(false)} className="btn-secondary">
              取消
            </Button>
            <Button disabled={submitting} className="btn-primary">
              {submitting ? <ArrowsClockwise size={16} /> : <CheckCircle size={16} />}
              {submitting ? "保存中" : "保存"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmation?.title || ""}
        description={confirmation?.description || ""}
        confirmLabel={confirmation?.confirmLabel || "确认"}
        confirmTone={confirmation?.confirmTone}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const action = confirmation?.onConfirm;
          setConfirmation(null);
          action?.();
        }}
      />
    </div>
  );
}

function handoffTitle(kind: ClusterHandoffReport["kind"]) {
  if (kind === "offline") return "节点下线结果";
  return "节点上线结果";
}

function fromNodeStatusChangeResult(report: NodeStatusChangeResult): ClusterHandoffReport {
  return {
    id: report.id,
    kind: report.action,
    happenedAt: report.changedAt,
    node: report.node,
    success: report.success,
    message: report.message,
    before: report.before,
    after: report.after
  };
}

function NodesPage({
  cluster,
  canManage,
  onChanged,
  pushNotice,
  openCreateToken,
  onOpenNode
}: {
  cluster: ClusterSnapshot | null;
  canManage: boolean;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
  openCreateToken: number;
  onOpenNode: (nodeID: string) => void;
}) {
  const nodes = cluster?.nodes ?? emptyNodes;
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ClusterNode["status"]>("all");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [operationResult, setOperationResult] = useState<NodeOperationResult | null>(null);
  const [handoffReport, setHandoffReport] = useState<ClusterHandoffReport | null>(null);
  const [, setBusyKey] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);
  const localNodeId = cluster?.localNodeId;

  useEffect(() => {
    if (openCreateToken === 0) return;
    setCreatorOpen(true);
  }, [openCreateToken]);

  const visibleNodes = nodes.filter((node) => {
    const matchesKeyword = !keyword.trim()
      || `${node.name} ${node.endpoint} ${node.zone} ${node.role} ${node.installDir}`.toLowerCase().includes(keyword.trim().toLowerCase());
    const matchesStatus = statusFilter === "all" || node.status === statusFilter;
    return matchesKeyword && matchesStatus;
  });
  const executeQuickAction = async (node: ClusterNode, action: "upgrade" | "uninstall") => {
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

  const requestQuickAction = (node: ClusterNode, action: "upgrade" | "uninstall") => {
    setConfirmation({
      title: action === "upgrade" ? `升级节点“${node.name}”` : `卸载节点“${node.name}”`,
      description: action === "upgrade"
        ? "确认升级该节点？"
        : "卸载会移除节点安装，操作不可直接撤销。确认继续吗？",
      confirmLabel: action === "upgrade" ? "确认升级" : "确认卸载",
      confirmTone: "danger",
      onConfirm: () => {
        void executeQuickAction(node, action);
      }
    });
  };

  const executeMoreAction = async (node: ClusterNode, action: "offline" | "online") => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "节点运维需要管理员权限" });
      return;
    }
    setBusyKey(`${node.id}:${action}`);
    try {
      const result = await api.nodeAction(node.id, action);
      if ("changedAt" in result) {
        setHandoffReport(fromNodeStatusChangeResult(result));
        pushNotice({ tone: result.success ? "success" : "warning", message: result.message });
      } else {
        pushNotice({ tone: "success", message: action === "online" ? "已上线" : "已下线" });
      }
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "节点操作失败" });
    } finally {
      setBusyKey(null);
    }
  };

  const requestMoreAction = (node: ClusterNode, action: "offline" | "online") => {
    const title = action === "offline" ? `下线节点“${node.name}”` : `恢复节点“${node.name}”`;
    const description = action === "offline" ? "节点会被标记为离线。确认继续吗？" : "确认上线该节点？";
    const confirmLabel = action === "online" ? "确认上线" : "确认下线";
    setConfirmation({
      title,
      description,
      confirmLabel,
      confirmTone: "danger",
      onConfirm: () => {
        void executeMoreAction(node, action);
      }
    });
  };

  return (
    <div className="space-y-5">
        <section className="surface min-w-0 p-6">
          <SectionHeader title="节点池" description="部署、容量与心跳" />

        <div className="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_0.7fr]">
          <MetricMini label="节点总数" value={`${cluster?.totalNodes ?? 0}`} />
          <MetricMini label="在线节点" value={`${cluster?.onlineNodes ?? 0}`} />
          <MetricMini label="离线" value={`${nodes.filter((node) => node.status === "offline").length}`} />
        </div>

        <div className="mt-5 grid gap-3 rounded-lg border border-line bg-slate-50/70 p-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <label className="block">
            <span className="label mb-2 block">搜索</span>
            <span className="relative block">
              <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <TextInput
                className="input pl-9"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="节点名、地址、角色"
              />
            </span>
          </label>
          <Field label="状态">
            <SelectInput className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | ClusterNode["status"])}>
              <option value="all">全部</option>
              <option value="online">在线</option>
              <option value="offline">离线</option>
            </SelectInput>
          </Field>
        </div>

        <div className="mt-3 text-sm text-slate-500">
          {`全部 ${nodes.length} · 在线 ${nodes.filter((node) => node.status === "online").length} · 离线 ${nodes.filter((node) => node.status === "offline").length}`}
        </div>

        {nodes.length === 0 ? (
          <EmptyPanel
            icon={HardDrives}
            title="无节点"
            action={canManage ? (
              <Button onClick={() => setCreatorOpen(true)} className="btn-primary">
                <Plus size={16} />
                新增
              </Button>
            ) : <PermissionNotice compact description="仅管理员可管节点。" />}
          />
        ) : (
          <div className="table-shell mt-5">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">名称</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">地址</th>
                  <th className="px-4 py-3">资源</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleNodes.map((node) => {
                  const isCurrentNode = localNodeId === node.id;
                  return (
                    <tr key={node.id} className="table-row hover:bg-slate-50/70">
                      <td className="px-4 py-4">
                        <Button onClick={() => onOpenNode(node.id)} className="link-button">
                          <div className="font-medium text-coal">{node.name}</div>
                          <div className="mt-1 text-xs text-slate-500">{node.version}</div>
                        </Button>
                      </td>
                      <td className="px-4 py-4">
                        <Badge tone={nodeTone(node.status)}>{nodeStatusText(node.status)}</Badge>
                      </td>
                      <td className="px-4 py-4">
                        <div className="mono text-slate-700">{node.endpoint}</div>
                      </td>
                      <td className="px-4 py-4 text-slate-600">CPU {node.cpuPercent}% · 内存 {node.memoryPercent}%</td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end">
                          <ActionMenu
                            items={[
                              { label: "详情", onSelect: () => onOpenNode(node.id) },
                              { label: "升级", onSelect: () => requestQuickAction(node, "upgrade"), disabled: !canManage },
                              { label: "卸载", onSelect: () => requestQuickAction(node, "uninstall"), danger: true, disabled: !canManage || isCurrentNode },
                              { label: node.status === "online" ? "下线" : "上线", onSelect: () => requestMoreAction(node, node.status === "online" ? "offline" : "online"), disabled: !canManage || (isCurrentNode && node.status === "online") },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
              <DetailCard label="状态" value={handoffReport.success ? "完成" : "失败"} />
            </div>

            <div className="border-l border-line bg-slate-50/60 px-4 py-3">
              <div className="text-sm font-medium text-coal">结果</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="border-t border-line px-0 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">节点</div>
                  <div className="mt-2 text-sm font-medium text-coal">
                    {handoffReport.node?.name || "-"}
                  </div>
                </div>
                <div className="border-t border-line px-0 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">结果</div>
                  <div className="mt-2 text-sm font-medium text-coal">
                    {handoffReport.success ? "已完成" : "未完成"}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3">
              <div className="border-y border-dashed border-line bg-slate-50/60 px-4 py-6 text-center text-sm text-slate-500">
                {handoffReport.message}
              </div>
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
                <DetailCard label="状态" value={operationResult.success ? "完成" : "失败"} />
              </div>
            )}

            <div className="grid gap-3">
              {operationResult.steps.map((step) => (
                <div key={step.key} className="border-l border-line bg-slate-50/60 px-4 py-3">
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

      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmation?.title || ""}
        description={confirmation?.description || ""}
        confirmLabel={confirmation?.confirmLabel || "确认"}
        confirmTone={confirmation?.confirmTone}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const action = confirmation?.onConfirm;
          setConfirmation(null);
          action?.();
        }}
      />
    </div>
  );
}

function NodeDetailPage({
  nodeId,
  cluster,
  logs,
  onBack
}: {
  nodeId: string | null;
  cluster: ClusterSnapshot | null;
  logs: OperationLog[];
  onBack: () => void;
}) {
  const nodes = cluster?.nodes ?? emptyNodes;
  const selected = nodes.find((item) => item.id === nodeId) || null;
  const localNodeId = cluster?.localNodeId;
  const nodeEvents = selected
    ? logs.filter((log) => {
      if (log.targetType === "cluster_node" && log.targetId === selected.id) {
        return true;
      }
      return false;
    }).slice(0, 4)
    : [];

  if (!selected) {
    return (
      <section className="surface p-6">
        <DetailPageHeader title="节点详情" onBack={onBack} />
        <div className="mt-5 text-sm text-slate-500">节点不存在或已删除。</div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="surface p-6">
        <DetailPageHeader title={selected.name} subtitle="节点详情" onBack={onBack} />
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={nodeTone(selected.status)}>{nodeStatusText(selected.status)}</Badge>
            {localNodeId === selected.id && <Badge tone="blue">本机节点</Badge>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <DetailCard label="主机地址" value={selected.endpoint} mono />
            <DetailCard label="SSH" value={`${selected.sshUser}@${selected.sshPort} · ${selected.authMode === "private_key" ? "私钥" : "密码"}`} mono />
            <DetailCard label="安装目录" value={selected.installDir} mono />
            <DetailCard label="版本" value={selected.version} mono />
            <DetailCard label="最近心跳" value={`${formatDateTime(selected.lastHeartbeatAt)} · ${secondsSince(selected.lastHeartbeatAt)} 秒前`} />
          </div>
          {localNodeId === selected.id && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              本机节点不支持自卸载或自下线。
            </div>
          )}
        </div>
      </section>

      {nodeEvents.length > 0 && (
        <section className="surface p-6">
          <SectionHeader title="最近运维事件" />
          <div className="mt-3 grid gap-3">
            {nodeEvents.map((log) => (
              <div key={log.id} className="border-t border-line px-0 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={log.targetType === "cluster_node" ? "blue" : "yellow"}>{log.action}</Badge>
                  <span className="text-xs text-slate-500">{formatDateTime(log.createdAt)}</span>
                </div>
                <div className="mt-2 text-sm text-coal">{log.detail}</div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SettingsPage({
  alertRules,
  alertEvents,
  evaluations,
  canManage,
  onChanged,
  pushNotice
}: {
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
    webhookUrl: ""
  });
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);
  const [activeTab, setActiveTab] = useState<"alerts">("alerts");

  useEffect(() => {
    if (!editing) {
      setForm({
        name: "",
        enabled: true,
        webhookUrl: ""
      });
      return;
    }
    setForm({
      name: editing.name,
      enabled: editing.enabled,
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
        pushNotice({ tone: "success", message: "已保存" });
      } else {
        const created = await api.createAlertRule(form);
        setEditingId(created.id);
        pushNotice({ tone: "success", message: "已创建" });
      }
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "保存失败" });
    }
  };

  const executeRemoveRule = async () => {
    if (!editing) return;
    if (!canManage) {
      pushNotice({ tone: "warning", message: "删除告警规则需要管理员权限" });
      return;
    }
    try {
      await api.deleteAlertRule(editing.id);
      setEditingId(null);
      pushNotice({ tone: "success", message: "已删除" });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "删除失败" });
    }
  };

  const requestRemoveRule = () => {
    if (!editing) return;
    setConfirmation({
      title: `删除规则“${editing.name}”`,
      description: "删除后，这条告警规则和它的编辑入口会一起移除。确认继续吗？",
      confirmLabel: "确认删除",
      confirmTone: "danger",
      onConfirm: () => {
        void executeRemoveRule();
      }
    });
  };

  return (
    <section className="surface p-6">
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-4">
        <Button
          type="button"
          onClick={() => setActiveTab("alerts")}
          className={cx(
            "rounded-lg px-4 py-2 text-sm font-medium transition",
            activeTab === "alerts" ? "bg-accent text-white" : "text-slate-600 hover:bg-slate-50"
          )}
        >
          告警
        </Button>
      </div>

      {activeTab === "alerts" && (
        <div className="pt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SectionHeader title="告警规则" />
            {canManage && (
              <Button onClick={() => setEditingId(null)} className="btn-secondary">
                <Plus size={16} />
                新增规则
              </Button>
            )}
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="grid gap-3">
              {alertRules.length === 0 ? (
                <div className="border-y border-dashed border-line bg-slate-50/60 px-4 py-6 text-sm text-slate-500">暂无告警规则</div>
              ) : alertRules.map((rule) => {
                const evaluation = evaluations.find((item) => item.ruleId === rule.id);
                return (
                  <Button
                    key={rule.id}
                    onClick={() => setEditingId(rule.id)}
                    className={cx(
                      "w-full self-start border-l-4 px-4 py-4 text-left transition",
                      editingId === rule.id ? "border-blue-300 bg-blue-50" : "border-line bg-white hover:bg-slate-50"
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-coal">{rule.name}</span>
                      <Badge tone={evaluation?.triggered ? "red" : "green"}>{evaluation?.triggered ? "触发中" : "正常"}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">{rule.webhookUrl ? "Webhook" : "未配置 Webhook"}</div>
                  </Button>
                );
              })}
            </div>

            <div>
              {!canManage && (
                <PermissionNotice compact description="此角色只能查看规则与事件。" />
              )}
              <form onSubmit={saveRule} className="mt-4 grid gap-4 xl:mt-0">
                <Field label="规则">
                  <TextInput className="input" value={form.name} disabled={!canManage} onChange={(event) => setForm({ ...form, name: event.target.value })} />
                </Field>
                <Field label="Webhook">
                  <TextInput className="input" value={form.webhookUrl || ""} disabled={!canManage} onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })} placeholder="https://example.com/webhook" />
                </Field>
                <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <CheckboxInput checked={Boolean(form.enabled)} disabled={!canManage} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
                  启用规则
                </label>
                <div className="flex flex-wrap justify-end gap-3 pt-2">
                  {editing && (
                    <Button type="button" onClick={requestRemoveRule} disabled={!canManage} className="btn-danger">
                      <Trash size={16} />
                      删除
                    </Button>
                  )}
                  <Button disabled={!canManage} className="btn-primary">
                    <CheckCircle size={16} />
                    保存
                  </Button>
                </div>
              </form>

              <div className="mt-6 border-l border-line bg-slate-50/60 px-4 py-3">
                <div className="text-sm font-medium text-coal">最近告警事件</div>
                <div className="mt-3 grid gap-3">
                  {alertEvents.slice(0, 3).map((event) => (
                    <div key={event.id} className="border-t border-line px-0 py-3">
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
                  {alertEvents.length === 0 && <div className="border-y border-dashed border-line bg-slate-50/60 px-4 py-6 text-sm text-slate-500">暂无告警</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmation)}
        title={confirmation?.title || ""}
        description={confirmation?.description || ""}
        confirmLabel={confirmation?.confirmLabel || "确认"}
        confirmTone={confirmation?.confirmTone}
        onCancel={() => setConfirmation(null)}
        onConfirm={() => {
          const action = confirmation?.onConfirm;
          setConfirmation(null);
          action?.();
        }}
      />
    </section>
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
    <div className="relative min-h-[100dvh] overflow-hidden bg-[linear-gradient(135deg,#f8fbff_0%,#eff6ff_46%,#dbeafe_100%)] text-ink">
      <ParticleWordmark wordmark="Canal Plus" />
      <div className="pointer-events-none relative grid min-h-[100dvh] max-w-[1400px] items-center gap-8 px-5 py-6 md:px-8 lg:mx-auto lg:grid-cols-[1.2fr_0.8fr] lg:gap-10">
        <section aria-hidden="true" className="order-2 min-h-[340px] py-8 md:min-h-[480px] lg:order-1 lg:min-h-[640px]" />

        <form onSubmit={submit} className="pointer-events-auto order-1 flex items-center lg:order-2 lg:min-h-[640px]">
          <div className="surface mx-auto w-full max-w-[410px] p-6 md:p-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-coal text-sm font-semibold text-white">
                CP
              </div>
              <div>
                <div className="brand-wordmark" aria-label="Canal Plus">
                  <span>Canal</span>
                  <span>Plus</span>
                </div>
                <div className="mt-1 text-xs font-medium text-slate-500">Control Plane</div>
              </div>
            </div>
            <h2
              style={{ fontFamily: "var(--font-display)" }}
              className="mt-10 text-3xl font-semibold tracking-tight text-coal"
            >
              登录
            </h2>

            <div className="mt-8 grid gap-5">
              <label className="block">
                <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">账号</span>
                <TextInput
                  className="input"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">密码</span>
                <TextInput
                  className="input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>

              {error && (
                <div className="border-l-4 border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <Button
                disabled={loading}
                className="btn-primary w-full justify-center py-3.5"
              >
                {loading ? <ArrowsClockwise size={16} /> : <ArrowRight size={16} />}
                {loading ? "登录中" : "登录"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
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
  const [lastSuccessfulTestSignature, setLastSuccessfulTestSignature] = useState<string | null>(null);
  const currentFormSignature = nodeFormFingerprint(form);
  const nodeFormError = validateNodeForm(form);
  const testExpired = Boolean(lastSuccessfulTestSignature && lastSuccessfulTestSignature !== currentFormSignature);
  const deployBlockedReason = nodeFormError
    || (!testResult
      ? "完成连接测试后再部署节点。"
      : !testResult.success
        ? "连接测试未通过，请修复后重新测试。"
      : testExpired
          ? "连接信息已变更，请重新测试后再部署。"
          : null);
  const showDeployGuard = Boolean(
    testResult
    || form.name
    || form.endpoint
    || form.sshUser
    || form.password
    || form.privateKey
  );

  useEffect(() => {
    if (!open) return;
    setForm({ ...emptyNodeForm });
    setTesting(false);
    setDeploying(false);
    setTestResult(null);
    setDeployResult(null);
    setLastSuccessfulTestSignature(null);
  }, [open]);

  const runTest = async () => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "节点部署需要管理员权限" });
      return;
    }
    if (nodeFormError) {
      pushNotice({ tone: "warning", message: nodeFormError });
      return;
    }
    setTesting(true);
    try {
      const result = await api.testNodeConnection(form);
      setTestResult(result);
      setLastSuccessfulTestSignature(result.success ? currentFormSignature : null);
      pushNotice({ tone: result.success ? "success" : "warning", message: result.message });
    } catch (requestError) {
      setLastSuccessfulTestSignature(null);
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
    if (deployBlockedReason) {
      pushNotice({ tone: "warning", message: deployBlockedReason });
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
      onClose={onClose}
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="节点名称">
            <TextInput className="input" value={form.name || ""} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field label="主机地址">
            <TextInput className="input" value={form.endpoint || ""} onChange={(event) => setForm({ ...form, endpoint: event.target.value })} placeholder="例如：10.18.4.24" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-[130px_minmax(0,1fr)]">
          <Field label="SSH 端口">
            <TextInput className="input" type="number" value={form.sshPort || 22} onChange={(event) => setForm({ ...form, sshPort: Number(event.target.value) })} />
          </Field>
          <Field label="SSH 用户">
            <TextInput className="input" value={form.sshUser || ""} onChange={(event) => setForm({ ...form, sshUser: event.target.value })} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="认证方式">
            <SelectInput className="select" value={form.authMode || "password"} onChange={(event) => setForm({ ...form, authMode: event.target.value as "password" | "private_key" })}>
              <option value="password">密码</option>
              <option value="private_key">私钥</option>
            </SelectInput>
          </Field>
          <Field label="安装目录">
            <TextInput className="input" value={form.installDir || ""} onChange={(event) => setForm({ ...form, installDir: event.target.value })} />
          </Field>
        </div>
        {form.authMode === "private_key" ? (
          <Field label="私钥">
            <TextareaInput className="textarea" value={form.privateKey || ""} onChange={(event) => setForm({ ...form, privateKey: event.target.value })} />
          </Field>
        ) : (
          <Field label="密码">
            <TextInput className="input" type="password" value={form.password || ""} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="节点角色">
            <SelectInput className="select" value={form.role || "worker"} onChange={(event) => setForm({ ...form, role: event.target.value })}>
              <option value="worker">worker</option>
              <option value="scheduler+worker">scheduler+worker</option>
            </SelectInput>
          </Field>
          <Field label="容量">
            <TextInput className="input" type="number" value={form.capacity || 4} onChange={(event) => setForm({ ...form, capacity: Number(event.target.value) })} />
          </Field>
          <Field label="版本">
            <TextInput className="input" value={form.version || "v1.0.0"} onChange={(event) => setForm({ ...form, version: event.target.value })} />
          </Field>
        </div>

        {testResult && (
          <div className={cx("border-l-4 px-4 py-3 text-sm", testResult.success ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
            {testResult.message} · 延迟 {testResult.latencyMs}ms
          </div>
        )}

        {showDeployGuard && deployBlockedReason && <NoticeBanner tone="warning">{deployBlockedReason}</NoticeBanner>}

        {deployResult && (
          <div className="grid gap-3">
            {deployResult.steps.map((step) => (
              <div key={step.key} className="border-l border-line bg-slate-50/60 px-4 py-3">
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
          <Button type="button" onClick={onClose} className="btn-secondary">关闭</Button>
          <Button type="button" onClick={() => void runTest()} disabled={testing || Boolean(nodeFormError)} className="btn-secondary">
            {testing ? <ArrowsClockwise size={16} /> : <ShieldCheck size={16} />}
            {testing ? "测试中" : "测试连接"}
          </Button>
          <Button type="button" onClick={() => void deploy()} disabled={deploying || Boolean(deployBlockedReason)} className="btn-primary">
            {deploying ? <ArrowsClockwise size={16} /> : <RocketLaunch size={16} />}
            {deploying ? "部署中" : "部署节点"}
          </Button>
        </div>
      </div>
    </Modal>
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

function DetailPageHeader({
  title,
  subtitle,
  onBack,
  actions
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <Button type="button" onClick={onBack} className="btn-compact">
          <ArrowRight size={14} className="rotate-180" />
          返回
        </Button>
        {subtitle && <div className="label mt-4">{subtitle}</div>}
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-coal">{title}</h2>
      </div>
      {actions}
    </div>
  );
}

function MetricMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-line px-0 py-4">
      <div className="label">{label}</div>
      <div className="mt-3 font-mono text-2xl font-semibold tracking-tight text-coal">{value}</div>
    </div>
  );
}

function DetailCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-b border-line px-0 py-3">
      <div className="label">{label}</div>
      <div className={cx("mt-2 text-sm font-medium text-coal", mono && "mono")}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-2 block">{label}</span>
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
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mt-5 rounded-lg border border-dashed border-line bg-slate-50/70 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-white text-accent">
        <Icon size={20} />
      </div>
      <div className="mt-4 text-lg font-semibold text-coal">{title}</div>
      {description && <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">{description}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

function NoticeBanner({
  tone,
  children,
  action
}: {
  tone: NoticeTone;
  children: ReactNode;
  action?: ReactNode;
}) {
  const className = tone === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-red-200 bg-red-50 text-red-700";
  return (
    <div className={cx("mb-5 flex flex-col gap-3 rounded-lg border px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="flex items-start gap-2">
        {tone === "success" ? <CheckCircle size={18} /> : tone === "warning" ? <WarningCircle size={18} /> : <XCircle size={18} />}
        <div>{children}</div>
      </div>
      {action && <div className="sm:pl-4">{action}</div>}
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
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-600">
            <WarningCircle size={28} />
          </div>
          <div className="label mt-6">Canal Plus</div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-coal md:text-3xl">后端不可用</h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-500 md:text-base">
            API 未响应。确认后端后重试。
          </p>
          <div className="mt-8 flex justify-center">
            <Button onClick={() => void onRetry()} disabled={retrying} className="btn-primary min-w-40 justify-center">
              <ArrowsClockwise size={16} />
              {retrying ? "重新连接中" : "重试连接"}
            </Button>
          </div>
        </section>
      </div>
    </div>
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
          : "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={cx("chip", className)}>{children}</span>;
}

function getFocusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => !element.hasAttribute("disabled"));
}

function Modal({
  open,
  title,
  description,
  children,
  onClose,
  size = "xl",
  closeOnOverlay = true
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  size?: "md" | "lg" | "xl";
  closeOnOverlay?: boolean;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    lastActiveElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      const focusable = getFocusableElements(panelRef.current);
      (focusable[0] || panelRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = getFocusableElements(panelRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      lastActiveElementRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;
  const sizeClass = size === "md" ? "max-w-xl" : size === "lg" ? "max-w-3xl" : "max-w-5xl";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-8 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cx("max-h-[90dvh] w-full overflow-auto rounded-lg border border-line bg-white p-6 shadow-raised outline-none md:p-8", sizeClass)}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id={titleId} className="text-2xl font-semibold tracking-tight text-coal">{title}</h3>
            {description && <p id={descriptionId} className="mt-2 text-sm text-slate-500">{description}</p>}
          </div>
          <Button onClick={onClose} className="btn-compact px-2.5" aria-label="关闭">
            <XCircle size={16} />
          </Button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmTone = "danger",
  onCancel,
  onConfirm
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmTone?: "danger" | "primary";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} title={title} description={description} onClose={onCancel} size="md" closeOnOverlay={false}>
      <div className="flex justify-end gap-3">
        <Button type="button" onClick={onCancel} className="btn-secondary">
          取消
        </Button>
        <Button type="button" onClick={onConfirm} className={confirmTone === "danger" ? "btn-danger" : "btn-primary"}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

function ActionMenu({
  items
}: {
  items: Array<{ label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const focusMenuItem = (index: number) => {
    const enabledItems = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not([disabled])") || []);
    if (enabledItems.length === 0) return;
    const normalizedIndex = ((index % enabledItems.length) + enabledItems.length) % enabledItems.length;
    enabledItems[normalizedIndex].focus();
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        ref={buttonRef}
        type="button"
        aria-label="更多操作"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            window.requestAnimationFrame(() => focusMenuItem(0));
          }
        }}
        className="btn-compact px-2.5"
      >
        <DotsThree size={14} />
      </Button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={(event) => {
            const enabledItems = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not([disabled])") || []);
            const currentIndex = enabledItems.findIndex((item) => item === document.activeElement);
            if (event.key === "ArrowDown") {
              event.preventDefault();
              focusMenuItem(currentIndex < 0 ? 0 : currentIndex + 1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              focusMenuItem(currentIndex < 0 ? enabledItems.length - 1 : currentIndex - 1);
            } else if (event.key === "Home") {
              event.preventDefault();
              focusMenuItem(0);
            } else if (event.key === "End") {
              event.preventDefault();
              focusMenuItem(enabledItems.length - 1);
            } else if (event.key === "Tab") {
              setOpen(false);
            }
          }}
          className="absolute right-0 top-11 z-20 w-40 rounded-lg border border-line bg-white p-2 shadow-raised"
        >
          {items.map((item) => (
            <Button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onSelect();
              }}
              disabled={item.disabled}
              className={cx(
                "block w-full rounded-md px-3 py-2 text-left text-sm transition",
                item.danger ? "text-red-700 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50",
                item.disabled && "cursor-not-allowed opacity-45"
              )}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserProfileMenu({
  user,
  onOpenSettings,
  onLogout
}: {
  user: User | null;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const displayName = user?.name || user?.username || "User";
  const initial = displayName.trim().charAt(0).toUpperCase() || "U";

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const menuItems: Array<{ label: string; icon: typeof GearSix; danger?: boolean; onSelect: () => void }> = [
    {
      label: "设置",
      icon: GearSix,
      onSelect: onOpenSettings
    },
    {
      label: "退出",
      icon: SignOut,
      danger: true,
      onSelect: onLogout
    }
  ];

  return (
    <div ref={rootRef} className="relative mt-4 lg:mt-auto lg:pt-4">
      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+0.75rem)] left-0 z-30 w-full min-w-[14rem] overflow-hidden rounded-lg border border-line bg-white p-2 shadow-raised"
        >
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className={cx(
                  "flex w-full items-center justify-start gap-3 rounded-md px-3 py-3 text-left text-sm font-medium transition",
                  item.danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"
                )}
              >
                <Icon size={18} />
                {item.label}
              </Button>
            );
          })}
        </div>
      )}

      <Button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cx(
          "flex w-full items-center justify-start gap-3 rounded-lg border border-line bg-slate-50/80 px-3 py-3 text-left transition hover:border-blue-200 hover:bg-white",
          open && "border-blue-200 bg-white"
        )}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-coal text-lg font-semibold text-white">
          {initial}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold text-coal">{displayName}</span>
          <span className="mt-0.5 block truncate text-sm text-slate-500">{roleLabel(user?.role)}</span>
        </span>
      </Button>
    </div>
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

function nodeFormFingerprint(form: ClusterNodeInput) {
  return JSON.stringify({
    name: form.name?.trim() || "",
    endpoint: form.endpoint?.trim() || "",
    sshPort: Number(form.sshPort) || 0,
    sshUser: form.sshUser?.trim() || "",
    authMode: form.authMode,
    password: form.password || "",
    privateKey: form.privateKey || "",
    installDir: form.installDir?.trim() || "",
    version: form.version?.trim() || "",
    zone: form.zone?.trim() || "",
    role: form.role?.trim() || "",
    capacity: Number(form.capacity) || 0
  });
}

function validateNodeForm(form: ClusterNodeInput) {
  if (!form.name?.trim()) return "请填写节点名称。";
  if (!form.endpoint?.trim()) return "请填写主机地址。";
  if (!form.sshUser?.trim()) return "请填写 SSH 用户。";
  if (!Number.isFinite(Number(form.sshPort)) || Number(form.sshPort) <= 0) return "SSH 端口必须大于 0。";
  if (!form.installDir?.trim()) return "请填写安装目录。";
  if (!form.version?.trim()) return "请填写节点版本。";
  if (!Number.isFinite(Number(form.capacity)) || Number(form.capacity) <= 0) return "容量必须大于 0。";
  if (form.authMode === "private_key" && !form.privateKey?.trim()) return "请填写私钥后再测试连接。";
  if (form.authMode !== "private_key" && !form.password) return "请填写密码后再测试连接。";
  return null;
}

function datasourceSearchText(item: Datasource) {
  return [
    item.name,
    item.host,
    item.defaultSchema,
    item.username
  ].filter(Boolean).join(" ").toLowerCase();
}

function percent(value: number, total: number) {
  if (total <= 0) return 100;
  return Math.round((value / total) * 100);
}

function navPage(page: Page): MainPage {
  if (page === "datasourceDetail") return "datasources";
  if (page === "nodeDetail") return "nodes";
  return page;
}

function pageTitle(page: Page) {
  if (page === "datasources") return "数据源";
  if (page === "nodes") return "节点";
  if (page === "datasourceDetail") return "数据源详情";
  if (page === "nodeDetail") return "节点详情";
  return "设置";
}

function pageDescription(page: Page) {
  if (page === "datasources") return "连接与状态";
  if (page === "nodes") return "运维区";
  if (page === "settings") return "告警";
  return "";
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

function nodeStatusText(status: ClusterNode["status"]) {
  if (status === "online") return "在线";
  return "离线";
}

function nodeTone(status: ClusterNode["status"]) {
  if (status === "online") return "green";
  return "neutral";
}

function nodeActionTitle(action: NodeOperationResult["action"]) {
  if (action === "deploy") return "部署结果";
  if (action === "upgrade") return "升级结果";
  return "卸载结果";
}

export default App;
