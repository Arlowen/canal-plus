import { cx } from "../lib/format";
import { taskStatusText } from "../lib/taskStatus";
import type { TaskStatus } from "../types/api";

const statusClass: Record<TaskStatus, string> = {
  draft: "border-zinc-300 bg-zinc-100 text-zinc-700",
  pending: "border-sky-200 bg-sky-50 text-sky-700",
  full_syncing: "border-amber-200 bg-amber-50 text-amber-700",
  incremental_running: "border-emerald-200 bg-emerald-50 text-emerald-700",
  paused: "border-zinc-300 bg-zinc-50 text-zinc-600",
  failed: "border-red-200 bg-red-50 text-red-700",
  stopped: "border-zinc-300 bg-zinc-100 text-zinc-700"
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={cx("rounded-full border px-2 py-0.5 text-xs", statusClass[status])}>
      {taskStatusText[status]}
    </span>
  );
}
