import { GitBranch, MagnifyingGlass, Plus, ShieldCheck, Stack } from "@phosphor-icons/react";
import { StatusBadge } from "../components/StatusBadge";
import { cx } from "../lib/format";
import type { Datasource, SyncTask } from "../types/api";

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-[#fcfcf8] p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("mt-2 text-sm font-medium text-coal", mono && "font-mono")}>{value}</div>
    </div>
  );
}

export function CapabilityView({ mode, tasks, datasources }: { mode: "structure" | "quality" | "subscription"; tasks: SyncTask[]; datasources: Datasource[] }) {
  const config = {
    structure: {
      title: "结构迁移与同步",
      icon: Stack,
      accent: "类型转换 / 方言适配 / 命名映射",
      steps: ["结构扫描", "差异分析", "DDL 生成", "目标执行", "持续同步"],
      primary: "生成结构计划"
    },
    quality: {
      title: "数据校验与订正",
      icon: ShieldCheck,
      accent: "字段级对比 / 差异定位 / 安全订正",
      steps: ["抽样计划", "全量对比", "差异分组", "订正预览", "执行回写"],
      primary: "创建校验任务"
    },
    subscription: {
      title: "修改订阅",
      icon: GitBranch,
      accent: "运行中加库减库 / action 过滤 / 条件过滤",
      steps: ["读取订阅", "对象变更", "过滤预检", "发布版本", "增量生效"],
      primary: "发起订阅变更"
    }
  }[mode];
  const Icon = config.icon;

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

        <div className="mt-6 grid gap-3">
          {config.steps.map((step, index) => (
            <div key={step} className="flex items-center gap-3 rounded-lg border border-line bg-[#fcfcf8] p-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white font-mono text-xs text-accent">{index + 1}</span>
              <span className="text-sm font-medium text-coal">{step}</span>
              <span className="ml-auto text-xs text-muted">{index < 2 ? "ready" : "planned"}</span>
            </div>
          ))}
        </div>

        <button className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-coal px-4 py-2.5 text-sm text-white transition active:scale-[0.98]">
          <Plus size={16} />
          {config.primary}
        </button>
      </section>

      <section className="rounded-xl border border-line bg-white p-5 shadow-panel">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold tracking-tight text-coal">链路影响面</h2>
            <div className="mt-1 text-sm text-muted">基于现有任务和数据源生成的执行预览</div>
          </div>
          <MagnifyingGlass size={20} className="text-muted" />
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <Info label="数据源" value={`${datasources.length} 个`} mono />
          <Info label="任务" value={`${tasks.length} 条`} mono />
          <Info label="运行中" value={`${tasks.filter((task) => task.status === "incremental_running" || task.status === "full_syncing").length} 条`} mono />
          <Info label="待处理异常" value={`${tasks.filter((task) => task.status === "failed").length} 条`} mono />
        </div>

        <div className="mt-5 divide-y divide-line rounded-lg border border-line">
          {tasks.slice(0, 5).map((task) => (
            <div key={task.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <div className="font-medium text-coal">{task.name}</div>
                <div className="mt-1 text-xs text-muted">{task.tableMappings.map((mapping) => `${mapping.sourceSchema}.${mapping.sourceTable}`).join(", ")}</div>
              </div>
              <StatusBadge status={task.status} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
