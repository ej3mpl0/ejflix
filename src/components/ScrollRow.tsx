import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";

/**
 * Horizontal strip without a scrollbar (cast, chapters, seasons) plus small arrows at the
 * ends while there is more to see, so a mouse without Shift+wheel can still get there.
 */
export function ScrollRow({
  children,
  className,
  gap = "gap-4",
  ...aria
}: {
  children: ReactNode;
  /** Classes of the scroller (padding, snapping). */
  className?: string;
  gap?: string;
  role?: string;
  "aria-label"?: string;
}) {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = () => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft >= max - 2 });
  };

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, []);

  const scrollBy = (dir: -1 | 1) => {
    const el = scroller.current;
    el?.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const arrow = (dir: -1 | 1, hidden: boolean) => (
    <button
      type="button"
      aria-label={dir < 0 ? t("previous") : t("next")}
      tabIndex={-1}
      onClick={() => scrollBy(dir)}
      className={cn(
        "absolute top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/70 text-white shadow-[0_6px_18px_rgb(0_0_0_/_0.5)] backdrop-blur-md transition-opacity duration-150 hover:bg-black/85",
        dir < 0 ? "-left-3" : "-right-3",
        hidden ? "pointer-events-none opacity-0" : "opacity-0 group-hover/strip:opacity-100",
      )}
    >
      {dir < 0 ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
    </button>
  );

  return (
    <div className="group/strip relative">
      <div ref={scroller} onScroll={measure} className={cn("no-scrollbar flex overflow-x-auto", gap, className)} {...aria}>
        {children}
      </div>
      {arrow(-1, edges.start)}
      {arrow(1, edges.end)}
    </div>
  );
}
