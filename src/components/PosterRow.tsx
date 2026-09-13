import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Movie } from "../lib/types";
import { PosterCard } from "./PosterCard";
import { ContinueCard } from "./ContinueCard";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";

export function PosterRow({
  title,
  items,
  variant = "poster",
  onOpen,
  onPlay,
}: {
  title: string;
  items: Movie[];
  variant?: "poster" | "continue" | "nextUp";
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [edges, setEdges] = useState({ start: true, end: false });

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
    return () => observer.disconnect();
  }, [items.length]);

  if (!items.length) return null;

  const scrollBy = (dir: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  const arrow = (dir: -1 | 1, disabled: boolean) => (
    <button
      type="button"
      aria-label={dir < 0 ? t("previous") : t("next")}
      onClick={() => scrollBy(dir)}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        "btn-press absolute top-[calc(50%-24px)] z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/60 text-white shadow-[0_8px_24px_rgb(0_0_0_/_0.5)] backdrop-blur-md transition-opacity duration-200 hover:bg-black/80",
        dir < 0 ? "left-2" : "right-2",
        hover && !disabled ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {dir < 0 ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
    </button>
  );

  return (
    <section
      className="relative py-3"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <h2 className="mb-3 px-page text-[18px] font-semibold text-text">{title}</h2>
      <div className="relative">
        <div
          ref={scroller}
          onScroll={measure}
          className={cn(
            "no-scrollbar flex snap-x snap-mandatory gap-rail overflow-x-auto px-page scroll-px-page pt-2 pb-3",
            !edges.end && "row-mask",
          )}
        >
          {items.map((movie, i) =>
            variant === "continue" || variant === "nextUp" ? (
              <ContinueCard
                key={movie.id}
                movie={movie}
                onOpen={onOpen}
                onPlay={onPlay}
                variant={variant === "nextUp" ? "nextUp" : "resume"}
              />
            ) : (
              <PosterCard key={movie.id} movie={movie} onOpen={onOpen} onPlay={onPlay} delay={i * 30} />
            ),
          )}
        </div>
        {arrow(-1, edges.start)}
        {arrow(1, edges.end)}
      </div>
    </section>
  );
}
