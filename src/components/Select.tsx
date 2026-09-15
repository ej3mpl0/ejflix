import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);

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

  // The selected row should be the one in view when the list opens.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: "center" });
  }, [open]);

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

  const move = (step: number) => {
    const index = options.findIndex((option) => option.value === value);
    const next = options[Math.min(options.length - 1, Math.max(0, index + step))];
    if (next) onChange(next.value);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          }
        }}
        className={cn(
          "flex h-10 min-w-[180px] items-center justify-between gap-3 rounded-btn border border-white/12 bg-black/40 px-3 text-left text-sm text-text transition-colors duration-150 hover:border-white/20",
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
              role="listbox"
              aria-label={label}
              style={{ left: box.left, top: box.top, width: box.width, maxHeight: MAX_HEIGHT }}
              className="modal-enter fixed z-[90] overflow-y-auto rounded-2xl bg-panel/97 p-1.5 shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md"
            >
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-selected={selected}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                      buttonRef.current?.focus();
                    }}
                    className={cn(
                      "flex min-h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] hover:bg-white/8",
                      selected ? "font-medium text-accent" : "text-text",
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
