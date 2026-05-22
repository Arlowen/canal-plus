import { LockKey } from "@phosphor-icons/react";
import { cx } from "../lib/format";

export function PermissionNotice({
  title = "需要管理员权限",
  description,
  compact
}: {
  title?: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <div className={cx(
      "rounded-lg border border-amber-200 bg-amber-50 text-amber-900",
      compact ? "px-3 py-2 text-sm" : "p-4"
    )}>
      <div className="flex items-start gap-2">
        <LockKey size={compact ? 16 : 18} className="mt-0.5 shrink-0" />
        <div>
          <div className="font-medium">{title}</div>
          <div className={cx("text-amber-800", compact ? "mt-0.5 text-xs" : "mt-1 text-sm")}>{description}</div>
        </div>
      </div>
    </div>
  );
}
