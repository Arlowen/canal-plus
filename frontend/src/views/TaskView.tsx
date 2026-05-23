import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowsClockwise,
  ClockCounterClockwise,
  ClipboardText,
  Copy,
  FileText,
  FunnelSimple,
  GearSix,
  MapPinLine,
  MagnifyingGlass,
  Pause,
  Play,
  Plus,
  SortAscending,
  Stop,
  Trash,
  WarningCircle
} from "@phosphor-icons/react";
import { PermissionNotice } from "../components/PermissionNotice";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { cx, formatDate, formatNumber } from "../lib/format";
import { taskStatusText } from "../lib/taskStatus";
import type { ClusterSnapshot, ErrorEvent, OperationLog, SyncStrategy, SyncTask, TaskCheckpoint, TaskExport, TaskRevision, TaskStatus } from "../types/api";
import { TaskInsightPanel } from "./TaskInsightPanel";

type TaskAction = "start" | "pause" | "resume" | "stop" | "copy";
type StatusFilter = "all" | TaskStatus;
type SortMode = "delay_desc" | "updated_desc" | "throughput_desc" | "name_asc";

const taskStatusOrder: TaskStatus[] = ["incremental_running", "full_syncing", "failed", "paused", "pending", "stopped", "draft"];

const sortLabels: Record<SortMode, string> = {
  delay_desc: "延迟最高",
  updated_desc: "最近更新",
  throughput_desc: "吞吐最高",
  name_asc: "名称 A-Z"
};

function progressOf(task: SyncTask) {
  const runtime = task.runtime;
  if (!runtime || runtime.fullTotalRows === 0) return 0;
  return Math.min(100, Math.round((runtime.fullSyncedRows / runtime.fullTotalRows) * 100));
}

function taskSearchText(task: SyncTask) {
  return [
    task.name,
    task.description,
    task.owner,
    task.sourceDatasource?.name,
    task.targetDatasource?.name,
    task.runtime?.nodeId,
    taskStatusText[task.status],
    ...task.tableMappings.flatMap((mapping) => [
      mapping.sourceSchema,
      mapping.sourceTable,
      mapping.targetSchema,
      mapping.targetTable
    ])
  ].filter(Boolean).join(" ").toLowerCase();
}

function sortTasks(tasks: SyncTask[], sortMode: SortMode) {
  const nextTasks = [...tasks];
  nextTasks.sort((left, right) => {
    if (sortMode === "name_asc") return left.name.localeCompare(right.name, "zh-Hans-CN");
    if (sortMode === "updated_desc") return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (sortMode === "throughput_desc") {
      return (right.runtime?.eventsPerSecond ?? 0) - (left.runtime?.eventsPerSecond ?? 0) || left.name.localeCompare(right.name, "zh-Hans-CN");
    }
    return (right.runtime?.delaySeconds ?? 0) - (left.runtime?.delaySeconds ?? 0) || left.name.localeCompare(right.name, "zh-Hans-CN");
  });
  return nextTasks;
}

function buildStatusCounts(tasks: SyncTask[]) {
  const counts: Record<TaskStatus, number> = {
    draft: 0,
    pending: 0,
    full_syncing: 0,
    incremental_running: 0,
    paused: 0,
    failed: 0,
    stopped: 0
  };
  tasks.forEach((task) => {
    counts[task.status] += 1;
  });
  return counts;
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-[#fcfcf8] p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("mt-2 text-sm font-medium text-coal", mono && "font-mono")}>{value}</div>
    </div>
  );
}

const checkpointReasonText: Record<string, string> = {
  create: "创建任务",
  import: "导入快照",
  runtime_tick: "运行推进",
  failover_takeover: "故障接管",
  lease_assign: "分配节点",
  lease_unassigned: "等待接管",
  manual_reset: "手动重置",
  rerun: "任务重跑",
  lifecycle_start: "启动任务",
  lifecycle_resume: "恢复任务",
  lifecycle_pause: "暂停任务",
  lifecycle_stop: "停止任务"
};

const checkpointPhaseText: Record<string, string> = {
  idle: "空闲",
  full: "全量",
  incremental: "增量",
  paused: "暂停",
  failed: "异常",
  stopped: "停止"
};

function checkpointReason(reason: string) {
  return checkpointReasonText[reason] || reason;
}

function checkpointPhase(phase: string) {
  return checkpointPhaseText[phase] || phase;
}

function checkpointTone(reason: string) {
  if (reason === "failover_takeover") return "bg-amber-500";
  if (reason === "lease_unassigned") return "bg-red-500";
  if (reason === "manual_reset" || reason.startsWith("lifecycle_")) return "bg-zinc-500";
  return "bg-emerald-500";
}

function EmptyTaskState({ canManage, onCreate }: { canManage: boolean; onCreate: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-[#fcfcf8] p-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-zinc-500">
        <ClipboardText size={18} />
      </div>
      <div className="mt-3 font-medium text-coal">暂无同步任务</div>
      <div className="mt-1 text-sm text-muted">先创建第一条任务</div>
      {canManage && (
        <button
          onClick={onCreate}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98]"
        >
          <Plus size={16} />
          新建任务
        </button>
      )}
    </div>
  );
}

function EmptyFilteredTaskState({ onReset }: { onReset: () => void }) {
  return (
    <div className="m-5 rounded-lg border border-dashed border-line bg-[#fcfcf8] p-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-zinc-500">
        <FunnelSimple size={18} />
      </div>
      <div className="mt-3 font-medium text-coal">没有匹配的任务</div>
      <div className="mt-1 text-sm text-muted">调整关键词或状态后再查看</div>
      <button
        onClick={onReset}
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98]"
      >
        <FunnelSimple size={16} />
        清空筛选
      </button>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled
}: {
  icon: typeof Play;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

type TaskTool = "params" | "position" | "export" | "versions" | "checkpoints" | "lifecycle";

function TaskFunctionPanel({ task, canManage, onChanged }: { task: SyncTask; canManage: boolean; onChanged: () => Promise<void> | void }) {
  const [activeTool, setActiveTool] = useState<TaskTool>("export");
  const [params, setParams] = useState({
    batchSize: task.strategy.batchSize,
    retryTimes: task.strategy.retryTimes,
    retryIntervalSeconds: task.strategy.retryIntervalSeconds,
    conflictStrategy: task.strategy.conflictStrategy,
    deleteStrategy: task.strategy.deleteStrategy
  });
  const [position, setPosition] = useState({
    binlogFile: task.runtime?.binlogFile || "mysql-bin.000001",
    binlogPosition: task.runtime?.binlogPosition || 4,
    serverId: ""
  });
  const [exported, setExported] = useState<TaskExport | null>(null);
  const [revisions, setRevisions] = useState<TaskRevision[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [checkpoints, setCheckpoints] = useState<TaskCheckpoint[]>([]);
  const [loadingCheckpoints, setLoadingCheckpoints] = useState(false);
  const [rollbackVersion, setRollbackVersion] = useState<number | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canRerun = task.status === "stopped" || task.status === "failed";
  const canDelete = task.status === "stopped" || task.status === "draft";
  const latestCheckpoint = checkpoints[0];
  const currentCheckpointPosition = latestCheckpoint
    ? `${latestCheckpoint.binlogFile}:${formatNumber(latestCheckpoint.binlogPosition)}`
    : task.runtime
      ? `${task.runtime.binlogFile}:${formatNumber(task.runtime.binlogPosition)}`
      : "-";

  useEffect(() => {
    if (!canManage && activeTool !== "export") setActiveTool("export");
  }, [activeTool, canManage]);

  useEffect(() => {
    if (activeTool !== "versions") return;
    setLoadingRevisions(true);
    setError(null);
    api.taskRevisions(task.id)
      .then(setRevisions)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "读取版本失败"))
      .finally(() => setLoadingRevisions(false));
  }, [activeTool, task.id]);

  useEffect(() => {
    if (activeTool !== "checkpoints") return;
    setLoadingCheckpoints(true);
    setError(null);
    api.taskCheckpoints(task.id)
      .then(setCheckpoints)
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "读取位点历史失败"))
      .finally(() => setLoadingCheckpoints(false));
  }, [activeTool, task.id]);

  const updateParams = async () => {
    if (!canManage) {
      setError("修改任务参数需要管理员权限");
      return;
    }
    setError(null);
    const response = await api.updateTaskParams(task.id, {
      batchSize: Number(params.batchSize),
      retryTimes: Number(params.retryTimes),
      retryIntervalSeconds: Number(params.retryIntervalSeconds),
      conflictStrategy: params.conflictStrategy as SyncStrategy["conflictStrategy"],
      deleteStrategy: params.deleteStrategy as SyncStrategy["deleteStrategy"]
    }).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : "参数修改失败");
      return null;
    });
    if (!response) return;
    setMessage(response.message);
    await onChanged();
  };

  const resetPosition = async () => {
    if (!canManage) {
      setError("重置同步位点需要管理员权限");
      return;
    }
    setError(null);
    const response = await api.resetTaskPosition(task.id, {
      binlogFile: position.binlogFile,
      binlogPosition: Number(position.binlogPosition),
      serverId: position.serverId || undefined
    }).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : "位点重置失败");
      return null;
    });
    if (!response) return;
    setMessage(response.message);
    await onChanged();
  };

  const exportTask = async () => {
    setError(null);
    const response = await api.exportTask(task.id).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : "导出失败");
      return null;
    });
    if (!response) return;
    setExported(response);
    setMessage("任务配置已生成导出包");
  };

  const rerunTask = async () => {
    if (!canManage) {
      setError("重跑任务需要管理员权限");
      return;
    }
    setError(null);
    const response = await api.rerunTask(task.id).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : "重跑失败");
      return null;
    });
    if (!response) return;
    setMessage(response.message);
    await onChanged();
  };

  const deleteTask = async () => {
    if (!canManage) {
      setError("删除任务需要管理员权限");
      return;
    }
    setError(null);
    const deleted = await api.deleteTask(task.id).then(() => true).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : "删除失败");
      return false;
    });
    if (!deleted) return;
    setMessage("任务已删除");
    await onChanged();
  };

  const rollbackRevision = async (version: number) => {
    if (!canManage) {
      setError("回滚任务配置需要管理员权限");
      return;
    }
    setRollbackVersion(version);
    setError(null);
    const response = await api.rollbackTaskRevision(task.id, version).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : "回滚失败");
      return null;
    });
    setRollbackVersion(null);
    if (!response) return;
    setMessage(response.message);
    const nextRevisions = await api.taskRevisions(task.id).catch(() => revisions);
    setRevisions(nextRevisions);
    await onChanged();
  };

  const toolItems = [
    { id: "params", label: "修改参数", icon: GearSix, adminOnly: true },
    { id: "position", label: "重置位点", icon: ArrowsClockwise, adminOnly: true },
    { id: "export", label: "导出任务", icon: FileText, adminOnly: false },
    { id: "versions", label: "版本记录", icon: ClockCounterClockwise, adminOnly: false },
    { id: "checkpoints", label: "位点历史", icon: MapPinLine, adminOnly: false },
    { id: "lifecycle", label: "生命周期", icon: Stop, adminOnly: true }
  ] as const;

  return (
    <div className="mt-5 rounded-xl border border-line bg-[#fcfcf8] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-coal">更多操作</div>
        </div>
        <span className="rounded-full border border-line bg-white px-2 py-1 text-xs text-muted">v{task.configVersion}</span>
      </div>

      <label className="mt-4 block">
        <span className="mb-2 block text-xs font-medium text-zinc-700">操作</span>
        <select className="control" value={activeTool} onChange={(event) => setActiveTool(event.target.value as TaskTool)}>
          {toolItems.filter((item) => !item.adminOnly || canManage).map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>

      {!canManage && (
        <div className="mt-4">
          <PermissionNotice compact description="当前角色可启停任务和导出配置；参数、位点、重跑、删除等配置动作需要管理员权限。" />
        </div>
      )}

      {message && <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <WarningCircle size={16} />
          {error}
        </div>
      )}

      {activeTool === "params" && (
        <div className="mt-4 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">批量写入</span>
              <input className="control" type="number" value={params.batchSize} disabled={!canManage} onChange={(event) => setParams({ ...params, batchSize: Number(event.target.value) })} />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">重试次数</span>
              <input className="control" type="number" value={params.retryTimes} disabled={!canManage} onChange={(event) => setParams({ ...params, retryTimes: Number(event.target.value) })} />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">重试间隔</span>
              <input className="control" type="number" value={params.retryIntervalSeconds} disabled={!canManage} onChange={(event) => setParams({ ...params, retryIntervalSeconds: Number(event.target.value) })} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">冲突策略</span>
              <select className="control" value={params.conflictStrategy} disabled={!canManage} onChange={(event) => setParams({ ...params, conflictStrategy: event.target.value as SyncStrategy["conflictStrategy"] })}>
                <option value="overwrite">覆盖</option>
                <option value="ignore">忽略</option>
                <option value="fail">失败停止</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">删除策略</span>
              <select className="control" value={params.deleteStrategy} disabled={!canManage} onChange={(event) => setParams({ ...params, deleteStrategy: event.target.value as SyncStrategy["deleteStrategy"] })}>
                <option value="physical">物理删除</option>
                <option value="soft_delete">软删除字段更新</option>
                <option value="ignore">忽略删除</option>
              </select>
            </label>
          </div>
          <button onClick={updateParams} disabled={!canManage} className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45">
            <GearSix size={16} />
            生效配置
          </button>
        </div>
      )}

      {activeTool === "position" && (
        <div className="mt-4 grid gap-3">
          {task.status !== "stopped" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              重置位点前需要先停止任务，避免跳过或重复消费增量日志。
            </div>
          )}
          <label className="block">
            <span className="mb-2 block text-xs font-medium text-zinc-700">Binlog 文件</span>
            <input className="control font-mono" value={position.binlogFile} disabled={!canManage} onChange={(event) => setPosition({ ...position, binlogFile: event.target.value })} />
          </label>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">Position</span>
              <input className="control font-mono" type="number" value={position.binlogPosition} disabled={!canManage} onChange={(event) => setPosition({ ...position, binlogPosition: Number(event.target.value) })} />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">Server ID</span>
              <input className="control font-mono" value={position.serverId} disabled={!canManage} onChange={(event) => setPosition({ ...position, serverId: event.target.value })} />
            </label>
          </div>
          <button
            onClick={resetPosition}
            disabled={!canManage || task.status !== "stopped"}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ArrowsClockwise size={16} />
            确认重置
          </button>
        </div>
      )}

      {activeTool === "export" && (
        <div className="mt-4 grid gap-3">
          <button onClick={exportTask} className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98]">
            <FileText size={16} />
            生成导出包
          </button>
          {exported && (
            <div className="rounded-lg border border-line bg-white p-3">
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <span>checksum</span>
                <span className="font-mono">{exported.checksum.slice(0, 16)}</span>
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs text-zinc-700">
{JSON.stringify(exported, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {activeTool === "versions" && (
        <div className="mt-4 grid gap-3">
          {loadingRevisions ? (
            <div className="rounded-lg border border-line bg-white p-4 text-sm text-muted">正在读取版本记录</div>
          ) : revisions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line bg-white p-5 text-center text-sm text-muted">
              暂无版本记录，下一次配置变更后会自动生成快照。
            </div>
          ) : (
            <div className="divide-y divide-line rounded-lg border border-line bg-white">
              {revisions.map((revision) => {
                const current = revision.version === task.configVersion;
                const fieldCount = revision.snapshot.tableMappings.reduce((total, mapping) => total + mapping.fields.filter((field) => !field.ignored).length, 0);
                return (
                  <div key={revision.id} className="grid gap-3 p-3 text-sm lg:grid-cols-[90px_minmax(0,1fr)_auto] lg:items-center">
                    <div className="font-mono text-lg font-semibold text-coal">v{revision.version}</div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-coal">{revision.summary}</span>
                        <span className="rounded-full border border-line bg-[#fcfcf8] px-2 py-0.5 text-xs text-muted">{revision.changeType}</span>
                        {current && <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">当前</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500">
                        <span>{formatDate(revision.createdAt)}</span>
                        <span>{revision.actor}</span>
                        <span>{revision.snapshot.tableMappings.length} tables</span>
                        <span>{fieldCount} fields</span>
                      </div>
                    </div>
                    <button
                      onClick={() => rollbackRevision(revision.version)}
                      disabled={!canManage || current || rollbackVersion === revision.version}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <ClockCounterClockwise size={16} />
                      {rollbackVersion === revision.version ? "回滚中" : "回滚"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {!canManage && (
            <PermissionNotice compact description="当前角色可查看配置版本记录；回滚任务配置需要管理员权限。" />
          )}
        </div>
      )}

      {activeTool === "checkpoints" && (
        <div className="mt-4 grid gap-3">
          <div className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-700">
            当前恢复点 <span className="ml-2 font-mono text-coal">{currentCheckpointPosition}</span>
          </div>
          {loadingCheckpoints ? (
            <div className="grid gap-2">
              {[0, 1, 2].map((index) => (
                <div key={index} className="h-20 animate-pulse rounded-lg border border-line bg-white" />
              ))}
            </div>
          ) : checkpoints.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line bg-white p-5 text-center text-sm text-muted">
              暂无位点历史，任务启动后会生成第一条检查点。
            </div>
          ) : (
            <div className="divide-y divide-line rounded-lg border border-line bg-white">
              {checkpoints.map((checkpoint) => {
                const handoff = checkpoint.previousNodeId && checkpoint.previousNodeId !== checkpoint.nodeId;
                return (
                  <div key={checkpoint.id} className="grid gap-3 p-3 text-sm lg:grid-cols-[150px_minmax(0,1fr)_190px] lg:items-center">
                    <div>
                      <div className="flex items-center gap-2 font-medium text-coal">
                        <span className={cx("h-2 w-2 rounded-full", checkpointTone(checkpoint.reason))} />
                        {checkpointReason(checkpoint.reason)}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">{formatDate(checkpoint.createdAt)}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="break-all font-mono text-sm font-semibold text-coal">
                        {checkpoint.binlogFile}:{formatNumber(checkpoint.binlogPosition)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-500">
                        <span>{checkpointPhase(checkpoint.phase)}</span>
                        <span>node {checkpoint.nodeId || "待分配"}</span>
                        <span>epoch {checkpoint.leaseEpoch || "-"}</span>
                        {handoff && <span>{checkpoint.previousNodeId} -&gt; {checkpoint.nodeId}</span>}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-md border border-line bg-[#fcfcf8] px-2 py-1.5">
                        <div className="text-[11px] text-muted">延迟</div>
                        <div className="font-mono text-sm text-coal">{checkpoint.delaySeconds}s</div>
                      </div>
                      <div className="rounded-md border border-line bg-[#fcfcf8] px-2 py-1.5">
                        <div className="text-[11px] text-muted">吞吐</div>
                        <div className="font-mono text-sm text-coal">{checkpoint.eventsPerSecond}/s</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTool === "lifecycle" && (
        <div className="mt-4 grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              onClick={rerunTask}
              disabled={!canManage || !canRerun}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ArrowsClockwise size={16} />
              重跑任务
            </button>
            <button
              onClick={deleteTask}
              disabled={!canManage || !canDelete || confirmText !== "DELETE_TASK"}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Trash size={16} />
              删除任务
            </button>
          </div>
          {!canRerun && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              重跑前需要先停止任务，异常任务可直接重跑。
            </div>
          )}
          <label className="block">
            <span className="mb-2 block text-xs font-medium text-zinc-700">删除确认</span>
            <input className="control font-mono" value={confirmText} disabled={!canManage} onChange={(event) => setConfirmText(event.target.value)} placeholder="DELETE_TASK" />
          </label>
        </div>
      )}
    </div>
  );
}

export function TaskView({
  tasks,
  errors,
  logs,
  cluster,
  canManage,
  onAction,
  onCreate,
  onChanged
}: {
  tasks: SyncTask[];
  errors: ErrorEvent[];
  logs: OperationLog[];
  cluster: ClusterSnapshot | null;
  canManage: boolean;
  onAction: (task: SyncTask, action: TaskAction) => Promise<void>;
  onCreate: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(tasks[0]?.id ?? null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("delay_desc");
  const statusCounts = useMemo(() => buildStatusCounts(tasks), [tasks]);
  const visibleTasks = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const filteredTasks = tasks.filter((task) => {
      const matchesKeyword = !normalizedKeyword || taskSearchText(task).includes(normalizedKeyword);
      const matchesStatus = statusFilter === "all" || task.status === statusFilter;
      return matchesKeyword && matchesStatus;
    });
    return sortTasks(filteredTasks, sortMode);
  }, [keyword, sortMode, statusFilter, tasks]);
  const selected = visibleTasks.find((task) => task.id === selectedId) ?? visibleTasks[0];
  const selectedErrors = selected ? errors.filter((event) => event.taskId === selected.id) : [];
  const selectedLogs = selected ? logs.filter((log) => log.targetId === selected.id || log.detail.includes(selected.name)) : [];
  const selectedLease = selected ? cluster?.leases.find((lease) => lease.taskId === selected.id) : undefined;
  const selectedNode = cluster?.nodes.find((node) => node.id === (selectedLease?.nodeId || selected?.runtime?.nodeId));
  const filterActive = Boolean(keyword.trim()) || statusFilter !== "all" || sortMode !== "delay_desc";

  useEffect(() => {
    if (tasks.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (visibleTasks.length === 0) return;
    if (!selectedId || !visibleTasks.some((task) => task.id === selectedId)) setSelectedId(visibleTasks[0].id);
  }, [selectedId, tasks.length, visibleTasks]);

  const resetFilters = () => {
    setKeyword("");
    setStatusFilter("all");
    setSortMode("delay_desc");
  };

  if (tasks.length === 0) {
    return <EmptyTaskState canManage={canManage} onCreate={onCreate} />;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_460px]">
      <section className="min-w-0 rounded-xl border border-line bg-white shadow-panel">
        <div className="border-b border-line p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-coal">任务</h2>
            </div>
            {canManage && (
              <button
                onClick={onCreate}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98]"
              >
                <Plus size={16} />
                新建任务
              </button>
            )}
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_170px]">
            <label className="block min-w-0">
              <span className="mb-2 block text-xs font-medium text-zinc-700">搜索</span>
              <span className="relative block">
                <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={17} />
                <input
                  className="control pl-9"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="名称、表、数据源、节点"
                />
              </span>
            </label>
            <label className="block">
              <span className="mb-2 flex items-center gap-1 text-xs font-medium text-zinc-700">
                <SortAscending size={14} />
                排序
              </span>
              <select className="control" value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                {Object.entries(sortLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStatusFilter("all")}
              className={cx(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition active:scale-[0.98]",
                statusFilter === "all" ? "border-coal bg-coal text-white" : "border-line bg-white text-zinc-600 hover:bg-zinc-50"
              )}
            >
              全部
              <span className={cx("font-mono", statusFilter === "all" ? "text-zinc-200" : "text-muted")}>{tasks.length}</span>
            </button>
            {taskStatusOrder.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cx(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition active:scale-[0.98]",
                  statusFilter === status ? "border-coal bg-coal text-white" : "border-line bg-white text-zinc-600 hover:bg-zinc-50"
                )}
              >
                {taskStatusText[status]}
                <span className={cx("font-mono", statusFilter === status ? "text-zinc-200" : "text-muted")}>{statusCounts[status]}</span>
              </button>
            ))}
            {filterActive && (
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-[#fcfcf8] px-3 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-50 active:scale-[0.98]"
              >
                <FunnelSimple size={14} />
                清空
              </button>
            )}
          </div>
        </div>
        <div className="divide-y divide-line">
          {visibleTasks.length === 0 && <EmptyFilteredTaskState onReset={resetFilters} />}
          {visibleTasks.map((task) => (
            <button
              key={task.id}
              onClick={() => setSelectedId(task.id)}
              className={cx(
                "grid w-full min-w-0 gap-4 p-5 text-left transition hover:bg-zinc-50 md:grid-cols-[minmax(0,1.2fr)_minmax(190px,0.8fr)_minmax(150px,0.7fr)] md:items-center",
                selected?.id === task.id && "bg-[#f7faf6]"
              )}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium text-coal">{task.name}</span>
                  <StatusBadge status={task.status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
                  <span className="rounded-full border border-line bg-white px-2 py-1">负责人 {task.owner}</span>
                  <span className="rounded-full border border-line bg-white px-2 py-1">v{task.configVersion}</span>
                </div>
              </div>
              <div className="min-w-0 text-sm text-zinc-700">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{task.sourceDatasource?.name || task.sourceDatasourceId}</span>
                  <ArrowRight size={15} className="shrink-0 text-zinc-400" />
                  <span className="truncate">{task.targetDatasource?.name || task.targetDatasourceId}</span>
                </div>
                <div className="mt-2 truncate font-mono text-xs text-zinc-500">
                  {task.runtime?.binlogFile ?? "-"}:{task.runtime?.binlogPosition ?? "-"}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm text-zinc-600">
                <span className="rounded-lg border border-line bg-[#fcfcf8] px-2 py-2">
                  <span className="block text-xs text-muted">延迟</span>
                  <span className="font-mono text-coal">{task.runtime?.delaySeconds ?? 0}s</span>
                </span>
                <span className="rounded-lg border border-line bg-[#fcfcf8] px-2 py-2">
                  <span className="block text-xs text-muted">吞吐</span>
                  <span className="font-mono text-coal">{task.runtime?.eventsPerSecond ?? 0}/s</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {selected && (
        <aside className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-coal">{selected.name}</h2>
              <div className="mt-1 text-sm text-muted">配置版本 v{selected.configVersion}</div>
            </div>
            <StatusBadge status={selected.status} />
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <Info label="负责人" value={selected.owner} />
            <Info label="阶段" value={selected.runtime?.phase || "-"} />
            <Info label="全量进度" value={`${progressOf(selected)}%`} />
            <Info label="延迟" value={`${selected.runtime?.delaySeconds ?? 0}s`} mono />
          </div>

          <div className="mt-5 rounded-lg border border-line bg-[#fcfcf8] p-4">
            <div className="text-sm font-medium text-coal">链路</div>
            <div className="mt-3 flex items-center gap-2 text-sm text-zinc-700">
              <span>{selected.sourceDatasource?.name}</span>
              <ArrowRight size={16} />
              <span>{selected.targetDatasource?.name}</span>
            </div>
            <div className="mt-3 text-sm text-muted">
              {selected.tableMappings.map((mapping) => `${mapping.sourceSchema}.${mapping.sourceTable} 到 ${mapping.targetSchema}.${mapping.targetTable}`).join("，")}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <ActionButton icon={Play} label="启动" onClick={() => onAction(selected, "start")} disabled={selected.status === "incremental_running" || selected.status === "full_syncing"} />
            <ActionButton icon={Pause} label="暂停" onClick={() => onAction(selected, "pause")} disabled={selected.status === "paused" || selected.status === "stopped"} />
            <ActionButton icon={Play} label="恢复" onClick={() => onAction(selected, "resume")} disabled={selected.status !== "paused" && selected.status !== "failed"} />
            <ActionButton icon={Stop} label="停止" onClick={() => onAction(selected, "stop")} disabled={selected.status === "stopped"} />
            <ActionButton icon={Copy} label="复制" onClick={() => onAction(selected, "copy")} disabled={!canManage} />
          </div>

          {!canManage && (
            <div className="mt-4">
              <PermissionNotice compact description="当前角色可启停任务、查看运行态和处理异常；复制任务需要管理员权限。" />
            </div>
          )}

          <TaskInsightPanel task={selected} lease={selectedLease} node={selectedNode} errors={selectedErrors} logs={selectedLogs} />

          <TaskFunctionPanel key={selected.id} task={selected} canManage={canManage} onChanged={onChanged} />
        </aside>
      )}
    </div>
  );
}
