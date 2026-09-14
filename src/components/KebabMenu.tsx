import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";
import { cn } from "../lib/format";

export type MenuAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Shown under the label, greyed out (why an action is unavailable, for instance). */
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
};

const WIDTH = 224;
const ITEM_HEIGHT = 40;

/**
 * Three-dot button with a small menu. The menu lives in a portal and is placed in
 * viewport coordinates, so a scrolling list or a modal never clips it, and it flips
 * above the button when there is no room below.
 */
export function KebabMenu({
  actions,
  label,
  className,
}: {
  actions: MenuAction[];
  /** Accessible name of the button ("More options"). */
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const height = actions.reduce((n, action) => n + (action.hint ? ITEM_HEIGHT + 14 : ITEM_HEIGHT), 12);
    const left = Math.max(8, Math.min(window.innerWidth - WIDTH - 8, rect.right - WIDTH));
    const below = rect.bottom + 6;
    const flip = below + height > window.innerHeight - 8;
    setPos({ left, top: flip ? Math.max(8, rect.top - height - 6) : below });
  }, [open, actions]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture phase: closing the menu must not also close the sheet behind it.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/60 transition-colors duration-150 hover:bg-white/10 hover:text-white",
          open && "bg-white/12 text-white",
          className,
        )}
      >
        <MoreVertical size={17} />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              className="modal-enter fixed z-[90] rounded-2xl bg-panel/95 p-1.5 shadow-[0_16px_40px_rgb(0_0_0_/_0.55),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md"
              style={{ left: pos.left, top: pos.top, width: WIDTH }}
              onClick={(e) => e.stopPropagation()}
            >
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  onClick={() => {
                    setOpen(false);
                    action.onSelect();
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-150",
                    action.disabled ? "cursor-default text-dim" : "text-text hover:bg-white/8",
                  )}
                >
                  {action.icon ? <span className="shrink-0 text-muted">{action.icon}</span> : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{action.label}</span>
                    {action.hint ? <span className="mt-0.5 block text-[11px] leading-[1.3] text-dim">{action.hint}</span> : null}
                  </span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
