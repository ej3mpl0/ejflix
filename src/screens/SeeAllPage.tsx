import { useRef, useState } from "react";
import type { Movie } from "../lib/types";
import type { SeeAllRequest } from "../lib/see-all-context";
import { useBackNavigation } from "../lib/use-back";
import { PosterCard } from "../components/PosterCard";
import { FloatingTitleBar } from "../components/FloatingTitleBar";
import { LoadMoreButton } from "../components/LoadMoreButton";
import { handlePosterArrows } from "../lib/poster-nav";
import { PosterGridItemsSkeleton } from "../components/Skeletons";

/** A Home row as a full grid, over Home (which keeps its scroll); pages in more when it can. */
export function SeeAllPage({
  request,
  top,
  onBack,
  onOpen,
  onPlay,
}: {
  request: SeeAllRequest;
  /** Only while nothing else is on top does it react to back navigation. */
  top: boolean;
  onBack: () => void;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const [items, setItems] = useState<Movie[]>(request.items);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(!request.loadMore);
  const scroller = useRef<HTMLDivElement>(null);

  useBackNavigation(top ? onBack : null);

  const more = async () => {
    if (!request.loadMore || loading || done) return;
    setLoading(true);
    try {
      const page = await request.loadMore(items.length);
      const known = new Set(items.map((movie) => movie.id));
      const fresh = page.filter((movie) => !known.has(movie.id));
      if (!fresh.length) setDone(true);
      else setItems((current) => [...current, ...fresh]);
    } catch {
      setDone(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-enter absolute inset-0 z-30 overflow-hidden bg-base text-text" aria-hidden={!top}>
      <div ref={scroller} className="absolute inset-0 overflow-y-auto" onKeyDown={(e) => handlePosterArrows(e, scroller.current)}>
        <div className="px-page pt-24 pb-16">
          <h1 className="mb-6 text-[22px] font-semibold tracking-[-0.01em]">{request.title}</h1>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(var(--poster-min),1fr))] gap-rail">
            {items.map((movie, i) => (
              <PosterCard key={movie.id} movie={movie} onOpen={onOpen} onPlay={onPlay} layout="grid" delay={Math.min(i, 24) * 20} />
            ))}
            {/* The next page's slots, so the grid grows in place instead of jumping. */}
            {loading ? <PosterGridItemsSkeleton count={6} titles /> : null}
          </div>
          {!done ? <LoadMoreButton loading={loading} onLoad={() => void more()} /> : null}
        </div>
      </div>
      <FloatingTitleBar title={request.title} onBack={onBack} />
    </div>
  );
}
