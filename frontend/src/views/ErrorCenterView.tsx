import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowsClockwise,
  CheckCircle,
  ClipboardText,
  FunnelSimple,
  MagnifyingGlass,
  WarningCircle,
  XCircle
} from "@phosphor-icons/react";
import { api } from "../lib/api";
import { cx, formatDate } from "../lib/format";
import type { ErrorEvent, ErrorStatus, SyncTask } from "../types/api";

type StatusFilter = "all" | ErrorStatus;
type SortMode = "created_desc" | "updated_desc" | "binlog_desc" | "table_asc";

const statusOrder: ErrorStatus[] = ["pending", "retried", "skipped", "resolved"];

const statusText: Record<ErrorStatus, string> = {
  pending: "待处理",
  retried: "已重试",
  skipped: "已跳过",
  resolved: "已恢复"
};

const statusClass: Record<ErrorStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  retried: "border-sky-200 bg-sky-50 text-sky-700",
  skipped: "border-zinc-300 bg-zinc-100 text-zinc-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700"
};

const eventTypeText: Record<ErrorEvent["eventType"], string> = {
  insert: "INSERT",
  update: "UPDATE",
  delete: "DELETE",
  ddl: "DDL"
};

const sortLabels: Record<SortMode, string> = {
  created_desc: "最新发生",
  updated_desc: "最近处理",
  binlog_desc: "位点倒序",
  table_asc: "表名 A-Z"
};

function ErrorStatusBadge({ status }: { status: ErrorStatus }) {
  return (
    <span className={cx("rounded-full border px-2 py-0.5 text-xs", statusClass[status])}>
      {statusText[status]}
    </span>
  );
}

function buildStatusCounts(errors: ErrorEvent[]) {
  const counts: Record<ErrorStatus, number> = {
    pending: 0,
    retried: 0,
    skipped: 0,
    resolved: 0
  };
  errors.forEach((event) => {
    counts[event.status] += 1;
  });
  return counts;
}

function errorSearchText(event: ErrorEvent, task?: SyncTask) {
  return [
    event.reason,
    event.rawEventSummary,
    event.sourceTable,
    event.targetTable,
    event.primaryKeyValue,
    event.binlogFile,
    event.binlogPosition,
    statusText[event.status],
    eventTypeText[event.eventType],
    task?.name,
    task?.owner,
    task?.sourceDatasource?.name,
    task?.targetDatasource?.name
  ].filter(Boolean).join(" ").toLowerCase();
}

function sortErrors(errors: ErrorEvent[], sortMode: SortMode) {
  const nextErrors = [...errors];
  nextErrors.sort((left, right) => {
    if (sortMode === "updated_desc") return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    if (sortMode === "binlog_desc") return right.binlogPosition - left.binlogPosition || right.binlogFile.localeCompare(left.binlogFile);
    if (sortMode === "table_asc") return left.sourceTable.localeCompare(right.sourceTable, "zh-Hans-CN");
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
  });
  return nextErrors;
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-[#fcfcf8] p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("mt-2 break-words text-sm font-medium text-coal", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function EmptyErrors() {
  return (
    <div className="rounded-lg border border-dashed border-line bg-[#fcfcf8] p-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-zinc-500">
        <CheckCircle size={18} />
      </div>
      <div className="mt-3 font-medium text-coal">暂无错误事件</div>
      <div className="mt-1 text-sm text-muted">当前没有待处理错误</div>
    </div>
  );
}

function EmptyFilteredErrors({ onReset }: { onReset: () => void }) {
  return (
    <div className="m-5 rounded-lg border border-dashed border-line bg-[#fcfcf8] p-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-zinc-500">
        <FunnelSimple size={18} />
      </div>
      <div className="mt-3 font-medium text-coal">没有匹配的错误事件</div>
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

export function ErrorCenterView({
  errors,
  tasks,
  onChanged
}: {
  errors: ErrorEvent[];
  tasks: SyncTask[];
  onChanged: () => Promise<void> | void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(errors[0]?.id ?? null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("created_desc");
  const [skipReason, setSkipReason] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const statusCounts = useMemo(() => buildStatusCounts(errors), [errors]);
  const visibleErrors = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const filtered = errors.filter((event) => {
      const task = taskById.get(event.taskId);
      const matchesKeyword = !normalizedKeyword || errorSearchText(event, task).includes(normalizedKeyword);
      const matchesStatus = statusFilter === "all" || event.status === statusFilter;
      return matchesKeyword && matchesStatus;
    });
    return sortErrors(filtered, sortMode);
  }, [errors, keyword, sortMode, statusFilter, taskById]);
  const selected = visibleErrors.find((event) => event.id === selectedId) ?? visibleErrors[0];
  const selectedTask = selected ? taskById.get(selected.taskId) : undefined;
  const visiblePendingIds = visibleErrors.filter((event) => event.status === "pending").map((event) => event.id);
  const filterActive = Boolean(keyword.trim()) || statusFilter !== "all" || sortMode !== "created_desc";

  useEffect(() => {
    if (errors.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (visibleErrors.length === 0) return;
    if (!selectedId || !visibleErrors.some((event) => event.id === selectedId)) setSelectedId(visibleErrors[0].id);
  }, [errors.length, selectedId, visibleErrors]);

  useEffect(() => {
    setSkipReason("");
  }, [selected?.id]);

  const resetFilters = () => {
    setKeyword("");
    setStatusFilter("all");
    setSortMode("created_desc");
  };

  const runAction = async (key: string, action: () => Promise<string>) => {
    setProcessing(key);
    setActionError(null);
    setMessage(null);
    try {
      const nextMessage = await action();
      setMessage(nextMessage);
      await onChanged();
    } catch (requestError) {
      setActionError(requestError instanceof Error ? requestError.message : "操作失败");
    } finally {
      setProcessing(null);
    }
  };

  const retryEvent = (event: ErrorEvent) => runAction(`retry:${event.id}`, async () => {
    await api.retryError(event.id);
    return "错误事件已重新投递";
  });

  const retryVisiblePending = () => runAction("batch-retry", async () => {
    await api.retryErrors(visiblePendingIds);
    return `已批量重试 ${visiblePendingIds.length} 个待处理事件`;
  });

  const skipSelected = () => {
    if (!selected || !skipReason.trim()) return;
    runAction(`skip:${selected.id}`, async () => {
      await api.skipError(selected.id, skipReason.trim());
      setSkipReason("");
      return "错误事件已跳过";
    });
  };

  if (errors.length === 0) {
    return <EmptyErrors />;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
      <section className="min-w-0 rounded-xl border border-line bg-white shadow-panel">
        <div className="border-b border-line p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-coal">错误事件</h2>
            </div>
            <div className="rounded-lg border border-line bg-[#fcfcf8] px-3 py-2 text-sm text-zinc-700">
              待处理 {statusCounts.pending}
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px]">
            <label className="block min-w-0">
              <span className="mb-2 block text-xs font-medium text-zinc-700">搜索错误</span>
              <span className="relative block">
                <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={17} />
                <input
                  className="control pl-9"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="原因、SQL、表、主键、位点"
                />
              </span>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">排序</span>
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
              <span className={cx("font-mono", statusFilter === "all" ? "text-zinc-200" : "text-muted")}>{errors.length}</span>
            </button>
            {statusOrder.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cx(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition active:scale-[0.98]",
                  statusFilter === status ? "border-coal bg-coal text-white" : "border-line bg-white text-zinc-600 hover:bg-zinc-50"
                )}
              >
                {statusText[status]}
                <span className={cx("font-mono", statusFilter === status ? "text-zinc-200" : "text-muted")}>{statusCounts[status]}</span>
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
              onClick={retryVisiblePending}
              disabled={visiblePendingIds.length === 0 || processing === "batch-retry"}
              className="ml-auto inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <ArrowsClockwise size={14} />
              批量重试 {visiblePendingIds.length}
            </button>
          </div>
        </div>

        {(message || actionError) && (
          <div className="border-b border-line p-5">
            {message && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle size={16} />
                {message}
              </div>
            )}
            {actionError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <XCircle size={16} />
                {actionError}
              </div>
            )}
          </div>
        )}

        <div className="divide-y divide-line">
          {visibleErrors.length === 0 && <EmptyFilteredErrors onReset={resetFilters} />}
          {visibleErrors.map((event) => {
            const task = taskById.get(event.taskId);
            return (
              <button
                key={event.id}
                onClick={() => setSelectedId(event.id)}
                className={cx(
                  "grid w-full min-w-0 gap-4 p-5 text-left transition hover:bg-zinc-50 lg:grid-cols-[minmax(0,1fr)_minmax(180px,0.7fr)_140px] lg:items-center",
                  selected?.id === event.id && "bg-[#f7faf6]"
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-zinc-500">{eventTypeText[event.eventType]}</span>
                    <span className="truncate font-medium text-coal">{event.sourceTable}</span>
                    <ErrorStatusBadge status={event.status} />
                  </div>
                  <div className="mt-1 line-clamp-2 text-sm text-red-700">{event.reason}</div>
                  <div className="mt-2 truncate font-mono text-xs text-muted">{event.rawEventSummary}</div>
                </div>
                <div className="min-w-0 text-sm text-zinc-700">
                  <div className="truncate">{task?.name || event.taskId}</div>
                  <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-zinc-500">
                    <span className="truncate">{event.sourceTable}</span>
                    <ArrowRight size={14} className="shrink-0" />
                    <span className="truncate">{event.targetTable}</span>
                  </div>
                </div>
                <div className="font-mono text-xs text-zinc-600">
                  <div>{event.binlogFile}</div>
                  <div className="mt-1 text-coal">{event.binlogPosition}</div>
                  <div className="mt-2 font-sans text-muted">{formatDate(event.createdAt)}</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="min-w-0 rounded-xl border border-line bg-white p-5 shadow-panel">
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold tracking-tight text-coal">{selected.sourceTable}</h2>
                <div className="mt-1 text-sm text-muted">{selectedTask?.name || selected.taskId}</div>
              </div>
              <ErrorStatusBadge status={selected.status} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <DetailItem label="事件类型" value={eventTypeText[selected.eventType]} mono />
              <DetailItem label="主键" value={selected.primaryKeyValue} mono />
              <DetailItem label="Binlog 文件" value={selected.binlogFile} mono />
              <DetailItem label="Position" value={`${selected.binlogPosition}`} mono />
              <DetailItem label="时间" value={formatDate(selected.createdAt)} />
            </div>

            <div className="mt-5 rounded-lg border border-line bg-[#fcfcf8] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-coal">
                <WarningCircle size={16} />
                失败原因
              </div>
              <div className="mt-3 text-sm text-red-700">{selected.reason}</div>
            </div>

            <div className="mt-5 rounded-lg border border-line bg-[#111412] p-4 text-white">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <ClipboardText size={16} />
                原始事件
              </div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 text-zinc-200">{selected.rawEventSummary}</pre>
            </div>

            <div className="mt-5 grid gap-3">
              <button
                onClick={() => retryEvent(selected)}
                disabled={selected.status !== "pending" || processing === `retry:${selected.id}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ArrowsClockwise size={16} />
                重新投递
              </button>
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-zinc-700">跳过原因</span>
                <textarea
                  className="control min-h-24"
                  value={skipReason}
                  onChange={(event) => setSkipReason(event.target.value)}
                  disabled={selected.status !== "pending"}
                  placeholder="说明为什么允许跳过该事件"
                />
              </label>
              <button
                onClick={skipSelected}
                disabled={selected.status !== "pending" || !skipReason.trim() || processing === `skip:${selected.id}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ArrowRight size={16} />
                跳过事件
              </button>
            </div>

            {(selected.handledBy || selected.handledReason) && (
              <div className="mt-5 rounded-lg border border-line bg-[#fcfcf8] p-4 text-sm text-zinc-700">
                <div className="font-medium text-coal">处置记录</div>
                <div className="mt-2">处理人：{selected.handledBy || "-"}</div>
                <div className="mt-1">原因：{selected.handledReason || "-"}</div>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-[#fcfcf8] p-8 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-zinc-500">
              <ClipboardText size={18} />
            </div>
            <div className="mt-3 font-medium text-coal">选择错误事件</div>
            <div className="mt-1 text-sm text-muted">从左侧选择一条记录</div>
          </div>
        )}
      </aside>
    </div>
  );
}
