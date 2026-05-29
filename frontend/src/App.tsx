import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowsClockwise,
  ArrowRight,
  CaretDown,
  CheckCircle,
  Database,
  DotsThree,
  GearSix,
  HardDrives,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  SignOut,
  Trash,
  WarningCircle,
  XCircle
} from "@phosphor-icons/react";
import { PermissionNotice } from "./components/PermissionNotice";
import { Button, CheckboxInput, DropdownSelect, TextareaInput, TextInput } from "./components/ui";
import mysqlLogoUrl from "./assets/mysql-logo.svg";
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
import { canManageConfig, canTestDatasource, roleLabel } from "./lib/permissions";
import type {
  AlertEvent,
  AlertRule,
  AlertRuleEvaluation,
  AlertRuleInput,
  ClusterNode,
  ClusterSnapshot,
  Datasource,
  DatasourceAuthType,
  DatasourceInput,
  DatasourcePurpose,
  DatasourceTestResult,
  NodeOperationResult,
  NodeStatusChangeResult,
  OperationLog,
  User
} from "./types/api";

type MainPage = "datasources" | "nodes" | "settings";
type Page = MainPage | "nodeDetail" | "datasourceCreate" | "datasourceEdit";
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

type DatasourceTestDialogState = {
  datasource: Datasource;
  selectedNodeId: string;
  error: string | null;
  result: DatasourceTestResult | null;
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

type DatasourceFormState = {
  name: string;
  type: "mysql";
  purpose: DatasourcePurpose;
  authType: DatasourceAuthType;
  host: string;
  port: number;
  username: string;
  password: string;
  defaultSchema: string;
  remark: string;
};

type DatasourceFieldErrors = Partial<Record<"name" | "host" | "port" | "username" | "password" | "remark", string>>;

const navItems: Array<{ id: MainPage; label: string; icon: typeof Database }> = [
  { id: "datasources", label: "数据源", icon: Database },
  { id: "nodes", label: "节点", icon: HardDrives }
];

const emptyDatasourceForm: DatasourceFormState = {
  name: "",
  type: "mysql" as const,
  purpose: "general" as const,
  authType: "password" as const,
  host: "",
  port: 3306,
  username: "",
  password: "",
  defaultSchema: "",
  remark: ""
};

const datasourceTypeOptions: Array<{ value: DatasourceFormState["type"]; label: string }> = [
  { value: "mysql", label: "MySQL" }
];

const datasourceAuthOptions: Array<{ value: DatasourceAuthType; label: string }> = [
  { value: "password", label: "用户名 & 密码" },
  { value: "none", label: "无账号密码" }
];

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

type BrandTileParticle = AnimatedParticle;

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

function createBrandTileParticles(width: number, height: number) {
  if (typeof document === "undefined") return [];
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return [];
  canvas.width = width;
  canvas.height = height;

  const label = "Canal Plus";
  let fontSize = Math.round(Math.min(width * 0.19, height * 0.72));
  const maxTextWidth = width - 4;
  const maxTextHeight = height - 4;
  while (fontSize > 12) {
    context.font = `900 ${fontSize}px ${loginDisplayFont}`;
    const metrics = context.measureText(label);
    const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    if (metrics.width <= maxTextWidth && textHeight <= maxTextHeight) {
      break;
    }
    fontSize -= 1;
  }

  context.clearRect(0, 0, width, height);
  context.font = `900 ${fontSize}px ${loginDisplayFont}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#ffffff";
  context.fillText(label, width / 2, height / 2 + height * 0.02);

  const samples: ParticlePoint[] = [];
  const pixels = context.getImageData(0, 0, width, height).data;
  const step = Math.max(3, Math.floor(Math.min(width, height) / 24));

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha < 48) continue;
      const seed = particleNoise(x * 0.51, y * 0.47);
      samples.push({
        x: x + (seed - 0.5) * 0.24,
        y: y + (0.5 - seed) * 0.24,
        size: seed > 0.78 ? 1.24 : seed > 0.42 ? 1.14 : 1.04,
        opacity: 1,
        seed
      });
    }
  }

  const limit = 1400;
  const stride = Math.max(1, Math.ceil(samples.length / limit));
  return samples.filter((_, index) => index % stride === 0).slice(0, limit);
}

function BrandParticleTile({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<BrandTileParticle[]>([]);
  const frameIdRef = useRef(0);
  const animationRunningRef = useRef(false);
  const drawFrameRef = useRef<(now: number) => void>(() => undefined);
  const lastFrameAtRef = useRef(0);
  const sizeRef = useRef({ width: 240, height: 80 });
  const pointerRef = useRef({ x: 120, y: 40 });
  const activeRef = useRef(false);

  const resetParticles = useCallback((width: number, height: number) => {
    particlesRef.current = createBrandTileParticles(width, height).map((point) => {
      return {
        ...point,
        currentX: point.x,
        currentY: point.y,
        velocityX: 0,
        velocityY: 0
      };
    });
  }, []);

  const updatePointer = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointerRef.current = {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }, []);

  const requestParticleFrame = useCallback(() => {
    if (animationRunningRef.current) return;
    animationRunningRef.current = true;
    frameIdRef.current = window.requestAnimationFrame((now) => drawFrameRef.current(now));
  }, []);

  useEffect(() => {
    const resizeCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(40, Math.round(rect.width));
      const height = Math.max(40, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { width, height };
      pointerRef.current = { x: width / 2, y: height / 2 };
      resetParticles(width, height);
      lastFrameAtRef.current = 0;
      if (activeRef.current) {
        requestParticleFrame();
      } else if (!animationRunningRef.current) {
        drawFrameRef.current(performance.now());
      }
    };

    const drawFrame = (now: number) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;
      const { width, height } = sizeRef.current;
      const delta = lastFrameAtRef.current ? Math.min(2, (now - lastFrameAtRef.current) / 16.6667) : 1;
      lastFrameAtRef.current = now;

      context.clearRect(0, 0, width, height);

      let maxDistance = 0;
      let maxVelocity = 0;
      particlesRef.current.forEach((particle) => {
        let targetX = particle.x;
        let targetY = particle.y;

        if (activeRef.current) {
          const wave = now / 260 + particle.seed * Math.PI * 2;
          targetX += Math.cos(wave) * (1.8 + particle.seed * 2.2);
          targetY += Math.sin(wave * 1.18) * (1.4 + particle.seed * 2);

          const dx = particle.currentX - pointerRef.current.x;
          const dy = particle.currentY - pointerRef.current.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const radius = Math.min(width, height) * 0.58;
          if (distance < radius) {
            const force = (1 - distance / radius) * (0.62 + particle.seed * 0.36);
            particle.velocityX += (dx / distance) * force * delta;
            particle.velocityY += (dy / distance) * force * delta;
            particle.velocityX += (-dy / distance) * force * 0.14 * delta;
            particle.velocityY += (dx / distance) * force * 0.14 * delta;
          }
        }

        const spring = activeRef.current ? 0.052 : 0.088;
        particle.velocityX += (targetX - particle.currentX) * spring * delta;
        particle.velocityY += (targetY - particle.currentY) * spring * delta;
        particle.velocityX *= activeRef.current ? 0.84 : 0.76;
        particle.velocityY *= activeRef.current ? 0.84 : 0.76;
        particle.currentX += particle.velocityX * delta;
        particle.currentY += particle.velocityY * delta;

        const distance = Math.hypot(particle.x - particle.currentX, particle.y - particle.currentY);
        const velocity = Math.hypot(particle.velocityX, particle.velocityY);
        if (distance > maxDistance) maxDistance = distance;
        if (velocity > maxVelocity) maxVelocity = velocity;

        context.globalAlpha = particle.opacity;
        context.fillStyle = particle.seed > 0.62 ? "#1d4ed8" : "#2563eb";
        context.beginPath();
        context.arc(particle.currentX, particle.currentY, particle.size, 0, Math.PI * 2);
        context.fill();
      });

      context.globalAlpha = 1;
      if (activeRef.current || maxDistance > 0.18 || maxVelocity > 0.02) {
        frameIdRef.current = window.requestAnimationFrame(drawFrame);
      } else {
        animationRunningRef.current = false;
        lastFrameAtRef.current = 0;
      }
    };

    drawFrameRef.current = drawFrame;
    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    if (canvasRef.current) observer.observe(canvasRef.current);

    return () => {
      window.cancelAnimationFrame(frameIdRef.current);
      animationRunningRef.current = false;
      observer.disconnect();
    };
  }, [requestParticleFrame, resetParticles]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Canal Plus"
      tabIndex={0}
      title="Canal Plus"
      onPointerEnter={(event) => {
        activeRef.current = true;
        updatePointer(event.clientX, event.clientY);
        requestParticleFrame();
      }}
      onPointerMove={(event) => {
        updatePointer(event.clientX, event.clientY);
        requestParticleFrame();
      }}
      onPointerLeave={() => {
        activeRef.current = false;
        requestParticleFrame();
      }}
      onMouseEnter={(event) => {
        activeRef.current = true;
        updatePointer(event.clientX, event.clientY);
        requestParticleFrame();
      }}
      onMouseMove={(event) => {
        updatePointer(event.clientX, event.clientY);
        requestParticleFrame();
      }}
      onMouseLeave={() => {
        activeRef.current = false;
        requestParticleFrame();
      }}
      onFocus={() => {
        activeRef.current = true;
        requestParticleFrame();
      }}
      onBlur={() => {
        activeRef.current = false;
        requestParticleFrame();
      }}
      className={cx(
        "block h-20 w-60 shrink-0 bg-transparent outline-none transition duration-200 hover:-translate-y-px focus:ring-4 focus:ring-blue-100",
        className
      )}
    />
  );
}

function App() {
  const [tokenState, setTokenState] = useState(getToken());
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>(() => pageFromPathname(window.location.pathname));
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [cluster, setCluster] = useState<ClusterSnapshot | null>(null);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([]);
  const [alertEvaluations, setAlertEvaluations] = useState<AlertRuleEvaluation[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const [serviceRecoveryPending, setServiceRecoveryPending] = useState(false);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [focusedDatasourceId, setFocusedDatasourceId] = useState<string | null>(() => datasourceEditIdFromPathname(window.location.pathname));
  const previousServiceUnavailable = useRef(false);
  const canManage = canManageConfig(user);
  const canTestDatasources = canTestDatasource(user);

  const navigateToPage = useCallback((nextPage: Page, mode: "push" | "replace" = "push", datasourceId?: string) => {
    setPage(nextPage);
    setFocusedDatasourceId(nextPage === "datasourceEdit" ? datasourceId ?? null : null);
    const nextPath = pathForPage(nextPage, datasourceId);
    if (window.location.pathname === nextPath) {
      return;
    }
    const state = { page: nextPage, datasourceId };
    if (mode === "replace") {
      window.history.replaceState(state, "", nextPath);
    } else {
      window.history.pushState(state, "", nextPath);
    }
  }, []);

  const pushNotice = useCallback((next: Notice) => {
    if (next.tone === "error") {
      setErrorDialog(next.message);
      return;
    }
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
    const handlePopState = () => {
      setPage(pageFromPathname(window.location.pathname));
      setFocusedDatasourceId(datasourceEditIdFromPathname(window.location.pathname));
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
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
    navigateToPage("datasources", "replace");
  };

  const handleLogout = () => {
    clearToken();
    setTokenState(null);
    setUser(null);
    setNotice(null);
  };

  const openNodeDetail = (nodeID: string) => {
    setFocusedNodeId(nodeID);
    navigateToPage("nodeDetail");
  };

  const openDatasourceCreate = () => {
    navigateToPage("datasourceCreate");
  };

  const closeDatasourceCreate = () => {
    navigateToPage("datasources", "replace");
  };

  const openDatasourceEdit = (datasourceId: string) => {
    navigateToPage("datasourceEdit", "push", datasourceId);
  };

  const closeDatasourceEdit = () => {
    navigateToPage("datasources", "replace");
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
        <div className="surface grid min-h-[calc(100dvh-1.5rem)] overflow-hidden lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="flex h-fit flex-col border-b border-line/80 p-3 lg:sticky lg:top-0 lg:min-h-[calc(100dvh-1.5rem)] lg:border-b-0 lg:border-r">
            <div className="-mx-3 flex h-[88px] items-center justify-center border-b border-line/80 px-5">
              <BrandParticleTile />
            </div>

            <nav className="mt-4 grid grid-cols-3 gap-2 lg:grid-cols-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.id}
                    onClick={() => navigateToPage(item.id)}
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

            <UserProfileMenu
              user={user}
              onOpenSettings={() => navigateToPage("settings")}
              onLogout={handleLogout}
            />
          </aside>

          <main className="min-w-0">
            {page !== "datasources" && page !== "nodes" && page !== "datasourceCreate" && page !== "datasourceEdit" && (
              <div className="flex flex-col gap-5 border-b border-line px-5 py-5 md:px-6 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-coal md:text-4xl">
                    {pageTitle(page)}
                  </h1>
                  {pageDescription(page) && (
                    <p className="mt-2 text-sm text-slate-500">
                      {pageDescription(page)}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 xl:justify-end" />
              </div>
            )}

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

            <ErrorDialog
              open={Boolean(globalError || errorDialog)}
              message={globalError || errorDialog || ""}
              onClose={() => {
                setGlobalError(null);
                setErrorDialog(null);
              }}
            />

            {loading && datasources.length === 0 ? (
              <ShellSkeleton />
            ) : page === "datasources" ? (
              <DatasourcePage
                datasources={datasources}
                cluster={cluster}
                canManage={canManage}
                canTest={canTestDatasources}
                onChanged={refresh}
                onCreate={openDatasourceCreate}
                onEdit={openDatasourceEdit}
                pushNotice={pushNotice}
              />
            ) : page === "datasourceCreate" ? (
              <DatasourceCreatePage
                datasources={datasources}
                canManage={canManage}
                onBack={closeDatasourceCreate}
                onChanged={refresh}
                pushNotice={pushNotice}
              />
            ) : page === "datasourceEdit" ? (
              <DatasourceEditPage
                key={focusedDatasourceId ?? "missing"}
                datasourceId={focusedDatasourceId}
                datasources={datasources}
                canManage={canManage}
                onBack={closeDatasourceEdit}
                onChanged={refresh}
                pushNotice={pushNotice}
              />
            ) : page === "nodes" ? (
              <NodesPage
                cluster={cluster}
                canManage={canManage}
                onChanged={refresh}
                pushNotice={pushNotice}
                onOpenNode={openNodeDetail}
              />
            ) : page === "nodeDetail" ? (
              <NodeDetailPage
                nodeId={focusedNodeId}
                cluster={cluster}
                logs={logs}
                onBack={() => navigateToPage("nodes")}
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

function DatasourcePage({
  datasources,
  cluster,
  canManage,
  canTest,
  onChanged,
  onCreate,
  onEdit,
  pushNotice
}: {
  datasources: Datasource[];
  cluster: ClusterSnapshot | null;
  canManage: boolean;
  canTest: boolean;
  onChanged: (quiet?: boolean) => Promise<void>;
  onCreate: () => void;
  onEdit: (datasourceId: string) => void;
  pushNotice: (notice: Notice) => void;
}) {
  const [draftTypeFilter, setDraftTypeFilter] = useState<"all" | "mysql">("all");
  const [draftNameQuery, setDraftNameQuery] = useState("");
  const [appliedTypeFilter, setAppliedTypeFilter] = useState<"all" | "mysql">("all");
  const [appliedNameQuery, setAppliedNameQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(1);
  const pageSize = 20;
  const [querying, setQuerying] = useState(false);
  const [queryRevealKey, setQueryRevealKey] = useState(0);
  const [testingSavedId, setTestingSavedId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);
  const [testDialog, setTestDialog] = useState<DatasourceTestDialogState | null>(null);
  const [selectedNodeByDatasource, setSelectedNodeByDatasource] = useState<Record<string, string>>({});

  const availableNodes = useMemo(() => (cluster?.nodes ?? []).filter((node) => node.status === "online"), [cluster?.nodes]);
  const defaultNodeId = useMemo(() => {
    const localNode = availableNodes.find((node) => node.id === cluster?.localNodeId);
    return localNode?.id ?? availableNodes[0]?.id ?? "";
  }, [availableNodes, cluster?.localNodeId]);
  const nodesLoading = cluster === null;

  const filteredDatasources = useMemo(() => datasources.filter((item) => {
    const matchesType = appliedTypeFilter === "all" || item.type === appliedTypeFilter;
    const query = appliedNameQuery.trim().toLowerCase();
    const matchesName = query === "" || item.name.toLowerCase().includes(query);
    return matchesType && matchesName;
  }), [appliedNameQuery, appliedTypeFilter, datasources]);

  const totalItems = filteredDatasources.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = clampPage(pageIndex, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = filteredDatasources.slice(pageStart, pageStart + pageSize);
  const tableBusy = querying;

  useEffect(() => {
    setPageIndex((current) => clampPage(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!testDialog) return;
    if (nodesLoading) return;
    const selectedNodeExists = availableNodes.some((node) => node.id === testDialog.selectedNodeId);
    if (selectedNodeExists || testDialog.selectedNodeId === defaultNodeId) {
      return;
    }
    setTestDialog({ ...testDialog, selectedNodeId: defaultNodeId, error: defaultNodeId ? null : "无节点" });
  }, [availableNodes, defaultNodeId, nodesLoading, testDialog]);

  const runQuery = async () => {
    setQuerying(true);
    try {
      await onChanged(true);
      setAppliedTypeFilter(draftTypeFilter);
      setAppliedNameQuery(draftNameQuery);
      setPageIndex(1);
      setQueryRevealKey((current) => current + 1);
    } finally {
      setQuerying(false);
    }
  };

  const goToPage = (nextPage: number) => {
    setPageIndex(clampPage(nextPage, totalPages));
  };

  const openTestDialog = (item: Datasource) => {
    const cachedNodeId = selectedNodeByDatasource[item.id];
    const selectedNodeId = availableNodes.some((node) => node.id === cachedNodeId) ? cachedNodeId : defaultNodeId;
    setTestDialog({
      datasource: item,
      selectedNodeId,
      error: selectedNodeId ? null : "无节点",
      result: null
    });
  };

  const testSavedDatasource = async () => {
    if (!testDialog) return;
    if (!testDialog.selectedNodeId) {
      setTestDialog({ ...testDialog, error: "无节点" });
      return;
    }
    const datasourceId = testDialog.datasource.id;
    const selectedNodeId = testDialog.selectedNodeId;
    setTestingSavedId(datasourceId);
    setTestDialog({ ...testDialog, error: null });
    try {
      const result = await api.testDatasource(datasourceId, { nodeId: selectedNodeId });
      setSelectedNodeByDatasource((current) => ({ ...current, [datasourceId]: selectedNodeId }));
      await onChanged(true);
      if (result.success) {
        setTestDialog((current) => current?.datasource.id === datasourceId ? { ...current, result, error: null } : current);
      } else {
        setTestDialog((current) => current?.datasource.id === datasourceId ? { ...current, result, error: result.message || "测试失败" } : current);
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "连接失败";
      setTestDialog((current) => current?.datasource.id === datasourceId ? { ...current, error: message, result: null } : current);
    } finally {
      setTestingSavedId(null);
    }
  };

  const executeRemoveDatasource = async (item: Datasource) => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "权限不足" });
      return;
    }
    try {
      await api.deleteDatasource(item.id);
      const nextTotalPages = Math.max(1, Math.ceil(Math.max(0, filteredDatasources.length - 1) / pageSize));
      setPageIndex((current) => clampPage(current, nextTotalPages));
      pushNotice({ tone: "success", message: "已删除" });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "删除失败" });
    }
  };

  const requestRemoveDatasource = (item: Datasource) => {
    setConfirmation({
      title: `删除 ${item.name}`,
      description: "删除后无法恢复。",
      confirmLabel: "删除",
      confirmTone: "danger",
      onConfirm: () => {
        void executeRemoveDatasource(item);
      }
    });
  };

  return (
    <>
      <section className="min-w-0 overflow-hidden">
        <div className="border-b border-line px-5 py-5 md:px-6">
          <h1 className="text-3xl font-semibold tracking-tight text-coal md:text-4xl">数据源</h1>
        </div>

        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 md:px-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid gap-3 sm:grid-cols-[170px_240px_auto] sm:items-end">
            <label className="block">
              <span className="label mb-2 block">类型</span>
              <DropdownSelect
                value={draftTypeFilter}
                disabled={tableBusy}
                ariaLabel="类型"
                options={[
                  { value: "all", label: "全部" },
                  { value: "mysql", label: "MySQL" }
                ]}
                onChange={(nextValue) => setDraftTypeFilter(nextValue as "all" | "mysql")}
              />
            </label>
            <label className="block">
              <span className="label mb-2 block">名称</span>
              <TextInput
                className="input"
                value={draftNameQuery}
                disabled={tableBusy}
                placeholder="名称"
                onChange={(event) => setDraftNameQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runQuery();
                  }
                }}
              />
            </label>
            <Button type="button" onClick={() => void runQuery()} disabled={tableBusy} className="btn-primary">
              {querying ? <ArrowsClockwise size={16} /> : <MagnifyingGlass size={16} />}
              {querying ? "查询中" : "查询"}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 xl:justify-end">
            {canManage ? (
              <Button type="button" onClick={onCreate} className="btn-primary">
                <Plus size={16} />
                新增数据源
              </Button>
            ) : (
              <div title="权限不足">
                <Button type="button" disabled className="btn-secondary w-full">
                  <Plus size={16} />
                  新增数据源
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[595px] table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-[250px]" />
              <col className="w-[170px]" />
              <col className="w-[95px]" />
              <col className="w-[170px]" />
            </colgroup>
            <thead className="bg-slate-50/90 text-xs font-semibold text-slate-500">
              <tr className="border-b border-line">
                <th className="whitespace-nowrap px-5 py-3 md:px-6">数据源名称</th>
                <th className="whitespace-nowrap px-4 py-3">Host</th>
                <th className="whitespace-nowrap px-4 py-3">版本号</th>
                <th className="whitespace-nowrap px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {pageItems.length === 0 ? (
                <tr
                  key={`empty-${queryRevealKey}`}
                  className={cx(queryRevealKey > 0 && !tableBusy && "query-reveal-row")}
                  style={queryRevealKey > 0 && !tableBusy ? { animationDelay: "0ms" } : undefined}
                >
                  <td colSpan={4} className="px-6 py-12">
                    <div className="mx-auto flex max-w-sm flex-col items-center text-center">
                      <div className="text-base font-semibold text-coal">
                        {datasources.length === 0 ? "暂无数据源" : "无匹配"}
                      </div>
                      {!canManage && datasources.length === 0 && (
                        <div className="mt-5">
                          <PermissionNotice compact description="仅管理员可新增。" />
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ) : pageItems.map((item, index) => (
                <tr
                  key={`${queryRevealKey}-${item.id}`}
                  className={cx("transition hover:bg-slate-50/70", tableBusy && "opacity-70", queryRevealKey > 0 && !tableBusy && "query-reveal-row")}
                  style={queryRevealKey > 0 && !tableBusy ? { animationDelay: `${Math.min(index, 14) * 44}ms` } : undefined}
                >
                  <td className="max-w-[340px] px-5 py-4 align-middle md:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                      <DatasourceTypeIcon type={item.type} />
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-semibold text-coal">{item.name || item.id}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 align-middle">
                    <div className="flex min-w-0 items-center gap-2">
                      <span title={`${item.host}:${item.port}`} className="min-w-0 truncate font-mono text-sm text-coal">{item.host}:{item.port}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 align-middle font-mono text-sm text-slate-600">{item.version?.trim() || "-"}</td>
                  <td className="px-4 py-4 align-middle">
                    <div className="flex items-center justify-start gap-2">
                      {canTest && (
                        <Button
                          type="button"
                          onClick={() => openTestDialog(item)}
                          disabled={testingSavedId === item.id}
                          className="btn-compact whitespace-nowrap"
                        >
                          {testingSavedId === item.id ? <ArrowsClockwise size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                          {testingSavedId === item.id ? "测试中" : "测试连接"}
                        </Button>
                      )}
                      {canManage && (
                        <ActionMenu
                          label="更多"
                          items={[
                            {
                              label: "编辑",
                              onSelect: () => onEdit(item.id)
                            },
                            {
                              label: "删除",
                              danger: true,
                              onSelect: () => requestRemoveDatasource(item)
                            }
                          ]}
                        />
                      )}
                      {!canTest && !canManage && <span className="text-sm text-slate-400">-</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-center justify-center gap-3 border-t border-line px-5 py-4 text-sm text-slate-600 md:px-6 sm:flex-row sm:items-center">
          <div>共 {totalItems} 条</div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className="btn-compact">
              <ArrowRight size={14} className="rotate-180" />
              上一页
            </Button>
            <span className="min-w-16 text-center font-mono text-sm text-coal">{currentPage}/{totalPages}</span>
            <Button type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages} className="btn-compact">
              下一页
              <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      </section>

      <DatasourceTestModal
        open={Boolean(testDialog)}
        nodes={availableNodes}
        loading={nodesLoading}
        selectedNodeId={testDialog?.selectedNodeId ?? ""}
        testing={testDialog ? testingSavedId === testDialog.datasource.id : false}
        error={testDialog?.error ?? null}
        result={testDialog?.result ?? null}
        onNodeChange={(nodeId) => {
          if (!testDialog) return;
          setTestDialog({ ...testDialog, selectedNodeId: nodeId, error: null, result: null });
        }}
        onClose={() => setTestDialog(null)}
        onTest={() => void testSavedDatasource()}
      />

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
    </>
  );
}

function DatasourceCreatePage({
  datasources,
  canManage,
  onBack,
  onChanged,
  pushNotice
}: {
  datasources: Datasource[];
  canManage: boolean;
  onBack: () => void;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
}) {
  const [selectedType, setSelectedType] = useState<DatasourceFormState["type"] | null>("mysql");
  const [form, setForm] = useState<DatasourceFormState>(() => emptyDatasourceFormForType("mysql"));
  const [testedFingerprint, setTestedFingerprint] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<DatasourceTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);
  const nameManuallyEditedRef = useRef(false);

  const hasTypes = datasourceTypeOptions.length > 0;
  const currentFingerprint = selectedType ? datasourceFormConnectionFingerprint(form) : "";
  const freshTestResult = selectedType && testedFingerprint === currentFingerprint ? testResult : null;
  const displayedTestResult = freshTestResult ?? testResult;
  const validationError = selectedType ? validateDatasourceForm(form, true) : "请选择类型";
  const fieldErrors = showFieldErrors ? datasourceFieldErrors(form, true) : {};
  const duplicateName = selectedType ? datasources.some((item) => item.name.trim() === form.name.trim() && form.name.trim() !== "") : false;
  const dirty = selectedType ? isDatasourceFormDirty(form, emptyDatasourceFormForType(selectedType)) || Boolean(testResult) : false;
  const saveBlockReason = !selectedType
    ? "请选择类型"
    : duplicateName
      ? "同名"
      : validationError
        ? "请填写必填项"
        : !freshTestResult?.success
          ? "请先测试"
          : null;

  const applyType = (type: DatasourceFormState["type"]) => {
    nameManuallyEditedRef.current = false;
    setSelectedType(type);
    setForm(emptyDatasourceFormForType(type));
    setTestedFingerprint(null);
    setTestResult(null);
    setShowFieldErrors(false);
  };

  const requestType = (type: DatasourceFormState["type"]) => {
    if (selectedType === type) return;
    if (!dirty) {
      applyType(type);
      return;
    }
    setConfirmation({
      title: "切换类型",
      description: "切换后将清空已填内容。",
      confirmLabel: "切换",
      confirmTone: "danger",
      onConfirm: () => applyType(type)
    });
  };

  const requestBack = () => {
    if (!dirty) {
      onBack();
      return;
    }
    setConfirmation({
      title: "放弃更改",
      description: "离开后未保存内容会丢失。",
      confirmLabel: "离开",
      confirmTone: "danger",
      onConfirm: onBack
    });
  };

  const updateForm = (nextForm: DatasourceFormState | ((currentForm: DatasourceFormState) => DatasourceFormState)) => {
    setForm((currentForm) => {
      const resolvedForm = typeof nextForm === "function" ? nextForm(currentForm) : nextForm;
      if (!nameManuallyEditedRef.current) {
        return { ...resolvedForm, name: datasourceGeneratedName(resolvedForm) };
      }
      return resolvedForm;
    });
  };

  const updateName = (name: string) => {
    const generatedName = datasourceGeneratedName(form);
    nameManuallyEditedRef.current = name.trim() !== generatedName;
    setForm((currentForm) => ({ ...currentForm, name }));
  };

  const updateAuthType = (authType: DatasourceAuthType) => {
    updateForm((currentForm) => authType === "none" ? { ...currentForm, authType, username: "", password: "" } : { ...currentForm, authType });
  };

  const testConnection = async () => {
    if (!selectedType) {
      pushNotice({ tone: "warning", message: "请选择类型" });
      return;
    }
    if (validateDatasourceForm(form, true)) {
      setShowFieldErrors(true);
      return;
    }
    const fingerprint = datasourceFormConnectionFingerprint(form);
    setTesting(true);
    try {
      const result = await api.testDatasourceInput(datasourceFormPayload(form));
      setTestedFingerprint(fingerprint);
      setTestResult(result);
    } catch (requestError) {
      setTestResult(null);
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "连接失败" });
    } finally {
      setTesting(false);
    }
  };

  const saveDatasource = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage) {
      pushNotice({ tone: "warning", message: "权限不足" });
      return;
    }
    if (saveBlockReason) {
      if (validationError) {
        setShowFieldErrors(true);
        return;
      }
      pushNotice({ tone: duplicateName ? "warning" : "error", message: saveBlockReason });
      return;
    }
    setSubmitting(true);
    try {
      await api.createDatasource(datasourceFormPayload(form));
      pushNotice({ tone: "success", message: "已保存" });
      await onChanged();
      onBack();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "保存失败" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!canManage) {
    return (
      <section className="p-5 md:p-6">
        <Button type="button" onClick={onBack} className="btn-secondary">
          <ArrowRight size={14} className="rotate-180" />
          返回
        </Button>
        <div className="mt-5">
          <PermissionNotice description="权限不足" />
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={saveDatasource}>
      <section className="overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
            <h1 className="text-3xl font-semibold tracking-tight text-coal md:text-4xl">新增数据源</h1>
            <Button type="button" onClick={requestBack} className="btn-secondary">
              <ArrowRight size={14} className="rotate-180" />
              返回
            </Button>
          </div>

          {hasTypes ? (
            <div role="radiogroup" aria-label="数据源类型" className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(160px,180px))] gap-3">
              {datasourceTypeOptions.map((option) => {
                const selected = selectedType === option.value;
                return (
                  <Button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => requestType(option.value)}
                    className={cx(
                      "flex min-h-[64px] items-center gap-3 rounded-lg border bg-white p-3 text-left transition active:translate-y-px",
                      selected
                        ? "border-blue-300 bg-blue-50 shadow-[inset_3px_0_0_#2563eb]"
                        : "border-line hover:border-blue-200 hover:bg-slate-50"
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-100 bg-cyan-50">
                      <DatasourceTypeLogo type={option.value} className="h-7 w-7" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-base font-semibold text-coal">{option.label}</span>
                    </span>
                  </Button>
                );
              })}
            </div>
          ) : (
            <EmptyPanel icon={Database} title="暂无类型" />
          )}
        </div>

        {selectedType && (
          <div className="border-t border-line p-5 md:p-6">
            <div className="grid gap-4">
              <div className="grid gap-4">
                <Field label="名称" required error={fieldErrors.name || (duplicateName ? "同名" : undefined)}>
                  <TextInput className="input" value={form.name} maxLength={50} onChange={(event) => updateName(event.target.value)} />
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_150px]">
                <Field label="主机" required error={fieldErrors.host}>
                  <TextInput className="input" value={form.host} onChange={(event) => updateForm((currentForm) => ({ ...currentForm, host: event.target.value }))} />
                </Field>
                <Field label="端口" required error={fieldErrors.port}>
                  <TextInput className="input" type="number" min={1} max={65535} value={form.port} onChange={(event) => updateForm((currentForm) => ({ ...currentForm, port: Number(event.target.value) }))} />
                </Field>
              </div>

              <div className="grid gap-4">
                <Field label="认证类型" required>
                  <DropdownSelect
                    value={form.authType}
                    ariaLabel="认证类型"
                    options={datasourceAuthOptions}
                    className="max-w-[180px]"
                    onChange={(nextValue) => updateAuthType(nextValue as DatasourceAuthType)}
                  />
                </Field>
              </div>

              {form.authType === "password" && (
                <div className="grid gap-4">
                  <Field label="用户名" required error={fieldErrors.username}>
                    <TextInput className="input" value={form.username} onChange={(event) => updateForm((currentForm) => ({ ...currentForm, username: event.target.value }))} />
                  </Field>
                  <Field label="密码" required error={fieldErrors.password}>
                    <TextInput className="input" type="password" value={form.password} onChange={(event) => updateForm((currentForm) => ({ ...currentForm, password: event.target.value }))} />
                  </Field>
                </div>
              )}

              <Field label="备注" error={fieldErrors.remark}>
                <TextareaInput className="textarea" maxLength={200} value={form.remark} onChange={(event) => updateForm((currentForm) => ({ ...currentForm, remark: event.target.value }))} />
              </Field>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          {selectedType && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button type="button" onClick={() => void testConnection()} disabled={testing} className="btn-secondary">
                {testing ? <ArrowsClockwise size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                {testing ? "测试中" : "测试连接"}
              </Button>
              <DatasourceTestInlineResult
                error={displayedTestResult?.success === false ? displayedTestResult.message || "连接失败" : null}
                result={displayedTestResult}
              />
            </div>
          )}
          <div className="flex justify-end gap-3 sm:ml-auto">
            <Button type="button" onClick={requestBack} className="btn-secondary">
              取消
            </Button>
            <Button type="submit" disabled={submitting || !selectedType} title={!selectedType ? "请选择类型" : undefined} className="btn-primary">
              {submitting ? <ArrowsClockwise size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              {submitting ? "保存中" : "保存"}
            </Button>
          </div>
        </div>
      </section>

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
    </form>
  );
}

function DatasourceEditPage({
  datasourceId,
  datasources,
  canManage,
  onBack,
  onChanged,
  pushNotice
}: {
  datasourceId: string | null;
  datasources: Datasource[];
  canManage: boolean;
  onBack: () => void;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
}) {
  const datasource = datasourceId ? datasources.find((item) => item.id === datasourceId) ?? null : null;
  const initial = datasource ? datasourceFormFromItem(datasource) : emptyDatasourceFormForType("mysql");
  const [form, setForm] = useState<DatasourceFormState>(initial);
  const [initialForm] = useState<DatasourceFormState>(initial);
  const [initialConnectionFingerprint] = useState(datasourceFormConnectionFingerprint(initial));
  const [testedFingerprint, setTestedFingerprint] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<DatasourceTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);

  const currentFingerprint = datasource ? datasourceFormConnectionFingerprint(form) : "";
  const connectionChanged = datasource ? currentFingerprint !== initialConnectionFingerprint : false;
  const freshTestResult = testedFingerprint === currentFingerprint ? testResult : null;
  const displayedTestResult = freshTestResult ?? testResult;
  const passwordRequired = !datasource?.hasPassword;
  const validationError = datasource ? validateDatasourceForm(form, passwordRequired) : "数据源不存在";
  const fieldErrors = showFieldErrors ? datasourceFieldErrors(form, passwordRequired) : {};
  const duplicateName = Boolean(datasource) && datasources.some((item) => item.id !== datasource?.id && item.name.trim() === form.name.trim() && form.name.trim() !== "");
  const needsFreshTest = connectionChanged;
  const saveBlockReason = !datasource
    ? "数据源不存在"
    : duplicateName
      ? "同名"
      : validationError
        ? "请填写必填项"
        : needsFreshTest && !freshTestResult?.success
          ? "请先测试"
          : null;
  const dirty = datasource ? isDatasourceFormDirty(form, initialForm) || Boolean(testResult) : false;
  const datasourceTypeLabel = datasourceTypeOptions.find((option) => option.value === form.type)?.label ?? form.type;

  const updateAuthType = (authType: DatasourceAuthType) => {
    setForm(authType === "none" ? { ...form, authType, username: "", password: "" } : { ...form, authType });
  };

  const requestBack = () => {
    if (!dirty) {
      onBack();
      return;
    }
    setConfirmation({
      title: "放弃更改",
      description: "离开后未保存内容会丢失。",
      confirmLabel: "离开",
      confirmTone: "danger",
      onConfirm: onBack
    });
  };

  const testConnection = async () => {
    if (!datasource) {
      pushNotice({ tone: "error", message: "数据源不存在" });
      return;
    }
    if (validateDatasourceForm(form, passwordRequired)) {
      setShowFieldErrors(true);
      return;
    }
    const fingerprint = datasourceFormConnectionFingerprint(form);
    setTesting(true);
    try {
      const result = await api.testDatasourceInput(datasourceFormPayload(form, datasource.id));
      setTestedFingerprint(fingerprint);
      setTestResult(result);
    } catch (requestError) {
      setTestResult(null);
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "连接失败" });
    } finally {
      setTesting(false);
    }
  };

  const saveDatasource = async (event: FormEvent) => {
    event.preventDefault();
    if (!datasource) {
      pushNotice({ tone: "error", message: "数据源不存在" });
      return;
    }
    if (!canManage) {
      pushNotice({ tone: "warning", message: "权限不足" });
      return;
    }
    if (saveBlockReason) {
      if (validationError) {
        setShowFieldErrors(true);
        return;
      }
      pushNotice({ tone: duplicateName ? "warning" : "error", message: saveBlockReason });
      return;
    }
    setSubmitting(true);
    try {
      await api.updateDatasource(datasource.id, datasourceFormPayload(form, datasource.id));
      pushNotice({ tone: "success", message: "已保存" });
      await onChanged();
      onBack();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "保存失败" });
    } finally {
      setSubmitting(false);
    }
  };

  if (!canManage) {
    return (
      <section className="p-5 md:p-6">
        <Button type="button" onClick={onBack} className="btn-secondary">
          <ArrowRight size={14} className="rotate-180" />
          返回
        </Button>
        <div className="mt-5">
          <PermissionNotice description="权限不足" />
        </div>
      </section>
    );
  }

  if (!datasource) {
    return (
      <section className="p-5 md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <h1 className="text-3xl font-semibold tracking-tight text-coal md:text-4xl">编辑数据源</h1>
          <Button type="button" onClick={onBack} className="btn-secondary">
            <ArrowRight size={14} className="rotate-180" />
            返回
          </Button>
        </div>
        <div className="mt-5">
          <EmptyPanel icon={Database} title="不存在" />
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={saveDatasource}>
      <section className="overflow-hidden">
        <div className="p-5 md:p-6">
          <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight text-coal md:text-4xl">编辑数据源</h1>
              <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-slate-50 px-2.5 py-1.5 text-sm font-medium text-coal">
                <DatasourceTypeLogo type={form.type} className="h-5 w-5" />
                {datasourceTypeLabel}
              </span>
            </div>
            <Button type="button" onClick={requestBack} className="btn-secondary">
              <ArrowRight size={14} className="rotate-180" />
              返回
            </Button>
          </div>

          <div className="mt-5 grid gap-4">
            <div className="grid gap-4">
              <Field label="名称" required error={fieldErrors.name || (duplicateName ? "同名" : undefined)}>
                <TextInput className="input" value={form.name} maxLength={50} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_150px]">
              <Field label="主机" required error={fieldErrors.host}>
                <TextInput className="input" value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} />
              </Field>
              <Field label="端口" required error={fieldErrors.port}>
                <TextInput className="input" type="number" min={1} max={65535} value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} />
              </Field>
            </div>

            <div className="grid gap-4">
              <Field label="认证类型" required>
                <DropdownSelect
                  value={form.authType}
                  ariaLabel="认证类型"
                  options={datasourceAuthOptions}
                  className="max-w-[180px]"
                  onChange={(nextValue) => updateAuthType(nextValue as DatasourceAuthType)}
                />
              </Field>
            </div>

            {form.authType === "password" && (
              <div className="grid gap-4">
                <Field label="用户名" required error={fieldErrors.username}>
                  <TextInput className="input" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
                </Field>
                <Field label="密码" required={form.authType === "password" && passwordRequired} error={fieldErrors.password}>
                  <TextInput
                    className="input"
                    type="password"
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    placeholder="留空不变"
                  />
                </Field>
              </div>
            )}

            <Field label="备注" error={fieldErrors.remark}>
              <TextareaInput className="textarea" maxLength={200} value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} />
            </Field>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="button" onClick={() => void testConnection()} disabled={testing} className="btn-secondary">
              {testing ? <ArrowsClockwise size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
              {testing ? "测试中" : "测试连接"}
            </Button>
            <DatasourceTestInlineResult
              error={displayedTestResult?.success === false ? displayedTestResult.message || "连接失败" : null}
              result={displayedTestResult}
            />
          </div>
          <div className="flex justify-end gap-3 sm:ml-auto">
            <Button type="button" onClick={requestBack} className="btn-secondary">
              取消
            </Button>
            <Button type="submit" disabled={submitting} title={saveBlockReason || undefined} className="btn-primary">
              {submitting ? <ArrowsClockwise size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              {submitting ? "保存中" : "保存"}
            </Button>
          </div>
        </div>
      </section>

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
    </form>
  );
}

function DatasourceTestModal({
  open,
  nodes,
  loading,
  selectedNodeId,
  testing,
  error,
  result,
  onNodeChange,
  onClose,
  onTest
}: {
  open: boolean;
  nodes: ClusterNode[];
  loading: boolean;
  selectedNodeId: string;
  testing: boolean;
  error: string | null;
  result: DatasourceTestResult | null;
  onNodeChange: (nodeId: string) => void;
  onClose: () => void;
  onTest: () => void;
}) {
  const hasNodes = nodes.length > 0;
  const selectedValue = nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : "";
  const nodeOptions = loading
    ? [{ value: "", label: "加载中", disabled: true }]
    : hasNodes
      ? nodes.map((node) => ({ value: node.id, label: node.name || node.id }))
      : [{ value: "", label: "无节点", disabled: true }];
  const testDisabled = testing || loading || !hasNodes || !selectedValue;

  return (
    <Modal open={open} title="测试连接" onClose={onClose} size="md">
      <div className="grid gap-5">
        <div className="grid gap-3">
          <div className="text-sm font-medium text-coal">节点</div>
          <DropdownSelect
            value={selectedValue}
            ariaLabel="节点"
            disabled={testing || loading || !hasNodes}
            options={nodeOptions}
            onChange={onNodeChange}
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="button" onClick={onTest} disabled={testDisabled} className="btn-secondary">
            {testing ? <ArrowsClockwise size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
            {testing ? "测试中" : "测试连接"}
          </Button>
          <DatasourceTestInlineResult error={error} result={result} />
        </div>
      </div>
    </Modal>
  );
}

function DatasourceTestInlineResult({ error, result }: { error: string | null; result: DatasourceTestResult | null }) {
  if (result?.success) {
    return (
      <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-emerald-700">
        <CheckCircle className="shrink-0" size={17} weight="fill" />
        <span className="truncate">{result.version?.trim() || "测试通过"}</span>
      </span>
    );
  }
  if (error || result?.success === false) {
    return (
      <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-red-700">
        <XCircle className="shrink-0" size={17} weight="fill" />
        <span className="truncate" title={error || result?.message || "测试失败"}>
          {error || result?.message || "测试失败"}
        </span>
      </span>
    );
  }
  return null;
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
  onOpenNode
}: {
  cluster: ClusterSnapshot | null;
  canManage: boolean;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
  onOpenNode: (nodeID: string) => void;
}) {
  const nodes = cluster?.nodes ?? emptyNodes;
  const [draftStatusFilter, setDraftStatusFilter] = useState<"all" | ClusterNode["status"]>("all");
  const [draftNameQuery, setDraftNameQuery] = useState("");
  const [appliedStatusFilter, setAppliedStatusFilter] = useState<"all" | ClusterNode["status"]>("all");
  const [appliedNameQuery, setAppliedNameQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(1);
  const pageSize = 20;
  const [querying, setQuerying] = useState(false);
  const [queryRevealKey, setQueryRevealKey] = useState(0);
  const [operationResult, setOperationResult] = useState<NodeOperationResult | null>(null);
  const [handoffReport, setHandoffReport] = useState<ClusterHandoffReport | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);
  const localNodeId = cluster?.localNodeId;
  const tableBusy = querying || Boolean(busyKey);

  const filteredNodes = useMemo(() => nodes.filter((node) => {
    const matchesStatus = appliedStatusFilter === "all" || node.status === appliedStatusFilter;
    const query = appliedNameQuery.trim().toLowerCase();
    const matchesName = query === "" || node.name.toLowerCase().includes(query);
    return matchesStatus && matchesName;
  }), [appliedNameQuery, appliedStatusFilter, nodes]);

  const totalItems = filteredNodes.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = clampPage(pageIndex, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = filteredNodes.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setPageIndex((current) => clampPage(current, totalPages));
  }, [totalPages]);

  const runQuery = async () => {
    setQuerying(true);
    try {
      await onChanged(true);
      setAppliedStatusFilter(draftStatusFilter);
      setAppliedNameQuery(draftNameQuery);
      setPageIndex(1);
      setQueryRevealKey((current) => current + 1);
    } finally {
      setQuerying(false);
    }
  };

  const goToPage = (nextPage: number) => {
    setPageIndex(clampPage(nextPage, totalPages));
  };

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
    <>
      <section className="min-w-0">
        <div className="border-b border-line px-5 py-5 md:px-6">
          <h1 className="text-3xl font-semibold tracking-tight text-coal md:text-4xl">节点</h1>
        </div>

        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 md:px-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid gap-3 sm:grid-cols-[170px_240px_auto] sm:items-end">
            <label className="block">
              <span className="label mb-2 block">状态</span>
              <DropdownSelect
                value={draftStatusFilter}
                disabled={tableBusy}
                ariaLabel="状态"
                options={[
                  { value: "all", label: "全部" },
                  { value: "online", label: "在线" },
                  { value: "offline", label: "离线" }
                ]}
                onChange={(nextValue) => setDraftStatusFilter(nextValue as "all" | ClusterNode["status"])}
              />
            </label>
            <label className="block">
              <span className="label mb-2 block">名称</span>
              <TextInput
                className="input"
                value={draftNameQuery}
                disabled={tableBusy}
                placeholder="名称"
                onChange={(event) => setDraftNameQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runQuery();
                  }
                }}
              />
            </label>
            <Button type="button" onClick={() => void runQuery()} disabled={tableBusy} className="btn-primary">
              {querying ? <ArrowsClockwise size={16} /> : <MagnifyingGlass size={16} />}
              {querying ? "查询中" : "查询"}
            </Button>
          </div>

          <div className="hidden xl:block" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-[220px]" />
              <col className="w-[100px]" />
              <col className="w-[170px]" />
              <col className="w-[105px]" />
              <col className="w-[170px]" />
              <col className="w-[170px]" />
            </colgroup>
            <thead className="bg-slate-50/90 text-xs font-semibold text-slate-500">
              <tr className="border-b border-line">
                <th className="whitespace-nowrap px-5 py-3 md:px-6">节点名称</th>
                <th className="whitespace-nowrap px-4 py-3">状态</th>
                <th className="whitespace-nowrap px-4 py-3">Host</th>
                <th className="whitespace-nowrap px-4 py-3">版本号</th>
                <th className="whitespace-nowrap px-4 py-3">资源</th>
                <th className="whitespace-nowrap px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-white">
              {pageItems.length === 0 ? (
                <tr
                  key={`empty-${queryRevealKey}`}
                  className={cx(queryRevealKey > 0 && !tableBusy && "query-reveal-row")}
                  style={queryRevealKey > 0 && !tableBusy ? { animationDelay: "0ms" } : undefined}
                >
                  <td colSpan={6} className="px-6 py-12">
                    <div className="mx-auto flex max-w-sm flex-col items-center text-center">
                      <div className="text-base font-semibold text-coal">
                        {nodes.length === 0 ? "暂无节点" : "无匹配"}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : pageItems.map((node, index) => {
                const isCurrentNode = localNodeId === node.id;
                const actionBusy = busyKey?.startsWith(`${node.id}:`) ?? false;
                return (
                  <tr
                    key={`${queryRevealKey}-${node.id}`}
                    className={cx("transition hover:bg-slate-50/70", tableBusy && "opacity-70", queryRevealKey > 0 && !tableBusy && "query-reveal-row")}
                    style={queryRevealKey > 0 && !tableBusy ? { animationDelay: `${Math.min(index, 14) * 44}ms` } : undefined}
                  >
                    <td className="max-w-[340px] px-5 py-4 align-middle md:px-6">
                      <div className="flex min-w-0 items-center gap-3">
                        <NodeTypeIcon status={node.status} />
                        <Button type="button" onClick={() => onOpenNode(node.id)} className="panel-link min-w-0">
                          <span className="block truncate text-sm font-semibold text-coal">{node.name || node.id}</span>
                        </Button>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <Badge tone={nodeTone(node.status)}>{nodeStatusText(node.status)}</Badge>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <span title={node.endpoint} className="block truncate font-mono text-sm text-coal">{node.endpoint}</span>
                    </td>
                    <td className="px-4 py-4 align-middle font-mono text-sm text-slate-600">{node.version?.trim() || "-"}</td>
                    <td className="px-4 py-4 align-middle text-sm text-slate-600">
                      <span className="block truncate" title={`CPU ${node.cpuPercent}% · 内存 ${node.memoryPercent}%`}>
                        CPU {node.cpuPercent}% · 内存 {node.memoryPercent}%
                      </span>
                    </td>
                    <td className="px-4 py-4 align-middle">
                      <div className="flex items-center justify-start gap-2">
                        <Button
                          type="button"
                          onClick={() => onOpenNode(node.id)}
                          className="btn-compact whitespace-nowrap"
                        >
                          <ArrowRight size={14} />
                          详情
                        </Button>
                        {canManage && (
                          <ActionMenu
                            label="更多"
                            items={[
                              { label: "升级", onSelect: () => requestQuickAction(node, "upgrade"), disabled: tableBusy },
                              { label: "卸载", onSelect: () => requestQuickAction(node, "uninstall"), danger: true, disabled: tableBusy || isCurrentNode },
                              { label: node.status === "online" ? "下线" : "上线", onSelect: () => requestMoreAction(node, node.status === "online" ? "offline" : "online"), disabled: tableBusy || (isCurrentNode && node.status === "online") },
                            ]}
                          />
                        )}
                        {actionBusy && <ArrowsClockwise size={14} className="animate-spin text-slate-400" />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-center justify-center gap-3 border-t border-line px-5 py-4 text-sm text-slate-600 md:px-6 sm:flex-row sm:items-center">
          <div>共 {totalItems} 条</div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1} className="btn-compact">
              <ArrowRight size={14} className="rotate-180" />
              上一页
            </Button>
            <span className="min-w-16 text-center font-mono text-sm text-coal">{currentPage}/{totalPages}</span>
            <Button type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages} className="btn-compact">
              下一页
              <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      </section>

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
    </>
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
      <section className="p-6">
        <DetailPageHeader title="节点详情" onBack={onBack} />
        <div className="mt-5 text-sm text-slate-500">节点不存在或已删除。</div>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <section className="p-6">
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
        <section className="border-t border-line p-6">
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
    <section className="p-6">
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
            <div className="flex justify-center">
              <BrandParticleTile />
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

function DetailCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-b border-line px-0 py-3">
      <div className="label">{label}</div>
      <div className={cx("mt-2 text-sm font-medium text-coal", mono && "mono")}>{value}</div>
    </div>
  );
}

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-2 flex items-center gap-1.5">
        {required && <span className="mr-1 text-red-500">*</span>}
        <span>{label}</span>
        {error && <span className="text-xs font-medium text-red-600">{error}</span>}
      </span>
      {children}
    </label>
  );
}

function DatasourceTypeLogo({ type, className }: { type?: Datasource["type"]; className?: string }) {
  if (type === "mysql" || !type) {
    return <img src={mysqlLogoUrl} alt="" className={cx("object-contain", className)} draggable={false} />;
  }
  return <Database size={18} />;
}

function DatasourceTypeIcon({ type }: { type?: Datasource["type"] }) {
  const label = datasourceTypeText(type);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const tooltipOpen = isHovered || isFocused;

  return (
    <span
      role="img"
      aria-label={label}
      tabIndex={0}
      title={label}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onClick={() => setIsFocused(true)}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-100 bg-cyan-50 text-cyan-700 outline-none focus:ring-4 focus:ring-blue-100"
    >
      <DatasourceTypeLogo type={type} className="h-8 w-8" />
      <span
        aria-hidden="true"
        className={cx(
          "pointer-events-none absolute left-[calc(100%+0.5rem)] top-1/2 z-30 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-white px-2 py-1 text-xs font-medium text-coal shadow-raised transition",
          tooltipOpen ? "opacity-100" : "opacity-0"
        )}
      >
        {label}
      </span>
    </span>
  );
}

function NodeTypeIcon({ status }: { status: ClusterNode["status"] }) {
  const online = status === "online";
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
        online ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"
      )}
    >
      <HardDrives size={18} />
    </span>
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
  closeOnOverlay = false
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
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

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
        onCloseRef.current();
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
  }, [open]);

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

function ErrorDialog({
  open,
  message,
  onClose
}: {
  open: boolean;
  message: string;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title="错误" onClose={onClose} size="md" closeOnOverlay={false}>
      <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <XCircle className="mt-0.5 shrink-0" size={18} />
        <div className="min-w-0 break-words">{message || "请求失败"}</div>
      </div>
      <div className="mt-5 flex justify-end">
        <Button type="button" onClick={onClose} className="btn-primary">
          关闭
        </Button>
      </div>
    </Modal>
  );
}

function ActionMenu({
  label,
  items
}: {
  label?: string;
  items: Array<{ label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const width = Math.max(160, rect.width);
    const menuHeight = Math.min(320, 16 + items.length * 40);
    const left = Math.min(Math.max(12, rect.right - width), Math.max(12, window.innerWidth - width - 12));
    const bottomTop = rect.bottom + 8;
    const top = bottomTop + menuHeight > window.innerHeight - 12
      ? Math.max(12, rect.top - menuHeight - 8)
      : bottomTop;
    setPosition({ left, top, width });
  }, [items.length]);

  const focusMenuItem = (index: number) => {
    const enabledItems = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not([disabled])") || []);
    if (enabledItems.length === 0) return;
    const normalizedIndex = ((index % enabledItems.length) + enabledItems.length) % enabledItems.length;
    enabledItems[normalizedIndex].focus();
  };

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleResize = () => updatePosition();
    const handleScroll = () => updatePosition();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, updatePosition]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

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
        className={cx("btn-compact", label ? "px-3" : "px-2.5")}
      >
        {label ? (
          <>
            <span>{label}</span>
            <CaretDown size={12} />
          </>
        ) : (
          <DotsThree size={14} />
        )}
      </Button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={position}
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
          className="fixed z-[90] rounded-lg border border-line bg-white p-2 shadow-raised"
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
        </div>,
        document.body
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

function clampPage(page: number, totalPages: number) {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, totalPages));
}

function datasourceGeneratedName(form: DatasourceFormState) {
  const host = form.host.trim();
  const port = Number(form.port);
  if (!host || !Number.isFinite(port) || port < 1 || port > 65535) {
    return "";
  }
  return `${datasourceTypeText(form.type)}-${host}:${port}`;
}

function emptyDatasourceFormForType(type: DatasourceFormState["type"]): DatasourceFormState {
  return {
    ...emptyDatasourceForm,
    type,
    port: type === "mysql" ? 3306 : emptyDatasourceForm.port
  };
}

function datasourceFormFromItem(item: Datasource): DatasourceFormState {
  return {
    name: item.name,
    type: item.type || "mysql",
    purpose: item.purpose || "general",
    authType: datasourceAuthTypeFromItem(item),
    host: item.host,
    port: item.port,
    username: item.username,
    password: "",
    defaultSchema: "",
    remark: item.remark || ""
  };
}

function datasourceFormPayload(form: DatasourceFormState, id?: string): DatasourceInput {
  return {
    ...(id ? { id } : {}),
    name: form.name.trim(),
    type: form.type,
    purpose: form.purpose,
    authType: form.authType,
    host: form.host.trim(),
    port: Number(form.port),
    username: form.authType === "password" ? form.username.trim() : "",
    password: form.authType === "password" ? form.password : "",
    defaultSchema: "",
    remark: form.remark.trim()
  };
}

function datasourceFormConnectionFingerprint(form: DatasourceFormState) {
  return JSON.stringify({
    type: form.type,
    authType: form.authType,
    host: form.host.trim(),
    port: Number(form.port) || 0,
    username: form.authType === "password" ? form.username.trim() : "",
    password: form.authType === "password" ? form.password : ""
  });
}

function isDatasourceFormDirty(current: DatasourceFormState, initial: DatasourceFormState) {
  return JSON.stringify({
    ...current,
    name: current.name.trim(),
    host: current.host.trim(),
    username: current.authType === "password" ? current.username.trim() : "",
    password: current.authType === "password" ? current.password : "",
    remark: current.remark.trim(),
    port: Number(current.port) || 0
  }) !== JSON.stringify({
    ...initial,
    name: initial.name.trim(),
    host: initial.host.trim(),
    username: initial.authType === "password" ? initial.username.trim() : "",
    password: initial.authType === "password" ? initial.password : "",
    remark: initial.remark.trim(),
    port: Number(initial.port) || 0
  });
}

function datasourceFieldErrors(form: DatasourceFormState, passwordRequired: boolean): DatasourceFieldErrors {
  const errors: DatasourceFieldErrors = {};
  if (!form.name.trim()) {
    errors.name = "必填";
  } else if (form.name.trim().length > 50) {
    errors.name = "最多 50 字符";
  }
  if (!form.host.trim()) {
    errors.host = "必填";
  }
  if (!Number.isFinite(Number(form.port)) || Number(form.port) < 1 || Number(form.port) > 65535) {
    errors.port = "端口无效";
  }
  if (form.authType === "password" && !form.username.trim()) {
    errors.username = "必填";
  }
  if (form.authType === "password" && passwordRequired && !form.password) {
    errors.password = "必填";
  }
  if (form.remark.trim().length > 200) {
    errors.remark = "最多 200 字符";
  }
  return errors;
}

function validateDatasourceForm(form: DatasourceFormState, passwordRequired: boolean) {
  const errors = datasourceFieldErrors(form, passwordRequired);
  if (errors.name) return errors.name === "必填" ? "名称必填" : `名称${errors.name}`;
  if (errors.host) return errors.host === "必填" ? "主机必填" : errors.host;
  if (errors.port) return errors.port;
  if (errors.username) return errors.username === "必填" ? "用户名必填" : errors.username;
  if (errors.password) return errors.password === "必填" ? "密码必填" : errors.password;
  if (errors.remark) return `备注${errors.remark}`;
  return null;
}

function datasourceTypeText(type?: Datasource["type"]) {
  if (type === "mysql") return "MySQL";
  return "MySQL";
}

function datasourceAuthTypeFromItem(item: Datasource): DatasourceAuthType {
  if (!item.username?.trim() && !item.hasPassword) return "none";
  return "password";
}

function pageFromPathname(pathname: string): Page {
  if (pathname === "/datasource/create") return "datasourceCreate";
  if (datasourceEditIdFromPathname(pathname)) return "datasourceEdit";
  return "datasources";
}

function pathForPage(page: Page, datasourceId?: string) {
  if (page === "datasourceCreate") return "/datasource/create";
  if (page === "datasourceEdit" && datasourceId) return `/datasource/${encodeURIComponent(datasourceId)}/edit`;
  return "/";
}

function navPage(page: Page): MainPage {
  if (page === "datasourceCreate") return "datasources";
  if (page === "datasourceEdit") return "datasources";
  if (page === "nodeDetail") return "nodes";
  return page;
}

function pageTitle(page: Page) {
  if (page === "datasources") return "数据源";
  if (page === "datasourceCreate") return "新增数据源";
  if (page === "datasourceEdit") return "编辑数据源";
  if (page === "nodes") return "节点";
  if (page === "nodeDetail") return "节点详情";
  return "设置";
}

function pageDescription(page: Page) {
  if (page === "datasources") return "";
  if (page === "datasourceCreate") return "";
  if (page === "datasourceEdit") return "";
  if (page === "nodes") return "";
  if (page === "settings") return "告警";
  return "";
}

function datasourceEditIdFromPathname(pathname: string) {
  const match = pathname.match(/^\/datasource\/([^/]+)\/edit$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
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
  if (action === "upgrade") return "升级结果";
  return "卸载结果";
}

export default App;
