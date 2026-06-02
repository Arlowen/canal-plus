import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type TextareaHTMLAttributes
} from "react";
import { createPortal } from "react-dom";
import { CaretDown, Check } from "@phosphor-icons/react";
import { cx } from "../lib/format";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;
type TextInputProps = InputHTMLAttributes<HTMLInputElement>;
type TextareaInputProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
type CheckboxInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;
type DropdownOption = {
  value: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
};

type DropdownSelectProps = {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
};

type DropdownPosition = {
  left: number;
  top: number;
  width: number;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, ...props }, ref) {
  return <button ref={ref} className={cx(className)} {...props} />;
});

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput({ className, ...props }, ref) {
  return <input ref={ref} className={cx(className)} {...props} />;
});

export const TextareaInput = forwardRef<HTMLTextAreaElement, TextareaInputProps>(function TextareaInput({ className, ...props }, ref) {
  return <textarea ref={ref} className={cx(className)} {...props} />;
});

export const CheckboxInput = forwardRef<HTMLInputElement, CheckboxInputProps>(function CheckboxInput({ className, ...props }, ref) {
  return <input ref={ref} type="checkbox" className={cx("h-4 w-4 rounded border-line text-accent focus:ring-blue-100", className)} {...props} />;
});

export function DropdownSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled
}: DropdownSelectProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<DropdownPosition | null>(null);
  const selectedIndex = useMemo(() => Math.max(0, options.findIndex((option) => option.value === value)), [options, value]);
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);
  const selectedOption = options[selectedIndex] ?? options[0];

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, 180);
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
    const menuHeight = Math.min(260, 10 + options.length * 48);
    const bottomTop = rect.bottom + 6;
    const top = bottomTop + menuHeight > window.innerHeight - 12
      ? Math.max(12, rect.top - menuHeight - 6)
      : bottomTop;
    setPosition({ left, top, width });
  }, [options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    setHighlightedIndex(selectedIndex);
    updatePosition();
  }, [open, selectedIndex, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const handleResize = () => updatePosition();
    const handleScroll = () => updatePosition();
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, options.length, updatePosition]);

  const moveHighlight = (direction: 1 | -1) => {
    if (options.length === 0) return;
    setHighlightedIndex((current) => {
      for (let offset = 1; offset <= options.length; offset += 1) {
        const nextIndex = (current + direction * offset + options.length) % options.length;
        if (!options[nextIndex]?.disabled) {
          return nextIndex;
        }
      }
      return current;
    });
  };

  const selectOption = (option: DropdownOption) => {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      moveHighlight(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      moveHighlight(-1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const option = options[highlightedIndex];
      if (option) {
        selectOption(option);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const menuStyle: CSSProperties | undefined = position
    ? { left: position.left, top: position.top, width: position.width }
    : undefined;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        className={cx(
          "input flex min-h-[46px] items-center justify-between gap-3 text-left",
          open && "border-blue-300 ring-4 ring-blue-100",
          className
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedOption?.icon && <span className="shrink-0 text-slate-500">{selectedOption.icon}</span>}
          <span className="min-w-0 truncate">{selectedOption?.label ?? "-"}</span>
        </span>
        <CaretDown className={cx("shrink-0 text-slate-400 transition", open && "rotate-180 text-accent")} size={16} />
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="fixed z-[80] overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 shadow-[0_18px_54px_-22px_rgba(20,24,32,0.45)]"
          style={menuStyle}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            const highlighted = index === highlightedIndex;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={option.disabled}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOption(option)}
                className={cx(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium transition",
                  highlighted ? "bg-blue-500 text-white" : "text-slate-700 hover:bg-blue-50 hover:text-accent",
                  selected && !highlighted && "text-coal",
                  option.disabled && "cursor-not-allowed opacity-45"
                )}
              >
                <Check className={cx("shrink-0", selected ? "opacity-100" : "opacity-0")} size={17} weight="bold" />
                {option.icon && <span className="shrink-0">{option.icon}</span>}
                <span className="min-w-0 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
