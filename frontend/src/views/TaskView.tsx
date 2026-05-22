import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowsClockwise,
  ClipboardText,
  Copy,
  FileText,
  GearSix,
  Pause,
  Play,
  Stop,
  WarningCircle
} from "@phosphor-icons/react";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import type { SyncStrategy, SyncTask, TaskExport } from "../types/api";

type TaskAction = "start" | "pause" | "resume" | "stop" | "copy";

function progressOf(task: SyncTask) {
  const runtime = task.runtime;
  if (!runtime || runtime.fullTotalRows === 0) return 0;
  return Math.min(100, Math.round((runtime.fullSyncedRows / runtime.fullTotalRows) * 100));
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-[#fcfcf8] p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("mt-2 text-sm font-medium text-coal", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function EmptyTaskState() {
  return (
    <div className="rounded-lg border border-dashed border-line bg-[#fcfcf8] p-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-zinc-500">
        <ClipboardText size={18} />
      </div>
      <div className="mt-3 font-medium text-coal">暂无同步任务</div>
      <div className="mt-1 text-sm text-muted">使用新建任务向导创建第一条链路</div>
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

function TaskFunctionPanel({ task, onChanged }: { task: SyncTask; onChanged: () => Promise<void> | void }) {
  const [activeTool, setActiveTool] = useState<"params" | "position" | "export">("params");
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateParams = async () => {
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

  const toolItems = [
    { id: "params", label: "修改参数", icon: GearSix },
    { id: "position", label: "重置位点", icon: ArrowsClockwise },
    { id: "export", label: "导出任务", icon: FileText }
  ] as const;

  return (
    <div className="mt-5 rounded-xl border border-line bg-[#fcfcf8] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-coal">功能列表</div>
          <div className="mt-1 text-xs text-muted">参数、位点和导出操作集中处理</div>
        </div>
        <span className="rounded-full border border-line bg-white px-2 py-1 text-xs text-muted">v{task.configVersion}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {toolItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTool(item.id)}
              className={cx(
                "inline-flex items-center justify-center gap-2 rounded-lg border px-2 py-2 text-sm transition active:scale-[0.98]",
                activeTool === item.id ? "border-coal bg-coal text-white" : "border-line bg-white text-zinc-700 hover:bg-zinc-50"
              )}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
      </div>

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
              <input className="control" type="number" value={params.batchSize} onChange={(event) => setParams({ ...params, batchSize: Number(event.target.value) })} />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">重试次数</span>
              <input className="control" type="number" value={params.retryTimes} onChange={(event) => setParams({ ...params, retryTimes: Number(event.target.value) })} />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">重试间隔</span>
              <input className="control" type="number" value={params.retryIntervalSeconds} onChange={(event) => setParams({ ...params, retryIntervalSeconds: Number(event.target.value) })} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">冲突策略</span>
              <select className="control" value={params.conflictStrategy} onChange={(event) => setParams({ ...params, conflictStrategy: event.target.value as SyncStrategy["conflictStrategy"] })}>
                <option value="overwrite">覆盖</option>
                <option value="ignore">忽略</option>
                <option value="fail">失败停止</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">删除策略</span>
              <select className="control" value={params.deleteStrategy} onChange={(event) => setParams({ ...params, deleteStrategy: event.target.value as SyncStrategy["deleteStrategy"] })}>
                <option value="physical">物理删除</option>
                <option value="soft_delete">软删除字段更新</option>
                <option value="ignore">忽略删除</option>
              </select>
            </label>
          </div>
          <button onClick={updateParams} className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98]">
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
            <input className="control font-mono" value={position.binlogFile} onChange={(event) => setPosition({ ...position, binlogFile: event.target.value })} />
          </label>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">Position</span>
              <input className="control font-mono" type="number" value={position.binlogPosition} onChange={(event) => setPosition({ ...position, binlogPosition: Number(event.target.value) })} />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">Server ID</span>
              <input className="control font-mono" value={position.serverId} onChange={(event) => setPosition({ ...position, serverId: event.target.value })} />
            </label>
          </div>
          <button
            onClick={resetPosition}
            disabled={task.status !== "stopped"}
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
    </div>
  );
}

export function TaskView({
  tasks,
  onAction,
  onChanged
}: {
  tasks: SyncTask[];
  onAction: (task: SyncTask, action: TaskAction) => Promise<void>;
  onChanged: () => Promise<void> | void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(tasks[0]?.id ?? null);
  const selected = tasks.find((task) => task.id === selectedId) ?? tasks[0];

  useEffect(() => {
    if (!selectedId && tasks[0]) setSelectedId(tasks[0].id);
  }, [selectedId, tasks]);

  if (tasks.length === 0) {
    return <EmptyTaskState />;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_460px]">
      <section className="rounded-xl border border-line bg-white shadow-panel">
        <div className="border-b border-line p-5">
          <h2 className="text-lg font-semibold tracking-tight text-coal">任务列表</h2>
          <div className="mt-1 text-sm text-muted">生命周期、吞吐、延迟和操作入口</div>
        </div>
        <div className="divide-y divide-line">
          {tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => setSelectedId(task.id)}
              className={cx(
                "grid w-full gap-3 p-5 text-left transition hover:bg-zinc-50 md:grid-cols-[1.2fr_0.8fr_0.7fr] md:items-center",
                selected?.id === task.id && "bg-[#f7faf6]"
              )}
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-coal">{task.name}</span>
                  <StatusBadge status={task.status} />
                </div>
                <div className="mt-1 text-sm text-muted">{task.description}</div>
              </div>
              <div className="font-mono text-sm text-zinc-700">
                {task.runtime?.binlogFile}:{task.runtime?.binlogPosition}
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm text-zinc-600">
                <span>{task.runtime?.delaySeconds ?? 0}s</span>
                <span>{task.runtime?.eventsPerSecond ?? 0}/s</span>
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
            <ActionButton icon={Copy} label="复制" onClick={() => onAction(selected, "copy")} />
          </div>

          <TaskFunctionPanel key={selected.id} task={selected} onChanged={onChanged} />
        </aside>
      )}
    </div>
  );
}
