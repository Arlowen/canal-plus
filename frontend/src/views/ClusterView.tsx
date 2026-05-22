import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowsClockwise,
  ChartLineUp,
  ClockClockwise,
  Cpu,
  HardDrives,
  MapPinLine,
  Pulse,
  ShieldCheck,
  WarningCircle
} from "@phosphor-icons/react";
import { PermissionNotice } from "../components/PermissionNotice";
import { api } from "../lib/api";
import { cx, formatDate, formatNumber, secondsSince } from "../lib/format";
import type { ClusterNode, ClusterNodeInput, ClusterRebalanceReport, ClusterSnapshot, FailoverDrillTask, NodeDrainReport, SyncTask } from "../types/api";

type HandoffReport = {
  id: string;
  kind: "drill" | "drain" | "rebalance";
  happenedAt: string;
  node?: ClusterNode;
  success: boolean;
  message: string;
  affectedTasks: FailoverDrillTask[];
  before: ClusterSnapshot;
  after: ClusterSnapshot;
};

function emptyNodeForm(): ClusterNodeInput {
  return {
    id: "",
    name: "",
    endpoint: "",
    zone: "default",
    role: "worker",
    capacity: 4,
    cpuPercent: 12,
    memoryPercent: 18
  };
}

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

const runtimePhaseText: Record<string, string> = {
  idle: "空闲",
  full: "全量",
  incremental: "增量",
  paused: "暂停",
  failed: "异常",
  stopped: "停止"
};

function phaseText(phase: string) {
  return runtimePhaseText[phase] || phase || "-";
}

function reportTitle(kind: HandoffReport["kind"]) {
  if (kind === "drill") return "最近故障演练";
  if (kind === "drain") return "最近维护排空";
  return "最近重新均衡";
}

function reportTrackTitle(kind: HandoffReport["kind"]) {
  if (kind === "drill") return "演练轨迹";
  if (kind === "drain") return "排空轨迹";
  return "均衡轨迹";
}

function fromDrainReport(report: NodeDrainReport): HandoffReport {
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

function fromRebalanceReport(report: ClusterRebalanceReport): HandoffReport {
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
  const [message, setMessage] = useState<string | null>(null);
  const [handoffReport, setHandoffReport] = useState<HandoffReport | null>(null);
  const [nodeForm, setNodeForm] = useState<ClusterNodeInput>(emptyNodeForm);
  const nodes = cluster?.nodes ?? [];
  const leases = cluster?.leases ?? [];
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const onlineNodes = cluster?.onlineNodes ?? nodes.filter((node) => node.status === "online").length;
  const degradedNodes = cluster?.degradedNodes ?? Math.max(0, nodes.length - onlineNodes);
  const heartbeatTimeoutSeconds = cluster?.heartbeatTimeoutSeconds ?? 30;

  const nodeName = (id?: string) => {
    if (!id) return "待分配";
    const node = nodeById.get(id) || handoffReport?.after.nodes.find((item) => item.id === id) || handoffReport?.before.nodes.find((item) => item.id === id);
    return node ? `${node.name} / ${id}` : id;
  };
  const uniqueHandoffNodes = (side: "previous" | "next") => {
    if (!handoffReport || handoffReport.affectedTasks.length === 0) return "无任务迁移";
    const ids = handoffReport.affectedTasks.map((task) => side === "previous" ? task.previousNodeId : task.newNodeId);
    return Array.from(new Set(ids)).map((id) => nodeName(id)).join(", ");
  };

  const runNodeAction = async (node: ClusterNode, action: "online" | "offline" | "heartbeat") => {
    if (!canManage) {
      setError("节点上下线和排空需要管理员权限");
      return;
    }
    setBusyNode(node.id);
    setError(null);
    setMessage(null);
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
    setMessage(null);
    try {
      const report = await api.rebalanceCluster();
      setHandoffReport(fromRebalanceReport(report));
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "重新均衡失败");
    } finally {
      setBusyNode(null);
    }
  };

  const runFailoverDrill = async (node: ClusterNode) => {
    if (!canManage) {
      setError("故障演练需要管理员权限");
      return;
    }
    setBusyNode(`drill:${node.id}`);
    setError(null);
    setMessage(null);
    try {
      const report = await api.failoverDrill(node.id);
      setHandoffReport({
        id: report.id,
        kind: "drill",
        happenedAt: report.drilledAt,
        node: report.node,
        success: report.success,
        message: report.message,
        affectedTasks: report.affectedTasks,
        before: report.before,
        after: report.after
      });
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "故障演练失败");
    } finally {
      setBusyNode(null);
    }
  };

  const drainNode = async (node: ClusterNode) => {
    if (!canManage) {
      setError("维护排空需要管理员权限");
      return;
    }
    setBusyNode(`drain:${node.id}`);
    setError(null);
    setMessage(null);
    try {
      const report = await api.drainNode(node.id);
      setHandoffReport(fromDrainReport(report));
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "维护排空失败");
    } finally {
      setBusyNode(null);
    }
  };

  const registerNode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage) {
      setError("接入新 node 需要管理员权限");
      return;
    }
    setBusyNode("register");
    setError(null);
    setMessage(null);
    try {
      const node = await api.registerNode({
        ...nodeForm,
        id: nodeForm.id?.trim() || undefined,
        name: nodeForm.name.trim(),
        endpoint: nodeForm.endpoint.trim(),
        zone: nodeForm.zone?.trim() || "default",
        role: nodeForm.role?.trim() || "worker",
        capacity: Number(nodeForm.capacity) || 4,
        cpuPercent: Number(nodeForm.cpuPercent) || 0,
        memoryPercent: Number(nodeForm.memoryPercent) || 0
      });
      setMessage(`${node.name} 已接入集群`);
      setNodeForm(emptyNodeForm());
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Node 接入失败");
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

        {(!canManage || error || message) && (
          <div className="grid gap-3 border-b border-line p-5">
            {!canManage && (
              <PermissionNotice compact description="当前角色可查看节点、租约和自动接管状态；节点上下线、排空和重新均衡需要管理员权限。" />
            )}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            {message && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                {message}
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

                <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4">
                  <button onClick={() => runNodeAction(node, "offline")} disabled={!canManage || busyNode === node.id || node.status === "offline"} className="node-action">下线</button>
                  <button onClick={() => drainNode(node)} disabled={!canManage || busyNode === `drain:${node.id}` || node.status !== "online"} className="node-action">排空</button>
                  <button onClick={() => runNodeAction(node, "online")} disabled={!canManage || busyNode === node.id || node.status === "online"} className="node-action">恢复</button>
                  <button onClick={() => runFailoverDrill(node)} disabled={!canManage || busyNode === `drill:${node.id}` || node.status !== "online"} className="node-action">演练</button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <aside className="space-y-5">
        <div className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <div className="flex items-center gap-2 text-coal">
            <HardDrives size={20} />
            <h2 className="font-semibold tracking-tight">接入 Node</h2>
          </div>
          <form className="mt-4 grid gap-3" onSubmit={registerNode}>
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-muted">节点 ID</span>
              <input
                value={nodeForm.id ?? ""}
                onChange={(event) => setNodeForm((current) => ({ ...current, id: event.target.value }))}
                className="rounded-lg border border-line bg-[#fcfcf8] px-3 py-2 text-sm outline-none transition focus:border-coal"
                placeholder="可选，默认自动生成"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted">名称</span>
                <input
                  required
                  value={nodeForm.name}
                  onChange={(event) => setNodeForm((current) => ({ ...current, name: event.target.value }))}
                  className="rounded-lg border border-line bg-[#fcfcf8] px-3 py-2 text-sm outline-none transition focus:border-coal"
                  placeholder="hangzhou-d"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted">可承载任务</span>
                <input
                  min={1}
                  type="number"
                  value={nodeForm.capacity ?? 4}
                  onChange={(event) => setNodeForm((current) => ({ ...current, capacity: Number(event.target.value) }))}
                  className="rounded-lg border border-line bg-[#fcfcf8] px-3 py-2 text-sm outline-none transition focus:border-coal"
                />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <span className="text-xs font-medium text-muted">Endpoint</span>
              <input
                required
                value={nodeForm.endpoint}
                onChange={(event) => setNodeForm((current) => ({ ...current, endpoint: event.target.value }))}
                className="rounded-lg border border-line bg-[#fcfcf8] px-3 py-2 font-mono text-sm outline-none transition focus:border-coal"
                placeholder="10.8.0.14:4101"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted">可用区</span>
                <input
                  value={nodeForm.zone ?? ""}
                  onChange={(event) => setNodeForm((current) => ({ ...current, zone: event.target.value }))}
                  className="rounded-lg border border-line bg-[#fcfcf8] px-3 py-2 text-sm outline-none transition focus:border-coal"
                />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-xs font-medium text-muted">角色</span>
                <input
                  value={nodeForm.role ?? ""}
                  onChange={(event) => setNodeForm((current) => ({ ...current, role: event.target.value }))}
                  className="rounded-lg border border-line bg-[#fcfcf8] px-3 py-2 text-sm outline-none transition focus:border-coal"
                />
              </label>
            </div>
            <button
              disabled={!canManage || busyNode === "register"}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2.5 text-sm text-white transition hover:bg-zinc-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <HardDrives size={16} />
              {busyNode === "register" ? "接入中" : "接入集群"}
            </button>
          </form>
        </div>

        {handoffReport && (
          <div className="rounded-xl border border-line bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className={cx(
                    "flex h-9 w-9 items-center justify-center rounded-lg border",
                    handoffReport.success ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"
                  )}>
                    {handoffReport.success ? <ShieldCheck size={18} /> : <WarningCircle size={18} />}
                  </span>
                  <div>
                    <h2 className="font-semibold tracking-tight text-coal">{reportTitle(handoffReport.kind)}</h2>
                    <p className="mt-1 text-sm text-zinc-600">{handoffReport.message}</p>
                  </div>
                </div>
              </div>
              <span className="rounded-full border border-line bg-[#fcfcf8] px-2 py-1 font-mono text-xs text-muted">
                {formatDate(handoffReport.happenedAt)}
              </span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <ClusterStat
                label={handoffReport.kind === "drill" ? "演练节点" : handoffReport.kind === "drain" ? "排空节点" : "操作类型"}
                value={handoffReport.node?.name || "重新均衡"}
                detail={handoffReport.node ? `${handoffReport.node.zone} / ${handoffReport.node.id}` : "在线 node 负载重分布"}
                tone={handoffReport.success ? "ok" : "warn"}
              />
              <ClusterStat label="影响任务" value={handoffReport.affectedTasks.length} detail="自动接管链路" />
              <ClusterStat label="接管累计" value={handoffReport.after.failovers} detail={`操作前 ${handoffReport.before.failovers}`} />
            </div>

            <div className="mt-4 rounded-xl border border-line bg-[#fcfcf8] p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-coal">
                <MapPinLine size={16} />
                {reportTrackTitle(handoffReport.kind)}
              </div>
              <div className="mt-3 grid gap-2 text-xs text-zinc-600 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div className="rounded-lg border border-line bg-white p-3">
                  <div className="text-muted">{handoffReport.kind === "drill" ? "故障节点" : handoffReport.kind === "drain" ? "排空节点" : "原承载节点"}</div>
                  <div className="mt-1 truncate font-mono text-coal">{handoffReport.node ? nodeName(handoffReport.node.id) : uniqueHandoffNodes("previous")}</div>
                </div>
                <ArrowRight className="hidden text-zinc-400 sm:block" size={18} />
                <div className="rounded-lg border border-line bg-white p-3">
                  <div className="text-muted">接管目标</div>
                  <div className="mt-1 truncate font-mono text-coal">
                    {uniqueHandoffNodes("next")}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {handoffReport.affectedTasks.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line bg-[#fcfcf8] p-4 text-center text-sm text-muted">
                  {handoffReport.kind === "drill" ? "该节点没有承载任务，演练只验证节点离线流程。" : handoffReport.kind === "drain" ? "该节点没有承载任务，排空只更新维护状态。" : "当前集群已经均衡，没有任务需要迁移。"}
                </div>
              ) : handoffReport.affectedTasks.map((task) => (
                <div key={task.taskId} className="rounded-xl border border-line bg-[#fcfcf8] p-4 text-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-coal">{task.taskName}</span>
                        <span className={cx(
                          "rounded-full border px-2 py-0.5 text-xs",
                          task.newNodeId ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"
                        )}>
                          {task.newNodeId ? "已接管" : "待处理"}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-zinc-600">
                        <span className="rounded-full bg-white px-2 py-1">{nodeName(task.previousNodeId)}</span>
                        <ArrowRight size={14} className="text-zinc-400" />
                        <span className="rounded-full bg-white px-2 py-1">{nodeName(task.newNodeId)}</span>
                      </div>
                    </div>
                    <div className="rounded-lg border border-line bg-white px-3 py-2">
                      <div className="text-xs text-muted">恢复位点</div>
                      <div className="mt-1 break-all font-mono text-sm font-semibold text-coal">
                        {task.recoveryBinlogFile}:{formatNumber(task.recoveryBinlogPosition)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    <div className="rounded-lg border border-line bg-white px-3 py-2">
                      <div className="text-xs text-muted">运行阶段</div>
                      <div className="mt-1 font-medium text-coal">{phaseText(task.runtimePhase)}</div>
                    </div>
                    <div className="rounded-lg border border-line bg-white px-3 py-2">
                      <div className="text-xs text-muted">Lease Epoch</div>
                      <div className="mt-1 font-mono font-medium text-coal">{task.previousLeaseEpoch} -&gt; {task.leaseEpoch}</div>
                    </div>
                    <div className="rounded-lg border border-line bg-white px-3 py-2">
                      <div className="text-xs text-muted">延迟</div>
                      <div className="mt-1 font-mono font-medium text-coal">{task.recoveryDelaySeconds}s</div>
                    </div>
                    <div className="rounded-lg border border-line bg-white px-3 py-2">
                      <div className="text-xs text-muted">吞吐</div>
                      <div className="mt-1 font-mono font-medium text-coal">{task.recoveryEventsPerSecond}/s</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
