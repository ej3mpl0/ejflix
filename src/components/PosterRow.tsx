import { useRef, useState } from "react";
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
  variant?: "poster" | "continue";
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const scroller = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);

  if (!items.length) return null;

  const scrollBy = (dir: number) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section
      className="relative px-12 py-4"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <h2 className="mb-3 text-[20px] font-semibold text-text">{title}</h2>
      <div className="relative">
        <div
          ref={scroller}
          className="no-scrollbar row-mask flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2"
        >
          {items.map((movie, i) =>
            variant === "continue" ? (
              <ContinueCard key={movie.id} movie={movie} onOpen={onOpen} onPlay={onPlay} />
            ) : (
              <PosterCard key={movie.id} movie={movie} onOpen={onOpen} delay={i * 30} />
            ),
          )}
        </div>
        <button
          type="button"
          aria-label={t("previous")}
          onClick={() => scrollBy(-1)}
          className={cn(
            "absolute top-0 left-0 z-10 grid h-full w-10 place-items-center bg-gradient-to-r from-base/90 to-transparent text-white/80 transition-opacity",
            hover ? "opacity-100" : "opacity-0",
          )}
        >
          <ChevronLeft size={32} />
        </button>
        <button
          type="button"
          aria-label={t("next")}
          onClick={() => scrollBy(1)}
          className={cn(
            "absolute top-0 right-0 z-10 grid h-full w-10 place-items-center bg-gradient-to-l from-base/90 to-transparent text-white/80 transition-opacity",
            hover ? "opacity-100" : "opacity-0",
          )}
        >
          <ChevronRight size={32} />
        </button>
      </div>
    </section>
  );
}
