import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BellRinging, FileText, Plus, Trash } from "@phosphor-icons/react";
import { PermissionNotice } from "../components/PermissionNotice";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import type { AlertRule, AlertRuleEvaluation, AlertRuleInput, SyncTask } from "../types/api";

function emptyRule(): AlertRuleInput {
  return {
    name: "任务异常告警",
    enabled: true,
    taskId: "",
    delayThresholdSeconds: 300,
    errorThreshold: 1,
    webhookUrl: ""
  };
}

function SettingsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-zinc-700">{label}</span>
      {children}
    </label>
  );
}

function EvaluationBadge({ evaluation }: { evaluation?: AlertRuleEvaluation }) {
  if (!evaluation) {
    return <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-600">未评估</span>;
  }
  return (
    <span className={cx(
      "rounded-full border px-2 py-1 text-xs",
      evaluation.triggered ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
    )}>
      {evaluation.triggered ? "触发中" : "正常"}
    </span>
  );
}

export function SettingsView({
  alertRules,
  evaluations,
  tasks,
  canManage,
  onChanged
}: {
  alertRules: AlertRule[];
  evaluations: AlertRuleEvaluation[];
  tasks: SyncTask[];
  canManage: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const evaluationByRule = useMemo(() => new Map(evaluations.map((item) => [item.ruleId, item])), [evaluations]);
  const [editingId, setEditingId] = useState<string | null>(alertRules[0]?.id ?? null);
  const editingRule = alertRules.find((rule) => rule.id === editingId);
  const editingRuleId = editingRule?.id ?? "";
  const editingRuleName = editingRule?.name ?? "";
  const editingRuleEnabled = editingRule?.enabled ?? true;
  const editingRuleTaskId = editingRule?.taskId ?? "";
  const editingRuleDelayThreshold = editingRule?.delayThresholdSeconds ?? 300;
  const editingRuleErrorThreshold = editingRule?.errorThreshold ?? 1;
  const editingRuleWebhook = editingRule?.webhookUrl ?? "";
  const [form, setForm] = useState<AlertRuleInput>(emptyRule());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editingId && alertRules[0]) setEditingId(alertRules[0].id);
    if (editingId && !alertRules.some((rule) => rule.id === editingId)) setEditingId(alertRules[0]?.id ?? null);
  }, [alertRules, editingId]);

  useEffect(() => {
    if (!editingRuleId) {
      setForm(emptyRule());
      return;
    }
    setForm({
      name: editingRuleName,
      enabled: editingRuleEnabled,
      taskId: editingRuleTaskId,
      delayThresholdSeconds: editingRuleDelayThreshold,
      errorThreshold: editingRuleErrorThreshold,
      webhookUrl: editingRuleWebhook
    });
  }, [editingRuleDelayThreshold, editingRuleEnabled, editingRuleErrorThreshold, editingRuleId, editingRuleName, editingRuleTaskId, editingRuleWebhook]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage) {
      setError("保存告警规则需要管理员权限");
      return;
    }
    setError(null);
    const input: AlertRuleInput = {
      ...form,
      taskId: form.taskId || undefined,
      webhookUrl: form.webhookUrl || undefined,
      delayThresholdSeconds: Number(form.delayThresholdSeconds),
      errorThreshold: Number(form.errorThreshold)
    };
    try {
      const saved = editingRule ? await api.updateAlertRule(editingRule.id, input) : await api.createAlertRule(input);
      setEditingId(saved.id);
      setMessage(editingRule ? "告警规则已保存" : "告警规则已创建");
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败");
    }
  };

  const createNew = () => {
    if (!canManage) {
      setError("新增告警规则需要管理员权限");
      return;
    }
    setEditingId(null);
    setForm(emptyRule());
    setMessage(null);
    setError(null);
  };

  const deleteRule = async () => {
    if (!canManage) {
      setError("删除告警规则需要管理员权限");
      return;
    }
    if (!editingRule) return;
    setError(null);
    try {
      await api.deleteAlertRule(editingRule.id);
      setMessage("告警规则已删除");
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除失败");
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section className="rounded-xl border border-line bg-white shadow-panel">
        <div className="flex flex-col gap-3 border-b border-line p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-coal">
            <BellRinging size={20} />
            <div>
              <h2 className="font-semibold tracking-tight">告警规则</h2>
              <div className="mt-1 text-sm text-muted">延迟、错误阈值和通知出口</div>
            </div>
          </div>
          <button
            onClick={createNew}
            disabled={!canManage}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus size={16} />
            新增规则
          </button>
        </div>

        <div className="divide-y divide-line">
          {alertRules.length === 0 ? (
            <div className="p-6 text-sm text-muted">暂无告警规则</div>
          ) : alertRules.map((rule) => {
            const evaluation = evaluationByRule.get(rule.id);
            return (
              <button
                key={rule.id}
                onClick={() => setEditingId(rule.id)}
                className={cx(
                  "grid w-full gap-3 p-5 text-left transition hover:bg-zinc-50 md:grid-cols-[1fr_0.7fr_0.7fr_auto] md:items-center",
                  editingId === rule.id && "bg-[#f7faf6]"
                )}
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-coal">{rule.name}</span>
                    <EvaluationBadge evaluation={evaluation} />
                  </div>
                  <div className="mt-1 text-sm text-muted">{rule.taskId ? tasks.find((task) => task.id === rule.taskId)?.name || rule.taskId : "全部任务"}</div>
                </div>
                <div className="font-mono text-sm text-zinc-700">{rule.delayThresholdSeconds}s</div>
                <div className="font-mono text-sm text-zinc-700">{rule.errorThreshold} errors</div>
                <div className="text-xs text-muted">{rule.enabled ? "启用" : "停用"}</div>
              </button>
            );
          })}
        </div>
      </section>

      <aside className="space-y-5">
        {!canManage && (
          <PermissionNotice compact description="当前角色可查看告警规则和评估结果；新增、编辑、删除通知规则需要管理员权限。" />
        )}
        {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <form onSubmit={submit} className="rounded-xl border border-line bg-white p-5 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold tracking-tight text-coal">{editingRule ? "编辑告警" : "新增告警"}</h2>
            <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
              <input type="checkbox" checked={Boolean(form.enabled)} disabled={!canManage} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
              启用
            </label>
          </div>
          <div className="mt-4 grid gap-4">
            <SettingsField label="规则名称">
              <input className="control" value={form.name} disabled={!canManage} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </SettingsField>
            <SettingsField label="作用范围">
              <select className="control" value={form.taskId || ""} disabled={!canManage} onChange={(event) => setForm({ ...form, taskId: event.target.value })}>
                <option value="">全部任务</option>
                {tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
              </select>
            </SettingsField>
            <div className="grid gap-3 sm:grid-cols-2">
              <SettingsField label="延迟阈值秒">
                <input className="control" type="number" min={1} value={form.delayThresholdSeconds} disabled={!canManage} onChange={(event) => setForm({ ...form, delayThresholdSeconds: Number(event.target.value) })} />
              </SettingsField>
              <SettingsField label="错误次数阈值">
                <input className="control" type="number" min={0} value={form.errorThreshold} disabled={!canManage} onChange={(event) => setForm({ ...form, errorThreshold: Number(event.target.value) })} />
              </SettingsField>
            </div>
            <SettingsField label="Webhook">
              <input className="control" value={form.webhookUrl || ""} disabled={!canManage} onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })} placeholder="https://example.com/webhook" />
            </SettingsField>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <button
                disabled={!canManage}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-3 py-2 text-sm text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              >
                保存规则
              </button>
              <button
                type="button"
                onClick={deleteRule}
                disabled={!canManage || !editingRule}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Trash size={16} />
                删除
              </button>
            </div>
          </div>
        </form>

        <section className="rounded-xl border border-line bg-[#fcfcf8] p-5 shadow-panel">
          <div className="flex items-center gap-2 text-coal">
            <FileText size={20} />
            <h2 className="font-semibold tracking-tight">评估结果</h2>
          </div>
          <div className="mt-4 space-y-3 text-sm text-zinc-600">
            {evaluations.slice(0, 4).map((evaluation) => (
              <div key={evaluation.ruleId} className="border-l border-line pl-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-coal">{evaluation.ruleName}</span>
                  <EvaluationBadge evaluation={evaluation} />
                </div>
                <div className="mt-1 font-mono text-xs">
                  tasks {evaluation.matchedTasks} / delay {evaluation.maxDelaySeconds}s / errors {evaluation.pendingErrors}
                </div>
                {evaluation.reasons.length > 0 && <div className="mt-1 text-xs text-red-700">{evaluation.reasons.join("，")}</div>}
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}
