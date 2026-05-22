import { useEffect, useMemo, useState } from "react";
import {
  ClockCounterClockwise,
  DownloadSimple,
  FunnelSimple,
  Hash,
  MagnifyingGlass,
  SortDescending,
  UserCircle
} from "@phosphor-icons/react";
import { cx, formatDate, formatDateTime } from "../lib/format";
import type { OperationLog } from "../types/api";

type TargetTypeFilter = "all" | OperationLog["targetType"];
type ActorFilter = "all" | string;
type TimeWindowFilter = "all" | "1h" | "24h" | "7d";
type SortMode = "created_desc" | "created_asc" | "actor_asc" | "action_asc";

const targetTypeOrder: OperationLog["targetType"][] = [
  "sync_task",
  "datasource",
  "error_event",
  "cluster_node",
  "capability_job",
  "alert_rule",
  "auth"
];

const targetTypeText: Record<OperationLog["targetType"], string> = {
  datasource: "数据源",
  sync_task: "同步任务",
  error_event: "错误事件",
  auth: "认证",
  cluster_node: "集群节点",
  capability_job: "能力任务",
  alert_rule: "告警规则"
};

const targetTypeClass: Record<OperationLog["targetType"], string> = {
  datasource: "border-sky-200 bg-sky-50 text-sky-700",
  sync_task: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error_event: "border-red-200 bg-red-50 text-red-700",
  auth: "border-zinc-300 bg-zinc-100 text-zinc-700",
  cluster_node: "border-indigo-200 bg-indigo-50 text-indigo-700",
  capability_job: "border-amber-200 bg-amber-50 text-amber-700",
  alert_rule: "border-cyan-200 bg-cyan-50 text-cyan-700"
};

const sortLabels: Record<SortMode, string> = {
  created_desc: "最新优先",
  created_asc: "最早优先",
  actor_asc: "操作者 A-Z",
  action_asc: "动作 A-Z"
};

const timeWindowLabels: Record<TimeWindowFilter, string> = {
  all: "全部时间",
  "1h": "近 1 小时",
  "24h": "近 24 小时",
  "7d": "近 7 天"
};

function targetTypeBadge(type: OperationLog["targetType"]) {
  return (
    <span className={cx("rounded-full border px-2 py-0.5 text-xs", targetTypeClass[type])}>
      {targetTypeText[type]}
    </span>
  );
}

function logSearchText(log: OperationLog) {
  return [
    log.actor,
    log.action,
    log.detail,
    log.targetId,
    log.targetType,
    targetTypeText[log.targetType]
  ].filter(Boolean).join(" ").toLowerCase();
}

function inTimeWindow(log: OperationLog, windowFilter: TimeWindowFilter) {
  if (windowFilter === "all") return true;
  const createdAt = new Date(log.createdAt).getTime();
  if (Number.isNaN(createdAt)) return false;
  const hours = windowFilter === "1h" ? 1 : windowFilter === "24h" ? 24 : 24 * 7;
  return Date.now() - createdAt <= hours * 60 * 60 * 1000;
}

function sortLogs(logs: OperationLog[], sortMode: SortMode) {
  const nextLogs = [...logs];
  nextLogs.sort((left, right) => {
    if (sortMode === "created_asc") return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    if (sortMode === "actor_asc") return left.actor.localeCompare(right.actor, "zh-Hans-CN") || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    if (sortMode === "action_asc") return left.action.localeCompare(right.action, "zh-Hans-CN") || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
  return nextLogs;
}

function buildTargetCounts(logs: OperationLog[]) {
  const counts = Object.fromEntries(targetTypeOrder.map((type) => [type, 0])) as Record<OperationLog["targetType"], number>;
  logs.forEach((log) => {
    counts[log.targetType] += 1;
  });
  return counts;
}

function exportLogs(logs: OperationLog[]) {
  const rows = logs.map((log) => ({
    createdAt: log.createdAt,
    actor: log.actor,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId || "",
    detail: log.detail
  }));
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `canal-plus-operation-logs-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-[#fcfcf8] p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("mt-2 break-words text-sm font-medium text-coal", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function EmptyLogs() {
  return (
    <div className="rounded-lg border border-dashed border-line bg-[#fcfcf8] p-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-zinc-500">
        <ClockCounterClockwise size={18} />
      </div>
      <div className="mt-3 font-medium text-coal">暂无操作日志</div>
      <div className="mt-1 text-sm text-muted">系统操作、节点接管和任务变更会记录在这里</div>
    </div>
  );
}

function EmptyFilteredLogs({ onReset }: { onReset: () => void }) {
  return (
    <div className="m-5 rounded-lg border border-dashed border-line bg-[#fcfcf8] p-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-zinc-500">
        <FunnelSimple size={18} />
      </div>
      <div className="mt-3 font-medium text-coal">没有匹配的审计记录</div>
      <div className="mt-1 text-sm text-muted">调整关键词、操作者、对象或时间范围后再查看</div>
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

export function OperationLogsView({ logs }: { logs: OperationLog[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(logs[0]?.id ?? null);
  const [keyword, setKeyword] = useState("");
  const [actorFilter, setActorFilter] = useState<ActorFilter>("all");
  const [targetTypeFilter, setTargetTypeFilter] = useState<TargetTypeFilter>("all");
  const [timeWindowFilter, setTimeWindowFilter] = useState<TimeWindowFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("created_desc");
  const targetCounts = useMemo(() => buildTargetCounts(logs), [logs]);
  const actorOptions = useMemo(() => Array.from(new Set(logs.map((log) => log.actor).filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-Hans-CN")), [logs]);
  const visibleLogs = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const filteredLogs = logs.filter((log) => {
      const matchesKeyword = !normalizedKeyword || logSearchText(log).includes(normalizedKeyword);
      const matchesActor = actorFilter === "all" || log.actor === actorFilter;
      const matchesTargetType = targetTypeFilter === "all" || log.targetType === targetTypeFilter;
      return matchesKeyword && matchesActor && matchesTargetType && inTimeWindow(log, timeWindowFilter);
    });
    return sortLogs(filteredLogs, sortMode);
  }, [actorFilter, keyword, logs, sortMode, targetTypeFilter, timeWindowFilter]);
  const selected = visibleLogs.find((log) => log.id === selectedId) ?? visibleLogs[0];
  const filterActive = Boolean(keyword.trim()) || actorFilter !== "all" || targetTypeFilter !== "all" || timeWindowFilter !== "all" || sortMode !== "created_desc";
  const systemLogs = logs.filter((log) => log.actor === "system").length;
  const adminLogs = logs.filter((log) => log.actor === "admin").length;
  const latestLog = sortLogs(logs, "created_desc")[0];

  useEffect(() => {
    if (logs.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (visibleLogs.length === 0) return;
    if (!selectedId || !visibleLogs.some((log) => log.id === selectedId)) setSelectedId(visibleLogs[0].id);
  }, [logs.length, selectedId, visibleLogs]);

  const resetFilters = () => {
    setKeyword("");
    setActorFilter("all");
    setTargetTypeFilter("all");
    setTimeWindowFilter("all");
    setSortMode("created_desc");
  };

  if (logs.length === 0) {
    return <EmptyLogs />;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
      <section className="min-w-0 rounded-xl border border-line bg-white shadow-panel">
        <div className="border-b border-line p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-coal">操作日志</h2>
              <div className="mt-1 text-sm text-muted">关键操作审计、节点接管和配置变更追踪</div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-sm lg:min-w-[330px]">
              <div className="rounded-lg border border-line bg-[#fcfcf8] px-3 py-2">
                <div className="text-xs text-muted">总记录</div>
                <div className="mt-1 font-mono font-semibold text-coal">{logs.length}</div>
              </div>
              <div className="rounded-lg border border-line bg-[#fcfcf8] px-3 py-2">
                <div className="text-xs text-muted">系统</div>
                <div className="mt-1 font-mono font-semibold text-coal">{systemLogs}</div>
              </div>
              <div className="rounded-lg border border-line bg-[#fcfcf8] px-3 py-2">
                <div className="text-xs text-muted">管理员</div>
                <div className="mt-1 font-mono font-semibold text-coal">{adminLogs}</div>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(0,1fr)_150px_160px_150px_150px]">
            <label className="block min-w-0">
              <span className="mb-2 block text-xs font-medium text-zinc-700">搜索审计</span>
              <span className="relative block">
                <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={17} />
                <input
                  className="control pl-9"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="动作、对象、详情、ID"
                />
              </span>
            </label>
            <label className="block">
              <span className="mb-2 flex items-center gap-1 text-xs font-medium text-zinc-700">
                <UserCircle size={14} />
                操作者
              </span>
              <select className="control" value={actorFilter} onChange={(event) => setActorFilter(event.target.value)}>
                <option value="all">全部操作者</option>
                {actorOptions.map((actor) => (
                  <option key={actor} value={actor}>{actor}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">对象类型</span>
              <select className="control" value={targetTypeFilter} onChange={(event) => setTargetTypeFilter(event.target.value as TargetTypeFilter)}>
                <option value="all">全部对象</option>
                {targetTypeOrder.map((type) => (
                  <option key={type} value={type}>{targetTypeText[type]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">时间范围</span>
              <select className="control" value={timeWindowFilter} onChange={(event) => setTimeWindowFilter(event.target.value as TimeWindowFilter)}>
                {Object.entries(timeWindowLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 flex items-center gap-1 text-xs font-medium text-zinc-700">
                <SortDescending size={14} />
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
              onClick={() => setTargetTypeFilter("all")}
              className={cx(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition active:scale-[0.98]",
                targetTypeFilter === "all" ? "border-coal bg-coal text-white" : "border-line bg-white text-zinc-600 hover:bg-zinc-50"
              )}
            >
              全部
              <span className={cx("font-mono", targetTypeFilter === "all" ? "text-zinc-200" : "text-muted")}>{logs.length}</span>
            </button>
            {targetTypeOrder.map((type) => (
              <button
                key={type}
                onClick={() => setTargetTypeFilter(type)}
                className={cx(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition active:scale-[0.98]",
                  targetTypeFilter === type ? "border-coal bg-coal text-white" : "border-line bg-white text-zinc-600 hover:bg-zinc-50"
                )}
              >
                {targetTypeText[type]}
                <span className={cx("font-mono", targetTypeFilter === type ? "text-zinc-200" : "text-muted")}>{targetCounts[type]}</span>
              </button>
            ))}
            {filterActive && (
              <button
                onClick={resetFilters}
                className="inline-flex items-center gap-2 rounded-full border border-line bg-[#fcfcf8] px-3 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-50 active:scale-[0.98]"
              >
                <FunnelSimple size={14} />
                清空筛选
              </button>
            )}
            <button
              onClick={() => exportLogs(visibleLogs)}
              disabled={visibleLogs.length === 0}
              className="ml-auto inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <DownloadSimple size={14} />
              导出 JSON
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>当前显示 <span className="font-mono text-coal">{visibleLogs.length}</span> / <span className="font-mono text-coal">{logs.length}</span> 条</span>
            <span>最近记录 {formatDate(latestLog?.createdAt)}</span>
          </div>
        </div>

        <div className="divide-y divide-line">
          {visibleLogs.length === 0 && <EmptyFilteredLogs onReset={resetFilters} />}
          {visibleLogs.map((log) => (
            <button
              key={log.id}
              onClick={() => setSelectedId(log.id)}
              className={cx(
                "grid w-full min-w-0 gap-4 p-5 text-left transition hover:bg-zinc-50 lg:grid-cols-[170px_minmax(0,1fr)_150px] lg:items-center",
                selected?.id === log.id && "bg-[#f7faf6]"
              )}
            >
              <div className="min-w-0">
                <div className="font-mono text-xs text-muted">{formatDate(log.createdAt)}</div>
                <div className="mt-2 flex items-center gap-2 text-sm text-zinc-700">
                  <UserCircle size={16} className="shrink-0 text-zinc-400" />
                  <span className="truncate">{log.actor}</span>
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {targetTypeBadge(log.targetType)}
                  <span className="font-mono text-xs uppercase tracking-[0.12em] text-muted">{log.action}</span>
                </div>
                <div className="mt-2 line-clamp-2 text-sm text-coal">{log.detail}</div>
              </div>
              <div className="min-w-0 text-xs text-zinc-500">
                <div className="flex items-center gap-1">
                  <Hash size={13} />
                  <span className="truncate font-mono">{log.targetId || log.id}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      <aside className="min-w-0 rounded-xl border border-line bg-white p-5 shadow-panel">
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold tracking-tight text-coal">{selected.detail}</h2>
                <div className="mt-1 text-sm text-muted">{formatDateTime(selected.createdAt)}</div>
              </div>
              {targetTypeBadge(selected.targetType)}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <DetailItem label="操作者" value={selected.actor} mono />
              <DetailItem label="动作" value={selected.action} mono />
              <DetailItem label="对象类型" value={targetTypeText[selected.targetType]} />
              <DetailItem label="对象 ID" value={selected.targetId || "-"} mono />
              <DetailItem label="日志 ID" value={selected.id} mono />
              <DetailItem label="记录时间" value={formatDateTime(selected.createdAt)} />
            </div>

            <div className="mt-5 rounded-lg border border-line bg-[#fcfcf8] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-coal">
                <ClockCounterClockwise size={16} />
                审计详情
              </div>
              <div className="mt-3 break-words text-sm leading-6 text-zinc-700">{selected.detail}</div>
            </div>

            <div className="mt-5 rounded-lg border border-line bg-[#111412] p-4 text-white">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Hash size={16} />
                原始记录
              </div>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 text-zinc-200">
{JSON.stringify(selected, null, 2)}
              </pre>
            </div>
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-[#fcfcf8] p-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-zinc-500">
              <ClockCounterClockwise size={18} />
            </div>
            <div className="mt-3 font-medium text-coal">选择审计记录</div>
            <div className="mt-1 text-sm text-muted">左侧筛选后选择一条记录查看详情</div>
          </div>
        )}
      </aside>
    </div>
  );
}
