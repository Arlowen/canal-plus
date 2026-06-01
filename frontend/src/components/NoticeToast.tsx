import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle, WarningCircle, X, XCircle } from "@phosphor-icons/react";
import { cx } from "../lib/format";
import { Button } from "./ui";

export type NoticeToastTone = "success" | "error" | "warning";

type NoticeToastProps = {
  tone: NoticeToastTone;
  children: ReactNode;
  action?: ReactNode;
  onClose?: () => void;
};

const toneClasses: Record<NoticeToastTone, { gradient: string; icon: typeof CheckCircle; ring: string }> = {
  success: {
    gradient: "from-emerald-600 via-teal-600 to-sky-600",
    icon: CheckCircle,
    ring: "bg-white/18"
  },
  warning: {
    gradient: "from-amber-500 via-orange-500 to-rose-500",
    icon: WarningCircle,
    ring: "bg-white/20"
  },
  error: {
    gradient: "from-rose-600 via-red-600 to-orange-600",
    icon: XCircle,
    ring: "bg-white/18"
  }
};

export function NoticeToastViewport({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none fixed left-1/2 top-4 z-[120] grid w-[min(calc(100vw-24px),560px)] -translate-x-1/2 gap-3 sm:top-5">
      {children}
    </div>,
    document.body
  );
}

export function NoticeToast({
  tone,
  children,
  action,
  onClose
}: NoticeToastProps) {
  const style = toneClasses[tone];
  const Icon = style.icon;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cx(
        "pointer-events-auto relative overflow-hidden rounded-lg border border-white/35 bg-gradient-to-r px-4 py-3 text-white",
        "shadow-[0_24px_70px_-28px_rgba(15,23,42,0.65)]",
        "animate-[notice-toast-in_220ms_cubic-bezier(0.16,1,0.3,1)_both]",
        style.gradient
      )}
    >
      <div className="relative flex min-w-0 items-start gap-3">
        <span className={cx("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]", style.ring)}>
          <Icon size={18} weight="fill" />
        </span>
        <div className="min-w-0 flex-1 pt-1 text-sm font-medium leading-5 drop-shadow-[0_1px_1px_rgba(15,23,42,0.18)]">
          {children}
        </div>
        {action && <div className="shrink-0 pl-2">{action}</div>}
        {onClose && (
          <Button
            type="button"
            aria-label="关闭提示"
            onClick={onClose}
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/14 text-white transition hover:bg-white/22 active:translate-y-px"
          >
            <X size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
