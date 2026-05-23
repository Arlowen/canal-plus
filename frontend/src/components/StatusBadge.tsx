import { cx } from "../lib/format";
import { taskStatusText } from "../lib/taskStatus";
import type { TaskStatus } from "../types/api";

const statusClass: Record<TaskStatus, string> = {
  draft: "border-slate-200 bg-slate-100 text-slate-600",
  pending: "border-slate-200 bg-slate-100 text-slate-700",
  full_syncing: "border-blue-200 bg-blue-50 text-blue-700",
  incremental_running: "border-blue-200 bg-blue-50 text-blue-700",
  paused: "border-amber-200 bg-amber-50 text-amber-700",
  failed: "border-red-200 bg-red-50 text-red-700",
  stopped: "border-slate-200 bg-slate-100 text-slate-700"
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={cx("rounded-full border px-2 py-0.5 text-xs", statusClass[status])}>
      {taskStatusText[status]}
    </span>
  );
}
