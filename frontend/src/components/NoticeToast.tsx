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

const toneClasses: Record<NoticeToastTone, { icon: typeof CheckCircle }> = {
  success: {
    icon: CheckCircle
  },
  warning: {
    icon: WarningCircle
  },
  error: {
    icon: XCircle
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
        "notice-toast pointer-events-auto relative overflow-hidden rounded-lg border border-blue-500/80 bg-accent px-4 py-3 text-white",
        "shadow-[0_24px_70px_-28px_rgba(37,99,235,0.72)]"
      )}
    >
      <div className="relative flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/16 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]">
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
            onClick={requestClose}
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/14 text-white transition hover:bg-white/22 active:translate-y-px"
          >
            <X size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
