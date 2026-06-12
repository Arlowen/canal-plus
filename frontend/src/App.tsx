import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from "react";
import {
  ArrowsClockwise,
  Archive,
  ArrowRight,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Database,
  GearSix,
  HardDrives,
  Info,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  ShieldCheck,
  SignOut,
  Trash,
  WarningCircle,
  XCircle
} from "@phosphor-icons/react";
import { NoticeToast, NoticeToastViewport, type NoticeToastTone } from "./components/NoticeToast";
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
  Channel,
  ChannelKind,
  ChannelColumnMappingInput,
  ChannelInput,
  ChannelMappingsResponse,
  ChannelPrecheckItem,
  ChannelPrecheckResult,
  ChannelTableMappingInput,
  ChannelTask,
  ChannelTaskInput,
  ChannelTaskType,
  ClusterNode,
  ClusterSnapshot,
  DataValidationDiff,
  Datasource,
  DatasourceAuthType,
  DatasourceColumn,
  DatasourceInput,
  DatasourcePurpose,
  DatasourceType,
  DatasourceTestResult,
  NodeMetricHistoryResponse,
  NodeMetricRange,
  NodeMetricSample,
  TaskLog,
  TaskRun,
  User
} from "./types/api";

type MainPage = "channels" | "datasources" | "nodes" | "settings";
type Page = MainPage | "channelDetail" | "channelCreate" | "nodeMonitor" | "datasourceCreate" | "datasourceEdit";
type NoticeTone = NoticeToastTone;

type Notice = {
  tone: NoticeTone;
  message: string;
};

type BadgeTone = "blue" | "green" | "yellow" | "red" | "purple" | "neutral";

type ChannelDetailSummary = {
  healthLabel: string;
  healthTone: BadgeTone;
  healthDetail: string;
  startLabel: string;
  startTone: BadgeTone;
  startDetail: string;
  latestRunLabel: string;
  latestRunTone: BadgeTone;
  latestRunDetail: string;
  nextAction: string;
  nextTone: BadgeTone;
  nextDetail: string;
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

type ChannelFormState = {
  name: string;
  description: string;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceDatasourceType: DatasourceType;
  targetDatasourceType: DatasourceType;
  runNodeId: string;
  resourceSpec: string;
  kind: ChannelKind;
  tags: string;
};

type ChannelColumnMappingDraft = ChannelColumnMappingInput & {
  localId: string;
};

type ChannelTableMappingDraft = Omit<ChannelTableMappingInput, "columns"> & {
  localId: string;
  primaryKeysText: string;
  columns: ChannelColumnMappingDraft[];
};

type ChannelWizardStep = "connections" | "tasks" | "sourceTables" | "targetTables" | "columns";
type ResourceSpec = "0.5G" | "1G" | "2G" | "3G" | "4G";
type DatasourceTestState = "idle" | "testing" | "success" | "failed";
type MetadataLoadState = "idle" | "loading" | "success" | "failed";

type ChannelWizardColumnMetadata = {
  sourceColumns: DatasourceColumn[];
  targetColumns: DatasourceColumn[];
  loadState: MetadataLoadState;
  error: string;
};

type ChannelWizardTableDraft = ChannelTableMappingDraft & {
  createTarget: boolean;
};

type ChannelWizardFormState = {
  name: string;
  description: string;
  runNodeId: string;
  sourceDatasourceType: DatasourceType;
  targetDatasourceType: DatasourceType;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceTestState: DatasourceTestState;
  targetTestState: DatasourceTestState;
  sourceTestMessage: string;
  targetTestMessage: string;
  resourceSpec: ResourceSpec;
  kind: ChannelKind;
  fullMigration: boolean;
  incrementalSync: boolean;
  schemaCompare: boolean;
  dataValidation: boolean;
  dataCorrection: boolean;
  sourceDatabase: string;
  sourceSchema: string;
  targetDatabase: string;
  targetSchema: string;
  tables: ChannelWizardTableDraft[];
};

type DatasourceFieldErrors = Partial<Record<"name" | "host" | "port" | "username" | "password" | "remark", string>>;
type DatasourceTypeFilter = "all" | "mysql";
type NodeTypeFilter = "all" | "master" | "standby";
type ChannelStatusFilter = "all" | Channel["status"];
type TableSelectionFilter = "all" | "selected" | "unselected";
type ChannelDetailTab = "overview" | "mappings" | "tasks" | "runs" | "logs" | "diffs";
type ChannelLogFilters = {
  taskId: string;
  runId: string;
  level: "" | TaskLog["level"];
};

const navItems: Array<{ id: MainPage; label: string; icon: typeof Database }> = [
  { id: "channels", label: "Canal", icon: ArrowRight },
  { id: "datasources", label: "数据源", icon: Database },
  { id: "nodes", label: "节点", icon: HardDrives }
];

const channelWizardSteps: ChannelWizardStep[] = ["connections", "tasks", "sourceTables", "targetTables", "columns"];
const resourceSpecOptions: ResourceSpec[] = ["0.5G", "1G", "2G", "3G", "4G"];

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

const nodeMetricRangeOptions: Array<{ value: NodeMetricRange; label: string }> = [
  { value: "30m", label: "最近 30 分钟" },
  { value: "1h", label: "最近 1 小时" },
  { value: "3h", label: "最近 3 小时" },
  { value: "6h", label: "最近 6 小时" },
  { value: "12h", label: "最近 12 小时" },
  { value: "1d", label: "最近一天" },
  { value: "3d", label: "最近 3 天" },
  { value: "1w", label: "最近一周" },
  { value: "1mo", label: "最近一月" }
];

const nodeMetricRangeDurations: Record<NodeMetricRange, number> = {
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1mo": 30 * 24 * 60 * 60 * 1000
};

const resourceTrendViewBox = {
  width: 760,
  height: 318,
  yTickLabelX: 16,
  xTickLabelY: 306
};
const resourceTrendYAxisTicks = [0, 25, 50, 75, 100];

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
        context.fillStyle = "#0052ff";
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
        context.fillStyle = particle.seed > 0.62 ? "#003ecc" : "#0052ff";
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
      className={cx(
        "block h-20 w-60 shrink-0 bg-transparent transition duration-200 hover:-translate-y-px",
        className
      )}
    />
  );
}

function App() {
  const [tokenState, setTokenState] = useState(getToken());
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>(() => pageFromPathname(window.location.pathname));
  const [channels, setChannels] = useState<Channel[]>([]);
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [cluster, setCluster] = useState<ClusterSnapshot | null>(null);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>([]);
  const [alertEvaluations, setAlertEvaluations] = useState<AlertRuleEvaluation[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [serviceUnavailable, setServiceUnavailable] = useState(false);
  const [serviceRecoveryPending, setServiceRecoveryPending] = useState(false);
  const [focusedChannelId, setFocusedChannelId] = useState<string | null>(() => channelDetailIdFromPathname(window.location.pathname));
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(() => nodeMonitorIdFromPathname(window.location.pathname));
  const [focusedDatasourceId, setFocusedDatasourceId] = useState<string | null>(() => datasourceEditIdFromPathname(window.location.pathname));
  const previousServiceUnavailable = useRef(false);
  const canManage = canManageConfig(user);
  const canTestDatasources = canTestDatasource(user);
  const canOperateTasks = user?.role === "admin" || user?.role === "operator";

  const navigateToPage = useCallback((nextPage: Page, mode: "push" | "replace" = "push", resourceId?: string) => {
    setPage(nextPage);
    setFocusedChannelId(nextPage === "channelDetail" ? resourceId ?? null : null);
    setFocusedDatasourceId(nextPage === "datasourceEdit" ? resourceId ?? null : null);
    setFocusedNodeId(nextPage === "nodeMonitor" ? resourceId ?? null : null);
    const nextPath = pathForPage(nextPage, resourceId);
    if (window.location.pathname === nextPath) {
      return;
    }
    const state = { page: nextPage, resourceId };
    if (mode === "replace") {
      window.history.replaceState(state, "", nextPath);
    } else {
      window.history.pushState(state, "", nextPath);
    }
  }, []);

  useEffect(() => {
    const canonicalPath = canonicalCanalPathname(window.location.pathname);
    if (!canonicalPath) return;
    const nextPage = pageFromPathname(canonicalPath);
    window.history.replaceState({ page: nextPage, resourceId: channelDetailIdFromPathname(canonicalPath) ?? undefined }, "", canonicalPath);
  }, []);

  const pushNotice = useCallback((next: Notice) => {
    setNotice(next);
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!getToken()) return;
    if (!quiet) setLoading(true);
    setGlobalError(null);
    try {
      const [
        nextChannels,
        nextDatasources,
        nextCluster,
        nextAlertRules,
        nextAlertEvaluations,
        nextAlertEvents
      ] = await Promise.all([
        api.channels(),
        api.datasources(),
        api.cluster(),
        api.alertRules(),
        api.alertEvaluations(),
        api.alertEvents()
      ]);
      setChannels(nextChannels);
      setDatasources(nextDatasources);
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
      const pathname = window.location.pathname;
      setPage(pageFromPathname(pathname));
      setFocusedChannelId(channelDetailIdFromPathname(pathname));
      setFocusedDatasourceId(datasourceEditIdFromPathname(pathname));
      setFocusedNodeId(nodeMonitorIdFromPathname(pathname));
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

  const handleLogin = async (username: string, password: string) => {
    const response = await api.login({ username, password });
    setToken(response.token);
    setTokenState(response.token);
    setUser(response.user);
    navigateToPage("channels", "replace");
  };

  const handleLogout = () => {
    clearToken();
    setTokenState(null);
    setUser(null);
    setNotice(null);
  };

  const openNodeMonitor = (nodeID: string) => {
    navigateToPage("nodeMonitor", "push", nodeID);
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

  const openChannelDetail = (channelId: string) => {
    navigateToPage("channelDetail", "push", channelId);
  };

  const openChannelCreate = () => {
    navigateToPage("channelCreate");
  };

  if (!tokenState) {
    if (serviceUnavailable) {
      return <BackendUnavailableScreen retrying={serviceRecoveryPending} onRetry={retryServiceConnection} />;
    }
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-[100dvh] bg-mist text-ink">
      <NoticeToastViewport>
        {serviceUnavailable && (
          <NoticeToast
            tone="warning"
            action={(
              <Button onClick={() => void retryServiceConnection()} disabled={serviceRecoveryPending} className="btn-compact border-blue-100 bg-blue-50 text-accent hover:bg-blue-100">
                <ArrowsClockwise size={14} />
                {serviceRecoveryPending ? "重试中" : "重试"}
              </Button>
            )}
          >
            系统异常
          </NoticeToast>
        )}
        {globalError && (
          <NoticeToast tone="error" onClose={() => setGlobalError(null)}>
            {globalError}
          </NoticeToast>
        )}
        {notice && (
          <NoticeToast tone={notice.tone} autoCloseMs={notice.tone === "error" ? 5200 : 3000} onClose={() => setNotice(null)}>
            {notice.message}
          </NoticeToast>
        )}
      </NoticeToastViewport>
      <div className="page-shell">
        <div className="grid min-h-[100dvh] overflow-hidden border-x border-line/70 bg-white lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="flex h-fit flex-col border-b border-line/80 bg-white pb-3 lg:sticky lg:top-0 lg:min-h-[100dvh] lg:border-b-0 lg:border-r">
            <div className="flex h-[92px] items-center justify-start border-b border-line/80 px-5">
              <BrandParticleTile />
            </div>

            <nav className="mx-4 mt-5 grid grid-cols-3 gap-2 lg:grid-cols-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.id}
                    onClick={() => navigateToPage(item.id)}
                    className={cx(
                      "flex min-h-12 items-center justify-start gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition",
                      navPage(page) === item.id
                        ? "border border-accent bg-accent text-white shadow-none"
                        : "border border-transparent text-slate-600 hover:border-blue-100 hover:bg-blue-50 hover:text-accent"
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
            {page !== "channels" && page !== "channelDetail" && page !== "channelCreate" && page !== "datasources" && page !== "nodes" && page !== "datasourceCreate" && page !== "datasourceEdit" && (
              <div className="flex min-h-[92px] flex-col justify-center gap-1 border-b border-line bg-white px-5 md:px-8 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h1 className="text-2xl font-semibold text-coal md:text-3xl">
                    {pageTitle(page)}
                  </h1>
                  {pageDescription(page) && (
                    <p className="mt-1 text-sm text-slate-500">
                      {pageDescription(page)}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 xl:justify-end">
                  {page === "nodeMonitor" && (
                    <Button type="button" onClick={() => navigateToPage("nodes")} className="btn-secondary h-11 px-4">
                      <ArrowRight size={16} className="rotate-180" />
                      返回
                    </Button>
                  )}
                </div>
              </div>
            )}

            {loading && channels.length === 0 && datasources.length === 0 ? (
              <ShellSkeleton />
            ) : page === "channels" ? (
              <ChannelsPage
                channels={channels}
                datasources={datasources}
                canManage={canManage}
                onChanged={refresh}
                onCreate={openChannelCreate}
                onCreateDatasource={openDatasourceCreate}
                onOpenChannel={openChannelDetail}
                pushNotice={pushNotice}
              />
            ) : page === "channelCreate" ? (
              <ChannelCreateWizardPage
                datasources={datasources}
                cluster={cluster}
                canManage={canManage}
                onOpenChannel={openChannelDetail}
                onChanged={refresh}
                pushNotice={pushNotice}
              />
            ) : page === "channelDetail" ? (
              <ChannelDetailPage
                channelId={focusedChannelId}
                channels={channels}
                datasources={datasources}
                canManage={canManage}
                canOperate={canOperateTasks}
                onBack={() => navigateToPage("channels")}
                onChanged={refresh}
                pushNotice={pushNotice}
              />
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
                cluster={cluster}
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
                cluster={cluster}
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
                onOpenNode={openNodeMonitor}
              />
            ) : page === "nodeMonitor" ? (
              <NodeMonitorPage
                nodeId={focusedNodeId}
                cluster={cluster}
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

function ChannelsPage({
  channels,
  datasources,
  canManage,
  onChanged,
  onCreate,
  onCreateDatasource,
  onOpenChannel,
  pushNotice
}: {
  channels: Channel[];
  datasources: Datasource[];
  canManage: boolean;
  onChanged: (quiet?: boolean) => Promise<void>;
  onCreate: () => void;
  onCreateDatasource: () => void;
  onOpenChannel: (channelId: string) => void;
  pushNotice: (notice: Notice) => void;
}) {
  const [draftQuery, setDraftQuery] = useState("");
  const [draftStatus, setDraftStatus] = useState<ChannelStatusFilter>("all");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [appliedStatus, setAppliedStatus] = useState<ChannelStatusFilter>("all");
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);

  const filteredChannels = useMemo(() => channels.filter((channel) => {
    const query = appliedQuery.trim().toLowerCase();
    const source = datasourceById(datasources, channel.sourceDatasourceId);
    const target = datasourceById(datasources, channel.targetDatasourceId);
    const matchesQuery = !query
      || channel.name.toLowerCase().includes(query)
      || channel.description?.toLowerCase().includes(query)
      || source?.name.toLowerCase().includes(query)
      || target?.name.toLowerCase().includes(query);
    const matchesStatus = appliedStatus === "all" || channel.status === appliedStatus;
    return matchesQuery && matchesStatus;
  }), [appliedQuery, appliedStatus, channels, datasources]);

  const openCreate = () => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "权限不足" });
      return;
    }
    onCreate();
  };

  const openEdit = (channel: Channel) => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "权限不足" });
      return;
    }
    setEditingChannel(channel);
    setFormOpen(true);
  };

  const saveChannel = async (input: ChannelInput) => {
    setSaving(true);
    try {
      if (editingChannel) {
        await api.updateChannel(editingChannel.id, input);
      }
      pushNotice({ tone: "success", message: "已保存" });
      setFormOpen(false);
      setEditingChannel(null);
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (channel: Channel) => {
    setConfirmation({
      title: "删除 Canal",
      description: "删除后，映射、任务和运行记录会一起移除。",
      confirmLabel: "删除",
      confirmTone: "danger",
      onConfirm: () => {
        void deleteChannel(channel.id);
      }
    });
  };

  const deleteChannel = async (channelId: string) => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "权限不足" });
      return;
    }
    setDeletingId(channelId);
    try {
      await api.deleteChannel(channelId);
      pushNotice({ tone: "success", message: "已删除" });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "删除失败" });
    } finally {
      setDeletingId(null);
    }
  };

  const archiveChannel = async (channel: Channel) => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "权限不足" });
      return;
    }
    try {
      await api.archiveChannel(channel.id);
      pushNotice({ tone: "success", message: "已归档" });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "归档失败" });
    }
  };

  return (
    <>
      <section className="min-w-0 overflow-hidden">
        <div className="page-titlebar">
          <h1 className="text-2xl font-semibold text-coal md:text-3xl">Canal</h1>
        </div>

        <div className="px-5 py-6 md:px-8">
          <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="w-full sm:w-[174px]">
                <DropdownSelect
                  value={draftStatus}
                  ariaLabel="状态"
                  options={channelStatusOptions()}
                  onChange={(nextValue) => setDraftStatus(nextValue as ChannelStatusFilter)}
                  className="h-12 min-h-12"
                />
              </div>
              <label className="relative block w-full sm:w-[344px]">
                <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <TextInput
                  className="input h-12 pl-11"
                  value={draftQuery}
                  placeholder="搜索 Canal、源端、目标端"
                  onChange={(event) => setDraftQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      setAppliedQuery(draftQuery);
                      setAppliedStatus(draftStatus);
                    }
                  }}
                />
              </label>
              <Button type="button" onClick={() => {
                setAppliedQuery(draftQuery);
                setAppliedStatus(draftStatus);
              }} className="btn-primary h-12 min-w-[108px]">
                <MagnifyingGlass size={16} />
                查询
              </Button>
            </div>

            <Button type="button" onClick={openCreate} disabled={!canManage} className="btn-primary h-12 min-w-[118px] px-4">
              <Plus size={18} />
              新增
            </Button>
          </div>

          <div className="table-shell">
            <table className="w-full min-w-[1020px] table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-[250px]" />
                <col className="w-[180px]" />
                <col className="w-[180px]" />
                <col className="w-[100px]" />
                <col className="w-[130px]" />
                <col className="w-[150px]" />
                <col className="w-[230px]" />
              </colgroup>
              <thead className="bg-slate-50/70 text-sm font-semibold text-slate-500">
                <tr className="border-b border-line">
                  <th className="whitespace-nowrap px-6 py-4">Canal</th>
                  <th className="whitespace-nowrap px-5 py-4">源端</th>
                  <th className="whitespace-nowrap px-5 py-4">目标端</th>
                  <th className="whitespace-nowrap px-5 py-4">任务</th>
                  <th className="whitespace-nowrap px-5 py-4">状态</th>
                  <th className="whitespace-nowrap px-5 py-4">最近运行</th>
                  <th className="whitespace-nowrap px-5 py-4">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {filteredChannels.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-16">
                      <div className="mx-auto flex max-w-sm flex-col items-center text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-accent">
                          <Database size={20} />
                        </div>
                        <div className="mt-4 text-base font-semibold text-coal">{channels.length === 0 ? datasources.length === 0 ? "先加数据源" : "暂无 Canal" : "无匹配"}</div>
                        {canManage && channels.length === 0 && (
                          <div className="mt-5 flex flex-wrap justify-center gap-3">
                            {datasources.length === 0 && (
                              <Button type="button" onClick={onCreateDatasource} className="btn-primary">
                                <Database size={16} />
                                添加数据源
                              </Button>
                            )}
                            <Button type="button" onClick={openCreate} className={datasources.length === 0 ? "btn-secondary" : "btn-primary"}>
                              <Plus size={16} />
                              创建 Canal
                            </Button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : filteredChannels.map((channel) => {
                  const source = datasourceById(datasources, channel.sourceDatasourceId);
                  const target = datasourceById(datasources, channel.targetDatasourceId);
                  return (
                    <tr key={channel.id} className="transition hover:bg-slate-50/70">
                      <td className="px-6 py-5 align-middle">
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold text-coal">{channel.name}</div>
                          <div className="mt-1 truncate text-sm text-slate-500">{channel.description || channel.id}</div>
                        </div>
                      </td>
                      <td className="px-5 py-5 align-middle">
                        <DatasourceEndpointLabel datasource={source} fallback={channel.sourceDatasourceId} />
                      </td>
                      <td className="px-5 py-5 align-middle">
                        <DatasourceEndpointLabel datasource={target} fallback={channel.targetDatasourceId} />
                      </td>
                      <td className="px-5 py-5 align-middle text-sm text-coal">{channel.runningTaskCount}/{channel.taskCount}</td>
                      <td className="px-5 py-5 align-middle">
                        <ChannelStatusBadge status={channel.status} />
                      </td>
                      <td className="px-5 py-5 align-middle text-sm text-slate-600">{channel.lastRunStatus ? taskRunStatusText(channel.lastRunStatus) : "-"}</td>
                      <td className="px-5 py-5 align-middle">
                        <div className="flex items-center gap-2">
                          <Button type="button" onClick={() => onOpenChannel(channel.id)} className="btn-secondary h-9 px-3">
                            详情
                          </Button>
                          {canManage && (
                            <IconActionButton label="编辑" onClick={() => openEdit(channel)}>
                              <PencilSimple size={18} />
                            </IconActionButton>
                          )}
                          {canManage && (
                            <IconActionButton label="归档" onClick={() => void archiveChannel(channel)} disabled={channel.status === "archived"}>
                              <ArchiveIcon />
                            </IconActionButton>
                          )}
                          {canManage && (
                            <IconActionButton label={deletingId === channel.id ? "删除中" : "删除"} tone="danger" disabled={deletingId === channel.id} onClick={() => confirmDelete(channel)}>
                              {deletingId === channel.id ? <ArrowsClockwise size={18} className="animate-spin" /> : <Trash size={18} />}
                            </IconActionButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 text-sm text-slate-600">共 {filteredChannels.length} 条</div>
        </div>
      </section>

      <ChannelFormModal
        open={formOpen}
        channel={editingChannel}
        datasources={datasources}
        saving={saving}
        onClose={() => {
          setFormOpen(false);
          setEditingChannel(null);
        }}
        onSubmit={saveChannel}
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

function ChannelFormModal({
  open,
  channel,
  datasources,
  saving,
  onClose,
  onSubmit
}: {
  open: boolean;
  channel: Channel | null;
  datasources: Datasource[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: ChannelInput) => Promise<void>;
}) {
  const [form, setForm] = useState<ChannelFormState>(() => channelFormFromChannel(channel, datasources));

  useEffect(() => {
    if (!open) return;
    setForm(channelFormFromChannel(channel, datasources));
  }, [channel, datasources, open]);

  const sourceOptions = datasourceSelectOptions(datasources, "source");
  const targetOptions = datasourceSelectOptions(datasources, "target");
  const validationError = validateChannelForm(form);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (validationError) {
      return;
    }
    await onSubmit(channelFormPayload(form));
  };

  return (
    <Modal open={open} title={channel ? "编辑 Canal" : "新增 Canal"} onClose={onClose} size="lg">
      <form onSubmit={submit} className="grid gap-4">
        <Field label="名称" required error={!form.name.trim() ? "必填" : undefined}>
          <TextInput className="input" value={form.name} maxLength={80} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="源端" required>
            <DropdownSelect value={form.sourceDatasourceId} ariaLabel="源端" options={sourceOptions} onChange={(sourceDatasourceId) => setForm({ ...form, sourceDatasourceId })} />
          </Field>
          <Field label="目标端" required>
            <DropdownSelect value={form.targetDatasourceId} ariaLabel="目标端" options={targetOptions} onChange={(targetDatasourceId) => setForm({ ...form, targetDatasourceId })} />
          </Field>
        </div>
        <Field label="标签">
          <TextInput className="input" value={form.tags} placeholder="迁移, 生产" onChange={(event) => setForm({ ...form, tags: event.target.value })} />
        </Field>
        <Field label="描述">
          <TextareaInput className="textarea" maxLength={300} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" onClick={onClose} className="btn-secondary">
            取消
          </Button>
          <Button type="submit" disabled={saving || Boolean(validationError)} title={validationError || undefined} className="btn-primary">
            {saving ? <ArrowsClockwise size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            {saving ? "保存中" : "保存"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ChannelCreateWizardPage({
  datasources,
  cluster,
  canManage,
  onOpenChannel,
  onChanged,
  pushNotice
}: {
  datasources: Datasource[];
  cluster: ClusterSnapshot | null;
  canManage: boolean;
  onOpenChannel: (channelId: string) => void;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
}) {
  const onlineNodes = useMemo(() => (cluster?.nodes || []).filter((node) => node.status === "online"), [cluster]);
  const [form, setForm] = useState<ChannelWizardFormState>(() => emptyChannelWizardForm(datasources, onlineNodes));
  const formTablesRef = useRef(form.tables);
  const [channelNameEdited, setChannelNameEdited] = useState(false);
  const [step, setStep] = useState<ChannelWizardStep>("connections");
  const [submitting, setSubmitting] = useState(false);
  const [sourceDatabaseOptions, setSourceDatabaseOptions] = useState<string[]>([]);
  const [targetDatabaseOptions, setTargetDatabaseOptions] = useState<string[]>([]);
  const [sourceTableOptions, setSourceTableOptions] = useState<string[]>([]);
  const [targetTableOptions, setTargetTableOptions] = useState<string[]>([]);
  const [sourceDatabaseLoadState, setSourceDatabaseLoadState] = useState<MetadataLoadState>("idle");
  const [targetDatabaseLoadState, setTargetDatabaseLoadState] = useState<MetadataLoadState>("idle");
  const [sourceTableLoadState, setSourceTableLoadState] = useState<MetadataLoadState>("idle");
  const [targetTableLoadState, setTargetTableLoadState] = useState<MetadataLoadState>("idle");
  const [sourceMetadataError, setSourceMetadataError] = useState("");
  const [targetMetadataError, setTargetMetadataError] = useState("");
  const [columnMetadataByTable, setColumnMetadataByTable] = useState<Record<string, ChannelWizardColumnMetadata>>({});
  const [testFailureDialog, setTestFailureDialog] = useState<{ side: "source" | "target" | "both"; message: string } | null>(null);
  const [schemaMigrationInfoOpen, setSchemaMigrationInfoOpen] = useState(false);
  const [tablePageIndex, setTablePageIndex] = useState(1);
  const [tableJumpPageDraft, setTableJumpPageDraft] = useState("1");
  const [tableFilterDraft, setTableFilterDraft] = useState("");
  const [tableFilterText, setTableFilterText] = useState("");
  const [tableSelectionFilter, setTableSelectionFilter] = useState<TableSelectionFilter>("all");
  const [targetTablePageIndex, setTargetTablePageIndex] = useState(1);
  const [targetTableJumpPageDraft, setTargetTableJumpPageDraft] = useState("1");
  const [targetTableFilterDraft, setTargetTableFilterDraft] = useState("");
  const [targetTableFilterText, setTargetTableFilterText] = useState("");
  const targetTableListId = useId();
  const columnMetadataRequestKey = useMemo(() => (
    form.tables
      .filter((table) => table.enabled)
      .map((table) => [table.localId, table.sourceTable.trim(), table.targetTable.trim()].join(":"))
      .join("|")
  ), [form.tables]);

  useEffect(() => {
    formTablesRef.current = form.tables;
  }, [form.tables]);

  useEffect(() => {
    if (sourceTableLoadState !== "success") {
      return;
    }
    setForm((current) => syncWizardTablesWithMetadata(
      current,
      sourceTableOptions,
      targetTableOptions,
      targetTableLoadState === "success"
    ));
  }, [sourceTableLoadState, sourceTableOptions, targetTableLoadState, targetTableOptions]);

  useEffect(() => {
    if (channelNameEdited || !form.sourceDatasourceType || !form.targetDatasourceType) {
      return;
    }
    const nextName = channelWizardDefaultName(form.sourceDatasourceType, form.targetDatasourceType);
    setForm((current) => current.name === nextName ? current : { ...current, name: nextName });
  }, [channelNameEdited, form.sourceDatasourceType, form.targetDatasourceType]);

  useEffect(() => {
    setForm((current) => {
      let next = current;
      const sourceDatasources = datasourcesForWizard(datasources, "source", current.sourceDatasourceType);
      const targetDatasources = datasourcesForWizard(datasources, "target", current.targetDatasourceType);
      if (!current.runNodeId && onlineNodes[0]) {
        next = { ...next, runNodeId: onlineNodes[0].id };
      }
      if (!sourceDatasources.some((datasource) => datasource.id === current.sourceDatasourceId) && sourceDatasources[0]) {
        next = {
          ...next,
          sourceDatasourceId: sourceDatasources[0].id,
          sourceDatabase: sourceDatasources[0].defaultSchema || next.sourceDatabase,
          sourceTestState: "idle",
          sourceTestMessage: ""
        };
      }
      if (!targetDatasources.some((datasource) => datasource.id === current.targetDatasourceId) && targetDatasources[0]) {
        next = {
          ...next,
          targetDatasourceId: targetDatasources[0].id,
          targetDatabase: targetDatasources[0].defaultSchema || next.targetDatabase,
          targetTestState: "idle",
          targetTestMessage: ""
        };
      }
      return next;
    });
  }, [datasources, onlineNodes]);

  useEffect(() => {
    if (form.sourceTestState !== "success" || !form.sourceDatasourceId || !form.runNodeId) {
      setSourceDatabaseOptions([]);
      setSourceDatabaseLoadState("idle");
      return;
    }
    let active = true;
    setSourceDatabaseLoadState("loading");
    setSourceMetadataError("");
    void api.datasourceDatabases(form.sourceDatasourceId, { nodeId: form.runNodeId })
      .then((response) => {
        if (!active) return;
        setSourceDatabaseOptions(response.databases);
        setSourceDatabaseLoadState("success");
        setForm((current) => {
          if (current.sourceDatasourceId !== form.sourceDatasourceId) return current;
          const nextDatabase = current.sourceDatabase && response.databases.includes(current.sourceDatabase)
            ? current.sourceDatabase
            : response.databases[0] || "";
          const databaseChanged = nextDatabase !== current.sourceDatabase;
          return {
            ...current,
            sourceDatabase: nextDatabase,
            sourceSchema: "",
            tables: databaseChanged ? resetWizardTables(current.tables, "source") : current.tables
          };
        });
      })
      .catch((requestError) => {
        if (!active) return;
        setSourceDatabaseOptions([]);
        setSourceDatabaseLoadState("failed");
        setSourceMetadataError(requestError instanceof Error ? requestError.message : "加载失败");
      });
    return () => {
      active = false;
    };
  }, [form.runNodeId, form.sourceDatasourceId, form.sourceTestState]);

  useEffect(() => {
    if (form.targetTestState !== "success" || !form.targetDatasourceId || !form.runNodeId) {
      setTargetDatabaseOptions([]);
      setTargetDatabaseLoadState("idle");
      return;
    }
    let active = true;
    setTargetDatabaseLoadState("loading");
    setTargetMetadataError("");
    void api.datasourceDatabases(form.targetDatasourceId, { nodeId: form.runNodeId })
      .then((response) => {
        if (!active) return;
        setTargetDatabaseOptions(response.databases);
        setTargetDatabaseLoadState("success");
        setForm((current) => {
          if (current.targetDatasourceId !== form.targetDatasourceId) return current;
          const nextDatabase = current.targetDatabase && response.databases.includes(current.targetDatabase)
            ? current.targetDatabase
            : response.databases[0] || "";
          const databaseChanged = nextDatabase !== current.targetDatabase;
          return {
            ...current,
            targetDatabase: nextDatabase,
            targetSchema: "",
            tables: databaseChanged ? resetWizardTables(current.tables, "target") : current.tables
          };
        });
      })
      .catch((requestError) => {
        if (!active) return;
        setTargetDatabaseOptions([]);
        setTargetDatabaseLoadState("failed");
        setTargetMetadataError(requestError instanceof Error ? requestError.message : "加载失败");
      });
    return () => {
      active = false;
    };
  }, [form.runNodeId, form.targetDatasourceId, form.targetTestState]);

  useEffect(() => {
    if (form.sourceTestState !== "success" || !form.sourceDatasourceId || !form.runNodeId || !form.sourceDatabase) {
      setSourceTableOptions([]);
      setSourceTableLoadState("idle");
      return;
    }
    let active = true;
    setSourceTableLoadState("loading");
    setSourceMetadataError("");
    void api.datasourceTables(form.sourceDatasourceId, { nodeId: form.runNodeId, database: form.sourceDatabase })
      .then((response) => {
        if (!active) return;
        setSourceTableOptions(response.tables);
        setSourceTableLoadState("success");
      })
      .catch((requestError) => {
        if (!active) return;
        setSourceTableOptions([]);
        setSourceTableLoadState("failed");
        setSourceMetadataError(requestError instanceof Error ? requestError.message : "加载失败");
      });
    return () => {
      active = false;
    };
  }, [form.runNodeId, form.sourceDatabase, form.sourceDatasourceId, form.sourceTestState]);

  useEffect(() => {
    if (form.targetTestState !== "success" || !form.targetDatasourceId || !form.runNodeId || !form.targetDatabase) {
      setTargetTableOptions([]);
      setTargetTableLoadState("idle");
      return;
    }
    if (
      form.sourceDatasourceId
      && form.sourceDatasourceId === form.targetDatasourceId
      && form.sourceDatabase
      && form.sourceDatabase === form.targetDatabase
    ) {
      setTargetTableOptions([]);
      setTargetTableLoadState("idle");
      return;
    }
    let active = true;
    setTargetTableLoadState("loading");
    setTargetMetadataError("");
    void api.datasourceTables(form.targetDatasourceId, { nodeId: form.runNodeId, database: form.targetDatabase })
      .then((response) => {
        if (!active) return;
        setTargetTableOptions(response.tables);
        setTargetTableLoadState("success");
      })
      .catch((requestError) => {
        if (!active) return;
        setTargetTableOptions([]);
        setTargetTableLoadState("failed");
        setTargetMetadataError(requestError instanceof Error ? requestError.message : "加载失败");
      });
    return () => {
      active = false;
    };
  }, [form.runNodeId, form.sourceDatabase, form.sourceDatasourceId, form.targetDatabase, form.targetDatasourceId, form.targetTestState]);

  useEffect(() => {
    if (
      !form.sourceDatasourceId
      || form.sourceDatasourceId !== form.targetDatasourceId
      || !form.sourceDatabase
      || form.sourceDatabase !== form.targetDatabase
    ) {
      return;
    }
    setForm((current) => {
      if (
        !current.sourceDatasourceId
        || current.sourceDatasourceId !== current.targetDatasourceId
        || !current.sourceDatabase
        || current.sourceDatabase !== current.targetDatabase
      ) {
        return current;
      }
      const nextTargetDatabase = targetDatabaseOptions.find((database) => database !== current.sourceDatabase) || "";
      return {
        ...current,
        targetDatabase: nextTargetDatabase,
        targetSchema: "",
        tables: resetWizardTables(current.tables, "target")
      };
    });
  }, [form.sourceDatabase, form.sourceDatasourceId, form.targetDatabase, form.targetDatasourceId, targetDatabaseOptions]);

  useEffect(() => {
    if (
      form.sourceTestState !== "success"
      || form.targetTestState !== "success"
      || !form.runNodeId
      || !form.sourceDatasourceId
      || !form.targetDatasourceId
      || !form.sourceDatabase
      || !form.targetDatabase
    ) {
      setColumnMetadataByTable({});
      return;
    }
    const tablesToLoad = formTablesRef.current.filter((table) => table.enabled && table.sourceTable.trim() && table.targetTable.trim());
    if (tablesToLoad.length === 0) {
      setColumnMetadataByTable({});
      return;
    }
    let active = true;
    setColumnMetadataByTable((current) => {
      const next: Record<string, ChannelWizardColumnMetadata> = {};
      tablesToLoad.forEach((table) => {
        next[table.localId] = current[table.localId] || {
          sourceColumns: [],
          targetColumns: [],
          loadState: "loading",
          error: ""
        };
        next[table.localId] = { ...next[table.localId], loadState: "loading", error: "" };
      });
      return next;
    });
    tablesToLoad.forEach((table) => {
      const sourceTable = table.sourceTable.trim();
      const targetTable = table.targetTable.trim();
      void Promise.allSettled([
        api.datasourceColumns(form.sourceDatasourceId, {
          nodeId: form.runNodeId,
          database: form.sourceDatabase,
          table: sourceTable
        }),
        api.datasourceColumns(form.targetDatasourceId, {
          nodeId: form.runNodeId,
          database: form.targetDatabase,
          table: targetTable
        })
      ]).then(([sourceResult, targetResult]) => {
        if (!active) return;
        const sourceColumns = sourceResult.status === "fulfilled" ? sourceResult.value.columns : [];
        const targetColumns = targetResult.status === "fulfilled" ? targetResult.value.columns : [];
        const sourceError = sourceResult.status === "rejected" ? requestErrorMessage(sourceResult.reason) : "";
        const targetError = targetResult.status === "rejected" ? requestErrorMessage(targetResult.reason) : "";
        const failed = sourceResult.status === "rejected";
        setColumnMetadataByTable((current) => ({
          ...current,
          [table.localId]: {
            sourceColumns,
            targetColumns,
            loadState: failed ? "failed" : "success",
            error: sourceError || targetError
          }
        }));
        if (sourceColumns.length === 0 || failed) return;
        setForm((current) => ({
          ...current,
          tables: current.tables.map((currentTable) => {
            if (
              currentTable.localId !== table.localId
              || currentTable.sourceTable.trim() !== sourceTable
              || currentTable.targetTable.trim() !== targetTable
              || !channelWizardColumnsAreEmpty(currentTable.columns)
            ) {
              return currentTable;
            }
            return applyColumnMetadataToWizardTable(currentTable, sourceColumns, targetColumns);
          })
        }));
      });
    });
    return () => {
      active = false;
    };
  }, [
    columnMetadataRequestKey,
    form.runNodeId,
    form.sourceDatabase,
    form.sourceDatasourceId,
    form.sourceTestState,
    form.targetDatabase,
    form.targetDatasourceId,
    form.targetTestState
  ]);

  const selectedNode = onlineNodes.find((node) => node.id === form.runNodeId) || null;
  const sourceDatasourceCandidates = datasourcesForWizard(datasources, "source", form.sourceDatasourceType);
  const targetDatasourceCandidates = datasourcesForWizard(datasources, "target", form.targetDatasourceType);
  const sourceOptions = datasourceOptionsForWizard(datasources, "source", form.sourceDatasourceType);
  const targetOptions = datasourceOptionsForWizard(datasources, "target", form.targetDatasourceType);
  const sourceHasDatasources = sourceDatasourceCandidates.length > 0;
  const targetHasDatasources = targetDatasourceCandidates.length > 0;
  const connectionStepMissingDatasourceMessage = !sourceHasDatasources || !targetHasDatasources
    ? "先建数据源"
    : "";
  const sameDatasourceSelected = Boolean(form.sourceDatasourceId && form.sourceDatasourceId === form.targetDatasourceId);
  const sameDatasourceSameDatabase = Boolean(sameDatasourceSelected && form.sourceDatabase && form.sourceDatabase === form.targetDatabase);
  const sourceDatabaseValues = sameDatasourceSelected && form.targetDatabase
    ? sourceDatabaseOptions.filter((database) => database !== form.targetDatabase)
    : sourceDatabaseOptions;
  const targetDatabaseValues = sameDatasourceSelected && form.sourceDatabase
    ? targetDatabaseOptions.filter((database) => database !== form.sourceDatabase)
    : targetDatabaseOptions;
  const sourceDatabaseSelectOptions = metadataValueOptions(sourceDatabaseValues, sourceDatabaseLoadState, "暂无 DB");
  const targetDatabaseSelectOptions = metadataValueOptions(targetDatabaseValues, targetDatabaseLoadState, "暂无 DB");
  const requiredCapacity = channelResourceSpecGB(form.resourceSpec);
  const hasCapacity = Boolean(selectedNode && selectedNode.capacity >= requiredCapacity);
  const selectedTables = form.tables.filter((table) => table.enabled);
  const selectedTableCount = selectedTables.length;
  const tablePageSize = 10;
  const tableFilterQuery = tableFilterText.trim().toLowerCase();
  const tableRows = useMemo(() => {
    const rows = form.tables.map((table, tableIndex) => ({ table, tableIndex }));
    return rows.filter(({ table }) => {
      if (tableSelectionFilter === "selected" && !table.enabled) {
        return false;
      }
      if (tableSelectionFilter === "unselected" && table.enabled) {
        return false;
      }
      if (!tableFilterQuery) {
        return true;
      }
      return [
        table.sourceSchema,
        table.sourceTable,
        table.targetSchema,
        table.targetTable
      ].some((value) => (value || "").toLowerCase().includes(tableFilterQuery));
    });
  }, [form.tables, tableFilterQuery, tableSelectionFilter]);
  const tableTotalItems = tableRows.length;
  const tableTotalPages = Math.max(1, Math.ceil(tableTotalItems / tablePageSize));
  const tableCurrentPage = clampPage(tablePageIndex, tableTotalPages);
  const tablePageStart = (tableCurrentPage - 1) * tablePageSize;
  const tablePageRows = tableRows.slice(tablePageStart, tablePageStart + tablePageSize);
  const tablePageNumbers = useMemo(() => paginationRange(tableCurrentPage, tableTotalPages), [tableCurrentPage, tableTotalPages]);
  const targetTablePageSize = 10;
  const targetTableFilterQuery = targetTableFilterText.trim().toLowerCase();
  const targetTableRows = useMemo(() => {
    const rows = form.tables.map((table, tableIndex) => ({ table, tableIndex })).filter(({ table }) => table.enabled);
    if (!targetTableFilterQuery) {
      return rows;
    }
    return rows.filter(({ table }) => [
      table.sourceSchema,
      table.sourceTable,
      table.targetSchema,
      table.targetTable
    ].some((value) => (value || "").toLowerCase().includes(targetTableFilterQuery)));
  }, [form.tables, targetTableFilterQuery]);
  const targetTableTotalItems = targetTableRows.length;
  const targetTableTotalPages = Math.max(1, Math.ceil(targetTableTotalItems / targetTablePageSize));
  const targetTableCurrentPage = clampPage(targetTablePageIndex, targetTableTotalPages);
  const targetTablePageStart = (targetTableCurrentPage - 1) * targetTablePageSize;
  const targetTablePageRows = targetTableRows.slice(targetTablePageStart, targetTablePageStart + targetTablePageSize);
  const targetTablePageNumbers = useMemo(() => paginationRange(targetTableCurrentPage, targetTableTotalPages), [targetTableCurrentPage, targetTableTotalPages]);
  const connectionStepValid = Boolean(
    form.name.trim()
    && form.runNodeId
    && form.sourceDatasourceId
    && form.targetDatasourceId
    && form.sourceTestState === "success"
    && form.targetTestState === "success"
  );
  const taskStepValid = hasCapacity && (form.kind === "sync" || form.schemaCompare || form.dataValidation);
  const sourceTableStepValid = Boolean(form.sourceDatabase) && selectedTableCount > 0 && selectedTables.every((table) => table.sourceTable.trim());
  const targetTableStepValid = sourceTableStepValid && Boolean(form.targetDatabase && !sameDatasourceSameDatabase) && selectedTables.every((table) => table.targetTable.trim());
  const columnStepValid = targetTableStepValid && selectedTables.every((table) => table.columns.some((column) => column.enabled !== false && column.sourceColumn.trim() && column.targetColumn.trim()));
  const stepIndex = channelWizardSteps.indexOf(step);
  const maxReachableStepIndex = !connectionStepValid ? 0 : !taskStepValid ? 1 : !sourceTableStepValid ? 2 : !targetTableStepValid ? 3 : 4;
  const currentStepValid = step === "connections"
    ? connectionStepValid
    : step === "tasks"
      ? taskStepValid
      : step === "sourceTables"
        ? sourceTableStepValid
        : step === "targetTables"
          ? targetTableStepValid
          : columnStepValid;
  const nextStepDisabled = submitting;

  useEffect(() => {
    setTablePageIndex((current) => clampPage(current, tableTotalPages));
  }, [tableTotalPages]);

  useEffect(() => {
    setTargetTablePageIndex((current) => clampPage(current, targetTableTotalPages));
  }, [targetTableTotalPages]);

  useEffect(() => {
    setTableJumpPageDraft(String(tableCurrentPage));
  }, [tableCurrentPage]);

  useEffect(() => {
    setTargetTableJumpPageDraft(String(targetTableCurrentPage));
  }, [targetTableCurrentPage]);

  useEffect(() => {
    setTablePageIndex(1);
    setTableFilterDraft("");
    setTableFilterText("");
    setTableSelectionFilter("all");
    setTargetTablePageIndex(1);
    setTargetTableFilterDraft("");
    setTargetTableFilterText("");
  }, [form.sourceDatasourceId, form.targetDatasourceId, form.sourceDatabase, form.targetDatabase]);

  useEffect(() => {
    setTablePageIndex(1);
  }, [tableFilterQuery, tableSelectionFilter]);

  useEffect(() => {
    setTargetTablePageIndex(1);
  }, [targetTableFilterQuery, selectedTableCount]);

  const patchForm = (patch: Partial<ChannelWizardFormState>) => setForm((current) => ({ ...current, ...patch }));

  const applyTableFilter = () => {
    setTableFilterText(tableFilterDraft);
    setTablePageIndex(1);
  };

  const applyTargetTableFilter = () => {
    setTargetTableFilterText(targetTableFilterDraft);
    setTargetTablePageIndex(1);
  };

  const updateSourceDatasource = (datasourceId: string) => {
    const datasource = datasources.find((item) => item.id === datasourceId);
    patchForm({
      sourceDatasourceId: datasourceId,
      sourceDatabase: datasource?.defaultSchema || form.sourceDatabase,
      sourceSchema: "",
      sourceTestState: "idle",
      sourceTestMessage: "",
      tables: resetWizardTables(form.tables, "source")
    });
    setSourceDatabaseOptions([]);
    setSourceTableOptions([]);
    setSourceDatabaseLoadState("idle");
    setSourceTableLoadState("idle");
  };

  const updateTargetDatasource = (datasourceId: string) => {
    const datasource = datasources.find((item) => item.id === datasourceId);
    patchForm({
      targetDatasourceId: datasourceId,
      targetDatabase: datasource?.defaultSchema || form.targetDatabase,
      targetSchema: "",
      targetTestState: "idle",
      targetTestMessage: "",
      tables: resetWizardTables(form.tables, "target")
    });
    setTargetDatabaseOptions([]);
    setTargetTableOptions([]);
    setTargetDatabaseLoadState("idle");
    setTargetTableLoadState("idle");
  };

  const updateSourceDatabase = (sourceDatabase: string) => {
    patchForm({
      sourceDatabase,
      sourceSchema: "",
      tables: resetWizardTables(form.tables, "source")
    });
  };

  const updateTargetDatabase = (targetDatabase: string) => {
    patchForm({
      targetDatabase,
      targetSchema: "",
      tables: resetWizardTables(form.tables, "target")
    });
  };

  const testDatasourceConnection = async (side: "source" | "target") => {
    const datasourceId = side === "source" ? form.sourceDatasourceId : form.targetDatasourceId;
    if (!datasourceId || !form.runNodeId) {
      pushNotice({ tone: "warning", message: "先选节点" });
      return;
    }
    setTestFailureDialog(null);
    setForm((current) => ({
      ...current,
      [side === "source" ? "sourceTestState" : "targetTestState"]: "testing",
      [side === "source" ? "sourceTestMessage" : "targetTestMessage"]: ""
    }));
    try {
      const result = await api.testDatasource(datasourceId, { nodeId: form.runNodeId });
      const message = result.message.trim() || (result.success ? "测试连接成功" : "测试连接失败");
      setForm((current) => ({
        ...current,
        [side === "source" ? "sourceTestState" : "targetTestState"]: result.success ? "success" : "failed",
        [side === "source" ? "sourceTestMessage" : "targetTestMessage"]: result.success ? "测试连接成功" : message
      }));
      if (!result.success) {
        setTestFailureDialog({ side, message });
      }
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "测试连接失败";
      setForm((current) => ({
        ...current,
        [side === "source" ? "sourceTestState" : "targetTestState"]: "failed",
        [side === "source" ? "sourceTestMessage" : "targetTestMessage"]: message
      }));
      setTestFailureDialog({ side, message });
    }
  };

  const goToTablePage = (nextPage: number) => {
    setTablePageIndex(clampPage(nextPage, tableTotalPages));
  };

  const goToTargetTablePage = (nextPage: number) => {
    setTargetTablePageIndex(clampPage(nextPage, targetTableTotalPages));
  };

  const commitTableJumpPage = () => {
    if (!tableJumpPageDraft.trim()) {
      setTableJumpPageDraft(String(tableCurrentPage));
      return;
    }
    const nextPage = clampPage(Number(tableJumpPageDraft), tableTotalPages);
    setTablePageIndex(nextPage);
    setTableJumpPageDraft(String(nextPage));
  };

  const commitTargetTableJumpPage = () => {
    if (!targetTableJumpPageDraft.trim()) {
      setTargetTableJumpPageDraft(String(targetTableCurrentPage));
      return;
    }
    const nextPage = clampPage(Number(targetTableJumpPageDraft), targetTableTotalPages);
    setTargetTablePageIndex(nextPage);
    setTargetTableJumpPageDraft(String(nextPage));
  };

  const updateTable = (index: number, patch: Partial<ChannelWizardTableDraft>) => {
    setForm((current) => ({
      ...current,
      tables: current.tables.map((table, tableIndex) => {
        if (tableIndex !== index) return table;
        const sourceTableChanged = patch.sourceTable !== undefined && patch.sourceTable !== table.sourceTable;
        const targetTableChanged = patch.targetTable !== undefined && patch.targetTable !== table.targetTable;
        const nextTargetTable = (patch.targetTable ?? table.targetTable).trim();
        const targetTableExists = targetTableOptions.some((targetTable) => targetTable === nextTargetTable);
        return {
          ...table,
          ...patch,
          createTarget: targetTableChanged && targetTableLoadState === "success" ? Boolean(nextTargetTable) && !targetTableExists : patch.createTarget ?? table.createTarget,
          primaryKeysText: sourceTableChanged ? "" : table.primaryKeysText,
          columns: sourceTableChanged || targetTableChanged ? [] : table.columns
        };
      })
    }));
  };

  const updateColumn = (tableIndex: number, columnIndex: number, patch: Partial<ChannelColumnMappingDraft>) => {
    setForm((current) => ({
      ...current,
      tables: current.tables.map((table, currentTableIndex) => {
        if (currentTableIndex !== tableIndex) return table;
        const columns = table.columns.map((column, currentColumnIndex) => currentColumnIndex === columnIndex ? { ...column, ...patch } : column);
        const patchedColumn = columns[columnIndex];
        const primaryKeys = new Set(splitList(table.primaryKeysText));
        if (patch.isPrimaryKey !== undefined && patchedColumn?.sourceColumn.trim()) {
          if (patch.isPrimaryKey) {
            primaryKeys.add(patchedColumn.sourceColumn.trim());
          } else {
            primaryKeys.delete(patchedColumn.sourceColumn.trim());
          }
        }
        return {
          ...table,
          columns,
          primaryKeysText: patch.isPrimaryKey !== undefined ? Array.from(primaryKeys).join(", ") : table.primaryKeysText
        };
      })
    }));
  };

  const updateTableColumnsEnabled = (tableIndex: number, enabled: boolean) => {
    setForm((current) => ({
      ...current,
      tables: current.tables.map((table, currentTableIndex) => (
        currentTableIndex === tableIndex
          ? {
            ...table,
            columns: table.columns.map((column) => ({
              ...column,
              enabled
            }))
          }
          : table
      ))
    }));
  };

  const goNext = () => {
    if (step === "connections") {
      if (connectionStepMissingDatasourceMessage) {
        pushNotice({ tone: "warning", message: connectionStepMissingDatasourceMessage });
        return;
      }
      const sourceNeedsTest = Boolean(form.sourceDatasourceId && form.sourceTestState !== "success");
      const targetNeedsTest = Boolean(form.targetDatasourceId && form.targetTestState !== "success");
      if (sourceNeedsTest || targetNeedsTest) {
        pushNotice({
          tone: "error",
          message: sourceNeedsTest && targetNeedsTest
            ? "请先测试源端和目标端连接"
            : sourceNeedsTest
              ? "请先测试源端连接"
              : "请先测试目标端连接"
        });
        return;
      }
    }
    if (!currentStepValid) {
      pushNotice({
        tone: "warning",
        message: step === "connections" && connectionStepMissingDatasourceMessage
          ? connectionStepMissingDatasourceMessage
          : channelWizardStepError(step)
      });
      return;
    }
    setStep(channelWizardSteps[Math.min(channelWizardSteps.length - 1, stepIndex + 1)]);
  };

  const goPrevious = () => {
    setStep(channelWizardSteps[Math.max(0, stepIndex - 1)]);
  };

  const submit = async () => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "权限不足" });
      return;
    }
    if (!connectionStepValid || !taskStepValid || !targetTableStepValid || !columnStepValid) {
      pushNotice({ tone: "warning", message: "配置不完整" });
      return;
    }
    setSubmitting(true);
    try {
      const channel = await api.createChannel({
        name: form.name.trim(),
        description: form.description.trim(),
        sourceDatasourceId: form.sourceDatasourceId,
        targetDatasourceId: form.targetDatasourceId,
        sourceDatasourceType: form.sourceDatasourceType,
        targetDatasourceType: form.targetDatasourceType,
        runNodeId: form.runNodeId,
        resourceSpec: form.resourceSpec,
        kind: form.kind,
        tags: [form.kind === "sync" ? "同步" : "检查"]
      });
      await api.saveChannelMappings(channel.id, { tables: channelWizardMappingPayload(form) });
      const baseConfig = channelWizardTaskConfig(form);
      if (form.kind === "sync") {
        const createTables = form.tables.filter((table) => table.enabled && table.createTarget);
        if (createTables.length > 0) {
          await api.createChannelTask(channel.id, {
            name: "结构迁移",
            type: "schema_migration",
            enabled: true,
            config: { ...baseConfig, createTables: createTables.map((table) => table.targetTable.trim()).join(",") }
          });
        }
        if (form.fullMigration) {
          await api.createChannelTask(channel.id, { name: "全量迁移", type: "full_migration", enabled: true, config: baseConfig });
        }
        if (form.incrementalSync) {
          await api.createChannelTask(channel.id, { name: "增量同步", type: "incremental_sync", enabled: true, config: baseConfig });
        }
      } else {
        if (form.schemaCompare) {
          await api.createChannelTask(channel.id, { name: "结构对比", type: "schema_compare", enabled: true, config: baseConfig });
        }
        let validationTask: ChannelTask | null = null;
        if (form.dataValidation) {
          validationTask = await api.createChannelTask(channel.id, { name: "数据校验", type: "data_validation", enabled: true, config: baseConfig });
        }
        if (form.dataCorrection && validationTask) {
          await api.createChannelTask(channel.id, {
            name: "数据订正",
            type: "data_correction",
            enabled: true,
            dependsOn: [validationTask.id],
            config: baseConfig
          });
        }
      }
      pushNotice({ tone: "success", message: "已创建" });
      await onChanged(true);
      onOpenChannel(channel.id);
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "创建失败" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <section className="flex min-h-[100dvh] min-w-0 flex-col">
        <div className="flex flex-1 flex-col px-5 py-6 md:px-8">
          {!canManage ? (
            <PermissionNotice description="当前账号不能创建 Canal。" />
          ) : (
            <div className="flex flex-1 flex-col gap-6">
            <nav className="toolbar overflow-x-auto" aria-label="Canal 创建步骤">
              <div className="grid min-w-[860px] grid-cols-5 gap-3">
                {channelWizardSteps.map((wizardStep, index) => (
                  <Button
                    key={wizardStep}
                    type="button"
                    disabled={index > maxReachableStepIndex}
                    onClick={() => setStep(wizardStep)}
                    className={cx(
                      "flex min-h-14 items-center justify-center gap-3 rounded-lg px-4 text-sm font-semibold transition",
                      step === wizardStep
                        ? "border border-accent bg-accent text-white"
                        : "border border-transparent bg-white text-slate-600 hover:border-blue-100 hover:bg-blue-50 hover:text-accent",
                      index > maxReachableStepIndex && "cursor-not-allowed opacity-45"
                    )}
                  >
                    <span className={cx(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs",
                      step === wizardStep ? "border-white/40 bg-white/15 text-white" : "border-line bg-slate-50"
                    )}>
                      {index + 1}
                    </span>
                    <span>{channelWizardStepLabel(wizardStep)}</span>
                  </Button>
                ))}
              </div>
            </nav>

            <div className="surface flex min-w-0 flex-1 flex-col">
              <div className="min-w-0 flex-1">
              {step === "connections" && (
                <div className="grid gap-6 p-5">
                  <div className="grid gap-4">
                    <Field label="名称" required error={!form.name.trim() ? "必填" : undefined}>
                      <TextInput
                        className="input"
                        maxLength={80}
                        value={form.name}
                        onChange={(event) => {
                          setChannelNameEdited(true);
                          patchForm({ name: event.target.value });
                        }}
                      />
                    </Field>
                    <Field label="运行节点" required error={!form.runNodeId ? "必填" : undefined}>
                      <DropdownSelect
                        value={form.runNodeId}
                        ariaLabel="运行节点"
                        options={nodeOptionsForWizard(onlineNodes)}
                        onChange={(runNodeId) => patchForm({ runNodeId, sourceTestState: "idle", targetTestState: "idle", sourceTestMessage: "", targetTestMessage: "" })}
                      />
                    </Field>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-line p-4">
                      <div className="mb-4 text-base font-semibold text-coal">源端</div>
                      <div className="grid gap-4">
                        <Field label="类型" required>
                          <ChannelWizardDatasourceTypeSelector
                            value={form.sourceDatasourceType}
                            ariaLabel="源端类型"
                            onChange={(value) => patchForm({
                              sourceDatasourceType: value,
                              sourceDatasourceId: "",
                              sourceDatabase: "",
                              sourceSchema: "",
                              sourceTestState: "idle",
                              sourceTestMessage: "",
                              tables: resetWizardTables(form.tables, "source")
                            })}
                          />
                        </Field>
                        <Field label="数据源" required error={!sourceHasDatasources ? "暂无" : undefined}>
                          <DropdownSelect value={form.sourceDatasourceId} ariaLabel="源端数据源" options={sourceOptions} onChange={updateSourceDatasource} />
                        </Field>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Button
                            type="button"
                            aria-label={form.sourceTestState === "testing" ? "源端测试中" : "测试源端"}
                            title={form.sourceTestState === "testing" ? "源端测试中" : "测试源端"}
                            onClick={() => void testDatasourceConnection("source")}
                            disabled={!form.sourceDatasourceId || !form.runNodeId || form.sourceTestState === "testing"}
                            className="btn-secondary h-10 justify-self-start px-3"
                          >
                            {form.sourceTestState === "testing" ? <ArrowsClockwise size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                            {form.sourceTestState === "testing" ? "测试中" : "测试连接"}
                          </Button>
                          {form.sourceTestState === "success" && (
                            <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-emerald-700">
                              <CheckCircle className="shrink-0" size={16} weight="fill" />
                              <span className="truncate">测试连接成功</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-line p-4">
                      <div className="mb-4 text-base font-semibold text-coal">目标端</div>
                      <div className="grid gap-4">
                        <Field label="类型" required>
                          <ChannelWizardDatasourceTypeSelector
                            value={form.targetDatasourceType}
                            ariaLabel="目标端类型"
                            onChange={(value) => patchForm({
                              targetDatasourceType: value,
                              targetDatasourceId: "",
                              targetDatabase: "",
                              targetSchema: "",
                              targetTestState: "idle",
                              targetTestMessage: "",
                              tables: resetWizardTables(form.tables, "target")
                            })}
                          />
                        </Field>
                        <Field label="数据源" required error={!targetHasDatasources ? "暂无" : undefined}>
                          <DropdownSelect value={form.targetDatasourceId} ariaLabel="目标端数据源" options={targetOptions} onChange={updateTargetDatasource} />
                        </Field>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Button
                            type="button"
                            aria-label={form.targetTestState === "testing" ? "目标端测试中" : "测试目标端"}
                            title={form.targetTestState === "testing" ? "目标端测试中" : "测试目标端"}
                            onClick={() => void testDatasourceConnection("target")}
                            disabled={!form.targetDatasourceId || !form.runNodeId || form.targetTestState === "testing"}
                            className="btn-secondary h-10 justify-self-start px-3"
                          >
                            {form.targetTestState === "testing" ? <ArrowsClockwise size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                            {form.targetTestState === "testing" ? "测试中" : "测试连接"}
                          </Button>
                          {form.targetTestState === "success" && (
                            <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-emerald-700">
                              <CheckCircle className="shrink-0" size={16} weight="fill" />
                              <span className="truncate">测试连接成功</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {step === "tasks" && (
                <div className="grid gap-6 p-5">
                  <div>
                    <div className="mb-3 text-sm font-semibold text-slate-500">规格</div>
                    <div className="flex flex-wrap gap-2">
                      {resourceSpecOptions.map((spec) => (
                        <Button
                          key={spec}
                          type="button"
                          onClick={() => patchForm({ resourceSpec: spec })}
                          className={cx(
                            "h-11 min-w-[82px] rounded-lg border px-4 text-sm font-semibold transition",
                            form.resourceSpec === spec ? "border-blue-200 bg-blue-50 text-accent" : "border-line bg-white text-slate-600 hover:border-blue-200"
                          )}
                        >
                          {spec}
                        </Button>
                      ))}
                    </div>
                    <div className={cx("mt-3 flex items-center gap-2 text-sm", hasCapacity ? "text-emerald-700" : "text-amber-700")}>
                      {hasCapacity ? <CheckCircle size={16} /> : <WarningCircle size={16} />}
                      {selectedNode ? `${selectedNode.name} ${selectedNode.capacity}G` : "无在线节点"}
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 text-sm font-semibold text-slate-500">类型</div>
                    <div className="inline-flex rounded-lg border border-line bg-slate-50 p-1">
                      <Button type="button" onClick={() => patchForm({ kind: "sync", schemaCompare: false, dataValidation: false, dataCorrection: false })} className={cx("h-10 rounded-md px-4 text-sm font-semibold", form.kind === "sync" ? "bg-white text-accent shadow-sm" : "text-slate-600")}>
                        同步
                      </Button>
                      <Button type="button" onClick={() => patchForm({ kind: "check", fullMigration: false, incrementalSync: false })} className={cx("h-10 rounded-md px-4 text-sm font-semibold", form.kind === "check" ? "bg-white text-accent shadow-sm" : "text-slate-600")}>
                        检查
                      </Button>
                    </div>
                  </div>

                  {form.kind === "sync" ? (
                    <div className="grid gap-3">
                      <div className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-line bg-white p-4">
                        <div className="font-semibold text-coal">结构迁移</div>
                        <div className="relative flex shrink-0 items-center justify-end">
                          {schemaMigrationInfoOpen && (
                            <div
                              id="schema-migration-info"
                              role="tooltip"
                              className="absolute right-10 top-1/2 z-20 w-[min(520px,calc(100vw-112px))] -translate-y-1/2 rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm font-medium leading-5 text-slate-700 shadow-panel"
                            >
                              系统根据实际选择的表判断是否需要结构迁移任务；有待创建的表时自动添加结构迁移任务，没有待创建的表时不会添加。
                            </div>
                          )}
                          <Button
                            type="button"
                            aria-label="结构迁移说明"
                            aria-expanded={schemaMigrationInfoOpen}
                            aria-describedby={schemaMigrationInfoOpen ? "schema-migration-info" : undefined}
                            title="结构迁移说明"
                            onClick={() => setSchemaMigrationInfoOpen((open) => !open)}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-blue-100 bg-blue-50 text-accent transition hover:bg-blue-100 active:translate-y-px"
                          >
                            <Info size={16} weight="bold" />
                          </Button>
                        </div>
                      </div>
                      <TaskToggle label="全量迁移" checked={form.fullMigration} onChange={(fullMigration) => patchForm({ fullMigration })} />
                      <TaskToggle label="增量同步" checked={form.incrementalSync} onChange={(incrementalSync) => patchForm({ incrementalSync })} />
                    </div>
                  ) : (
                    <div className="grid gap-3">
                      <TaskToggle label="结构对比" checked={form.schemaCompare} onChange={(schemaCompare) => patchForm({ schemaCompare })} />
                      <TaskToggle label="数据校验" checked={form.dataValidation} onChange={(dataValidation) => patchForm({ dataValidation, dataCorrection: dataValidation ? form.dataCorrection : false })} />
                      <TaskToggle label="数据订正" checked={form.dataCorrection} disabled={!form.dataValidation} onChange={(dataCorrection) => patchForm({ dataCorrection })} />
                    </div>
                  )}
                </div>
              )}

              {step === "sourceTables" && (
                <div className="grid gap-5 p-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="源 DB" required error={!form.sourceDatabase ? "必选" : undefined}>
                      <DropdownSelect
                        value={form.sourceDatabase}
                        ariaLabel="源 DB"
                        options={sourceDatabaseSelectOptions}
                        disabled={sourceDatabaseLoadState === "loading"}
                        onChange={updateSourceDatabase}
                      />
                    </Field>
                  </div>
                  {sourceMetadataError && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      {sourceMetadataError}
                    </div>
                  )}

                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
                      <div className="text-base font-semibold text-coal">源端订阅表</div>
                      <div className="text-sm font-medium text-slate-500">已选 {selectedTableCount}</div>
                      <div className="w-full md:w-[128px]">
                        <DropdownSelect
                          value={tableSelectionFilter}
                          ariaLabel="过滤类型"
                          options={tableSelectionFilterOptions()}
                          showSelectedDescription={false}
                          onChange={(value) => setTableSelectionFilter(value as TableSelectionFilter)}
                          className="h-10 min-h-10"
                        />
                      </div>
                      <label className="relative block w-full md:w-[280px]">
                        <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
                        <TextInput
                          aria-label="搜表"
                          className="input h-10 pl-10"
                          value={tableFilterDraft}
                          placeholder="搜表"
                          onChange={(event) => setTableFilterDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              applyTableFilter();
                            }
                          }}
                        />
                      </label>
                      <Button type="button" onClick={applyTableFilter} className="btn-primary h-10 min-w-[86px]">
                        <MagnifyingGlass size={16} />
                        查询
                      </Button>
                      {(tableFilterQuery || tableSelectionFilter !== "all") && (
                        <div className="text-sm font-medium text-slate-500">匹配 {tableTotalItems}</div>
                      )}
                    </div>
                  </div>

                  {sourceTableLoadState === "loading" ? (
                    <EmptyPanel icon={Database} title="加载中" />
                  ) : form.tables.length === 0 ? (
                    <EmptyPanel icon={Database} title="暂无源表" />
                  ) : tableTotalItems === 0 ? (
                    <EmptyPanel icon={MagnifyingGlass} title="无匹配" />
                  ) : (
                    <div className="rounded-lg border border-line">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[560px] table-fixed text-left text-sm">
                          <colgroup>
                            <col className="w-[90px]" />
                            <col className="w-[470px]" />
                          </colgroup>
                          <thead className="border-b border-line bg-slate-50 text-xs font-semibold text-slate-500">
                            <tr>
                              <th className="px-4 py-3">订阅</th>
                              <th className="px-4 py-3">源表</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {tablePageRows.map(({ table, tableIndex }) => (
                              <tr key={table.localId}>
                                <td className="px-4 py-3">
                                  <CheckboxInput checked={Boolean(table.enabled)} onChange={(event) => updateTable(tableIndex, { enabled: event.target.checked })} />
                                </td>
                                <td className="px-4 py-3">
                                  <div className="truncate font-medium text-coal" title={table.sourceTable}>{table.sourceTable}</div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="sticky bottom-[81px] z-10 flex flex-col gap-3 border-t border-line bg-white px-4 py-3 text-sm text-slate-600 lg:flex-row lg:items-center lg:justify-between">
                        <div>共 {tableTotalItems} 条</div>
                        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                          <PaginationButton label="上一页" disabled={tableCurrentPage <= 1} onClick={() => goToTablePage(tableCurrentPage - 1)}>
                            <CaretLeft size={16} />
                          </PaginationButton>
                          {tablePageNumbers.map((pageNumber) => (
                            <Button
                              key={pageNumber}
                              type="button"
                              onClick={() => goToTablePage(pageNumber)}
                              className={cx(
                                "inline-flex h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition active:translate-y-px",
                                tableCurrentPage === pageNumber
                                  ? "border-accent bg-accent text-white shadow-raised"
                                  : "border-line bg-white text-coal hover:border-blue-200 hover:bg-blue-50 hover:text-accent"
                              )}
                            >
                              {pageNumber}
                            </Button>
                          ))}
                          <PaginationButton label="下一页" disabled={tableCurrentPage >= tableTotalPages} onClick={() => goToTablePage(tableCurrentPage + 1)}>
                            <CaretRight size={16} />
                          </PaginationButton>
                          <span className="ml-2 text-slate-500">前往</span>
                          <TextInput
                            aria-label="页码"
                            inputMode="numeric"
                            value={tableJumpPageDraft}
                            onChange={(event) => setTableJumpPageDraft(event.target.value.replace(/\D/g, "").slice(0, 4))}
                            onBlur={commitTableJumpPage}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                commitTableJumpPage();
                              }
                            }}
                            className="input h-10 w-16 px-3 py-2 text-center"
                          />
                          <span className="text-slate-500">页</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step === "targetTables" && (
                <div className="grid gap-5 p-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="目标 DB" required error={!form.targetDatabase ? "必选" : sameDatasourceSameDatabase ? "需不同" : undefined}>
                      <DropdownSelect
                        value={form.targetDatabase}
                        ariaLabel="目标 DB"
                        options={targetDatabaseSelectOptions}
                        disabled={targetDatabaseLoadState === "loading"}
                        onChange={updateTargetDatabase}
                      />
                    </Field>
                  </div>
                  {targetMetadataError && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      {targetMetadataError}
                    </div>
                  )}
                  {targetTableOptions.length > 0 && (
                    <datalist id={targetTableListId}>
                      {targetTableOptions.map((targetTable) => (
                        <option key={targetTable} value={targetTable} />
                      ))}
                    </datalist>
                  )}

                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
                      <div className="text-base font-semibold text-coal">目标端映射表</div>
                      <div className="text-sm font-medium text-slate-500">已映射 {selectedTableCount}</div>
                      <label className="relative block w-full md:w-[280px]">
                        <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={17} />
                        <TextInput
                          aria-label="搜映射表"
                          className="input h-10 pl-10"
                          value={targetTableFilterDraft}
                          placeholder="搜表"
                          onChange={(event) => setTargetTableFilterDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              applyTargetTableFilter();
                            }
                          }}
                        />
                      </label>
                      <Button type="button" onClick={applyTargetTableFilter} className="btn-primary h-10 min-w-[86px]">
                        <MagnifyingGlass size={16} />
                        查询
                      </Button>
                      {targetTableFilterQuery && (
                        <div className="text-sm font-medium text-slate-500">匹配 {targetTableTotalItems}</div>
                      )}
                    </div>
                  </div>

                  {selectedTableCount === 0 ? (
                    <EmptyPanel icon={Database} title="未选源表" />
                  ) : targetTableTotalItems === 0 ? (
                    <EmptyPanel icon={MagnifyingGlass} title="无匹配" />
                  ) : (
                    <div className="rounded-lg border border-line">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[860px] table-fixed text-left text-sm">
                          <colgroup>
                            <col className="w-[280px]" />
                            <col className="w-[360px]" />
                            <col className="w-[160px]" />
                          </colgroup>
                          <thead className="border-b border-line bg-slate-50 text-xs font-semibold text-slate-500">
                            <tr>
                              <th className="px-4 py-3">源表</th>
                              <th className="px-4 py-3">目标表</th>
                              <th className="px-4 py-3">目标状态</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {targetTablePageRows.map(({ table, tableIndex }) => (
                              <tr key={table.localId}>
                                <td className="px-4 py-3">
                                  <div className="truncate font-medium text-coal" title={table.sourceTable}>{table.sourceTable}</div>
                                </td>
                                <td className="px-4 py-3">
                                  <TextInput
                                    className="input h-10"
                                    list={targetTableOptions.length > 0 ? targetTableListId : undefined}
                                    value={table.targetTable}
                                    placeholder="目标表"
                                    onChange={(event) => updateTable(tableIndex, { targetTable: event.target.value })}
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <TableTargetStatusBadge table={table} targetTableLoadState={targetTableLoadState} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="sticky bottom-[81px] z-10 flex flex-col gap-3 border-t border-line bg-white px-4 py-3 text-sm text-slate-600 lg:flex-row lg:items-center lg:justify-between">
                        <div>共 {targetTableTotalItems} 条</div>
                        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                          <PaginationButton label="上一页" disabled={targetTableCurrentPage <= 1} onClick={() => goToTargetTablePage(targetTableCurrentPage - 1)}>
                            <CaretLeft size={16} />
                          </PaginationButton>
                          {targetTablePageNumbers.map((pageNumber) => (
                            <Button
                              key={pageNumber}
                              type="button"
                              onClick={() => goToTargetTablePage(pageNumber)}
                              className={cx(
                                "inline-flex h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition active:translate-y-px",
                                targetTableCurrentPage === pageNumber
                                  ? "border-accent bg-accent text-white shadow-raised"
                                  : "border-line bg-white text-coal hover:border-blue-200 hover:bg-blue-50 hover:text-accent"
                              )}
                            >
                              {pageNumber}
                            </Button>
                          ))}
                          <PaginationButton label="下一页" disabled={targetTableCurrentPage >= targetTableTotalPages} onClick={() => goToTargetTablePage(targetTableCurrentPage + 1)}>
                            <CaretRight size={16} />
                          </PaginationButton>
                          <span className="ml-2 text-slate-500">前往</span>
                          <TextInput
                            aria-label="页码"
                            inputMode="numeric"
                            value={targetTableJumpPageDraft}
                            onChange={(event) => setTargetTableJumpPageDraft(event.target.value.replace(/\D/g, "").slice(0, 4))}
                            onBlur={commitTargetTableJumpPage}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                commitTargetTableJumpPage();
                              }
                            }}
                            className="input h-10 w-16 px-3 py-2 text-center"
                          />
                          <span className="text-slate-500">页</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {step === "columns" && (
                <div className="grid gap-5 p-5">
                  {form.tables.map((table, tableIndex) => {
                    if (!table.enabled) return null;
                    const metadata = columnMetadataByTable[table.localId];
                    const selectableColumns = table.columns.filter((column) => column.sourceColumn.trim() && column.targetColumn.trim());
                    const selectedColumnCount = selectableColumns.filter((column) => column.enabled !== false).length;
                    const allColumnsSelected = selectableColumns.length > 0 && selectedColumnCount === selectableColumns.length;
                    return (
                      <div key={table.localId} className="rounded-lg border border-line p-4">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-coal">{table.sourceTable || "源表"} → {table.targetTable || "目标表"}</div>
                            <div className={cx("mt-1 text-xs", metadata?.loadState === "failed" ? "text-amber-700" : "text-slate-500")}>
                              {metadata?.loadState === "loading" ? "列加载中" : metadata?.error || `已选 ${selectedColumnCount}/${selectableColumns.length}`}
                            </div>
                          </div>
                          <label className="flex shrink-0 items-center gap-2 text-sm font-semibold text-slate-600">
                            <CheckboxInput
                              aria-label="全选列"
                              checked={allColumnsSelected}
                              disabled={selectableColumns.length === 0}
                              onChange={(event) => updateTableColumnsEnabled(tableIndex, event.target.checked)}
                            />
                            全选
                          </label>
                        </div>
                        {selectableColumns.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-line bg-slate-50/70 px-4 py-6 text-center text-sm font-medium text-slate-500">
                            {metadata?.loadState === "loading" ? "加载中" : "暂无列"}
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[680px] table-fixed text-left text-sm">
                              <colgroup>
                                <col className="w-[80px]" />
                                <col className="w-[180px]" />
                                <col className="w-[170px]" />
                                <col className="w-[180px]" />
                                <col className="w-[170px]" />
                              </colgroup>
                              <thead className="border-b border-line text-xs font-semibold text-slate-500">
                                <tr>
                                  <th className="py-2 pr-3">同步</th>
                                  <th className="py-2 pr-3">源列</th>
                                  <th className="py-2 pr-3">源类型</th>
                                  <th className="py-2 pr-3">目标列</th>
                                  <th className="py-2 pr-3">目标类型</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-line">
                                {table.columns.map((column, columnIndex) => {
                                  if (!column.sourceColumn.trim() || !column.targetColumn.trim()) return null;
                                  return (
                                    <tr key={column.localId} className={cx("transition", column.enabled === false ? "bg-slate-50/60 text-slate-400" : "hover:bg-blue-50/40")}>
                                      <td className="py-3 pr-3">
                                        <CheckboxInput
                                          aria-label={`${column.sourceColumn} 同步`}
                                          checked={column.enabled !== false}
                                          onChange={(event) => updateColumn(tableIndex, columnIndex, { enabled: event.target.checked })}
                                        />
                                      </td>
                                      <td className={cx("truncate py-3 pr-3 font-medium", column.enabled === false ? "text-slate-400" : "text-coal")} title={column.sourceColumn}>{column.sourceColumn}</td>
                                      <td className={cx("truncate py-3 pr-3 font-mono text-xs", column.enabled === false ? "text-slate-400" : "text-slate-600")} title={column.sourceType || "-"}>{column.sourceType || "-"}</td>
                                      <td className={cx("truncate py-3 pr-3 font-medium", column.enabled === false ? "text-slate-400" : "text-coal")} title={column.targetColumn}>{column.targetColumn}</td>
                                      <td className={cx("truncate py-3 pr-3 font-mono text-xs", column.enabled === false ? "text-slate-400" : "text-slate-600")} title={column.targetType || "-"}>{column.targetType || "-"}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              </div>

              <div className="sticky bottom-0 z-10 mt-auto flex shrink-0 items-center justify-center gap-3 border-t border-line bg-white p-5">
                {stepIndex > 0 && (
                  <Button type="button" onClick={goPrevious} disabled={submitting} className="btn-secondary">
                    <CaretLeft size={16} />
                    上一步
                  </Button>
                )}
                {step === "columns" ? (
                  <Button type="button" onClick={() => void submit()} disabled={submitting || !columnStepValid} className="btn-primary">
                    {submitting ? <ArrowsClockwise size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                    创建
                  </Button>
                ) : (
                  <Button type="button" onClick={goNext} disabled={nextStepDisabled} className="btn-primary">
                    下一步
                    <CaretRight size={16} />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      </section>
      <ChannelWizardTestFailureDialog dialog={testFailureDialog} onClose={() => setTestFailureDialog(null)} />
    </>
  );
}

function ChannelWizardTestFailureDialog({
  dialog,
  onClose
}: {
  dialog: { side: "source" | "target" | "both"; message: string } | null;
  onClose: () => void;
}) {
  const sideLabel = dialog?.side === "both" ? "源端 / 目标端" : dialog?.side === "source" ? "源端" : "目标端";
  return (
    <Modal open={Boolean(dialog)} title="测试失败" onClose={onClose} size="md">
      <div className="grid gap-5">
        <div className="flex items-start gap-3 rounded-lg border border-red-100 bg-red-50 p-4 text-red-700">
          <XCircle className="mt-0.5 shrink-0" size={18} weight="fill" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">{sideLabel}</div>
            <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-red-500">失败原因</div>
            <p className="mt-1 break-words text-sm leading-6">{dialog?.message || "测试连接失败"}</p>
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={onClose} className="btn-secondary">
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ChannelDetailPage({
  channelId,
  channels,
  datasources,
  canManage,
  canOperate,
  onBack,
  onChanged,
  pushNotice
}: {
  channelId: string | null;
  channels: Channel[];
  datasources: Datasource[];
  canManage: boolean;
  canOperate: boolean;
  onBack: () => void;
  onChanged: (quiet?: boolean) => Promise<void>;
  pushNotice: (notice: Notice) => void;
}) {
  const channel = channelId ? channels.find((item) => item.id === channelId) ?? null : null;
  const [activeTab, setActiveTab] = useState<ChannelDetailTab>("overview");
  const [mappingDraft, setMappingDraft] = useState<ChannelTableMappingDraft[]>([]);
  const [tasks, setTasks] = useState<ChannelTask[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [logFilters, setLogFilters] = useState<ChannelLogFilters>({ taskId: "", runId: "", level: "" });
  const [diffs, setDiffs] = useState<DataValidationDiff[]>([]);
  const [precheck, setPrecheck] = useState<ChannelPrecheckResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [newTask, setNewTask] = useState<ChannelTaskInput>({ name: "", type: "schema_compare", enabled: true, config: {} });

  const loadDetail = useCallback(async () => {
    if (!channelId) return;
    setDetailLoading(true);
    try {
      const [nextMappings, nextTasks, nextRuns, nextLogs, nextDiffs, nextPrecheck] = await Promise.all([
        api.channelMappings(channelId),
        api.channelTasks(channelId),
        api.channelRuns(channelId),
        api.channelLogs(channelId, logFilters),
        api.channelDiffs(channelId),
        api.precheckChannel(channelId)
      ]);
      setMappingDraft(mappingDraftFromResponse(nextMappings));
      setTasks(nextTasks);
      setRuns(nextRuns);
      setLogs(nextLogs);
      setDiffs(nextDiffs);
      setPrecheck(nextPrecheck);
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "加载失败" });
    } finally {
      setDetailLoading(false);
    }
  }, [channelId, logFilters, pushNotice]);

  useEffect(() => {
    setLogFilters((current) => current.taskId || current.runId || current.level ? { taskId: "", runId: "", level: "" } : current);
  }, [channelId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  if (!channelId || !channel) {
    return (
      <section>
        <div className="page-titlebar justify-between gap-4">
          <h1 className="text-2xl font-semibold text-coal md:text-3xl">Canal</h1>
          <Button type="button" onClick={onBack} className="btn-secondary">
            <ArrowRight size={14} className="rotate-180" />
            返回
          </Button>
        </div>
        <div className="p-5 md:p-6">
          <EmptyPanel icon={ArrowRight} title="不存在" />
        </div>
      </section>
    );
  }

  const source = datasourceById(datasources, channel.sourceDatasourceId);
  const target = datasourceById(datasources, channel.targetDatasourceId);
  const detailSummary = channelDetailSummary(channel, tasks, runs, precheck);

  const saveMappings = async () => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "权限不足" });
      return;
    }
    setDetailBusy(true);
    try {
      const response = await api.saveChannelMappings(channel.id, { tables: mappingDraftPayload(mappingDraft) });
      setMappingDraft(mappingDraftFromResponse(response));
      pushNotice({ tone: "success", message: "已保存" });
      await onChanged(true);
      await loadDetail();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "保存失败" });
    } finally {
      setDetailBusy(false);
    }
  };

  const runPrecheck = async () => {
    setDetailBusy(true);
    try {
      const result = await api.precheckChannel(channel.id);
      setPrecheck(result);
      pushNotice({ tone: result.success ? "success" : "warning", message: result.success ? "预检通过" : "预检未通过" });
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "预检失败" });
    } finally {
      setDetailBusy(false);
    }
  };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage) {
      pushNotice({ tone: "warning", message: "权限不足" });
      return;
    }
    if (!newTask.name.trim()) {
      pushNotice({ tone: "warning", message: "任务名称必填" });
      return;
    }
    setDetailBusy(true);
    try {
      await api.createChannelTask(channel.id, newTask);
      setNewTask({ name: "", type: "schema_compare", enabled: true, config: {} });
      pushNotice({ tone: "success", message: "已保存" });
      await onChanged(true);
      await loadDetail();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "保存失败" });
    } finally {
      setDetailBusy(false);
    }
  };

  const runTaskAction = async (task: ChannelTask, action: "start" | "stop" | "rerun") => {
    if (!canOperate) {
      pushNotice({ tone: "warning", message: "权限不足" });
      return;
    }
    setDetailBusy(true);
    try {
      if (action === "start") {
        await api.startChannelTask(channel.id, task.id);
      } else if (action === "stop") {
        await api.stopChannelTask(channel.id, task.id);
      } else {
        await api.rerunChannelTask(channel.id, task.id);
      }
      pushNotice({ tone: "success", message: action === "stop" ? "已停止" : "已启动" });
      await onChanged(true);
      await loadDetail();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "操作失败" });
    } finally {
      setDetailBusy(false);
    }
  };

  const deleteTask = async (task: ChannelTask) => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "权限不足" });
      return;
    }
    setDetailBusy(true);
    try {
      await api.deleteChannelTask(channel.id, task.id);
      pushNotice({ tone: "success", message: "已删除" });
      await onChanged(true);
      await loadDetail();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "删除失败" });
    } finally {
      setDetailBusy(false);
    }
  };

  return (
    <section className="min-w-0 overflow-hidden">
      <div className="flex min-h-[92px] flex-col justify-center gap-3 border-b border-line bg-white px-5 py-4 md:px-8 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold text-coal md:text-3xl">{channel.name}</h1>
            <ChannelStatusBadge status={channel.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>{source?.name || channel.sourceDatasourceId}</span>
            <ArrowRight size={14} />
            <span>{target?.name || channel.targetDatasourceId}</span>
            <span>v{channel.mappingVersion}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 xl:justify-end">
          <Button type="button" onClick={onBack} className="btn-secondary h-11 px-4">
            <ArrowRight size={16} className="rotate-180" />
            返回
          </Button>
          <Button type="button" onClick={() => void runPrecheck()} disabled={detailBusy} className="btn-secondary h-11 px-4">
            {detailBusy ? <ArrowsClockwise size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
            预检
          </Button>
        </div>
      </div>

      <div className="px-5 py-6 md:px-8">
        <ChannelDetailSummaryPanel summary={detailSummary} />

        <div className="grid gap-4 md:grid-cols-4">
          <MetricTile label="任务" value={`${channel.runningTaskCount}/${channel.taskCount}`} />
          <MetricTile label="映射" value={`v${channel.mappingVersion}`} />
          <MetricTile label="运行" value={channel.lastRunStatus ? taskRunStatusText(channel.lastRunStatus) : "-"} />
          <MetricTile label="更新" value={formatDate(channel.updatedAt)} />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-line pb-4">
          {(["overview", "mappings", "tasks", "runs", "logs", "diffs"] as ChannelDetailTab[]).map((tab) => (
            <Button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cx(
                "rounded-lg px-4 py-2 text-sm font-medium transition",
                activeTab === tab ? "bg-accent text-white" : "text-slate-600 hover:bg-slate-50"
              )}
            >
              {channelTabText(tab)}
            </Button>
          ))}
        </div>

        {detailLoading ? (
          <ShellSkeleton />
        ) : activeTab === "overview" ? (
          <ChannelOverview
            source={source}
            target={target}
            tasks={tasks}
            runs={runs}
            logs={logs}
            precheck={precheck}
          />
        ) : activeTab === "mappings" ? (
          <ChannelMappingsEditor
            draft={mappingDraft}
            busy={detailBusy}
            canManage={canManage}
            onChange={setMappingDraft}
            onSave={() => void saveMappings()}
          />
        ) : activeTab === "tasks" ? (
          <ChannelTasksPanel
            tasks={tasks}
            newTask={newTask}
            busy={detailBusy}
            canManage={canManage}
            canOperate={canOperate}
            onNewTaskChange={setNewTask}
            onCreateTask={(event) => void createTask(event)}
            onTaskAction={(task, action) => void runTaskAction(task, action)}
            onDeleteTask={(task) => void deleteTask(task)}
          />
        ) : activeTab === "runs" ? (
          <ChannelRunsPanel runs={runs} tasks={tasks} />
        ) : activeTab === "logs" ? (
          <ChannelLogsPanel logs={logs} tasks={tasks} runs={runs} filters={logFilters} onFiltersChange={setLogFilters} />
        ) : (
          <ChannelDiffsPanel diffs={diffs} tasks={tasks} runs={runs} />
        )}
      </div>
    </section>
  );
}

function ChannelOverview({
  source,
  target,
  tasks,
  runs,
  logs,
  precheck
}: {
  source?: Datasource;
  target?: Datasource;
  tasks: ChannelTask[];
  runs: TaskRun[];
  logs: TaskLog[];
  precheck: ChannelPrecheckResult | null;
}) {
  const latestError = logs.find((log) => log.level === "error");
  return (
    <div className="grid gap-5 pt-5 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="grid gap-4">
        <SectionHeader title="链路" />
        <div className="surface p-4">
          <div className="grid gap-3 text-sm">
            <OverviewRow label="源端" value={source ? `${source.name} · ${source.host}:${source.port}` : "-"} />
            <OverviewRow label="目标端" value={target ? `${target.name} · ${target.host}:${target.port}` : "-"} />
            <OverviewRow label="任务" value={`${tasks.length}`} />
            <OverviewRow label="运行" value={`${runs.length}`} />
          </div>
        </div>
        {latestError && (
          <div className="border-l-4 border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {latestError.message}
          </div>
        )}
      </div>
      <div className="grid gap-4">
        <SectionHeader title="预检" />
        {precheck ? (
          <div className="grid gap-3">
            {precheck.items.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-white px-4 py-3 shadow-none">
                <div>
                  <div className="font-medium text-coal">{item.label}</div>
                  <div className="mt-1 text-sm text-slate-500">{item.message}</div>
                </div>
                <Badge tone={channelPrecheckSeverityTone(item)}>{channelPrecheckSeverityText(item)}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className="border-y border-dashed border-line bg-slate-50/60 px-4 py-6 text-sm text-slate-500">未预检</div>
        )}
      </div>
    </div>
  );
}

function ChannelDetailSummaryPanel({ summary }: { summary: ChannelDetailSummary }) {
  return (
    <div className="mb-4 grid gap-4 md:grid-cols-4">
      <ChannelDetailSummaryTile label="健康" value={summary.healthLabel} tone={summary.healthTone} detail={summary.healthDetail} />
      <ChannelDetailSummaryTile label="启动" value={summary.startLabel} tone={summary.startTone} detail={summary.startDetail} />
      <ChannelDetailSummaryTile label="最近" value={summary.latestRunLabel} tone={summary.latestRunTone} detail={summary.latestRunDetail} />
      <ChannelDetailSummaryTile label="下一步" value={summary.nextAction} tone={summary.nextTone} detail={summary.nextDetail} />
    </div>
  );
}

function ChannelDetailSummaryTile({
  label,
  value,
  tone,
  detail
}: {
  label: string;
  value: string;
  tone: BadgeTone;
  detail: string;
}) {
  return (
    <div className="surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-slate-500">{label}</div>
        <Badge tone={tone}>{value}</Badge>
      </div>
      <div className="mt-3 truncate text-sm font-medium text-coal" title={detail}>{detail}</div>
    </div>
  );
}

function ChannelMappingsEditor({
  draft,
  busy,
  canManage,
  onChange,
  onSave
}: {
  draft: ChannelTableMappingDraft[];
  busy: boolean;
  canManage: boolean;
  onChange: (draft: ChannelTableMappingDraft[]) => void;
  onSave: () => void;
}) {
  const addTable = () => {
    onChange([
      ...draft,
      {
        localId: newLocalId(),
        sourceSchema: "",
        sourceTable: "",
        targetSchema: "",
        targetTable: "",
        primaryKeys: [],
        primaryKeysText: "",
        enabled: true,
        columns: [emptyColumnDraft()]
      }
    ]);
  };

  const updateTable = (index: number, patch: Partial<ChannelTableMappingDraft>) => {
    onChange(draft.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const removeTable = (index: number) => {
    onChange(draft.filter((_, itemIndex) => itemIndex !== index));
  };

  const updateColumn = (tableIndex: number, columnIndex: number, patch: Partial<ChannelColumnMappingDraft>) => {
    onChange(draft.map((table, currentTableIndex) => {
      if (currentTableIndex !== tableIndex) return table;
      return {
        ...table,
        columns: table.columns.map((column, currentColumnIndex) => currentColumnIndex === columnIndex ? { ...column, ...patch } : column)
      };
    }));
  };

  const addColumn = (tableIndex: number) => {
    onChange(draft.map((table, currentTableIndex) => currentTableIndex === tableIndex ? { ...table, columns: [...table.columns, emptyColumnDraft()] } : table));
  };

  const removeColumn = (tableIndex: number, columnIndex: number) => {
    onChange(draft.map((table, currentTableIndex) => currentTableIndex === tableIndex ? { ...table, columns: table.columns.filter((_, currentColumnIndex) => currentColumnIndex !== columnIndex) } : table));
  };

  return (
    <div className="pt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeader title="映射" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={addTable} disabled={!canManage || busy} className="btn-secondary">
            <Plus size={16} />
            表
          </Button>
          <Button type="button" onClick={onSave} disabled={!canManage || busy} className="btn-primary">
            {busy ? <ArrowsClockwise size={16} className="animate-spin" /> : <CheckCircle size={16} />}
            保存
          </Button>
        </div>
      </div>
      <div className="mt-5 grid gap-5">
        {draft.length === 0 ? (
          <EmptyPanel icon={Database} title="暂无映射" action={canManage ? (
            <Button type="button" onClick={addTable} className="btn-primary">
              <Plus size={16} />
              添加表
            </Button>
          ) : undefined} />
        ) : draft.map((table, tableIndex) => (
          <div key={table.localId} className="surface p-4">
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]">
              <TextInput className="input" placeholder="源库" disabled={!canManage} value={table.sourceSchema || ""} onChange={(event) => updateTable(tableIndex, { sourceSchema: event.target.value })} />
              <TextInput className="input" placeholder="源表" disabled={!canManage} value={table.sourceTable} onChange={(event) => updateTable(tableIndex, { sourceTable: event.target.value })} />
              <TextInput className="input" placeholder="目标库" disabled={!canManage} value={table.targetSchema || ""} onChange={(event) => updateTable(tableIndex, { targetSchema: event.target.value })} />
              <TextInput className="input" placeholder="目标表" disabled={!canManage} value={table.targetTable} onChange={(event) => updateTable(tableIndex, { targetTable: event.target.value })} />
              <TextInput className="input" placeholder="主键" disabled={!canManage} value={table.primaryKeysText} onChange={(event) => updateTable(tableIndex, { primaryKeysText: event.target.value })} />
              <IconActionButton label="删除表" tone="danger" disabled={!canManage} onClick={() => removeTable(tableIndex)}>
                <Trash size={18} />
              </IconActionButton>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[820px] table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[150px]" />
                  <col className="w-[120px]" />
                  <col className="w-[150px]" />
                  <col className="w-[120px]" />
                  <col className="w-[90px]" />
                  <col className="w-[90px]" />
                  <col className="w-[80px]" />
                </colgroup>
                <thead className="text-xs font-semibold text-slate-500">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-3">源列</th>
                    <th className="py-2 pr-3">源类型</th>
                    <th className="py-2 pr-3">目标列</th>
                    <th className="py-2 pr-3">目标类型</th>
                    <th className="py-2 pr-3">主键</th>
                    <th className="py-2 pr-3">可空</th>
                    <th className="py-2 pr-3">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {table.columns.map((column, columnIndex) => (
                    <tr key={column.localId}>
                      <td className="py-2 pr-3"><TextInput className="input h-10" disabled={!canManage} value={column.sourceColumn} onChange={(event) => updateColumn(tableIndex, columnIndex, { sourceColumn: event.target.value })} /></td>
                      <td className="py-2 pr-3"><TextInput className="input h-10" disabled={!canManage} value={column.sourceType || ""} onChange={(event) => updateColumn(tableIndex, columnIndex, { sourceType: event.target.value })} /></td>
                      <td className="py-2 pr-3"><TextInput className="input h-10" disabled={!canManage} value={column.targetColumn} onChange={(event) => updateColumn(tableIndex, columnIndex, { targetColumn: event.target.value })} /></td>
                      <td className="py-2 pr-3"><TextInput className="input h-10" disabled={!canManage} value={column.targetType || ""} onChange={(event) => updateColumn(tableIndex, columnIndex, { targetType: event.target.value })} /></td>
                      <td className="py-2 pr-3"><CheckboxInput disabled={!canManage} checked={Boolean(column.isPrimaryKey)} onChange={(event) => updateColumn(tableIndex, columnIndex, { isPrimaryKey: event.target.checked })} /></td>
                      <td className="py-2 pr-3"><CheckboxInput disabled={!canManage} checked={Boolean(column.nullable)} onChange={(event) => updateColumn(tableIndex, columnIndex, { nullable: event.target.checked })} /></td>
                      <td className="py-2 pr-3">
                        <IconActionButton label="删除列" tone="danger" disabled={!canManage} onClick={() => removeColumn(tableIndex, columnIndex)}>
                          <Trash size={18} />
                        </IconActionButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button type="button" onClick={() => addColumn(tableIndex)} disabled={!canManage} className="btn-secondary mt-3">
              <Plus size={16} />
              列
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelTasksPanel({
  tasks,
  newTask,
  busy,
  canManage,
  canOperate,
  onNewTaskChange,
  onCreateTask,
  onTaskAction,
  onDeleteTask
}: {
  tasks: ChannelTask[];
  newTask: ChannelTaskInput;
  busy: boolean;
  canManage: boolean;
  canOperate: boolean;
  onNewTaskChange: (task: ChannelTaskInput) => void;
  onCreateTask: (event: FormEvent) => void;
  onTaskAction: (task: ChannelTask, action: "start" | "stop" | "rerun") => void;
  onDeleteTask: (task: ChannelTask) => void;
}) {
  return (
    <div className="pt-5">
      <SectionHeader title="任务" />
      <form onSubmit={onCreateTask} className="mt-4 grid gap-3 rounded-lg border border-line bg-slate-50/60 p-4 md:grid-cols-[minmax(0,1fr)_220px_auto]">
        <TextInput className="input" value={newTask.name} disabled={!canManage || busy} placeholder="任务名称" onChange={(event) => onNewTaskChange({ ...newTask, name: event.target.value })} />
        <DropdownSelect value={newTask.type} ariaLabel="任务类型" disabled={!canManage || busy} options={channelTaskTypeOptions()} onChange={(type) => onNewTaskChange({ ...newTask, type: type as ChannelTaskType })} />
        <Button type="submit" disabled={!canManage || busy || !newTask.name.trim()} className="btn-primary">
          <Plus size={16} />
          新增
        </Button>
      </form>
      <div className="mt-5 table-shell">
        <table className="w-full min-w-[840px] table-fixed text-left">
          <colgroup>
            <col className="w-[220px]" />
            <col className="w-[150px]" />
            <col className="w-[130px]" />
            <col className="w-[90px]" />
            <col className="w-[140px]" />
            <col className="w-[250px]" />
          </colgroup>
          <thead className="bg-slate-50/70 text-sm font-semibold text-slate-500">
            <tr className="border-b border-line">
              <th className="px-5 py-4">任务</th>
              <th className="px-5 py-4">类型</th>
              <th className="px-5 py-4">状态</th>
              <th className="px-5 py-4">映射</th>
              <th className="px-5 py-4">最近运行</th>
              <th className="px-5 py-4">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {tasks.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-500">暂无任务</td></tr>
            ) : tasks.map((task) => (
              <tr key={task.id} className="hover:bg-slate-50/70">
                <td className="px-5 py-4">
                  <div className="font-semibold text-coal">{task.name}</div>
                  <div className="mt-1 truncate text-xs text-slate-500">{task.id}</div>
                </td>
                <td className="px-5 py-4 text-sm text-coal">{channelTaskTypeText(task.type)}</td>
                <td className="px-5 py-4"><ChannelTaskStatusBadge status={task.status} /></td>
                <td className="px-5 py-4 text-sm text-slate-600">v{task.mappingVersion}</td>
                <td className="px-5 py-4 text-sm text-slate-600">{task.lastRunStatus ? taskRunStatusText(task.lastRunStatus) : "-"}</td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Button type="button" onClick={() => onTaskAction(task, task.status === "running" ? "stop" : "start")} disabled={!canOperate || busy} className="btn-secondary h-9 px-3">
                      {task.status === "running" ? "停止" : "启动"}
                    </Button>
                    <Button type="button" onClick={() => onTaskAction(task, "rerun")} disabled={!canOperate || busy || task.status === "running"} className="btn-secondary h-9 px-3">
                      重跑
                    </Button>
                    {canManage && (
                      <IconActionButton label="删除" tone="danger" disabled={busy || task.status === "running"} onClick={() => onDeleteTask(task)}>
                        <Trash size={18} />
                      </IconActionButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChannelRunsPanel({ runs, tasks }: { runs: TaskRun[]; tasks: ChannelTask[] }) {
  return (
    <div className="pt-5">
      <SectionHeader title="运行" />
      <div className="mt-5 table-shell">
        <table className="w-full min-w-[1110px] table-fixed text-left">
          <colgroup>
            <col className="w-[200px]" />
            <col className="w-[180px]" />
            <col className="w-[150px]" />
            <col className="w-[110px]" />
            <col className="w-[160px]" />
            <col className="w-[160px]" />
            <col className="w-[90px]" />
            <col className="w-[90px]" />
            <col className="w-[90px]" />
          </colgroup>
          <thead className="bg-slate-50/70 text-sm font-semibold text-slate-500">
            <tr className="border-b border-line">
              <th className="px-5 py-4">Run</th>
              <th className="px-5 py-4">任务</th>
              <th className="px-5 py-4">节点</th>
              <th className="px-5 py-4">状态</th>
              <th className="px-5 py-4">开始</th>
              <th className="px-5 py-4">结束</th>
              <th className="px-5 py-4">读</th>
              <th className="px-5 py-4">写</th>
              <th className="px-5 py-4">差异</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {runs.length === 0 ? (
              <tr><td colSpan={9} className="px-5 py-12 text-center text-sm text-slate-500">暂无运行</td></tr>
            ) : runs.map((run) => (
              <tr key={run.id}>
                <td className="px-5 py-4 font-mono text-xs text-slate-600">{run.id}</td>
                <td className="px-5 py-4 text-sm text-coal">{tasks.find((task) => task.id === run.taskId)?.name || channelTaskTypeText(run.taskType)}</td>
                <td className="px-5 py-4">
                  <div className="truncate text-sm font-medium text-coal">{run.runNodeName || run.runNodeId || "-"}</div>
                  {run.runNodeId && <div className="mt-1 truncate font-mono text-xs text-slate-500">{run.runNodeId}</div>}
                </td>
                <td className="px-5 py-4"><Badge tone={run.status === "success" ? "green" : run.status === "running" ? "blue" : run.status === "failed" ? "red" : "neutral"}>{taskRunStatusText(run.status)}</Badge></td>
                <td className="px-5 py-4 text-sm text-slate-600">{formatDate(run.startedAt)}</td>
                <td className="px-5 py-4 text-sm text-slate-600">{run.finishedAt ? formatDate(run.finishedAt) : "-"}</td>
                <td className="px-5 py-4 text-sm text-slate-600">{run.readRows}</td>
                <td className="px-5 py-4 text-sm text-slate-600">{run.writtenRows}</td>
                <td className="px-5 py-4 text-sm text-slate-600">{run.diffRows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChannelLogsPanel({
  logs,
  tasks,
  runs,
  filters,
  onFiltersChange
}: {
  logs: TaskLog[];
  tasks: ChannelTask[];
  runs: TaskRun[];
  filters: ChannelLogFilters;
  onFiltersChange: (filters: ChannelLogFilters) => void;
}) {
  const taskOptions = [
    { value: "", label: "全部任务" },
    ...tasks.map((task) => ({ value: task.id, label: task.name, description: channelTaskTypeText(task.type) }))
  ];
  const visibleRuns = filters.taskId ? runs.filter((run) => run.taskId === filters.taskId) : runs;
  const runOptions = [
    { value: "", label: "全部 Run" },
    ...visibleRuns.map((run) => ({
      value: run.id,
      label: run.id.slice(0, 8),
      description: tasks.find((task) => task.id === run.taskId)?.name || channelTaskTypeText(run.taskType)
    }))
  ];
  const levelOptions = [
    { value: "", label: "全部级别" },
    { value: "info", label: "info" },
    { value: "warn", label: "warn" },
    { value: "error", label: "error" }
  ];
  const updateTaskFilter = (taskId: string) => {
    const runStillVisible = !filters.runId || runs.some((run) => run.id === filters.runId && (!taskId || run.taskId === taskId));
    onFiltersChange({ ...filters, taskId, runId: runStillVisible ? filters.runId : "" });
  };

  return (
    <div className="pt-5">
      <SectionHeader title="日志" />
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <DropdownSelect value={filters.taskId} ariaLabel="日志任务" className="w-[180px]" options={taskOptions} showSelectedDescription={false} onChange={updateTaskFilter} />
        <DropdownSelect value={filters.runId} ariaLabel="日志 Run" className="w-[160px]" options={runOptions} showSelectedDescription={false} onChange={(runId) => onFiltersChange({ ...filters, runId })} />
        <DropdownSelect value={filters.level} ariaLabel="日志级别" className="w-[140px]" options={levelOptions} showSelectedDescription={false} onChange={(level) => onFiltersChange({ ...filters, level: level as ChannelLogFilters["level"] })} />
      </div>
      <div className="mt-4 log-console">
        {logs.length === 0 ? (
          <div className="px-5 py-12 text-center font-mono text-sm text-slate-400">暂无日志</div>
        ) : logs.map((log) => (
          <div key={log.id} className="log-line">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <span className={cx("min-w-0 break-all", log.level === "error" && "text-red-300", log.level === "warn" && "text-amber-300", log.level === "info" && "text-blue-100")}>
                [{formatDateTime(log.createdAt)}][{log.level}][{log.thread}]{log.message}
              </span>
              <span className="shrink-0 font-sans text-[11px] text-slate-500">
                {tasks.find((task) => task.id === log.taskId)?.name || log.taskId || "-"} · {log.runId ? log.runId.slice(0, 8) : "-"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelDiffsPanel({
  diffs,
  tasks,
  runs
}: {
  diffs: DataValidationDiff[];
  tasks: ChannelTask[];
  runs: TaskRun[];
}) {
  return (
    <div className="pt-5">
      <SectionHeader title="差异" />
      <div className="mt-5 table-shell">
        <table className="w-full min-w-[1200px] table-fixed text-left">
          <colgroup>
            <col className="w-[180px]" />
            <col className="w-[180px]" />
            <col className="w-[170px]" />
            <col className="w-[210px]" />
            <col className="w-[140px]" />
            <col className="w-[150px]" />
            <col className="w-[210px]" />
          </colgroup>
          <thead className="bg-slate-50/70 text-sm font-semibold text-slate-500">
            <tr className="border-b border-line">
              <th className="px-5 py-4">源表</th>
              <th className="px-5 py-4">目标表</th>
              <th className="px-5 py-4">主键</th>
              <th className="px-5 py-4">差异列</th>
              <th className="px-5 py-4">类型</th>
              <th className="px-5 py-4">订正</th>
              <th className="px-5 py-4">来源</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {diffs.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-500">暂无差异</td></tr>
            ) : diffs.map((diff) => (
              <tr key={diff.id}>
                <td className="px-5 py-4 text-sm font-medium text-coal">{diff.sourceTable}</td>
                <td className="px-5 py-4 text-sm text-coal">{diff.targetTable}</td>
                <td className="px-5 py-4 font-mono text-xs text-slate-600" title={diff.primaryKeyJson}>{compactJSONText(diff.primaryKeyJson)}</td>
                <td className="px-5 py-4 font-mono text-xs text-slate-600" title={diff.diffColumnsJson}>{compactJSONText(diff.diffColumnsJson)}</td>
                <td className="px-5 py-4"><Badge tone="yellow">{dataValidationDiffTypeText(diff.diffType)}</Badge></td>
                <td className="px-5 py-4"><Badge tone={diff.correctionStatus === "corrected" ? "green" : "neutral"}>{dataValidationCorrectionStatusText(diff.correctionStatus)}</Badge></td>
                <td className="px-5 py-4 text-xs text-slate-500">
                  <div className="truncate">{tasks.find((task) => task.id === diff.validationTaskId)?.name || "数据校验"}</div>
                  <div className="mt-1 truncate font-mono">{runs.find((run) => run.id === diff.validationRunId)?.id || diff.validationRunId}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DatasourceEndpointLabel({ datasource, fallback }: { datasource?: Datasource; fallback: string }) {
  if (!datasource) {
    return <span className="block truncate text-sm text-slate-400">{fallback}</span>;
  }
  return (
    <span className="block min-w-0">
      <span className="block truncate text-sm font-semibold text-coal">{datasource.name}</span>
      <span className="mt-1 block truncate font-mono text-xs text-slate-500">{datasource.host}:{datasource.port}</span>
    </span>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface p-4">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="mt-2 truncate text-2xl font-semibold text-coal">{value}</div>
    </div>
  );
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className="truncate text-right font-medium text-coal">{value}</span>
    </div>
  );
}

function ArchiveIcon() {
  return <Archive size={18} />;
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
  const [draftTypeFilter, setDraftTypeFilter] = useState<DatasourceTypeFilter>("all");
  const [draftNameQuery, setDraftNameQuery] = useState("");
  const [appliedTypeFilter, setAppliedTypeFilter] = useState<DatasourceTypeFilter>("all");
  const [appliedNameQuery, setAppliedNameQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(1);
  const pageSize = 10;
  const [jumpPageDraft, setJumpPageDraft] = useState("1");
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
    const searchableText = [
      item.name,
      item.id,
      item.host,
      String(item.port),
      item.version,
      item.defaultSchema,
      item.remark,
      datasourceTypeText(item.type),
      datasourceStatusText(item.connectionStatus)
    ].filter(Boolean).join(" ").toLowerCase();
    const matchesName = query === "" || searchableText.includes(query);
    return matchesType && matchesName;
  }), [appliedNameQuery, appliedTypeFilter, datasources]);

  const totalItems = filteredDatasources.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = clampPage(pageIndex, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = filteredDatasources.slice(pageStart, pageStart + pageSize);
  const tableBusy = querying;
  const pageNumbers = useMemo(() => paginationRange(currentPage, totalPages), [currentPage, totalPages]);

  useEffect(() => {
    setPageIndex((current) => clampPage(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setJumpPageDraft(String(currentPage));
  }, [currentPage]);

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

  const commitJumpPage = () => {
    if (!jumpPageDraft.trim()) {
      setJumpPageDraft(String(currentPage));
      return;
    }
    const nextPage = clampPage(Number(jumpPageDraft), totalPages);
    setPageIndex(nextPage);
    setJumpPageDraft(String(nextPage));
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
      description: "",
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
        <div className="page-titlebar">
          <h1 className="text-2xl font-semibold text-coal md:text-3xl">数据源</h1>
        </div>

        <div className="px-5 py-6 md:px-8">
          <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="w-full sm:w-[174px]">
                <DropdownSelect
                  value={draftTypeFilter}
                  disabled={tableBusy}
                  ariaLabel="类型"
                  options={[
                    { value: "all", label: "全部类型" },
                    { value: "mysql", label: "MySQL" }
                  ]}
                  onChange={(nextValue) => setDraftTypeFilter(nextValue as DatasourceTypeFilter)}
                  className="h-12 min-h-12"
                />
              </div>
              <label className="relative block w-full sm:w-[344px]">
                <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <TextInput
                  className="input h-12 pl-11"
                  value={draftNameQuery}
                  disabled={tableBusy}
                  placeholder="搜索名称、地址、数据源类型"
                  onChange={(event) => setDraftNameQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void runQuery();
                    }
                  }}
                />
              </label>
              <Button type="button" onClick={() => void runQuery()} disabled={tableBusy} className="btn-primary h-12 min-w-[108px]">
                {querying ? <ArrowsClockwise size={16} className="animate-spin" /> : <MagnifyingGlass size={16} />}
                查询
              </Button>
            </div>

            {canManage ? (
              <Button type="button" onClick={onCreate} className="btn-primary h-12 min-w-[146px] px-4">
                <Plus size={18} />
                新增数据源
              </Button>
            ) : (
              <div title="权限不足">
                <Button type="button" disabled className="btn-secondary h-12 min-w-[146px] px-4">
                  <Plus size={18} />
                  新增数据源
                </Button>
              </div>
            )}
          </div>

          <div className="table-shell">
            <table className="w-full min-w-[917px] table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-[240px]" />
                <col className="w-[110px]" />
                <col className="w-[165px]" />
                <col className="w-[135px]" />
                <col className="w-[115px]" />
                <col className="w-[152px]" />
              </colgroup>
              <thead className="bg-slate-50/70 text-sm font-semibold text-slate-500">
                <tr className="border-b border-line">
                  <th className="whitespace-nowrap px-6 py-4">数据源名称</th>
                  <th className="whitespace-nowrap px-5 py-4">数据源类型</th>
                  <th className="whitespace-nowrap px-5 py-4">地址</th>
                  <th className="whitespace-nowrap px-5 py-4">版本</th>
                  <th className="whitespace-nowrap px-5 py-4">状态</th>
                  <th className="whitespace-nowrap px-5 py-4">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {pageItems.length === 0 ? (
                  <tr
                    key={`empty-${queryRevealKey}`}
                    className={cx(queryRevealKey > 0 && !tableBusy && "query-reveal-row")}
                    style={queryRevealKey > 0 && !tableBusy ? { animationDelay: "0ms" } : undefined}
                  >
                    <td colSpan={6} className="px-6 py-16">
                      <div className="mx-auto flex max-w-sm flex-col items-center text-center">
                        <div className="text-base font-semibold text-coal">
                          {datasources.length === 0 ? "暂无数据源" : "无匹配"}
                        </div>
                        {canManage && datasources.length === 0 && (
                          <Button type="button" onClick={onCreate} className="btn-primary mt-5">
                            <Plus size={16} />
                            新增数据源
                          </Button>
                        )}
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
                    <td className="px-6 py-5 align-middle">
                      <div className="flex min-w-0 items-center gap-4">
                        <DatasourceTypeIcon type={item.type} />
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold text-coal">{item.name || item.id}</div>
                          <div className="mt-1 truncate text-sm text-slate-500">{datasourceSubtitle(item)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-5 align-middle">
                      <span className="text-base text-coal">{datasourceTypeText(item.type)}</span>
                    </td>
                    <td className="px-5 py-5 align-middle">
                      <span title={`${item.host}:${item.port}`} className="block truncate font-mono text-sm text-coal">{item.host}:{item.port}</span>
                    </td>
                    <td className="px-5 py-5 align-middle">
                      <span title={item.version?.trim() || "-"} className="block truncate font-mono text-sm text-coal">{item.version?.trim() || "-"}</span>
                    </td>
                    <td className="px-5 py-5 align-middle">
                      <DatasourceStatusBadge status={item.connectionStatus} />
                    </td>
                    <td className="px-5 py-5 align-middle">
                      <div className="flex items-center justify-start gap-2">
                        {canManage && (
                          <IconActionButton label="编辑" onClick={() => onEdit(item.id)}>
                            <PencilSimple size={18} />
                          </IconActionButton>
                        )}
                        {canTest && (
                          <IconActionButton
                            label={testingSavedId === item.id ? "测试中" : "测试连接"}
                            onClick={() => openTestDialog(item)}
                            disabled={testingSavedId === item.id}
                          >
                            {testingSavedId === item.id ? <ArrowsClockwise size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                          </IconActionButton>
                        )}
                        {canManage && (
                          <IconActionButton label="删除" tone="danger" onClick={() => requestRemoveDatasource(item)}>
                            <Trash size={18} />
                          </IconActionButton>
                        )}
                        {!canTest && !canManage && <span className="text-sm text-slate-400">-</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex flex-col gap-3 text-sm text-slate-600 lg:flex-row lg:items-center lg:justify-between">
            <div>共 {totalItems} 条</div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <PaginationButton label="上一页" disabled={currentPage <= 1 || tableBusy} onClick={() => goToPage(currentPage - 1)}>
                <CaretLeft size={16} />
              </PaginationButton>
              {pageNumbers.map((pageNumber) => (
                <Button
                  key={pageNumber}
                  type="button"
                  onClick={() => goToPage(pageNumber)}
                  disabled={tableBusy}
                  className={cx(
                    "inline-flex h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45",
                    currentPage === pageNumber
                      ? "border-accent bg-accent text-white shadow-raised"
                      : "border-line bg-white text-coal hover:border-blue-200 hover:bg-blue-50 hover:text-accent"
                  )}
                >
                  {pageNumber}
                </Button>
              ))}
              <PaginationButton label="下一页" disabled={currentPage >= totalPages || tableBusy} onClick={() => goToPage(currentPage + 1)}>
                <CaretRight size={16} />
              </PaginationButton>
              <span className="ml-2 text-slate-500">前往</span>
              <TextInput
                aria-label="页码"
                inputMode="numeric"
                value={jumpPageDraft}
                disabled={tableBusy}
                onChange={(event) => setJumpPageDraft(event.target.value.replace(/\D/g, "").slice(0, 4))}
                onBlur={commitJumpPage}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitJumpPage();
                  }
                }}
                className="input h-10 w-16 px-3 py-2 text-center"
              />
              <span className="text-slate-500">页</span>
            </div>
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

function useDatasourceTestNodeSelection(cluster: ClusterSnapshot | null) {
  const availableNodes = useMemo(() => (cluster?.nodes ?? []).filter((node) => node.status === "online"), [cluster?.nodes]);
  const nodesLoading = cluster === null;
  const defaultNodeId = useMemo(() => {
    const localNode = availableNodes.find((node) => node.id === cluster?.localNodeId);
    return localNode?.id ?? availableNodes[0]?.id ?? "";
  }, [availableNodes, cluster?.localNodeId]);
  const [selectedNodeId, setSelectedNodeId] = useState(defaultNodeId);

  useEffect(() => {
    if (nodesLoading) return;
    setSelectedNodeId((current) => availableNodes.some((node) => node.id === current) ? current : defaultNodeId);
  }, [availableNodes, defaultNodeId, nodesLoading]);

  const selectedValue = availableNodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : "";
  return {
    selectedNodeId: selectedValue,
    setSelectedNodeId,
    nodeOptions: datasourceTestNodeOptions(availableNodes, nodesLoading, true),
    nodesLoading,
    hasNodes: availableNodes.length > 0
  };
}

function datasourceTestNodeOptions(nodes: ClusterNode[], loading: boolean, showHost = false) {
  if (loading) {
    return [{ value: "", label: "加载中", disabled: true }];
  }
  if (nodes.length === 0) {
    return [{ value: "", label: "无节点", disabled: true }];
  }
  return nodes.map((node) => ({
    value: node.id,
    label: node.name || node.id,
    description: showHost ? node.endpoint : undefined,
    icon: <HardDrives size={18} />
  }));
}

function datasourceTestFingerprint(connectionFingerprint: string, nodeId: string) {
  return `${connectionFingerprint}::node:${nodeId}`;
}

function DatasourceCreatePage({
  datasources,
  cluster,
  canManage,
  onBack,
  onChanged,
  pushNotice
}: {
  datasources: Datasource[];
  cluster: ClusterSnapshot | null;
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
  const testNodeSelection = useDatasourceTestNodeSelection(cluster);
  const {
    selectedNodeId: selectedTestNodeId,
    setSelectedNodeId: setSelectedTestNodeId,
    nodeOptions: testNodeOptions,
    nodesLoading,
    hasNodes
  } = testNodeSelection;

  const hasTypes = datasourceTypeOptions.length > 0;
  const connectionFingerprint = selectedType ? datasourceFormConnectionFingerprint(form) : "";
  const currentFingerprint = selectedType && selectedTestNodeId ? datasourceTestFingerprint(connectionFingerprint, selectedTestNodeId) : "";
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
        : !selectedTestNodeId
          ? "无节点"
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

  const updateTestNode = (nodeId: string) => {
    setSelectedTestNodeId(nodeId);
    setTestedFingerprint(null);
    setTestResult(null);
  };

  const testConnection = async () => {
    if (!selectedType) {
      pushNotice({ tone: "warning", message: "请选择类型" });
      return;
    }
    if (!selectedTestNodeId) {
      pushNotice({ tone: "warning", message: nodesLoading ? "节点加载中" : "无节点" });
      return;
    }
    if (validateDatasourceForm(form, true)) {
      setShowFieldErrors(true);
      return;
    }
    const fingerprint = datasourceTestFingerprint(datasourceFormConnectionFingerprint(form), selectedTestNodeId);
    setTesting(true);
    try {
      const result = await api.testDatasourceInput({ ...datasourceFormPayload(form), nodeId: selectedTestNodeId });
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
      <section>
        <div className="page-titlebar justify-between gap-4">
          <h1 className="text-2xl font-semibold text-coal md:text-3xl">新增数据源</h1>
          <Button type="button" onClick={onBack} className="btn-secondary">
            <ArrowRight size={14} className="rotate-180" />
            返回
          </Button>
        </div>
        <div className="p-5 md:p-6">
          <PermissionNotice description="权限不足" />
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={saveDatasource}>
      <section className="overflow-hidden">
        <div className="page-titlebar justify-between gap-4">
          <h1 className="truncate text-2xl font-semibold text-coal md:text-3xl">新增数据源</h1>
          <Button type="button" onClick={requestBack} className="btn-secondary">
            <ArrowRight size={14} className="rotate-180" />
            返回
          </Button>
        </div>

        <div className="p-5 md:p-6">
          {hasTypes ? (
            <div role="radiogroup" aria-label="数据源类型" className="grid grid-cols-[repeat(auto-fit,minmax(160px,180px))] gap-3">
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
                        ? "border-accent bg-blue-50 text-accent shadow-none"
                        : "border-line hover:border-blue-200 hover:bg-blue-50"
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
              <DropdownSelect
                value={selectedTestNodeId}
                ariaLabel="测试节点"
                disabled={testing || nodesLoading || !hasNodes}
                options={testNodeOptions}
                onChange={updateTestNode}
                showSelectedDescription={false}
                className="h-10 min-h-10 w-full sm:w-[220px]"
              />
              <Button type="button" onClick={() => void testConnection()} disabled={testing || nodesLoading || !selectedTestNodeId} className="btn-secondary">
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
  cluster,
  canManage,
  onBack,
  onChanged,
  pushNotice
}: {
  datasourceId: string | null;
  datasources: Datasource[];
  cluster: ClusterSnapshot | null;
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
  const testNodeSelection = useDatasourceTestNodeSelection(cluster);
  const {
    selectedNodeId: selectedTestNodeId,
    setSelectedNodeId: setSelectedTestNodeId,
    nodeOptions: testNodeOptions,
    nodesLoading,
    hasNodes
  } = testNodeSelection;

  const connectionFingerprint = datasource ? datasourceFormConnectionFingerprint(form) : "";
  const currentFingerprint = datasource && selectedTestNodeId ? datasourceTestFingerprint(connectionFingerprint, selectedTestNodeId) : "";
  const connectionChanged = datasource ? connectionFingerprint !== initialConnectionFingerprint : false;
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
        : needsFreshTest && !selectedTestNodeId
          ? "无节点"
          : needsFreshTest && !freshTestResult?.success
            ? "请先测试"
            : null;
  const dirty = datasource ? isDatasourceFormDirty(form, initialForm) || Boolean(testResult) : false;
  const datasourceTypeLabel = datasourceTypeOptions.find((option) => option.value === form.type)?.label ?? form.type;

  const updateAuthType = (authType: DatasourceAuthType) => {
    setForm(authType === "none" ? { ...form, authType, username: "", password: "" } : { ...form, authType });
  };

  const updateTestNode = (nodeId: string) => {
    setSelectedTestNodeId(nodeId);
    setTestedFingerprint(null);
    setTestResult(null);
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
    if (!selectedTestNodeId) {
      pushNotice({ tone: "warning", message: nodesLoading ? "节点加载中" : "无节点" });
      return;
    }
    if (validateDatasourceForm(form, passwordRequired)) {
      setShowFieldErrors(true);
      return;
    }
    const fingerprint = datasourceTestFingerprint(datasourceFormConnectionFingerprint(form), selectedTestNodeId);
    setTesting(true);
    try {
      const result = await api.testDatasourceInput({ ...datasourceFormPayload(form, datasource.id), nodeId: selectedTestNodeId });
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
      <section>
        <div className="page-titlebar justify-between gap-4">
          <h1 className="text-2xl font-semibold text-coal md:text-3xl">编辑数据源</h1>
          <Button type="button" onClick={onBack} className="btn-secondary">
            <ArrowRight size={14} className="rotate-180" />
            返回
          </Button>
        </div>
        <div className="p-5 md:p-6">
          <PermissionNotice description="权限不足" />
        </div>
      </section>
    );
  }

  if (!datasource) {
    return (
      <section>
        <div className="page-titlebar justify-between gap-4">
          <h1 className="text-2xl font-semibold text-coal md:text-3xl">编辑数据源</h1>
          <Button type="button" onClick={onBack} className="btn-secondary">
            <ArrowRight size={14} className="rotate-180" />
            返回
          </Button>
        </div>
        <div className="p-5 md:p-6">
          <EmptyPanel icon={Database} title="不存在" />
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={saveDatasource}>
      <section className="overflow-hidden">
        <div className="page-titlebar justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <h1 className="shrink-0 text-2xl font-semibold text-coal md:text-3xl">编辑数据源</h1>
            <span className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-line bg-slate-50 px-2.5 py-1.5 text-sm font-medium text-coal">
              <DatasourceTypeLogo type={form.type} className="h-5 w-5 shrink-0" />
              <span className="truncate">{datasourceTypeLabel}</span>
            </span>
          </div>
          <Button type="button" onClick={requestBack} className="btn-secondary">
            <ArrowRight size={14} className="rotate-180" />
            返回
          </Button>
        </div>

        <div className="p-5 md:p-6">
          <div className="grid gap-4">
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
            <DropdownSelect
              value={selectedTestNodeId}
              ariaLabel="测试节点"
              disabled={testing || nodesLoading || !hasNodes}
              options={testNodeOptions}
              onChange={updateTestNode}
              showSelectedDescription={false}
              className="h-10 min-h-10 w-full sm:w-[220px]"
            />
            <Button type="button" onClick={() => void testConnection()} disabled={testing || nodesLoading || !selectedTestNodeId} className="btn-secondary">
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
  const nodeOptions = datasourceTestNodeOptions(nodes, loading, true);
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
  const [draftTypeFilter, setDraftTypeFilter] = useState<NodeTypeFilter>("all");
  const [draftNameQuery, setDraftNameQuery] = useState("");
  const [appliedTypeFilter, setAppliedTypeFilter] = useState<NodeTypeFilter>("all");
  const [appliedNameQuery, setAppliedNameQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(1);
  const pageSize = 10;
  const [jumpPageDraft, setJumpPageDraft] = useState("1");
  const [querying, setQuerying] = useState(false);
  const [queryRevealKey, setQueryRevealKey] = useState(0);
  const [masterCountDialogOpen, setMasterCountDialogOpen] = useState(false);
  const [masterCountDraft, setMasterCountDraft] = useState("");
  const [masterCountSaving, setMasterCountSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationDialogState | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingNodeName, setEditingNodeName] = useState("");
  const [savingNodeNameId, setSavingNodeNameId] = useState<string | null>(null);
  const [deletingNodeId, setDeletingNodeId] = useState<string | null>(null);
  const nodeNameEditRef = useRef<HTMLDivElement | null>(null);
  const maxMasterNodeCount = nodes.length;
  const currentMasterNodeCount = nodes.filter((node) => effectiveNodeRole(node, nodes) === "master").length;
  const rawMasterNodeCount = cluster?.masterNodeCount ?? (currentMasterNodeCount || 1);
  const configuredMasterNodeCount = Math.min(
    Math.max(1, rawMasterNodeCount),
    Math.max(1, maxMasterNodeCount)
  );
  const parsedMasterCount = Number.parseInt(masterCountDraft, 10);
  const masterCountError = masterCountDialogOpen && (!Number.isInteger(parsedMasterCount) || parsedMasterCount < 1 || parsedMasterCount > maxMasterNodeCount)
    ? `1-${maxMasterNodeCount}`
    : "";
  const tableBusy = querying || masterCountSaving || Boolean(savingNodeNameId) || Boolean(deletingNodeId);

  const filteredNodes = useMemo(() => nodes.filter((node) => {
    const role = effectiveNodeRole(node, nodes);
    const matchesType = appliedTypeFilter === "all" || role === appliedTypeFilter;
    const query = appliedNameQuery.trim().toLowerCase();
    const searchableText = [
      node.name,
      node.id,
      node.endpoint,
      node.zone,
      node.version,
      nodeRoleText(role),
      nodeStatusText(node.status)
    ].filter(Boolean).join(" ").toLowerCase();
    const matchesName = query === "" || searchableText.includes(query);
    return matchesType && matchesName;
  }), [appliedNameQuery, appliedTypeFilter, nodes]);

  const totalItems = filteredNodes.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = clampPage(pageIndex, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = filteredNodes.slice(pageStart, pageStart + pageSize);
  const pageNumbers = useMemo(() => paginationRange(currentPage, totalPages), [currentPage, totalPages]);

  useEffect(() => {
    setPageIndex((current) => clampPage(current, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setJumpPageDraft(String(currentPage));
  }, [currentPage]);

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

  const commitJumpPage = () => {
    if (!jumpPageDraft.trim()) {
      setJumpPageDraft(String(currentPage));
      return;
    }
    const nextPage = clampPage(Number(jumpPageDraft), totalPages);
    setPageIndex(nextPage);
    setJumpPageDraft(String(nextPage));
  };

  const openMasterCountDialog = () => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "需要管理员权限" });
      return;
    }
    if (maxMasterNodeCount <= 0) {
      pushNotice({ tone: "warning", message: "暂无节点" });
      return;
    }
    setMasterCountDraft(String(configuredMasterNodeCount));
    setMasterCountDialogOpen(true);
  };

  const saveMasterCount = async () => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "需要管理员权限" });
      return;
    }
    if (!Number.isInteger(parsedMasterCount) || parsedMasterCount < 1 || parsedMasterCount > maxMasterNodeCount) {
      pushNotice({ tone: "warning", message: `范围 1-${maxMasterNodeCount}` });
      return;
    }
    setMasterCountSaving(true);
    try {
      await api.updateMasterNodeCount(parsedMasterCount);
      pushNotice({ tone: "success", message: "已保存" });
      setMasterCountDialogOpen(false);
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "保存失败" });
    } finally {
      setMasterCountSaving(false);
    }
  };

  const startEditNodeName = (node: ClusterNode) => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "需要管理员权限" });
      return;
    }
    setEditingNodeId(node.id);
    setEditingNodeName(node.name || node.id);
  };

  const cancelEditNodeName = useCallback(() => {
    setEditingNodeId(null);
    setEditingNodeName("");
  }, []);

  useEffect(() => {
    if (!editingNodeId || savingNodeNameId) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && nodeNameEditRef.current?.contains(target)) {
        return;
      }
      cancelEditNodeName();
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [cancelEditNodeName, editingNodeId, savingNodeNameId]);

  const saveNodeName = async (node: ClusterNode) => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "需要管理员权限" });
      return;
    }
    const nextName = editingNodeName.trim();
    if (!nextName) {
      pushNotice({ tone: "warning", message: "名称必填" });
      return;
    }
    if (Array.from(nextName).length > 50) {
      pushNotice({ tone: "warning", message: "最多 50 字符" });
      return;
    }
    if (nextName === node.name) {
      cancelEditNodeName();
      return;
    }
    setSavingNodeNameId(node.id);
    try {
      await api.updateNodeName(node.id, nextName);
      pushNotice({ tone: "success", message: "已保存" });
      cancelEditNodeName();
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "保存失败" });
    } finally {
      setSavingNodeNameId(null);
    }
  };

  const deleteNode = async (node: ClusterNode) => {
    if (!canManage) {
      pushNotice({ tone: "warning", message: "需要管理员权限" });
      return;
    }
    if (node.status === "online") {
      pushNotice({ tone: "warning", message: "在线节点不能删除" });
      return;
    }
    setDeletingNodeId(node.id);
    try {
      await api.deleteNode(node.id);
      const nextTotalPages = Math.max(1, Math.ceil(Math.max(0, filteredNodes.length - 1) / pageSize));
      setPageIndex((current) => clampPage(current, nextTotalPages));
      pushNotice({ tone: "success", message: "已删除" });
      await onChanged();
    } catch (requestError) {
      pushNotice({ tone: "error", message: requestError instanceof Error ? requestError.message : "删除失败" });
    } finally {
      setDeletingNodeId(null);
    }
  };

  const requestDeleteNode = (node: ClusterNode) => {
    if (node.status === "online") {
      pushNotice({ tone: "warning", message: "在线节点不能删除" });
      return;
    }
    setConfirmation({
      title: `删除 ${node.name || node.id}`,
      description: "",
      confirmLabel: "删除",
      confirmTone: "danger",
      onConfirm: () => {
        void deleteNode(node);
      }
    });
  };

  return (
    <>
      <section className="min-w-0 overflow-hidden">
        <div className="page-titlebar">
          <h1 className="text-2xl font-semibold text-coal md:text-3xl">节点</h1>
        </div>

        <div className="px-5 py-6 md:px-8">
          <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="w-full sm:w-[174px]">
                <DropdownSelect
                  value={draftTypeFilter}
                  disabled={tableBusy}
                  ariaLabel="节点类型"
                  options={[
                    { value: "all", label: "全部类型" },
                    { value: "master", label: "主节点" },
                    { value: "standby", label: "备用节点" }
                  ]}
                  onChange={(nextValue) => setDraftTypeFilter(nextValue as NodeTypeFilter)}
                  className="h-12 min-h-12"
                />
              </div>
              <label className="relative block w-full sm:w-[344px]">
                <MagnifyingGlass aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <TextInput
                  className="input h-12 pl-11"
                  value={draftNameQuery}
                  disabled={tableBusy}
                  placeholder="搜索节点名称、Host"
                  onChange={(event) => setDraftNameQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void runQuery();
                    }
                  }}
                />
              </label>
              <Button type="button" onClick={() => void runQuery()} disabled={tableBusy} className="btn-primary h-12 min-w-[108px]">
                {querying ? <ArrowsClockwise size={16} className="animate-spin" /> : <MagnifyingGlass size={16} />}
                查询
              </Button>
            </div>

            <div title={canManage ? undefined : "权限不足"}>
              <Button
                type="button"
                onClick={openMasterCountDialog}
                disabled={!canManage || tableBusy || maxMasterNodeCount <= 0}
                className="btn-secondary h-12 min-w-[146px] px-4"
              >
                <GearSix size={18} />
                主节点配置
              </Button>
            </div>
          </div>

          <div className="table-shell">
            <table className="w-full min-w-[976px] table-fixed border-collapse text-left">
              <colgroup>
                <col className="w-[205px]" />
                <col className="w-[95px]" />
                <col className="w-[135px]" />
                <col className="w-[85px]" />
                <col className="w-[95px]" />
                <col className="w-[110px]" />
                <col className="w-[85px]" />
                <col className="w-[166px]" />
              </colgroup>
              <thead className="bg-slate-50/70 text-sm font-semibold text-slate-500">
                <tr className="border-b border-line">
                  <th className="whitespace-nowrap px-6 py-4">节点名称</th>
                  <th className="whitespace-nowrap px-5 py-4">节点类型</th>
                  <th className="whitespace-nowrap px-5 py-4">Host</th>
                  <th className="whitespace-nowrap px-5 py-4">状态</th>
                  <th className="whitespace-nowrap px-5 py-4">运行任务数</th>
                  <th className="whitespace-nowrap px-5 py-4">最近心跳</th>
                  <th className="whitespace-nowrap px-5 py-4">版本</th>
                  <th className="whitespace-nowrap px-3 py-4">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {pageItems.length === 0 ? (
                  <tr
                    key={`empty-${queryRevealKey}`}
                    className={cx(queryRevealKey > 0 && !tableBusy && "query-reveal-row")}
                    style={queryRevealKey > 0 && !tableBusy ? { animationDelay: "0ms" } : undefined}
                  >
                    <td colSpan={8} className="px-6 py-16">
                      <div className="mx-auto flex max-w-sm flex-col items-center text-center">
                        <div className="text-base font-semibold text-coal">
                          {nodes.length === 0 ? "暂无节点" : "无匹配"}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : pageItems.map((node, index) => {
                  const nodeRole = effectiveNodeRole(node, nodes);
                  const isEditingNodeName = editingNodeId === node.id;
                  const isSavingNodeName = savingNodeNameId === node.id;
                  return (
                    <tr
                      key={`${queryRevealKey}-${node.id}`}
                      className={cx("transition hover:bg-slate-50/70", tableBusy && "opacity-70", queryRevealKey > 0 && !tableBusy && "query-reveal-row")}
                      style={queryRevealKey > 0 && !tableBusy ? { animationDelay: `${Math.min(index, 14) * 44}ms` } : undefined}
                    >
                      <td className="px-6 py-5 align-middle">
                        <div className="flex min-w-0 items-center gap-4">
                          <NodeTypeIcon status={node.status} />
                          {isEditingNodeName ? (
                            <div ref={nodeNameEditRef} className="flex min-w-0 flex-1 items-center gap-1.5">
                              <TextInput
                                className="input h-9 min-w-0 px-2.5 py-1.5 text-sm font-semibold"
                                value={editingNodeName}
                                disabled={isSavingNodeName}
                                aria-label="节点名称"
                                autoFocus
                                onFocus={(event) => event.currentTarget.select()}
                                onChange={(event) => setEditingNodeName(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void saveNodeName(node);
                                  }
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelEditNodeName();
                                  }
                                }}
                              />
                              <Button
                                type="button"
                                aria-label="保存节点名称"
                                disabled={isSavingNodeName}
                                onClick={() => void saveNodeName(node)}
                                className="btn-compact h-9 w-9 shrink-0 px-0"
                              >
                                {isSavingNodeName ? <ArrowsClockwise size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                              </Button>
                            </div>
                          ) : (
                            <Button type="button" onClick={() => onOpenNode(node.id)} className="panel-link min-w-0">
                              <span className="block truncate text-base font-semibold text-coal">{node.name || node.id}</span>
                              <span className="mt-1 block truncate text-sm text-slate-500">{node.zone || node.id}</span>
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-5 align-middle">
                        <Badge tone={nodeRoleTone(nodeRole)}>{nodeRoleText(nodeRole)}</Badge>
                      </td>
                      <td className="px-5 py-5 align-middle">
                        <span title={node.endpoint} className="block truncate font-mono text-sm text-coal">{node.endpoint}</span>
                      </td>
                      <td className="px-5 py-5 align-middle">
                        <NodeStatusBadge status={node.status} />
                      </td>
                      <td className="px-5 py-5 align-middle font-mono text-sm text-coal">{node.capacity}</td>
                      <td className="px-5 py-5 align-middle text-sm text-coal">{formatNodeHeartbeatAge(node.lastHeartbeatAt)}</td>
                      <td className="px-5 py-5 align-middle">
                        <span title={node.version?.trim() || "-"} className="block truncate font-mono text-sm text-coal">{node.version?.trim() || "-"}</span>
                      </td>
                      <td className="px-5 py-5 align-middle">
                        <div className="flex items-center justify-start gap-2">
                          <Button
                            type="button"
                            onClick={() => onOpenNode(node.id)}
                            className="btn-compact h-10 whitespace-nowrap px-3"
                          >
                            详情
                          </Button>
                          {canManage && (
                            <IconActionButton label="编辑" onClick={() => startEditNodeName(node)} disabled={tableBusy}>
                              <PencilSimple size={18} />
                            </IconActionButton>
                          )}
                          {canManage && (
                            <IconActionButton
                              label={node.status === "online" ? "在线节点不能删除" : deletingNodeId === node.id ? "删除中" : "删除"}
                              tone="danger"
                              onClick={() => requestDeleteNode(node)}
                              disabled={tableBusy || node.status === "online"}
                            >
                              {deletingNodeId === node.id ? <ArrowsClockwise size={18} className="animate-spin" /> : <Trash size={18} />}
                            </IconActionButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex flex-col gap-3 text-sm text-slate-600 lg:flex-row lg:items-center lg:justify-between">
            <div>共 {totalItems} 条</div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <PaginationButton label="上一页" disabled={currentPage <= 1 || tableBusy} onClick={() => goToPage(currentPage - 1)}>
                <CaretLeft size={16} />
              </PaginationButton>
              {pageNumbers.map((pageNumber) => (
                <Button
                  key={pageNumber}
                  type="button"
                  onClick={() => goToPage(pageNumber)}
                  disabled={tableBusy}
                  className={cx(
                    "inline-flex h-10 min-w-10 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45",
                    currentPage === pageNumber
                      ? "border-accent bg-accent text-white shadow-raised"
                      : "border-line bg-white text-coal hover:border-blue-200 hover:bg-blue-50 hover:text-accent"
                  )}
                >
                  {pageNumber}
                </Button>
              ))}
              <PaginationButton label="下一页" disabled={currentPage >= totalPages || tableBusy} onClick={() => goToPage(currentPage + 1)}>
                <CaretRight size={16} />
              </PaginationButton>
              <span className="ml-2 text-slate-500">前往</span>
              <TextInput
                aria-label="页码"
                inputMode="numeric"
                value={jumpPageDraft}
                disabled={tableBusy}
                onChange={(event) => setJumpPageDraft(event.target.value.replace(/\D/g, "").slice(0, 4))}
                onBlur={commitJumpPage}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitJumpPage();
                  }
                }}
                className="input h-10 w-16 px-3 py-2 text-center"
              />
              <span className="text-slate-500">页</span>
            </div>
          </div>
        </div>
      </section>

      <Modal
        open={masterCountDialogOpen}
        title="主节点配置"
        onClose={() => setMasterCountDialogOpen(false)}
        size="md"
      >
        <div className="grid gap-4">
          <Field label="个数" error={masterCountError}>
            <TextInput
              className="input"
              type="number"
              min={1}
              max={maxMasterNodeCount}
              value={masterCountDraft}
              disabled={masterCountSaving}
              onChange={(event) => setMasterCountDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveMasterCount();
                }
              }}
            />
          </Field>
          <div className="flex justify-end gap-3">
            <Button type="button" onClick={() => void saveMasterCount()} disabled={masterCountSaving || Boolean(masterCountError)} className="btn-primary">
              {masterCountSaving ? <ArrowsClockwise size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              保存
            </Button>
          </div>
        </div>
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

function NodeMonitorPage({
  nodeId,
  cluster,
  onBack
}: {
  nodeId: string | null;
  cluster: ClusterSnapshot | null;
  onBack: () => void;
}) {
  const nodes = cluster?.nodes ?? emptyNodes;
  const selected = nodeId ? nodes.find((item) => item.id === nodeId) || null : nodes[0] || null;
  const [metricRange, setMetricRange] = useState<NodeMetricRange>("30m");
  const [metricHistory, setMetricHistory] = useState<NodeMetricHistoryResponse | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) {
      setMetricHistory(null);
      setMetricsError(null);
      setMetricsLoading(false);
      return;
    }
    let ignored = false;
    setMetricsLoading(true);
    setMetricsError(null);
    api.nodeMetrics(selected.id, metricRange)
      .then((history) => {
        if (ignored) return;
        setMetricHistory(history);
      })
      .catch((error: unknown) => {
        if (ignored) return;
        const message = error instanceof Error ? error.message : "指标加载失败";
        setMetricsError(message);
        setMetricHistory(null);
      })
      .finally(() => {
        if (!ignored) {
          setMetricsLoading(false);
        }
      });
    return () => {
      ignored = true;
    };
  }, [selected, metricRange]);

  if (!selected) {
    return (
      <section className="px-5 py-6 md:px-8">
        <div className="rounded-lg border border-dashed border-line bg-slate-50/70 p-10 text-center">
          <div className="text-base font-semibold text-coal">节点不存在</div>
          <div className="mt-2 text-sm text-slate-500">返回节点列表后重新选择。</div>
          <Button type="button" onClick={onBack} className="btn-primary mt-5">
            <ArrowRight size={16} className="rotate-180" />
            返回
          </Button>
        </div>
      </section>
    );
  }

  const selectedRole = effectiveNodeRole(selected, nodes);
  const activeMetricHistory = metricHistory?.nodeId === selected.id && metricHistory.range === metricRange ? metricHistory : null;
  const monitor = buildNodeMonitorData(selected, activeMetricHistory, metricRange);
  const heartbeatAge = formatNodeHeartbeatAge(selected.lastHeartbeatAt);

  return (
    <section className="min-w-0 px-5 py-6 md:px-8">
      <div className="surface px-5 py-4 md:px-7">
        <h2 className="truncate text-2xl font-semibold text-coal md:text-3xl">{selected.name || selected.id}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-slate-600">
          <Badge tone={nodeRoleTone(selectedRole)}>{nodeRoleText(selectedRole)}</Badge>
          <NodeStatusBadge status={selected.status} />
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-500">Host</span>
            <span className="font-mono text-coal">{selected.endpoint}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-500">版本</span>
            <span className="font-mono text-coal">{selected.version?.trim() || "-"}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-500">心跳</span>
            <span>{formatDateTime(selected.lastHeartbeatAt)}</span>
            <span className="font-mono text-xs text-slate-500">({heartbeatAge})</span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
        {monitor.metrics.map((metric) => (
          <NodeMetricPanel key={metric.key} metric={metric} />
        ))}
      </div>

      <div className="mt-5">
        <ResourceTrendPanel
          monitor={monitor}
          range={metricRange}
          loading={metricsLoading}
          error={metricsError}
          onRangeChange={setMetricRange}
        />
      </div>
    </section>
  );
}

type NodeMonitorMetric = {
  key: "cpu" | "memory" | "disk";
  label: string;
  value: number;
  unit: string;
  color: string;
  ringValue?: number;
  precision?: number;
};

type NodeMonitorData = {
  range: NodeMetricRange;
  metrics: NodeMonitorMetric[];
  cpuSeries: number[];
  memorySeries: number[];
  diskSeries: number[];
  sampleTimes: number[];
  labels: string[];
};

type ResourceTrendPoint = {
  x: number;
  time: number;
  cpu: number;
  memory: number;
  disk: number;
  cpuY: number;
  memoryY: number;
  diskY: number;
};

function NodeMetricPanel({ metric }: { metric: NodeMonitorMetric }) {
  return (
    <div className="surface min-h-[168px] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-coal">
            {metric.label}
            <Info size={15} className="text-slate-400" />
          </div>
          <div className="mt-4 flex items-end gap-1 font-mono font-semibold tracking-tight text-accent">
            <span className="text-4xl leading-none">{formatMetricValue(metric.value, metric.precision)}</span>
            <span className="pb-1 text-lg leading-none">{metric.unit}</span>
          </div>
        </div>
        {metric.ringValue !== undefined && (
          <MetricProgressRing value={metric.ringValue} color={metric.color} />
        )}
      </div>
    </div>
  );
}

function MetricProgressRing({ value, color }: { value: number; color: string }) {
  const percent = clampPercent(value);
  const circumference = 2 * Math.PI * 38;
  const offset = circumference * (1 - percent / 100);

  return (
    <svg className="h-24 w-24 shrink-0 -rotate-90" viewBox="0 0 96 96" aria-label={`${percent}%`}>
      <circle cx="48" cy="48" r="38" fill="none" stroke="#e5ebf5" strokeWidth="9" />
      <circle
        cx="48"
        cy="48"
        r="38"
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
      <text x="48" y="53" textAnchor="middle" className="rotate-90 fill-coal font-mono text-[16px] font-semibold">
        {percent}%
      </text>
    </svg>
  );
}

function ResourceTrendPanel({
  monitor,
  range,
  loading,
  error,
  onRangeChange
}: {
  monitor: NodeMonitorData;
  range: NodeMetricRange;
  loading: boolean;
  error: string | null;
  onRangeChange: (range: NodeMetricRange) => void;
}) {
  const chart = buildResourceTrendPaths(monitor);
  const latestSampleTime = monitor.sampleTimes[monitor.sampleTimes.length - 1] ?? Number.NaN;
  const [hoverPoint, setHoverPoint] = useState<ResourceTrendPoint | null>(null);

  useEffect(() => {
    setHoverPoint(null);
  }, [latestSampleTime, range]);

  const handleTrendPointerMove = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (chart.points.length === 0) {
      setHoverPoint(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const cursorX = (event.clientX - rect.left) / Math.max(1, rect.width) * resourceTrendViewBox.width;
    setHoverPoint(findClosestResourceTrendPoint(chart.points, cursorX));
  }, [chart.points]);

  return (
    <div className="surface p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold tracking-tight text-coal">资源监控</h3>
          {loading && <ArrowsClockwise size={16} className="animate-spin text-accent" />}
          {error && <span className="text-sm font-medium text-red-600">{error}</span>}
        </div>
        <DropdownSelect
          ariaLabel="监控时间范围"
          value={range}
          options={nodeMetricRangeOptions}
          onChange={(value) => onRangeChange(value as NodeMetricRange)}
          className="h-10 min-h-10 w-[150px] px-3 py-2"
        />
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-8 text-sm font-medium text-slate-600">
        <TrendLegend color="#0052ff" label="CPU 使用率 (%)" />
        <TrendLegend color="#10b981" label="内存使用率 (%)" />
        <TrendLegend color="#f97316" label="磁盘使用率 (%)" />
      </div>
      <div
        className="relative mt-4 h-[330px] cursor-crosshair overflow-hidden"
        onMouseLeave={() => setHoverPoint(null)}
        onMouseMove={handleTrendPointerMove}
      >
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${resourceTrendViewBox.width} ${resourceTrendViewBox.height}`} preserveAspectRatio="none" role="img" aria-label="资源监控图">
          {resourceTrendYAxisTicks.map((tick) => {
            const y = chart.yFor(tick);
            return (
              <g key={tick}>
                <line x1="58" x2="738" y1={y} y2={y} stroke="#dbe7f6" strokeDasharray="4 4" />
              </g>
            );
          })}
          <line x1="58" x2="738" y1={chart.yFor(0)} y2={chart.yFor(0)} stroke="#cad9ea" />
          <line x1="58" x2="58" y1="22" y2={chart.yFor(0)} stroke="#dbe7f6" />
          <path d={chart.cpuPath} fill="none" stroke="#0052ff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
          <path d={chart.memoryPath} fill="none" stroke="#10b981" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
          <path d={chart.diskPath} fill="none" stroke="#f97316" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
          {hoverPoint && (
            <g pointerEvents="none">
              <line x1={hoverPoint.x} x2={hoverPoint.x} y1="22" y2={chart.yFor(0)} stroke="#94a3b8" strokeDasharray="3 4" />
              <circle cx={hoverPoint.x} cy={hoverPoint.cpuY} r="4" fill="#0052ff" stroke="#ffffff" strokeWidth="2" />
              <circle cx={hoverPoint.x} cy={hoverPoint.memoryY} r="4" fill="#10b981" stroke="#ffffff" strokeWidth="2" />
              <circle cx={hoverPoint.x} cy={hoverPoint.diskY} r="4" fill="#f97316" stroke="#ffffff" strokeWidth="2" />
            </g>
          )}
        </svg>
        {resourceTrendYAxisTicks.map((tick) => (
          <span
            key={tick}
            aria-hidden="true"
            className="resource-trend-axis-label absolute -translate-y-1/2 text-[13px] font-medium leading-none text-slate-500"
            style={{
              left: `${resourceTrendPercent(resourceTrendViewBox.yTickLabelX, resourceTrendViewBox.width)}%`,
              top: `${resourceTrendPercent(chart.yFor(tick), resourceTrendViewBox.height)}%`
            }}
          >
            {tick}
          </span>
        ))}
        {monitor.labels.map((label, index) => {
          const x = 58 + (680 / Math.max(1, monitor.labels.length - 1)) * index;
          return (
            <span
              key={`${label}-${index}`}
              aria-hidden="true"
              className="resource-trend-axis-label absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[13px] font-medium leading-none text-slate-600"
              style={{
                left: `${resourceTrendPercent(x, resourceTrendViewBox.width)}%`,
                top: `${resourceTrendPercent(resourceTrendViewBox.xTickLabelY, resourceTrendViewBox.height)}%`
              }}
            >
              {label}
            </span>
          );
        })}
        {hoverPoint && (
          <div
            className="pointer-events-none absolute z-10 w-48 rounded-lg border border-line bg-white/95 px-3 py-2 text-xs text-slate-600 shadow-panel"
            style={{
              left: `${resourceTrendPercent(hoverPoint.x, resourceTrendViewBox.width)}%`,
              top: `${resourceTrendPercent(Math.max(48, Math.min(hoverPoint.cpuY, hoverPoint.memoryY, hoverPoint.diskY) - 18), resourceTrendViewBox.height)}%`,
              transform: hoverPoint.x > 600 ? "translate(calc(-100% - 12px), -50%)" : "translate(12px, -50%)"
            }}
          >
            <div className="mb-2 font-mono text-[11px] font-semibold text-coal">{formatTrendTooltipTime(hoverPoint.time)}</div>
            <TrendTooltipRow color="#0052ff" label="CPU" value={`${formatMetricValue(hoverPoint.cpu)}%`} />
            <TrendTooltipRow color="#10b981" label="内存" value={`${formatMetricValue(hoverPoint.memory)}%`} />
            <TrendTooltipRow color="#f97316" label="磁盘" value={`${formatMetricValue(hoverPoint.disk)}%`} />
          </div>
        )}
      </div>
    </div>
  );
}

function TrendTooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="mt-1 flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        {label}
      </span>
      <span className="font-mono font-semibold text-coal">{value}</span>
    </div>
  );
}

function TrendLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function resourceTrendPercent(value: number, total: number) {
  return total === 0 ? 0 : value / total * 100;
}

function findClosestResourceTrendPoint(points: ResourceTrendPoint[], cursorX: number) {
  return points.reduce((closest, point) => {
    const closestDistance = Math.abs(closest.x - cursorX);
    const pointDistance = Math.abs(point.x - cursorX);
    return pointDistance < closestDistance ? point : closest;
  }, points[0]);
}

function formatTrendTooltipTime(time: number) {
  if (!Number.isFinite(time)) {
    return "-";
  }
  return formatDateTime(new Date(time).toISOString());
}

function buildNodeMonitorData(
  node: ClusterNode,
  history: NodeMetricHistoryResponse | null,
  range: NodeMetricRange
): NodeMonitorData {
  const samples = normalizeMetricSamples(node, history);
  const current = samples[samples.length - 1] ?? nodeMetricSampleFromNode(node);
  const cpuValue = clampPercent(current.cpuPercent);
  const memoryValue = clampPercent(current.memoryPercent);
  const diskValue = clampPercent(current.diskPercent);
  const cpuSeries = samples.map((sample) => clampPercent(sample.cpuPercent));
  const memorySeries = samples.map((sample) => clampPercent(sample.memoryPercent));
  const diskSeries = samples.map((sample) => clampPercent(sample.diskPercent));
  const sampleTimes = samples.map((sample) => metricTime(sample.collectedAt));

  return {
    range,
    metrics: [
      {
        key: "cpu",
        label: "CPU 使用率",
        value: cpuValue,
        unit: "%",
        color: "#0052ff",
        ringValue: cpuValue
      },
      {
        key: "memory",
        label: "内存使用率",
        value: memoryValue,
        unit: "%",
        color: "#0052ff",
        ringValue: memoryValue
      },
      {
        key: "disk",
        label: "磁盘使用率",
        value: diskValue,
        unit: "%",
        color: "#0052ff",
        ringValue: diskValue
      }
    ],
    cpuSeries,
    memorySeries,
    diskSeries,
    sampleTimes,
    labels: buildTrendLabels(samples, range)
  };
}

function normalizeMetricSamples(node: ClusterNode, history: NodeMetricHistoryResponse | null) {
  const samples = (history?.samples ?? [])
    .map((sample) => ({
      ...sample,
      cpuPercent: clampPercent(sample.cpuPercent),
      memoryPercent: clampPercent(sample.memoryPercent),
      diskPercent: clampPercent(sample.diskPercent),
      networkThroughputMBps: normalizeNetworkValue(sample.networkThroughputMBps)
    }))
    .filter((sample) => sample.nodeId === node.id)
    .sort((left, right) => metricTime(left.collectedAt) - metricTime(right.collectedAt));
  if (samples.length > 0) {
    return samples;
  }
  return [nodeMetricSampleFromNode(node)];
}

function nodeMetricSampleFromNode(node: ClusterNode): NodeMetricSample {
  return {
    nodeId: node.id,
    collectedAt: node.lastHeartbeatAt || new Date().toISOString(),
    cpuPercent: clampPercent(node.cpuPercent),
    memoryPercent: clampPercent(node.memoryPercent),
    diskPercent: clampPercent(node.diskPercent ?? 0),
    networkThroughputMBps: normalizeNetworkValue(node.networkThroughputMBps ?? 0)
  };
}

function normalizeNetworkValue(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Number(value.toFixed(1));
}

function buildResourceTrendPaths(monitor: NodeMonitorData) {
  const width = 680;
  const height = 246;
  const left = 58;
  const top = 22;
  const yFor = (value: number) => top + height - clampPercent(value) / 100 * height;
  const validTimes = monitor.sampleTimes.filter((time) => Number.isFinite(time));
  const latestTime = validTimes.length > 0 ? Math.max(...validTimes) : Date.now();
  const duration = nodeMetricRangeDurations[monitor.range];
  const startTime = latestTime - duration;
  const xForTime = (time: number, fallbackIndex: number, total: number) => {
    if (!Number.isFinite(time)) {
      return left + (width / Math.max(1, total - 1)) * fallbackIndex;
    }
    const ratio = Math.min(1, Math.max(0, (time - startTime) / duration));
    return left + width * ratio;
  };
  const pathFor = (values: number[]) => {
    if (values.length === 1) {
      const y = yFor(values[0]);
      const x = xForTime(monitor.sampleTimes[0], 0, 1);
      return `M${x.toFixed(2)},${y.toFixed(2)}`;
    }
    return values.map((value, index) => {
      const x = xForTime(monitor.sampleTimes[index], index, values.length);
      const y = yFor(value);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
  };
  const points = monitor.cpuSeries.map((cpu, index) => {
    const memory = monitor.memorySeries[index] ?? 0;
    const disk = monitor.diskSeries[index] ?? 0;
    const time = monitor.sampleTimes[index];
    const x = xForTime(time, index, monitor.cpuSeries.length);
    return {
      x,
      time,
      cpu,
      memory,
      disk,
      cpuY: yFor(cpu),
      memoryY: yFor(memory),
      diskY: yFor(disk)
    };
  });

  return {
    yFor,
    cpuPath: pathFor(monitor.cpuSeries),
    memoryPath: pathFor(monitor.memorySeries),
    diskPath: pathFor(monitor.diskSeries),
    points
  };
}

function buildTrendLabels(samples: NodeMetricSample[], range: NodeMetricRange) {
  const latestTime = metricTime(samples[samples.length - 1]?.collectedAt);
  const endTime = Number.isFinite(latestTime) ? latestTime : Date.now();
  const startTime = endTime - nodeMetricRangeDurations[range];
  return Array.from({ length: 7 }, (_, index) => {
    const tickTime = startTime + (nodeMetricRangeDurations[range] / 6) * index;
    return formatTrendTimeLabel(new Date(tickTime), range);
  });
}

function formatTrendTimeLabel(value: Date, range: NodeMetricRange) {
  if (range === "30m" || range === "1h" || range === "3h" || range === "6h" || range === "12h") {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(value);
  }
  if (range === "1d" || range === "3d") {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false
    }).format(value);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function metricTime(value?: string) {
  if (!value) {
    return Number.NaN;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function formatMetricValue(value: number, precision = 0) {
  return precision > 0 ? value.toFixed(precision) : String(Math.round(value));
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
    <div className="relative min-h-[100dvh] overflow-hidden bg-mist text-ink">
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
              className="mt-10 text-3xl font-semibold text-coal"
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

function DatasourceStatusBadge({ status }: { status?: Datasource["connectionStatus"] }) {
  const meta = datasourceStatusMeta(status);
  return (
    <span className={cx("inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-sm font-semibold", meta.className)}>
      <span className={cx("h-2 w-2 rounded-full", meta.dotClassName)} />
      {meta.label}
    </span>
  );
}

function IconActionButton({
  label,
  tone = "default",
  disabled,
  onClick,
  children
}: {
  label: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-white transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45",
        tone === "danger"
          ? "border-red-100 text-red-600 hover:border-red-200 hover:bg-red-50"
          : "border-line text-coal hover:border-blue-200 hover:bg-blue-50 hover:text-accent"
      )}
    >
      {children}
    </Button>
  );
}

function PaginationButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-accent active:translate-y-px disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
    >
      {children}
    </Button>
  );
}

function NodeTypeIcon({ status }: { status: ClusterNode["status"] }) {
  const online = status === "online";
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
        online ? "border-blue-100 bg-blue-50 text-accent" : "border-red-100 bg-red-50 text-red-600"
      )}
    >
      <HardDrives size={18} />
    </span>
  );
}

function NodeStatusBadge({ status }: { status: ClusterNode["status"] }) {
  const online = status === "online";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 whitespace-nowrap rounded-md border px-2.5 py-1 text-sm font-semibold",
        online ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-600"
      )}
    >
      <span className={cx("h-2 w-2 rounded-full", online ? "bg-emerald-500" : "bg-red-500")} />
      {nodeStatusText(status)}
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
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-coal md:text-3xl">系统异常</h1>
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

function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  const className = tone === "blue"
    ? "border-blue-200 bg-blue-50 text-accent"
    : tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "yellow"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : tone === "red"
          ? "border-red-200 bg-red-50 text-red-700"
          : tone === "purple"
            ? "border-slate-200 bg-slate-50 text-slate-700"
            : "border-slate-200 bg-slate-50 text-slate-600";
  return <span className={cx("chip", className)}>{children}</span>;
}

function TableTargetStatusBadge({ table, targetTableLoadState }: { table: ChannelWizardTableDraft; targetTableLoadState: MetadataLoadState }) {
  if (!table.targetTable.trim()) {
    return <Badge tone="red">未映射</Badge>;
  }
  if (targetTableLoadState === "loading") {
    return <Badge tone="neutral">加载中</Badge>;
  }
  if (targetTableLoadState === "failed" || targetTableLoadState === "idle") {
    return <Badge tone="yellow">待确认</Badge>;
  }
  return table.createTarget ? <Badge tone="yellow">待创建</Badge> : <Badge tone="green">已存在</Badge>;
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
        className={cx("max-h-[90dvh] w-full overflow-auto rounded-lg border border-line bg-white p-6 shadow-panel outline-none md:p-8", sizeClass)}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id={titleId} className="text-2xl font-semibold text-coal">{title}</h3>
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
    <div ref={rootRef} className="relative mx-3 mt-4 lg:mt-auto lg:pt-4">
      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+0.75rem)] left-0 z-30 w-full min-w-[14rem] overflow-hidden rounded-lg border border-line bg-white p-2 shadow-panel"
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
          "flex w-full items-center justify-start gap-3 rounded-lg border border-line bg-[#f8fbff] px-3 py-3 text-left transition hover:border-blue-200 hover:bg-white",
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

function datasourceById(datasources: Datasource[], id: string) {
  return datasources.find((datasource) => datasource.id === id);
}

function channelStatusOptions() {
  return [
    { value: "all", label: "全部状态" },
    { value: "draft", label: "草稿" },
    { value: "ready", label: "就绪" },
    { value: "running", label: "运行中" },
    { value: "warning", label: "告警" },
    { value: "failed", label: "失败" },
    { value: "stopped", label: "已停止" },
    { value: "archived", label: "已归档" }
  ];
}

function tableSelectionFilterOptions() {
  return [
    { value: "all", label: "全部" },
    { value: "selected", label: "已选" },
    { value: "unselected", label: "未选" }
  ];
}

function channelStatusText(status: Channel["status"]) {
  const labels: Record<Channel["status"], string> = {
    draft: "草稿",
    ready: "就绪",
    running: "运行中",
    warning: "告警",
    failed: "失败",
    stopped: "已停止",
    archived: "已归档"
  };
  return labels[status] || status;
}

function channelDetailSummary(
  channel: Channel,
  tasks: ChannelTask[],
  runs: TaskRun[],
  precheck: ChannelPrecheckResult | null
): ChannelDetailSummary {
  const blockers = channelPrecheckItemsBySeverity(precheck, "blocker");
  const warnings = channelPrecheckItemsBySeverity(precheck, "warning");
  const runningTasks = tasks.filter((task) => task.status === "running");
  const enabledTasks = tasks.filter((task) => task.enabled && task.status !== "disabled");
  const runnableTask = enabledTasks.find((task) => task.status !== "running");
  const latestRun = latestTaskRun(runs);
  const health = channelDetailHealth(channel, precheck, blockers.length, warnings.length, runningTasks.length);
  const start = channelDetailStartState(precheck, blockers.length, tasks, enabledTasks, runningTasks.length);
  const latest = channelDetailLatestRunState(latestRun);
  const next = channelDetailNextAction(blockers, warnings, tasks, runnableTask, runningTasks.length, latestRun);

  return {
    healthLabel: health.label,
    healthTone: health.tone,
    healthDetail: health.detail,
    startLabel: start.label,
    startTone: start.tone,
    startDetail: start.detail,
    latestRunLabel: latest.label,
    latestRunTone: latest.tone,
    latestRunDetail: latest.detail,
    nextAction: next.label,
    nextTone: next.tone,
    nextDetail: next.detail
  };
}

function channelDetailHealth(
  channel: Channel,
  precheck: ChannelPrecheckResult | null,
  blockerCount: number,
  warningCount: number,
  runningTaskCount: number
) {
  if (channel.status === "archived") return { label: "归档", tone: "neutral" as BadgeTone, detail: "已归档" };
  if (channel.status === "failed") return { label: "失败", tone: "red" as BadgeTone, detail: "查看日志" };
  if (blockerCount > 0) return { label: "阻断", tone: "red" as BadgeTone, detail: `${blockerCount} 项阻断` };
  if (warningCount > 0) return { label: "关注", tone: "yellow" as BadgeTone, detail: `${warningCount} 项警告` };
  if (runningTaskCount > 0 || channel.status === "running") return { label: "运行中", tone: "blue" as BadgeTone, detail: `${runningTaskCount || channel.runningTaskCount} 个运行中` };
  if (!precheck) return { label: "未知", tone: "neutral" as BadgeTone, detail: "未预检" };
  return { label: "正常", tone: "green" as BadgeTone, detail: "预检通过" };
}

function channelDetailStartState(
  precheck: ChannelPrecheckResult | null,
  blockerCount: number,
  tasks: ChannelTask[],
  enabledTasks: ChannelTask[],
  runningTaskCount: number
) {
  if (runningTaskCount > 0) return { label: "运行中", tone: "blue" as BadgeTone, detail: "可停止或查看运行" };
  if (!precheck) return { label: "未知", tone: "neutral" as BadgeTone, detail: "先预检" };
  if (blockerCount > 0) return { label: "不可启动", tone: "red" as BadgeTone, detail: "处理阻断项" };
  if (tasks.length === 0) return { label: "无任务", tone: "neutral" as BadgeTone, detail: "新增任务" };
  if (enabledTasks.length === 0) return { label: "无启用", tone: "neutral" as BadgeTone, detail: "启用任务" };
  return { label: "可启动", tone: "green" as BadgeTone, detail: `${enabledTasks.length} 个可用任务` };
}

function channelDetailLatestRunState(run: TaskRun | null) {
  if (!run) return { label: "无运行", tone: "neutral" as BadgeTone, detail: "暂无 Run" };
  const detail = `${channelTaskTypeText(run.taskType)} · ${formatDate(run.startedAt)}`;
  if (run.status === "success") return { label: "成功", tone: "green" as BadgeTone, detail };
  if (run.status === "running") return { label: "运行中", tone: "blue" as BadgeTone, detail };
  if (run.status === "failed") return { label: "失败", tone: "red" as BadgeTone, detail };
  if (run.status === "stopped") return { label: "停止", tone: "purple" as BadgeTone, detail };
  return { label: taskRunStatusText(run.status), tone: "neutral" as BadgeTone, detail };
}

function channelDetailNextAction(
  blockers: ChannelPrecheckItem[],
  warnings: ChannelPrecheckItem[],
  tasks: ChannelTask[],
  runnableTask: ChannelTask | undefined,
  runningTaskCount: number,
  latestRun: TaskRun | null
) {
  if (blockers.length > 0) return { label: "处理阻断", tone: "red" as BadgeTone, detail: blockers[0].label };
  if (latestRun?.status === "failed") return { label: "查看日志", tone: "red" as BadgeTone, detail: channelTaskTypeText(latestRun.taskType) };
  if (runningTaskCount > 0) return { label: "查看运行", tone: "blue" as BadgeTone, detail: `${runningTaskCount} 个运行中` };
  if (tasks.length === 0) return { label: "新增任务", tone: "neutral" as BadgeTone, detail: "进入任务" };
  if (warnings.length > 0) return { label: "确认警告", tone: "yellow" as BadgeTone, detail: warnings[0].label };
  if (runnableTask) return { label: "启动任务", tone: "green" as BadgeTone, detail: runnableTask.name };
  return { label: "查看任务", tone: "neutral" as BadgeTone, detail: "任务列表" };
}

function channelPrecheckItemsBySeverity(precheck: ChannelPrecheckResult | null, severity: "warning" | "blocker") {
  if (!precheck) return [];
  return precheck.items.filter((item) => {
    const itemSeverity = item.severity || (item.success ? "pass" : "blocker");
    return itemSeverity === severity;
  });
}

function latestTaskRun(runs: TaskRun[]) {
  return runs.reduce<TaskRun | null>((latest, run) => {
    if (!latest) return run;
    return run.startedAt > latest.startedAt ? run : latest;
  }, null);
}

function ChannelStatusBadge({ status }: { status: Channel["status"] }) {
  const tone = status === "running"
    ? "blue"
    : status === "ready"
      ? "green"
      : status === "warning"
        ? "yellow"
        : status === "failed"
          ? "red"
          : status === "archived"
            ? "neutral"
            : status === "stopped"
              ? "purple"
              : "neutral";
  return <Badge tone={tone}>{channelStatusText(status)}</Badge>;
}

function channelPrecheckSeverityTone(item: ChannelPrecheckResult["items"][number]) {
  const severity = item.severity || (item.success ? "pass" : "blocker");
  if (severity === "warning") return "yellow";
  if (severity === "blocker") return "red";
  return "green";
}

function channelPrecheckSeverityText(item: ChannelPrecheckResult["items"][number]) {
  const severity = item.severity || (item.success ? "pass" : "blocker");
  if (severity === "warning") return "警告";
  if (severity === "blocker") return "阻断";
  return "通过";
}

function channelTaskTypeOptions() {
  return [
    { value: "schema_migration", label: "结构迁移" },
    { value: "full_migration", label: "全量迁移" },
    { value: "incremental_sync", label: "增量同步" },
    { value: "schema_compare", label: "结构对比" },
    { value: "data_validation", label: "数据校验" },
    { value: "data_correction", label: "数据订正" }
  ];
}

function channelTaskTypeText(type: ChannelTaskType) {
  const option = channelTaskTypeOptions().find((item) => item.value === type);
  return option?.label || type;
}

function channelTaskStatusText(status: ChannelTask["status"]) {
  const labels: Record<ChannelTask["status"], string> = {
    draft: "草稿",
    ready: "就绪",
    disabled: "禁用",
    queued: "排队中",
    running: "运行中",
    stopping: "停止中",
    stopped: "已停止",
    success: "成功",
    failed: "失败",
    canceled: "已取消"
  };
  return labels[status] || status;
}

function ChannelTaskStatusBadge({ status }: { status: ChannelTask["status"] }) {
  const tone = status === "success" || status === "ready"
    ? "green"
    : status === "running" || status === "queued" || status === "stopping"
      ? "blue"
      : status === "failed"
        ? "red"
        : status === "stopped"
          ? "purple"
          : "neutral";
  return <Badge tone={tone}>{channelTaskStatusText(status)}</Badge>;
}

function ChannelWizardDatasourceTypeSelector({
  value,
  ariaLabel,
  onChange
}: {
  value: DatasourceType;
  ariaLabel: string;
  onChange: (value: DatasourceType) => void;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2">
      {channelWizardDatasourceTypeOptions().map((option) => {
        const selected = value === option.value;
        return (
          <Button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value as DatasourceType)}
            className={cx(
              "flex min-h-12 items-center justify-start gap-3 rounded-lg border px-3 text-sm font-semibold transition",
              selected
                ? "border-blue-200 bg-blue-50 text-accent"
                : "border-line bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50"
            )}
          >
            {option.icon}
            <span>{option.label}</span>
          </Button>
        );
      })}
    </div>
  );
}

function TaskToggle({
  label,
  checked,
  disabled,
  onChange
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={cx(
      "flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-lg border border-line p-4 transition",
      disabled ? "cursor-not-allowed bg-slate-50 opacity-60" : "bg-white hover:border-blue-200"
    )}>
      <span className="font-semibold text-coal">{label}</span>
      <CheckboxInput disabled={disabled} checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function taskRunStatusText(status: TaskRun["status"]) {
  const labels: Record<TaskRun["status"], string> = {
    running: "运行中",
    stopped: "已停止",
    success: "成功",
    failed: "失败",
    canceled: "已取消"
  };
  return labels[status] || status;
}

function channelTabText(tab: ChannelDetailTab) {
  const labels: Record<ChannelDetailTab, string> = {
    overview: "概览",
    mappings: "映射",
    tasks: "任务",
    runs: "运行",
    logs: "日志",
    diffs: "差异"
  };
  return labels[tab];
}

function dataValidationDiffTypeText(type: string) {
  const labels: Record<string, string> = {
    value_mismatch: "值不一致",
    missing_source: "源缺失",
    missing_target: "目标缺失"
  };
  return labels[type] || type;
}

function dataValidationCorrectionStatusText(status: string) {
  const labels: Record<string, string> = {
    pending: "待订正",
    corrected: "已订正",
    failed: "失败"
  };
  return labels[status] || status;
}

function compactJSONText(value: string) {
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(parsed);
  } catch {
    return value || "-";
  }
}

function datasourceSelectOptions(datasources: Datasource[], purpose: DatasourcePurpose) {
  const filtered = datasources.filter((datasource) => datasource.purpose === purpose || datasource.purpose === "general" || !datasource.purpose);
  const candidates = filtered.length > 0 ? filtered : datasources;
  if (candidates.length === 0) {
    return [{ value: "", label: "暂无数据源", disabled: true }];
  }
  return candidates.map((datasource) => ({
    value: datasource.id,
    label: datasource.name,
    description: `${datasource.host}:${datasource.port}`,
    icon: <DatasourceTypeLogo type={datasource.type} className="h-5 w-5" />
  }));
}

function channelWizardDatasourceTypeOptions() {
  return [{
    value: "mysql",
    label: "MySQL",
    icon: <DatasourceTypeLogo type="mysql" className="h-5 w-5" />
  }];
}

function datasourcesForWizard(datasources: Datasource[], purpose: DatasourcePurpose, type: DatasourceType) {
  const typed = datasources.filter((datasource) => datasource.type === type);
  const scoped = typed.filter((datasource) => datasource.purpose === purpose || datasource.purpose === "general" || !datasource.purpose);
  return scoped.length > 0 ? scoped : typed;
}

function datasourceOptionsForWizard(datasources: Datasource[], purpose: DatasourcePurpose, type: DatasourceType) {
  const candidates = datasourcesForWizard(datasources, purpose, type);
  if (candidates.length === 0) {
    return [{ value: "", label: "暂无数据源", disabled: true }];
  }
  return candidates.map((datasource) => ({
    value: datasource.id,
    label: datasource.name,
    description: `${datasource.host}:${datasource.port}`,
    icon: <DatasourceTypeLogo type={datasource.type} className="h-5 w-5" />
  }));
}

function metadataValueOptions(values: string[], state: MetadataLoadState, emptyLabel: string, placeholderLabel = "") {
  if (state === "loading") {
    return [{ value: "", label: "加载中", disabled: true }];
  }
  if (values.length === 0) {
    return [{ value: "", label: emptyLabel, disabled: true }];
  }
  const options = values.map((value) => ({ value, label: value }));
  return placeholderLabel ? [{ value: "", label: placeholderLabel, disabled: true }, ...options] : options;
}

function nodeOptionsForWizard(nodes: ClusterNode[]) {
  if (nodes.length === 0) {
    return [{ value: "", label: "暂无在线节点", disabled: true }];
  }
  return nodes.map((node) => ({
    value: node.id,
    label: node.name,
    description: node.endpoint
  }));
}

function channelWizardDefaultName(sourceType: DatasourceType, targetType: DatasourceType, date = new Date()) {
  return `canal-plus-${sourceType}-to-${targetType}-${channelWizardNameTimestamp(date)}`;
}

function channelWizardNameTimestamp(date: Date) {
  return [
    String(date.getFullYear()),
    timestampPart(date.getMonth() + 1),
    timestampPart(date.getDate()),
    timestampPart(date.getHours()),
    timestampPart(date.getMinutes())
  ].join("");
}

function timestampPart(value: number) {
  return String(value).padStart(2, "0");
}

function emptyChannelWizardForm(datasources: Datasource[], onlineNodes: ClusterNode[]): ChannelWizardFormState {
  const source = datasourcesForWizard(datasources, "source", "mysql")[0];
  const target = datasourcesForWizard(datasources, "target", "mysql").find((datasource) => datasource.id !== source?.id)
    || datasourcesForWizard(datasources, "target", "mysql")[0];
  return {
    name: "",
    description: "",
    runNodeId: onlineNodes[0]?.id || "",
    sourceDatasourceType: "mysql",
    targetDatasourceType: "mysql",
    sourceDatasourceId: source?.id || "",
    targetDatasourceId: target?.id || "",
    sourceTestState: "idle",
    targetTestState: "idle",
    sourceTestMessage: "",
    targetTestMessage: "",
    resourceSpec: "0.5G",
    kind: "sync",
    fullMigration: true,
    incrementalSync: true,
    schemaCompare: true,
    dataValidation: true,
    dataCorrection: false,
    sourceDatabase: source?.defaultSchema || "",
    sourceSchema: "",
    targetDatabase: target?.defaultSchema || "",
    targetSchema: "",
    tables: []
  };
}

function emptyChannelWizardTable(): ChannelWizardTableDraft {
  return {
    localId: newLocalId(),
    sourceSchema: "",
    sourceTable: "",
    targetSchema: "",
    targetTable: "",
    primaryKeys: [],
    primaryKeysText: "",
    enabled: false,
    createTarget: false,
    columns: []
  };
}

function syncWizardTablesWithMetadata(
  form: ChannelWizardFormState,
  sourceTables: string[],
  targetTables: string[],
  targetTablesLoaded: boolean
): ChannelWizardFormState {
  const existingBySourceTable = new Map(form.tables.map((table) => [table.sourceTable, table]));
  const targetTableSet = new Set(targetTables);
  const tables = sourceTables.map((sourceTable) => {
    const existing = existingBySourceTable.get(sourceTable);
    const targetTable = existing?.targetTable?.trim() || sourceTable;
    return {
      ...(existing || emptyChannelWizardTable()),
      sourceTable,
      targetTable,
      createTarget: targetTablesLoaded ? !targetTableSet.has(targetTable) : existing?.createTarget || false
    };
  });
  return { ...form, tables };
}

function resetWizardTables(tables: ChannelWizardTableDraft[], side: "source" | "target") {
  void tables;
  void side;
  return [];
}

function channelResourceSpecGB(spec: ResourceSpec | string) {
  if (spec === "0.5G") return 0.5;
  if (spec === "1G") return 1;
  if (spec === "2G") return 2;
  if (spec === "3G") return 3;
  if (spec === "4G") return 4;
  return 0;
}

function channelWizardMappingPayload(form: ChannelWizardFormState): ChannelTableMappingInput[] {
  const sourceSchema = effectiveChannelSchema(form.sourceDatabase, form.sourceSchema);
  const targetSchema = effectiveChannelSchema(form.targetDatabase, form.targetSchema);
  return form.tables.filter((table) => table.enabled).map((table) => {
    const enabledColumns = table.columns.filter((column) => column.enabled !== false && column.sourceColumn.trim() && column.targetColumn.trim());
    const markedPrimaryKeys = enabledColumns
      .filter((column) => column.isPrimaryKey && column.sourceColumn.trim())
      .map((column) => column.sourceColumn.trim());
    return {
      sourceSchema,
      sourceTable: table.sourceTable.trim(),
      targetSchema,
      targetTable: table.targetTable.trim(),
      primaryKeys: markedPrimaryKeys,
      enabled: true,
      columns: enabledColumns.map((column) => ({
        sourceColumn: column.sourceColumn.trim(),
        sourceType: column.sourceType?.trim() || "",
        targetColumn: column.targetColumn.trim(),
        targetType: column.targetType?.trim() || "",
        isPrimaryKey: Boolean(column.isPrimaryKey),
        nullable: Boolean(column.nullable),
        defaultValue: column.defaultValue?.trim() || "",
        enabled: true
      }))
    };
  });
}

function channelWizardTaskConfig(form: ChannelWizardFormState): Record<string, string> {
  return {
    runNodeId: form.runNodeId,
    resourceSpec: form.resourceSpec,
    sourceDatabase: form.sourceDatabase.trim(),
    sourceSchema: form.sourceSchema.trim(),
    targetDatabase: form.targetDatabase.trim(),
    targetSchema: form.targetSchema.trim(),
    channelKind: form.kind
  };
}

function effectiveChannelSchema(database: string, schema: string) {
  return schema.trim() || database.trim();
}

function channelWizardStepLabel(step: ChannelWizardStep) {
  const labels: Record<ChannelWizardStep, string> = {
    connections: "选择数据源",
    tasks: "选择任务类型",
    sourceTables: "源端订阅表",
    targetTables: "目标端映射表",
    columns: "选择列"
  };
  return labels[step];
}

function channelWizardStepError(step: ChannelWizardStep) {
  if (step === "connections") return "选择数据源未完成";
  if (step === "tasks") return "选择任务类型未完成";
  if (step === "sourceTables") return "选择源端订阅表未完成";
  if (step === "targetTables") return "选择目标端映射表未完成";
  return "选择列未完成";
}

function channelFormFromChannel(channel: Channel | null, datasources: Datasource[]): ChannelFormState {
  return {
    name: channel?.name || "",
    description: channel?.description || "",
    sourceDatasourceId: channel?.sourceDatasourceId || datasources.find((item) => item.purpose === "source")?.id || datasources[0]?.id || "",
    targetDatasourceId: channel?.targetDatasourceId || datasources.find((item) => item.purpose === "target")?.id || datasources.find((item) => item.id !== datasources[0]?.id)?.id || "",
    sourceDatasourceType: channel?.sourceDatasourceType || "mysql",
    targetDatasourceType: channel?.targetDatasourceType || "mysql",
    runNodeId: channel?.runNodeId || "",
    resourceSpec: channel?.resourceSpec || "",
    kind: channel?.kind || "sync",
    tags: channel?.tags?.join(", ") || ""
  };
}

function validateChannelForm(form: ChannelFormState) {
  if (!form.name.trim()) return "名称必填";
  if (!form.sourceDatasourceId) return "源端必填";
  if (!form.targetDatasourceId) return "目标端必填";
  return null;
}

function channelFormPayload(form: ChannelFormState): ChannelInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    sourceDatasourceId: form.sourceDatasourceId,
    targetDatasourceId: form.targetDatasourceId,
    sourceDatasourceType: form.sourceDatasourceType,
    targetDatasourceType: form.targetDatasourceType,
    runNodeId: form.runNodeId,
    resourceSpec: form.resourceSpec,
    kind: form.kind,
    tags: splitList(form.tags)
  };
}

function splitList(value: string) {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function requestErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "加载失败";
}

function channelWizardColumnsAreEmpty(columns: ChannelColumnMappingDraft[]) {
  return columns.length === 0 || columns.every((column) => !column.sourceColumn.trim() && !column.targetColumn.trim());
}

function applyColumnMetadataToWizardTable(table: ChannelWizardTableDraft, sourceColumns: DatasourceColumn[], targetColumns: DatasourceColumn[]) {
  const columns = channelWizardColumnMappingsFromMetadata(sourceColumns, targetColumns);
  const primaryKeys = columns.filter((column) => column.isPrimaryKey && column.sourceColumn.trim()).map((column) => column.sourceColumn.trim());
  return {
    ...table,
    primaryKeysText: table.primaryKeysText.trim() || primaryKeys.join(", "),
    columns
  };
}

function channelWizardColumnMappingsFromMetadata(sourceColumns: DatasourceColumn[], targetColumns: DatasourceColumn[]): ChannelColumnMappingDraft[] {
  const targetByName = new Map(targetColumns.map((column) => [column.name.toLowerCase(), column]));
  return sourceColumns.map((sourceColumn) => {
    const targetColumn = targetByName.get(sourceColumn.name.toLowerCase());
    return {
      localId: newLocalId(),
      sourceColumn: sourceColumn.name,
      sourceType: sourceColumn.type || "",
      targetColumn: targetColumn?.name || sourceColumn.name,
      targetType: targetColumn?.type || "",
      isPrimaryKey: sourceColumn.isPrimaryKey,
      nullable: targetColumn?.nullable ?? sourceColumn.nullable,
      defaultValue: sourceColumn.defaultValue || "",
      enabled: true
    };
  });
}

function mappingDraftFromResponse(response: ChannelMappingsResponse): ChannelTableMappingDraft[] {
  return response.tables.map((table) => ({
    id: table.id,
    localId: table.id || newLocalId(),
    sourceSchema: table.sourceSchema || "",
    sourceTable: table.sourceTable,
    targetSchema: table.targetSchema || "",
    targetTable: table.targetTable,
    primaryKeys: table.primaryKeys,
    primaryKeysText: table.primaryKeys.join(", "),
    enabled: table.enabled,
    columns: response.columns
      .filter((column) => column.tableMappingId === table.id)
      .map((column) => ({
        id: column.id,
        localId: column.id || newLocalId(),
        sourceColumn: column.sourceColumn,
        sourceType: column.sourceType || "",
        targetColumn: column.targetColumn,
        targetType: column.targetType || "",
        isPrimaryKey: column.isPrimaryKey,
        nullable: column.nullable,
        defaultValue: column.defaultValue || "",
        enabled: column.enabled
      }))
  }));
}

function mappingDraftPayload(draft: ChannelTableMappingDraft[]): ChannelTableMappingInput[] {
  return draft.map((table) => ({
    id: table.id,
    sourceSchema: table.sourceSchema?.trim() || "",
    sourceTable: table.sourceTable.trim(),
    targetSchema: table.targetSchema?.trim() || "",
    targetTable: table.targetTable.trim(),
    primaryKeys: splitList(table.primaryKeysText),
    enabled: table.enabled ?? true,
    columns: table.columns.map((column) => ({
      id: column.id,
      sourceColumn: column.sourceColumn.trim(),
      sourceType: column.sourceType?.trim() || "",
      targetColumn: column.targetColumn.trim(),
      targetType: column.targetType?.trim() || "",
      isPrimaryKey: Boolean(column.isPrimaryKey),
      nullable: Boolean(column.nullable),
      defaultValue: column.defaultValue?.trim() || "",
      enabled: column.enabled ?? true
    }))
  }));
}

function emptyColumnDraft(): ChannelColumnMappingDraft {
  return {
    localId: newLocalId(),
    sourceColumn: "",
    sourceType: "",
    targetColumn: "",
    targetType: "",
    isPrimaryKey: false,
    nullable: true,
    defaultValue: "",
    enabled: true
  };
}

function newLocalId() {
  return `local-${Math.random().toString(36).slice(2, 10)}`;
}

function paginationRange(currentPage: number, totalPages: number) {
  const visibleCount = 5;
  const normalizedTotal = Math.max(1, totalPages);
  const half = Math.floor(visibleCount / 2);
  const start = Math.max(1, Math.min(currentPage - half, normalizedTotal - visibleCount + 1));
  const end = Math.min(normalizedTotal, start + visibleCount - 1);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
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

function datasourceSubtitle(item: Datasource) {
  return item.defaultSchema?.trim() || item.remark?.trim() || item.id;
}

function datasourceStatusText(status?: Datasource["connectionStatus"]) {
  return datasourceStatusMeta(status).label;
}

function datasourceStatusMeta(status?: Datasource["connectionStatus"]) {
  if (status === "available") {
    return {
      label: "正常",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      dotClassName: "bg-emerald-500"
    };
  }
  if (status === "failed") {
    return {
      label: "连接异常",
      className: "border-red-200 bg-red-50 text-red-600",
      dotClassName: "bg-red-500"
    };
  }
  if (status === "stale") {
    return {
      label: "过期",
      className: "border-amber-200 bg-amber-50 text-amber-700",
      dotClassName: "bg-amber-500"
    };
  }
  return {
    label: "未测",
    className: "border-slate-200 bg-slate-50 text-slate-600",
    dotClassName: "bg-slate-400"
  };
}

function datasourceAuthTypeFromItem(item: Datasource): DatasourceAuthType {
  if (!item.username?.trim() && !item.hasPassword) return "none";
  return "password";
}

function pageFromPathname(pathname: string): Page {
  if (pathname === "/" || pathname === "/canals" || pathname === "/channels") return "channels";
  if (pathname === "/canals/create" || pathname === "/channels/create") return "channelCreate";
  if (channelDetailIdFromPathname(pathname)) return "channelDetail";
  if (pathname === "/datasources") return "datasources";
  if (pathname === "/datasource/create") return "datasourceCreate";
  if (datasourceEditIdFromPathname(pathname)) return "datasourceEdit";
  if (nodeMonitorIdFromPathname(pathname)) return "nodeMonitor";
  if (pathname === "/nodes") return "nodes";
  return "datasources";
}

function pathForPage(page: Page, resourceId?: string) {
  if (page === "channels") return "/canals";
  if (page === "channelCreate") return "/canals/create";
  if (page === "channelDetail" && resourceId) return `/canals/${encodeURIComponent(resourceId)}`;
  if (page === "datasources") return "/datasources";
  if (page === "datasourceCreate") return "/datasource/create";
  if (page === "datasourceEdit" && resourceId) return `/datasource/${encodeURIComponent(resourceId)}/edit`;
  if (page === "nodes") return "/nodes";
  if (page === "nodeMonitor" && resourceId) return `/nodes/${encodeURIComponent(resourceId)}/monitor`;
  return "/";
}

function navPage(page: Page): MainPage {
  if (page === "channelCreate") return "channels";
  if (page === "channelDetail") return "channels";
  if (page === "datasourceCreate") return "datasources";
  if (page === "datasourceEdit") return "datasources";
  if (page === "nodeMonitor") return "nodes";
  return page;
}

function pageTitle(page: Page) {
  if (page === "channels") return "Canal";
  if (page === "channelCreate") return "新增 Canal";
  if (page === "channelDetail") return "Canal";
  if (page === "datasources") return "数据源";
  if (page === "datasourceCreate") return "新增数据源";
  if (page === "datasourceEdit") return "编辑数据源";
  if (page === "nodes") return "节点";
  if (page === "nodeMonitor") return "节点监控";
  return "设置";
}

function pageDescription(page: Page) {
  if (page === "channels") return "";
  if (page === "channelCreate") return "";
  if (page === "channelDetail") return "";
  if (page === "datasources") return "";
  if (page === "datasourceCreate") return "";
  if (page === "datasourceEdit") return "";
  if (page === "nodes") return "";
  if (page === "settings") return "告警";
  return "";
}

function channelDetailIdFromPathname(pathname: string) {
  const match = pathname.match(/^\/(?:canals|channels)\/([^/]+)$/);
  if (!match) return null;
  if (match[1] === "create") return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function canonicalCanalPathname(pathname: string) {
  if (pathname === "/channels") return "/canals";
  if (pathname === "/channels/create") return "/canals/create";
  const channelId = channelDetailIdFromPathname(pathname);
  if (channelId && pathname.startsWith("/channels/")) {
    return `/canals/${encodeURIComponent(channelId)}`;
  }
  return null;
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

function nodeMonitorIdFromPathname(pathname: string) {
  const match = pathname.match(/^\/nodes\/([^/]+)\/monitor$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function effectiveNodeRole(node: ClusterNode, nodes: ClusterNode[]): "master" | "standby" {
  if (nodes.length === 1) return "master";
  if (node.role === "master") return "master";
  return "standby";
}

function nodeRoleText(role: ClusterNode["role"] | "master" | "standby") {
  if (role === "master") return "主节点";
  return "备用节点";
}

function nodeRoleTone(role: ClusterNode["role"] | "master" | "standby") {
  if (role === "master") return "blue";
  return "purple";
}

function nodeStatusText(status: ClusterNode["status"]) {
  if (status === "online") return "在线";
  return "离线";
}

function formatNodeHeartbeatAge(value?: string) {
  if (!value) return "-";
  const seconds = secondsSince(value);
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export default App;
