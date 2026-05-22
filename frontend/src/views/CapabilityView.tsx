import { useEffect, useMemo, useState } from "react";
import {
  ArrowsClockwise,
  CheckCircle,
  GitBranch,
  MagnifyingGlass,
  Play,
  Plus,
  ShieldCheck,
  Stack,
  WarningCircle
} from "@phosphor-icons/react";
import { PermissionNotice } from "../components/PermissionNotice";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { cx, formatDate } from "../lib/format";
import type { CapabilityJob, CapabilityJobType, Datasource, QualityDiff, SyncTask } from "../types/api";

const capabilityConfig: Record<CapabilityJobType, {
  title: string;
  icon: typeof Stack;
  accent: string;
  primary: string;
  modes: Array<{ value: string; label: string; description: string }>;
}> = {
  structure: {
    title: "结构迁移与同步",
    icon: Stack,
    accent: "类型转换 / 方言适配 / 命名映射",
    primary: "生成结构计划",
    modes: [
      { value: "schema_prepare", label: "结构准备", description: "检查目标端缺失库表列并生成 DDL" },
      { value: "ddl_sync", label: "DDL 同步", description: "对运行中链路启用增量 DDL 变更" }
    ]
  },
  quality: {
    title: "数据校验与订正",
    icon: ShieldCheck,
    accent: "字段级对比 / 二次差异校验 / 安全订正",
    primary: "创建校验任务",
    modes: [
      { value: "verify_only", label: "仅校验", description: "输出差异，不执行回写" },
      { value: "verify_then_correct", label: "校验后订正", description: "二次确认差异后自动订正" },
      { value: "periodic_verify", label: "周期校验", description: "按 cron 执行并保留历史" }
    ]
  },
  subscription: {
    title: "修改订阅",
    icon: GitBranch,
    accent: "运行中加库减库 / action 过滤 / 条件过滤",
    primary: "发起订阅变更",
    modes: [
      { value: "add_tables", label: "新增订阅表", description: "预检后把新增表合入当前版本" },
      { value: "filter_actions", label: "Action 过滤", description: "调整 insert/update/delete 订阅动作" },
      { value: "condition_filter", label: "条件过滤", description: "发布行级过滤条件" }
    ]
  }
};

const statusLabel: Record<string, string> = {
  draft: "草稿",
  running: "运行中",
  completed: "已完成",
  failed: "失败"
};

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-[#fcfcf8] p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("mt-2 text-sm font-medium text-coal", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function JobBadge({ status }: { status: CapabilityJob["status"] }) {
  const className = status === "completed"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "running"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : status === "failed"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-zinc-200 bg-zinc-50 text-zinc-600";
  return <span className={cx("rounded-full border px-2 py-0.5 text-xs", className)}>{statusLabel[status] || status}</span>;
}

function riskLabel(value: string) {
  if (value === "high") return "高";
  if (value === "medium") return "中";
  return "低";
}

function diffTypeLabel(value: string) {
  if (value === "target_missing") return "目标缺失";
  if (value === "source_missing") return "源端缺失";
  return "值不一致";
}

function diffStatusLabel(value: QualityDiff["status"]) {
  return value === "corrected" ? "已订正" : "待订正";
}

function severityClass(value: string) {
  if (value === "high") return "border-red-200 bg-red-50 text-red-700";
  if (value === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function diffStatusClass(value: QualityDiff["status"]) {
  return value === "corrected" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700";
}

export function CapabilityView({
  mode,
  tasks,
  datasources,
  jobs,
  canManage,
  onChanged
}: {
  mode: CapabilityJobType;
  tasks: SyncTask[];
  datasources: Datasource[];
  jobs: CapabilityJob[];
  canManage: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const config = capabilityConfig[mode];
  const Icon = config.icon;
  const availableTasks = tasks.filter((task) => task.status !== "draft" && task.status !== "stopped");
  const [selectedTaskId, setSelectedTaskId] = useState(availableTasks[0]?.id || "");
  const [selectedMode, setSelectedMode] = useState(config.modes[0]?.value || "");
  const [schedule, setSchedule] = useState("0 2 * * *");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [qualityDiffs, setQualityDiffs] = useState<QualityDiff[]>([]);
  const [loadingDiffs, setLoadingDiffs] = useState(false);
  const [correctingDiff, setCorrectingDiff] = useState<string | null>(null);
  const relevantJobs = useMemo(() => jobs.filter((job) => job.type === mode), [jobs, mode]);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? availableTasks[0];
  const latestJob = relevantJobs[0];
  const latestQualityJobId = mode === "quality" ? latestJob?.id ?? "" : "";
  const pendingDiffs = qualityDiffs.filter((diff) => diff.status === "pending");

  useEffect(() => {
    setSelectedMode(config.modes[0]?.value || "");
  }, [config.modes]);

  useEffect(() => {
    if (!selectedTaskId && availableTasks[0]) {
      setSelectedTaskId(availableTasks[0].id);
    }
  }, [availableTasks, selectedTaskId]);

  useEffect(() => {
    if (!latestQualityJobId) {
      setQualityDiffs([]);
      return;
    }
    let cancelled = false;
    setLoadingDiffs(true);
    api.qualityDiffs(latestQualityJobId)
      .then((diffs) => {
        if (!cancelled) setQualityDiffs(diffs);
      })
      .catch((requestError) => {
        if (!cancelled) setError(requestError instanceof Error ? requestError.message : "加载差异失败");
      })
      .finally(() => {
        if (!cancelled) setLoadingDiffs(false);
      });
    return () => {
      cancelled = true;
    };
  }, [latestQualityJobId]);

  const createJob = async () => {
    if (!canManage) {
      setError("创建能力任务需要管理员权限");
      return;
    }
    if (!selectedTask) {
      setError("请先创建可执行的同步任务");
      return;
    }
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      await api.createCapabilityJob({
        type: mode,
        taskId: selectedTask.id,
        mode: selectedMode,
        schedule: selectedMode === "periodic_verify" ? schedule : undefined,
        autoStart: true
      });
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const runJob = async (job: CapabilityJob) => {
    setError(null);
    setMessage(null);
    try {
      await api.runCapabilityJob(job.id);
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "运行失败");
    }
  };

  const correctDiffs = async (ids?: string[]) => {
    if (!canManage) {
      setError("执行差异订正需要管理员权限");
      return;
    }
    if (!latestJob) return;
    const marker = ids?.[0] ?? "all";
    setCorrectingDiff(marker);
    setError(null);
    setMessage(null);
    try {
      const updated = await api.correctQualityDiffs(latestJob.id, {
        ids,
        reason: ids?.length ? "人工确认单条差异订正" : "人工确认批量差异订正"
      });
      const diffs = await api.qualityDiffs(latestJob.id);
      setQualityDiffs(diffs);
      setMessage(`已订正 ${updated.summary.correctedRows}/${diffs.length} 条差异`);
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "差异订正失败");
    } finally {
      setCorrectingDiff(null);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-coal text-white">
            <Icon size={22} />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-coal">{config.title}</h2>
            <div className="mt-1 text-sm text-muted">{config.accent}</div>
          </div>
        </div>

        {error && (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <WarningCircle size={18} />
            {error}
          </div>
        )}

        {message && (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle size={18} />
            {message}
          </div>
        )}

        {!canManage && (
          <div className="mt-5">
            <PermissionNotice compact description="当前角色可查看执行结果并重跑已有能力任务；生成结构、校验或订阅变更计划需要管理员权限。" />
          </div>
        )}

        <div className="mt-6 grid gap-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">关联任务</span>
            <select
              className="control"
              value={selectedTask?.id || ""}
              disabled={!canManage}
              onChange={(event) => setSelectedTaskId(event.target.value)}
            >
              {availableTasks.map((task) => (
                <option key={task.id} value={task.id}>{task.name}</option>
              ))}
            </select>
          </label>

          <div className="grid gap-3">
            {config.modes.map((item) => (
              <button
                key={item.value}
                onClick={() => {
                  if (canManage) setSelectedMode(item.value);
                }}
                disabled={!canManage}
                className={cx(
                  "rounded-lg border p-3 text-left transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
                  selectedMode === item.value ? "border-coal bg-[#f4f6f2]" : "border-line bg-[#fcfcf8] hover:bg-zinc-50"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-coal">{item.label}</span>
                  {selectedMode === item.value && <CheckCircle size={18} className="text-accent" />}
                </div>
                <div className="mt-1 text-xs text-muted">{item.description}</div>
              </button>
            ))}
          </div>

          {selectedMode === "periodic_verify" && (
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-zinc-700">Cron</span>
              <input className="control font-mono" value={schedule} disabled={!canManage} onChange={(event) => setSchedule(event.target.value)} />
            </label>
          )}
        </div>

        <button
          onClick={createJob}
          disabled={!canManage || creating || !selectedTask}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-coal px-4 py-2.5 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={16} />
          {creating ? "创建中" : config.primary}
        </button>
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold tracking-tight text-coal">执行面板</h2>
            <div className="mt-1 text-sm text-muted">创建、运行、查看结构/校验/订阅任务状态</div>
          </div>
          <MagnifyingGlass size={20} className="text-muted" />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Info label="数据源" value={`${datasources.length} 个`} mono />
          <Info label="任务" value={`${tasks.length} 条`} mono />
          <Info label="运行中能力任务" value={`${relevantJobs.filter((job) => job.status === "running").length} 条`} mono />
          <Info label="最近风险" value={riskLabel(latestJob?.summary.riskLevel || "low")} />
        </div>

        {latestJob && (
          <div className="mt-5 rounded-xl border border-line bg-[#fcfcf8] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-coal">{latestJob.name}</div>
                <div className="mt-1 text-xs text-muted">{formatDate(latestJob.updatedAt)} / {latestJob.mode}</div>
              </div>
              <JobBadge status={latestJob.status} />
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${latestJob.progressPercent}%` }} />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <Info label="表" value={`${latestJob.summary.tables}`} mono />
              <Info label="字段" value={`${latestJob.summary.columns}`} mono />
              <Info label={mode === "quality" ? "差异行" : mode === "subscription" ? "新增表" : "DDL"} value={`${mode === "quality" ? latestJob.summary.diffRows : mode === "subscription" ? latestJob.summary.addedTables : latestJob.summary.ddlCount}`} mono />
              <Info label="风险" value={riskLabel(latestJob.summary.riskLevel)} />
            </div>
            <div className="mt-4 grid gap-2">
              {latestJob.steps.map((step, index) => (
                <div key={`${latestJob.id}-${step.name}`} className="grid gap-2 rounded-lg border border-line bg-white p-3 text-sm sm:grid-cols-[28px_140px_1fr_auto] sm:items-center">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#fcfcf8] font-mono text-xs text-accent">{index + 1}</span>
                  <span className="font-medium text-coal">{step.name}</span>
                  <span className="text-xs text-muted">{step.detail}</span>
                  <span className="text-xs text-zinc-500">{step.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {mode === "quality" && latestJob && (
          <div className="mt-5 rounded-xl border border-line bg-[#fcfcf8] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold tracking-tight text-coal">字段级差异</h3>
                <div className="mt-1 text-sm text-muted">逐字段对比源端与目标端，确认后可按源端值订正。</div>
              </div>
              <button
                onClick={() => correctDiffs()}
                disabled={!canManage || loadingDiffs || pendingDiffs.length === 0 || correctingDiff === "all" || latestJob.status !== "completed"}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {correctingDiff === "all" ? <ArrowsClockwise size={16} /> : <ShieldCheck size={16} />}
                {correctingDiff === "all" ? "订正中" : `订正待处理 ${pendingDiffs.length}`}
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Info label="差异明细" value={loadingDiffs ? "加载中" : `${qualityDiffs.length} 条`} mono />
              <Info label="待订正" value={`${pendingDiffs.length} 条`} mono />
              <Info label="已订正" value={`${qualityDiffs.length - pendingDiffs.length} 条`} mono />
            </div>

            <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-white">
              {loadingDiffs ? (
                <div className="grid gap-3 p-4">
                  <div className="h-4 w-2/5 animate-pulse rounded bg-zinc-100" />
                  <div className="h-4 w-4/5 animate-pulse rounded bg-zinc-100" />
                  <div className="h-4 w-3/5 animate-pulse rounded bg-zinc-100" />
                </div>
              ) : qualityDiffs.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted">当前校验任务暂无字段差异</div>
              ) : qualityDiffs.slice(0, 8).map((diff) => (
                <div key={diff.id} className="grid gap-3 p-3 text-sm xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_auto] xl:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-coal">{diff.sourceTable}</span>
                      <span className="text-muted">to</span>
                      <span className="truncate font-medium text-coal">{diff.targetTable}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted">
                      <span className="font-mono">{diff.primaryKey}</span>
                      <span>{diff.fieldName}</span>
                      <span>{diffTypeLabel(diff.diffType)}</span>
                    </div>
                  </div>
                  <div className="grid gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg border border-line bg-[#fcfcf8] p-2">
                      <div className="text-muted">源端</div>
                      <div className="mt-1 truncate font-mono text-coal">{diff.sourceValue}</div>
                    </div>
                    <div className="rounded-lg border border-line bg-[#fcfcf8] p-2">
                      <div className="text-muted">目标端</div>
                      <div className="mt-1 truncate font-mono text-coal">{diff.targetValue}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    <span className={cx("rounded-full border px-2 py-1 text-xs", severityClass(diff.severity))}>{riskLabel(diff.severity)}</span>
                    <span className={cx("rounded-full border px-2 py-1 text-xs", diffStatusClass(diff.status))}>{diffStatusLabel(diff.status)}</span>
                    <button
                      onClick={() => correctDiffs([diff.id])}
                      disabled={!canManage || diff.status === "corrected" || correctingDiff === diff.id || latestJob.status !== "completed"}
                      className="rounded-lg border border-line bg-white px-3 py-2 text-xs text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {correctingDiff === diff.id ? "订正中" : "订正"}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {qualityDiffs.length > 8 && (
              <div className="mt-3 text-xs text-muted">已展示前 8 条高优先级差异，其余差异可通过批量订正处理。</div>
            )}
          </div>
        )}

        <div className="mt-5 divide-y divide-line rounded-lg border border-line">
          {relevantJobs.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted">暂无能力任务，创建后会显示执行历史</div>
          ) : relevantJobs.slice(0, 6).map((job) => {
            const task = tasks.find((item) => item.id === job.taskId);
            return (
              <div key={job.id} className="grid gap-3 p-3 text-sm lg:grid-cols-[1fr_120px_auto] lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-coal">{job.name}</span>
                    <JobBadge status={job.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{task?.name || job.taskId}</span>
                    {task && <StatusBadge status={task.status} />}
                  </div>
                </div>
                <div className="font-mono text-zinc-700">{job.progressPercent}%</div>
                <button
                  onClick={() => runJob(job)}
                  disabled={job.status === "running"}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {job.status === "running" ? <ArrowsClockwise size={16} /> : <Play size={16} />}
                  {job.status === "running" ? "执行中" : "重跑"}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
