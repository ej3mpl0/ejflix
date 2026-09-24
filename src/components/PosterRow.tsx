import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSeeAll, type SeeAllRequest } from "../lib/see-all-context";
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
  loadMore,
  caption,
  seeAll,
}: {
  title: string;
  /** Why the row is there ("Because you watched X"), under the title. */
  caption?: string;
  /** Opens this instead of the plain grid, and always offers "See all" (custom lists). */
  seeAll?: SeeAllRequest;
  items: Movie[];
  variant?: "poster" | "continue" | "nextUp" | "new";
  /** Next page of the row's source, for its "See all" grid. */
  loadMore?: (loaded: number) => Promise<Movie[]>;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const openSeeAll = useSeeAll();
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
        hover && !disabled
          ? "opacity-100"
          : cn("pointer-events-none opacity-0", !disabled && "focus-visible:pointer-events-auto focus-visible:opacity-100"),
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
      <div className="mb-1 flex items-baseline justify-between gap-4 px-page">
        <div className="min-w-0">
          <h2 className="truncate text-[18px] font-semibold text-text">{title}</h2>
          {caption ? <p className="truncate text-[12.5px] text-dim">{caption}</p> : null}
        </div>
        {openSeeAll && variant === "poster" && (seeAll || items.length >= 8 || loadMore) ? (
          <button
            type="button"
            onClick={() => openSeeAll(seeAll ?? { title, items, loadMore })}
            className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-muted transition-colors hover:text-text"
          >
            {t("seeAll")}
            <ChevronRight size={15} />
          </button>
        ) : null}
      </div>
      <div className="relative">
        <div
          ref={scroller}
          onScroll={measure}
          className={cn(
            "no-scrollbar flex snap-x snap-mandatory gap-rail overflow-x-auto px-page scroll-px-page pt-4 pb-3",
            !edges.end && "row-mask",
          )}
        >
          {items.map((movie, i) =>
            variant === "continue" || variant === "nextUp" || variant === "new" ? (
              <ContinueCard
                key={movie.id}
                movie={movie}
                onOpen={onOpen}
                onPlay={onPlay}
                variant={variant === "nextUp" || variant === "new" ? variant : "resume"}
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
