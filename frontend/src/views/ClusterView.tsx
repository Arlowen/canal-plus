import { useState } from "react";
import {
  ArrowsClockwise,
  ChartLineUp,
  ClockClockwise,
  Cpu,
  HardDrives,
  Pulse,
  ShieldCheck,
  WarningCircle
} from "@phosphor-icons/react";
import { PermissionNotice } from "../components/PermissionNotice";
import { api } from "../lib/api";
import { cx, formatDate, secondsSince } from "../lib/format";
import type { ClusterNode, ClusterSnapshot, SyncTask } from "../types/api";

function NodeBadge({ status }: { status: ClusterNode["status"] }) {
  const label = status === "online" ? "在线" : status === "draining" ? "排空" : "离线";
  const className = status === "online"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "draining"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-red-200 bg-red-50 text-red-700";
  return <span className={cx("rounded-full border px-2 py-0.5 text-xs", className)}>{label}</span>;
}

function MiniMeter({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <Icon size={14} />
          {label}
        </span>
        <span className="font-mono">{value}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full rounded-full bg-coal transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

function ClusterStat({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone?: "warn" | "ok" }) {
  return (
    <div className={cx(
      "rounded-xl border p-4",
      tone === "warn" ? "border-amber-200 bg-amber-50" : tone === "ok" ? "border-emerald-200 bg-emerald-50" : "border-line bg-[#fcfcf8]"
    )}>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-2 font-mono text-2xl font-semibold text-coal">{value}</div>
      <div className="mt-1 text-xs text-zinc-600">{detail}</div>
    </div>
  );
}

export function ClusterView({
  cluster,
  tasks,
  canManage,
  onChanged
}: {
  cluster: ClusterSnapshot | null;
  tasks: SyncTask[];
  canManage: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [busyNode, setBusyNode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nodes = cluster?.nodes ?? [];
  const leases = cluster?.leases ?? [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const onlineNodes = cluster?.onlineNodes ?? nodes.filter((node) => node.status === "online").length;
  const degradedNodes = cluster?.degradedNodes ?? Math.max(0, nodes.length - onlineNodes);
  const heartbeatTimeoutSeconds = cluster?.heartbeatTimeoutSeconds ?? 30;

  const runNodeAction = async (node: ClusterNode, action: "online" | "offline" | "drain" | "heartbeat") => {
    if (!canManage) {
      setError("节点上下线和排空需要管理员权限");
      return;
    }
    setBusyNode(node.id);
    setError(null);
    try {
      await api.nodeAction(node.id, action);
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "节点操作失败");
    } finally {
      setBusyNode(null);
    }
  };

  const rebalance = async () => {
    if (!canManage) {
      setError("重新均衡需要管理员权限");
      return;
    }
    setBusyNode("rebalance");
    setError(null);
    try {
      await api.rebalanceCluster();
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "重新均衡失败");
    } finally {
      setBusyNode(null);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
      <section className="rounded-xl border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-coal">Node 集群</h2>
            <div className="mt-1 text-sm text-muted">任务租约、节点心跳和自动接管</div>
          </div>
          <button
            onClick={rebalance}
            disabled={!canManage || busyNode === "rebalance"}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowsClockwise size={16} />
            重新均衡
          </button>
        </div>

        {(!canManage || error) && (
          <div className="grid gap-3 border-b border-line p-5">
            {!canManage && (
              <PermissionNotice compact description="当前角色可查看节点、租约和自动接管状态；节点上下线、排空和重新均衡需要管理员权限。" />
            )}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 border-b border-line p-5 sm:grid-cols-2 xl:grid-cols-4">
          <ClusterStat label="在线节点" value={`${onlineNodes}/${nodes.length}`} detail="可承载任务的 worker" tone={degradedNodes === 0 ? "ok" : undefined} />
          <ClusterStat label="降级节点" value={degradedNodes} detail="离线或排空节点" tone={degradedNodes > 0 ? "warn" : undefined} />
          <ClusterStat label="接管次数" value={cluster?.failovers ?? 0} detail="lease epoch 切换累计" />
          <ClusterStat label="心跳超时" value={`${heartbeatTimeoutSeconds}s`} detail="超时后自动接管" />
        </div>

        <div className="grid gap-4 p-5 lg:grid-cols-3">
          {nodes.map((node) => {
            const heartbeatAge = secondsSince(node.lastHeartbeatAt);
            const heartbeatRisk = node.status === "online" && heartbeatAge > heartbeatTimeoutSeconds;
            return (
              <div key={node.id} className="rounded-xl border border-line bg-[#fcfcf8] p-4 transition hover:-translate-y-0.5 hover:shadow-panel">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <HardDrives size={18} className="text-accent" />
                      <span className="font-semibold text-coal">{node.name}</span>
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted">{node.endpoint}</div>
                  </div>
                  <NodeBadge status={node.status} />
                </div>

                <div className={cx(
                  "mt-4 flex items-center justify-between rounded-lg border px-3 py-2 text-xs",
                  heartbeatRisk || node.status === "offline"
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-line bg-white text-zinc-600"
                )}>
                  <span className="inline-flex items-center gap-1">
                    <ClockClockwise size={14} />
                    心跳 {heartbeatAge}s 前
                  </span>
                  <span>{formatDate(node.lastHeartbeatAt)}</span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <MiniMeter icon={Cpu} label="CPU" value={node.cpuPercent} />
                  <MiniMeter icon={ChartLineUp} label="MEM" value={node.memoryPercent} />
                </div>

                <div className="mt-4 rounded-lg border border-line bg-white p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">运行任务</span>
                    <span className="font-mono text-coal">{node.runningTasks}/{node.capacity}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.min(100, (node.runningTasks / Math.max(1, node.capacity)) * 100)}%` }} />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <button onClick={() => runNodeAction(node, "offline")} disabled={!canManage || busyNode === node.id || node.status === "offline"} className="node-action">下线</button>
                  <button onClick={() => runNodeAction(node, "drain")} disabled={!canManage || busyNode === node.id || node.status === "draining"} className="node-action">排空</button>
                  <button onClick={() => runNodeAction(node, "online")} disabled={!canManage || busyNode === node.id || node.status === "online"} className="node-action">恢复</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <aside className="space-y-5">
        <div className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2 text-coal">
            <ShieldCheck size={20} />
            <h2 className="font-semibold tracking-tight">接管策略</h2>
          </div>
          <div className="mt-4 grid gap-3 text-sm text-zinc-600">
            <div className="rounded-lg border border-line bg-[#fcfcf8] p-3">任务以 lease 绑定 node，租约过期或节点离线会触发重分配。</div>
            <div className="rounded-lg border border-line bg-[#fcfcf8] p-3">节点心跳超过 {heartbeatTimeoutSeconds}s 未更新时，调度器会自动标记离线。</div>
            <div className="rounded-lg border border-line bg-[#fcfcf8] p-3">接管会保留 checkpoint，由新节点从最近成功位点继续。</div>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold tracking-tight text-coal">任务租约</h2>
            <span className="rounded-full border border-line px-2 py-1 font-mono text-xs text-muted">{leases.length} leases</span>
          </div>
          <div className="mt-4 space-y-3">
            {leases.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line bg-[#fcfcf8] p-5 text-center text-sm text-muted">
                当前没有需要 worker 承载的任务
              </div>
            ) : leases.map((lease) => {
              const task = taskById.get(lease.taskId);
              const expiresIn = Math.max(0, Math.round((new Date(lease.expiresAt).getTime() - Date.now()) / 1000));
              return (
                <div key={lease.taskId} className="rounded-lg border border-line bg-[#fcfcf8] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-coal">{task?.name || lease.taskId}</span>
                    <span className="font-mono text-xs text-muted">epoch {lease.epoch}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-600">
                    <span className="rounded-full bg-white px-2 py-1">{lease.nodeId}</span>
                    <span className="rounded-full bg-white px-2 py-1">接管 {lease.takeoverCount}</span>
                    <span className="rounded-full bg-white px-2 py-1">剩余 {expiresIn}s</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {degradedNodes > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-panel">
            <div className="flex items-center gap-2">
              <WarningCircle size={20} />
              <h2 className="font-semibold tracking-tight">集群处于降级状态</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed">
              离线节点上的任务已迁移到其他在线节点。恢复节点后可手动重新均衡，让任务重新按负载分布。
            </p>
          </div>
        )}

        {degradedNodes === 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 shadow-panel">
            <div className="flex items-center gap-2">
              <Pulse size={20} />
              <h2 className="font-semibold tracking-tight">接管链路正常</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed">
              所有 node 都在心跳窗口内，任务 lease 处于可接管状态。
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
