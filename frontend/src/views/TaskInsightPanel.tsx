import { ArrowRight, BellRinging, Cloud, Pulse } from "@phosphor-icons/react";
import { cx, formatDate } from "../lib/format";
import type { ClusterNode, ErrorEvent, OperationLog, SyncTask, TaskLease } from "../types/api";

function progressOf(task: SyncTask) {
  const runtime = task.runtime;
  if (!runtime || runtime.fullTotalRows === 0) return 0;
  return Math.min(100, Math.round((runtime.fullSyncedRows / runtime.fullTotalRows) * 100));
}

function nodeLabel(node?: ClusterNode) {
  if (!node) return "未绑定";
  if (node.status === "online") return "在线";
  if (node.status === "draining") return "排空";
  return "离线";
}

function leaseSecondsLeft(lease?: TaskLease) {
  if (!lease) return 0;
  return Math.max(0, Math.round((new Date(lease.expiresAt).getTime() - Date.now()) / 1000));
}

function InsightMetric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-[#fcfcf8] p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("mt-2 text-sm font-medium text-coal", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function PipelineStep({
  label,
  value,
  active
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <div className={cx(
      "min-w-0 rounded-lg border px-3 py-2",
      active ? "border-emerald-200 bg-emerald-50" : "border-line bg-[#fcfcf8]"
    )}>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-coal">{value}</div>
    </div>
  );
}

export function TaskInsightPanel({
  task,
  lease,
  node,
  errors,
  logs
}: {
  task: SyncTask;
  lease?: TaskLease;
  node?: ClusterNode;
  errors: ErrorEvent[];
  logs: OperationLog[];
}) {
  const runtime = task.runtime;
  const activePhase = runtime?.phase || "idle";
  const riskEvents = errors.filter((event) => event.status === "pending").slice(0, 2);
  const recentLogs = logs.slice(0, 3);
  const pipeline = [
    { label: "源端", value: task.sourceDatasource?.name || task.sourceDatasourceId, active: activePhase === "idle" },
    { label: "全量", value: `${progressOf(task)}%`, active: activePhase === "full" },
    { label: "增量", value: `${runtime?.eventsPerSecond ?? 0}/s`, active: activePhase === "incremental" },
    { label: "目标端", value: task.targetDatasource?.name || task.targetDatasourceId }
  ];

  return (
    <div className="mt-5 rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-coal">运行剖面</div>
          <div className="mt-1 text-xs text-muted">链路拓扑、租约和最近事件</div>
        </div>
        <span className={cx(
          "rounded-full border px-2 py-1 text-xs",
          node?.status === "online" && "border-emerald-200 bg-emerald-50 text-emerald-700",
          node?.status === "draining" && "border-amber-200 bg-amber-50 text-amber-700",
          (!node || node.status === "offline") && "border-zinc-200 bg-zinc-50 text-zinc-600"
        )}>
          {nodeLabel(node)}
        </span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        {pipeline.map((step, index) => (
          <div key={step.label} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <PipelineStep {...step} />
            {index < pipeline.length - 1 && <ArrowRight className="hidden text-zinc-400 sm:block" size={15} />}
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <InsightMetric label="承载节点" value={node?.name || runtime?.nodeId || "-"} />
        <InsightMetric label="Lease Epoch" value={lease ? `${lease.epoch} / ${leaseSecondsLeft(lease)}s` : "-"} mono />
        <InsightMetric label="接管次数" value={`${lease?.takeoverCount ?? runtime?.failoverCount ?? 0}`} mono />
      </div>

      <div className="mt-4 grid gap-3">
        {riskEvents.length > 0 ? (
          riskEvents.map((event) => (
            <div key={event.id} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <BellRinging className="mt-0.5 shrink-0" size={16} />
              <div>
                <div className="font-medium">{event.sourceTable} 写入待处理</div>
                <div className="mt-1">{event.reason}</div>
                <div className="mt-1 font-mono text-xs">{event.binlogFile}:{event.binlogPosition}</div>
              </div>
            </div>
          ))
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <Pulse size={16} />
            当前任务暂无待处理错误
          </div>
        )}

        <div className="rounded-lg border border-line bg-[#fcfcf8] p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-coal">
            <Cloud size={16} />
            最近操作
          </div>
          {recentLogs.length === 0 ? (
            <div className="text-sm text-muted">暂无任务级操作记录</div>
          ) : (
            <div className="space-y-3">
              {recentLogs.map((log) => (
                <div key={log.id} className="border-l border-line pl-3">
                  <div className="text-sm text-zinc-700">{log.detail}</div>
                  <div className="mt-1 text-xs text-muted">{formatDate(log.createdAt)} / {log.actor}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
