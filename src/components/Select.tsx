import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/format";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

const MAX_HEIGHT = 288;

/**
 * A dropdown in the app's own clothes: the native one draws its list with the
 * browser's colours, which look nothing like the rest of the settings. The list is a
 * portal at viewport coordinates, so a scrolling section cannot clip it, and it flips
 * above the button when there is no room below.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  variant = "field",
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
  /** `field` matches the text inputs; `pill` the translucent toolbar controls (Live TV). */
  variant?: "field" | "pill";
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  /** Row highlighted by the keyboard while the list is open. */
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const baseId = useId();
  const current = options.find((option) => option.value === value);
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    if (!button) return;
    const place = () => {
      const rect = button.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const height = Math.min(MAX_HEIGHT, Math.max(options.length * 36 + 8, 80));
      const flip = below < height && rect.top > below;
      setBox({
        left: rect.left,
        top: flip ? Math.max(12, rect.top - height - 6) : rect.bottom + 6,
        width: Math.max(rect.width, 200),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, options.length]);

  // The selected row should be the one in view (and highlighted) when the list opens.
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  /** Type-ahead: letters typed in quick succession jump to the first matching label. */
  const typeAhead = (key: string, from: number) => {
    const now = Date.now();
    typed.current = { text: now - typed.current.at < 700 ? typed.current.text + key : key, at: now };
    const needle = typed.current.text.toLocaleLowerCase();
    const order = [...options.slice(from + 1), ...options.slice(0, from + 1)];
    const hit = order.find((option) => option.label.toLocaleLowerCase().startsWith(needle));
    return hit ? options.indexOf(hit) : -1;
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (listRef.current?.contains(e.target as Node) || buttonRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture phase: closing the list must not also close the screen behind it.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      // Arrows open the list instead of saving a new value on every press.
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    const last = options.length - 1;
    if (e.key === "ArrowDown") setActive((i) => Math.min(last, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else if (e.key === "PageDown") setActive((i) => Math.min(last, i + 8));
    else if (e.key === "PageUp") setActive((i) => Math.max(0, i - 8));
    else if (e.key === "Enter" || e.key === " ") choose(active);
    else if (e.key === "Tab") {
      setOpen(false);
      return;
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const hit = typeAhead(e.key, active);
      if (hit >= 0) setActive(hit);
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${baseId}-list` : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={cn(
          "flex items-center justify-between gap-3 border text-left text-text transition-colors duration-150",
          // cn() does not merge conflicting utilities: only apply the default size when the
          // caller does not set one.
          !/(^|\s)h-/.test(className ?? "") && "h-10",
          !/(^|\s)min-w-/.test(className ?? "") && "min-w-[180px]",
          variant === "field"
            ? "rounded-btn border-white/12 bg-black/40 px-3 text-sm hover:border-white/20"
            : "rounded-pill border-transparent bg-white/6 pr-3 pl-4 text-[13px] font-medium hover:bg-white/10",
          open && "border-accent",
          className,
        )}
      >
        <span className="truncate">{current?.label ?? ""}</span>
        <ChevronDown size={15} className={cn("shrink-0 text-dim transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && box
        ? createPortal(
            <div
              ref={listRef}
              id={`${baseId}-list`}
              role="listbox"
              aria-label={label}
              style={{ left: box.left, top: box.top, width: box.width, maxHeight: MAX_HEIGHT }}
              className="modal-enter fixed z-[90] overflow-y-auto rounded-2xl bg-panel/97 p-1.5 shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md"
            >
              {options.map((option, index) => {
                const selected = option.value === value;
                return (
                  <button
                    key={option.value}
                    id={optionId(index)}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected}
                    data-selected={selected}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(index)}
                    className={cn(
                      "flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] hover:bg-white/8",
                      selected ? "font-medium text-accent" : "text-text",
                      index === active && "bg-white/8",
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {selected ? <Check size={14} className="shrink-0" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
