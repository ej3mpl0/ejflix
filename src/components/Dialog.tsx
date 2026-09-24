import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../lib/format";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Open dialogs, oldest first: only the top one answers Escape and keeps Tab inside. */
const openDialogs: object[] = [];

/**
 * Modal shell: dimmed backdrop, `role="dialog"`, focus moved inside on open (to the first
 * `[data-autofocus]` or focusable element), Tab kept inside, focus handed back on close.
 * `onEscape` closes on Escape before anything behind the dialog sees the key.
 */
export function Dialog({
  labelledBy,
  onEscape,
  onBackdrop,
  className,
  z = "z-[70]",
  children,
}: {
  labelledBy?: string;
  onEscape?: () => void;
  onBackdrop?: () => void;
  /** Classes of the panel itself. */
  className?: string;
  z?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = panel.current;
    const first = root?.querySelector<HTMLElement>("[data-autofocus]") ?? root?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? root)?.focus();
    // Several can be up at once (the Ctrl+K palette over a list picker...); they all listen
    // on window, where stopPropagation does not keep the one underneath from closing too.
    const token = {};
    openDialogs.push(token);

    const onKey = (e: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== token) return;
      if (e.key === "Escape" && onEscapeRef.current) {
        e.preventDefault();
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const head = items[0];
      const tail = items[items.length - 1];
      const inside = root.contains(document.activeElement);
      // A menu portalled out of the dialog (KebabMenu) handles its own focus.
      if (!inside && document.activeElement !== document.body) return;
      if (e.shiftKey && (document.activeElement === head || !inside)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && (document.activeElement === tail || !inside)) {
        e.preventDefault();
        head.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      openDialogs.splice(openDialogs.indexOf(token), 1);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <div className={cn("fixed inset-0 grid place-items-center bg-black/70 p-4 md:p-6", z)} onClick={onBackdrop}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn("modal-enter outline-none", className)}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
