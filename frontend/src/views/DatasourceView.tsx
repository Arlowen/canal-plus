import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CheckCircle,
  Database,
  FloppyDisk,
  FunnelSimple,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Pulse,
  Trash,
  WarningCircle,
  XCircle
} from "@phosphor-icons/react";
import { PermissionNotice } from "../components/PermissionNotice";
import { api } from "../lib/api";
import { cx, formatDateTime } from "../lib/format";
import type { Datasource, DatasourcePurpose, DatasourceStatus, SyncTask } from "../types/api";

type StatusFilter = "all" | DatasourceStatus;
type FormMode = "create" | "edit";

const purposeText: Record<DatasourcePurpose, string> = {
  source: "源端",
  target: "目标端",
  both: "源端和目标端"
};

const statusText: Record<DatasourceStatus, string> = {
  online: "在线",
  offline: "离线",
  untested: "未测试"
};

const statusClass: Record<DatasourceStatus, string> = {
  online: "border-emerald-200 bg-emerald-50 text-emerald-700",
  offline: "border-red-200 bg-red-50 text-red-700",
  untested: "border-zinc-200 bg-zinc-50 text-zinc-600"
};

const emptyForm = {
  name: "",
  purpose: "source" as DatasourcePurpose,
  host: "",
  port: 3306,
  username: "",
  password: "",
  defaultSchema: ""
};

function statusBadge(status: DatasourceStatus) {
  return (
    <span className={cx("rounded-full border px-2 py-0.5 text-xs", statusClass[status])}>
      {statusText[status]}
    </span>
  );
}

function datasourceSearchText(datasource: Datasource) {
  return [
    datasource.name,
    datasource.host,
    datasource.port,
    datasource.username,
    datasource.defaultSchema,
    purposeText[datasource.purpose],
    statusText[datasource.connectionStatus]
  ].filter(Boolean).join(" ").toLowerCase();
}

function buildStatusCounts(datasources: Datasource[]) {
  const counts: Record<DatasourceStatus, number> = {
    online: 0,
    offline: 0,
    untested: 0
  };
  datasources.forEach((datasource) => {
    counts[datasource.connectionStatus] += 1;
  });
  return counts;
}

function usageCount(datasource: Datasource, tasks: SyncTask[]) {
  return tasks.filter((task) => task.sourceDatasourceId === datasource.id || task.targetDatasourceId === datasource.id).length;
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-[#fcfcf8] p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("mt-2 break-words text-sm font-medium text-coal", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function EmptyDatasourceState({ onCreate, canManage }: { onCreate: () => void; canManage: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-[#fcfcf8] p-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-zinc-500">
        <Database size={18} />
      </div>
      <div className="mt-3 font-medium text-coal">暂无数据源</div>
      <div className="mt-1 text-sm text-muted">先创建连接</div>
      <button
        onClick={onCreate}
        disabled={!canManage}
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
      >
        <Plus size={16} />
        新增数据源
      </button>
      {!canManage && (
        <div className="mx-auto mt-4 max-w-md">
          <PermissionNotice compact description="当前角色可查看和测试连接；新增数据源需要管理员权限。" />
        </div>
      )}
    </div>
  );
}

function EmptyFilteredDatasource({ onReset }: { onReset: () => void }) {
  return (
    <div className="m-5 rounded-lg border border-dashed border-line bg-[#fcfcf8] p-8 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-white text-zinc-500">
        <FunnelSimple size={18} />
      </div>
      <div className="mt-3 font-medium text-coal">没有匹配的数据源</div>
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

function DatasourceForm({
  mode,
  form,
  onFormChange,
  onSubmit,
  onCancel,
  disabled
}: {
  mode: FormMode;
  form: typeof emptyForm;
  onFormChange: (form: typeof emptyForm) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-line bg-white p-5 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold tracking-tight text-coal">{mode === "create" ? "新增数据源" : "编辑数据源"}</h2>
          <div className="mt-1 text-sm text-muted">{mode === "create" ? "配置源端或目标端连接资产" : "密码留空时保持原密文"}</div>
        </div>
        <button type="button" onClick={onCancel} className="text-sm text-muted transition hover:text-coal">取消</button>
      </div>

      <div className="mt-4 space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-zinc-700">名称</span>
          <input className="control" value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} required />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-zinc-700">用途</span>
          <select className="control" value={form.purpose} onChange={(event) => onFormChange({ ...form, purpose: event.target.value as DatasourcePurpose })}>
            <option value="source">源端</option>
            <option value="target">目标端</option>
            <option value="both">源端和目标端</option>
          </select>
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-3">
          <label className="block min-w-0">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Host</span>
            <input className="control" value={form.host} onChange={(event) => onFormChange({ ...form, host: event.target.value })} required />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-zinc-700">Port</span>
            <input className="control" type="number" value={form.port} onChange={(event) => onFormChange({ ...form, port: Number(event.target.value) })} required />
          </label>
        </div>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-zinc-700">账号</span>
          <input className="control" value={form.username} onChange={(event) => onFormChange({ ...form, username: event.target.value })} required />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-zinc-700">密码</span>
          <input
            className="control"
            type="password"
            value={form.password}
            onChange={(event) => onFormChange({ ...form, password: event.target.value })}
            required={mode === "create"}
            placeholder={mode === "edit" ? "留空保持不变" : ""}
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-zinc-700">默认库</span>
          <input className="control" value={form.defaultSchema} onChange={(event) => onFormChange({ ...form, defaultSchema: event.target.value })} />
        </label>
        <button
          disabled={disabled}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2.5 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {mode === "create" ? <Plus size={16} /> : <FloppyDisk size={16} />}
          {mode === "create" ? "保存数据源" : "保存修改"}
        </button>
      </div>
    </form>
  );
}

export function DatasourceView({
  datasources,
  tasks,
  canManage,
  onChanged
}: {
  datasources: Datasource[];
  tasks: SyncTask[];
  canManage: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(datasources[0]?.id ?? null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [formMode, setFormMode] = useState<FormMode | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [confirmName, setConfirmName] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusCounts = useMemo(() => buildStatusCounts(datasources), [datasources]);
  const visibleDatasources = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return datasources
      .filter((datasource) => {
        const matchesKeyword = !normalizedKeyword || datasourceSearchText(datasource).includes(normalizedKeyword);
        const matchesStatus = statusFilter === "all" || datasource.connectionStatus === statusFilter;
        return matchesKeyword && matchesStatus;
      })
      .sort((left, right) => {
        const statusRank: Record<DatasourceStatus, number> = { offline: 0, untested: 1, online: 2 };
        return statusRank[left.connectionStatus] - statusRank[right.connectionStatus] || left.name.localeCompare(right.name, "zh-Hans-CN");
      });
  }, [datasources, keyword, statusFilter]);
  const selected = visibleDatasources.find((datasource) => datasource.id === selectedId) ?? visibleDatasources[0];
  const selectedUsage = selected ? usageCount(selected, tasks) : 0;
  const filterActive = Boolean(keyword.trim()) || statusFilter !== "all";

  useEffect(() => {
    if (datasources.length === 0) {
      if (selectedId) setSelectedId(null);
      return;
    }
    if (visibleDatasources.length === 0) return;
    if (!selectedId || !visibleDatasources.some((datasource) => datasource.id === selectedId)) setSelectedId(visibleDatasources[0].id);
  }, [datasources.length, selectedId, visibleDatasources]);

  useEffect(() => {
    setConfirmName("");
  }, [selected?.id]);

  const resetFilters = () => {
    setKeyword("");
    setStatusFilter("all");
  };

  const openCreate = () => {
    if (!canManage) {
      setError("新增数据源需要管理员权限");
      return;
    }
    setFormMode("create");
    setForm({ ...emptyForm });
    setError(null);
    setMessage(null);
  };

  const openEdit = (datasource: Datasource) => {
    if (!canManage) {
      setError("编辑数据源需要管理员权限");
      return;
    }
    setFormMode("edit");
    setForm({
      name: datasource.name,
      purpose: datasource.purpose,
      host: datasource.host,
      port: datasource.port,
      username: datasource.username,
      password: "",
      defaultSchema: datasource.defaultSchema || ""
    });
    setSelectedId(datasource.id);
    setError(null);
    setMessage(null);
  };

  const closeForm = () => {
    setFormMode(null);
    setForm({ ...emptyForm });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage) {
      setError("保存数据源需要管理员权限");
      return;
    }
    setProcessing("save");
    setError(null);
    setMessage(null);
    try {
      if (formMode === "edit" && selected) {
        await api.updateDatasource(selected.id, {
          ...form,
          password: form.password || undefined
        });
        setMessage("数据源已更新");
      } else {
        await api.createDatasource(form);
        setMessage("数据源已创建");
      }
      closeForm();
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败");
    } finally {
      setProcessing(null);
    }
  };

  const test = async (datasource: Datasource) => {
    setProcessing(`test:${datasource.id}`);
    setMessage(null);
    setError(null);
    try {
      const next = await api.testDatasource(datasource.id);
      setMessage(`${next.name}: ${next.lastTestMessage || "连接成功"}`);
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "连接失败");
      await onChanged();
    } finally {
      setProcessing(null);
    }
  };

  const deleteSelected = async () => {
    if (!canManage) {
      setError("删除数据源需要管理员权限");
      return;
    }
    if (!selected || selectedUsage > 0 || confirmName !== selected.name) return;
    setProcessing(`delete:${selected.id}`);
    setMessage(null);
    setError(null);
    try {
      await api.deleteDatasource(selected.id);
      setMessage("数据源已删除");
      setSelectedId(null);
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除失败");
    } finally {
      setProcessing(null);
    }
  };

  if (datasources.length === 0) {
    return (
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <EmptyDatasourceState onCreate={openCreate} canManage={canManage} />
        <aside>
          {canManage && formMode === "create" && (
            <DatasourceForm
              mode="create"
              form={form}
              onFormChange={setForm}
              onSubmit={submit}
              onCancel={closeForm}
              disabled={processing === "save" || !canManage}
            />
          )}
        </aside>
      </div>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="min-w-0 rounded-xl border border-line bg-white shadow-panel">
        <div className="border-b border-line p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-coal">数据源</h2>
            </div>
            <div className="rounded-lg border border-line bg-[#fcfcf8] px-3 py-2 text-sm text-zinc-700">
              在线 {statusCounts.online} / {datasources.length}
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_auto]">
            <label className="block min-w-0">
              <span className="mb-2 block text-xs font-medium text-zinc-700">搜索数据源</span>
              <span className="relative block">
                <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={17} />
                <input
                  className="control pl-9"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="名称、Host、账号、默认库"
                />
              </span>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-zinc-700">状态</span>
              <select className="control" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                <option value="all">全部状态</option>
                <option value="online">在线</option>
                <option value="offline">离线</option>
                <option value="untested">未测试</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                onClick={openCreate}
                disabled={!canManage}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 lg:w-auto"
              >
                <Plus size={16} />
                新增
              </button>
            </div>
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
              <span className={cx("font-mono", statusFilter === "all" ? "text-zinc-200" : "text-muted")}>{datasources.length}</span>
            </button>
            {(["online", "offline", "untested"] as DatasourceStatus[]).map((status) => (
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
          </div>
        </div>

        <div className="divide-y divide-line">
          {visibleDatasources.length === 0 && <EmptyFilteredDatasource onReset={resetFilters} />}
          {visibleDatasources.map((datasource) => {
            const usedByTasks = usageCount(datasource, tasks);
            return (
              <button
                key={datasource.id}
                onClick={() => setSelectedId(datasource.id)}
                className={cx(
                  "grid w-full min-w-0 gap-4 p-5 text-left transition hover:bg-zinc-50 lg:grid-cols-[minmax(0,1fr)_170px_130px] lg:items-center",
                  selected?.id === datasource.id && "bg-[#f7faf6]"
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Database size={18} className="text-accent" />
                    <span className="truncate font-medium text-coal">{datasource.name}</span>
                    {statusBadge(datasource.connectionStatus)}
                  </div>
                  <div className="mt-1 truncate text-sm text-muted">{datasource.host}:{datasource.port} / {datasource.username}</div>
                </div>
                <div className="text-sm text-zinc-600">
                  <div>{purposeText[datasource.purpose]}</div>
                  <div className="mt-1 text-xs text-muted">库 {datasource.defaultSchema || "-"}</div>
                </div>
                <div className="text-sm text-zinc-600">
                  <div className="font-mono text-coal">{usedByTasks}</div>
                  <div className="mt-1 text-xs text-muted">引用任务</div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="space-y-4">
        {!canManage && (
          <PermissionNotice compact description="当前角色可测试连接和查看引用任务；新增、编辑、删除数据源需要管理员权限。" />
        )}
        {message && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle size={16} />
            {message}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <XCircle size={16} />
            {error}
          </div>
        )}

        {formMode ? (
          <DatasourceForm
            mode={formMode}
            form={form}
            onFormChange={setForm}
            onSubmit={submit}
            onCancel={closeForm}
            disabled={processing === "save" || !canManage}
          />
        ) : selected ? (
          <div className="rounded-xl border border-line bg-white p-5 shadow-panel">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold tracking-tight text-coal">{selected.name}</h2>
                <div className="mt-1 text-sm text-muted">{selected.host}:{selected.port}</div>
              </div>
              {statusBadge(selected.connectionStatus)}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Info label="用途" value={purposeText[selected.purpose]} />
              <Info label="默认库" value={selected.defaultSchema || "-"} />
              <Info label="账号" value={selected.username} mono />
              <Info label="最后测试" value={formatDateTime(selected.lastTestedAt)} />
              <Info label="引用任务" value={`${selectedUsage}`} mono />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => test(selected)}
                disabled={processing === `test:${selected.id}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Pulse size={16} />
                测试连接
              </button>
              <button
                onClick={() => openEdit(selected)}
                disabled={!canManage}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <PencilSimple size={16} />
                编辑
              </button>
            </div>

            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-red-800">
                <Trash size={16} />
                删除数据源
              </div>
              <div className="mt-2 text-sm text-red-700">
                {selectedUsage > 0 ? "已被任务引用，不能删除。" : "输入名称后删除。"}
              </div>
              <input
                className="control mt-3 border-red-200"
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                disabled={!canManage || selectedUsage > 0}
                placeholder={selected.name}
              />
              <button
                onClick={deleteSelected}
                disabled={!canManage || selectedUsage > 0 || confirmName !== selected.name || processing === `delete:${selected.id}`}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-700 transition hover:bg-red-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Trash size={16} />
                确认删除
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line bg-[#fcfcf8] p-5 text-sm text-muted shadow-panel">
            选择一个数据源
          </div>
        )}
      </aside>
    </div>
  );
}
