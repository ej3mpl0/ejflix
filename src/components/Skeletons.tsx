import { Shimmer } from "./Shimmer";

export function HeroSkeleton() {
  return (
    <div className="relative h-[min(78vh,720px)] min-h-[480px] overflow-hidden rounded-b-[var(--radius-hero)] bg-surface">
      <Shimmer className="absolute inset-0 rounded-none bg-transparent" />
      <div className="absolute bottom-16 left-page space-y-4">
        <Shimmer className="h-16 w-[420px] max-w-[60vw] rounded-lg" />
        <Shimmer className="h-4 w-64 rounded" />
        <Shimmer className="h-4 w-[460px] max-w-[50vw] rounded" />
        <div className="flex gap-3 pt-2">
          <Shimmer className="h-12 w-36 rounded-pill" />
          <Shimmer className="h-12 w-40 rounded-pill" />
        </div>
      </div>
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="px-page py-3">
      <Shimmer className="mb-4 h-5 w-48 rounded" />
      <div className="flex gap-rail overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="w-[var(--poster-w)] shrink-0">
            <Shimmer className="aspect-[2/3] rounded-poster" delay={i * 80} />
            <Shimmer className="mt-2 h-3.5 w-3/4 rounded" delay={i * 80} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DetailsSkeleton() {
  return (
    <div>
      <div className="relative h-[58vh] min-h-[420px] bg-surface">
        <Shimmer className="absolute inset-0 rounded-none bg-transparent" />
        <div className="absolute bottom-10 left-page space-y-4">
          <Shimmer className="h-14 w-[380px] max-w-[50vw] rounded-lg" />
          <Shimmer className="h-4 w-56 rounded" />
          <div className="flex gap-3 pt-2">
            <Shimmer className="h-12 w-36 rounded-pill" />
            <Shimmer className="h-12 w-32 rounded-pill" />
          </div>
        </div>
      </div>
      <div className="space-y-4 px-page py-8">
        <Shimmer className="h-4 w-[70%] rounded" />
        <Shimmer className="h-4 w-[60%] rounded" />
        <div className="flex gap-4 pt-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Shimmer key={i} className="h-[88px] w-[88px] rounded-full" delay={i * 80} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Rows of a settings list (addons, IPTV lists) while they load: icon tile, two lines. */
export function ListRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3">
          <Shimmer className="h-11 w-11 shrink-0 rounded-xl" delay={i * 80} />
          <div className="min-w-0 flex-1 space-y-2">
            <Shimmer className="h-3.5 w-2/5 rounded" delay={i * 80} />
            <Shimmer className="h-3 w-3/5 rounded" delay={i * 80} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Poster placeholders for a grid (a first load, or the next page appended to it). */
export function PosterGridItemsSkeleton({ count = 12, titles = false }: { count?: number; titles?: boolean }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={`skeleton-${i}`} aria-hidden>
          <Shimmer className="aspect-[2/3] rounded-poster" delay={Math.min(i, 12) * 40} />
          {titles ? <Shimmer className="mt-2 h-3.5 w-3/4 rounded" delay={Math.min(i, 12) * 40} /> : null}
        </div>
      ))}
    </>
  );
}

export function EpisodeListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex gap-4 p-2">
          <Shimmer className="aspect-video w-[200px] shrink-0 rounded-poster" delay={i * 80} />
          <div className="flex-1 space-y-2 py-2">
            <Shimmer className="h-4 w-1/2 rounded" />
            <Shimmer className="h-3 w-5/6 rounded" />
            <Shimmer className="h-3 w-2/3 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
