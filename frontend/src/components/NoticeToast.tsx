import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle, WarningCircle, X, XCircle } from "@phosphor-icons/react";
import { cx } from "../lib/format";
import { Button } from "./ui";

export type NoticeToastTone = "success" | "error" | "warning";

type NoticeToastProps = {
  tone: NoticeToastTone;
  children: ReactNode;
  action?: ReactNode;
  autoCloseMs?: number;
  onClose?: () => void;
};

const NOTICE_TOAST_EXIT_MS = 240;

const toneClasses: Record<NoticeToastTone, {
  icon: typeof CheckCircle;
  iconWrap: string;
  closeButton: string;
}> = {
  success: {
    icon: CheckCircle,
    iconWrap: "border-blue-100 bg-blue-50 text-accent",
    closeButton: "text-slate-500 hover:border-blue-100 hover:bg-blue-50 hover:text-accent"
  },
  warning: {
    icon: WarningCircle,
    iconWrap: "border-amber-100 bg-amber-50 text-amber-600",
    closeButton: "text-slate-500 hover:border-amber-100 hover:bg-amber-50 hover:text-amber-600"
  },
  error: {
    icon: XCircle,
    iconWrap: "border-red-100 bg-red-50 text-red-600",
    closeButton: "text-slate-500 hover:border-red-100 hover:bg-red-50 hover:text-red-600"
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
  autoCloseMs,
  onClose
}: NoticeToastProps) {
  const style = toneClasses[tone];
  const Icon = style.icon;
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const autoCloseTimerRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (autoCloseTimerRef.current !== null) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
  }, []);

  const requestClose = useCallback(() => {
    if (!onClose || closingRef.current) {
      return;
    }
    if (autoCloseTimerRef.current !== null) {
      window.clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    closingRef.current = true;
    setClosing(true);
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      onClose();
    }, NOTICE_TOAST_EXIT_MS);
  }, [onClose]);

  useEffect(() => {
    closingRef.current = false;
    setClosing(false);
    clearTimers();
    if (!onClose || autoCloseMs === undefined) {
      return clearTimers;
    }
    autoCloseTimerRef.current = window.setTimeout(requestClose, autoCloseMs);
    return clearTimers;
  }, [autoCloseMs, children, clearTimers, onClose, requestClose, tone]);

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      data-state={closing ? "closing" : "open"}
      className={cx(
        "notice-toast pointer-events-auto relative overflow-hidden rounded-lg border border-line bg-white px-4 py-3 text-coal",
        "shadow-[0_24px_70px_-32px_rgba(37,99,235,0.34)]"
      )}
    >
      <div className="relative flex min-w-0 items-center gap-3">
        <span className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-md border", style.iconWrap)}>
          <Icon size={18} weight="fill" />
        </span>
        <div className="min-w-0 flex-1 text-sm font-medium leading-5">
          {children}
        </div>
        {action && <div className="shrink-0 pl-2">{action}</div>}
        {onClose && (
          <Button
            type="button"
            aria-label="关闭提示"
            onClick={requestClose}
            className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-white transition active:translate-y-px", style.closeButton)}
          >
            <X size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
