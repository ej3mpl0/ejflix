export function HeroSkeleton() {
  return (
    <div className="relative min-h-[480px] h-[78vh] bg-surface">
      <div className="absolute inset-0 animate-[pulse-soft_1.6s_ease-in-out_infinite] bg-white/5" />
      <div className="absolute bottom-20 left-12 space-y-4">
        <div className="h-14 w-[380px] max-w-[60vw] rounded-md bg-white/8" />
        <div className="h-4 w-56 rounded bg-white/6" />
        <div className="h-4 w-[420px] max-w-[50vw] rounded bg-white/6" />
        <div className="flex gap-3 pt-2">
          <div className="h-11 w-32 rounded-md bg-white/10" />
          <div className="h-11 w-36 rounded-md bg-white/6" />
        </div>
      </div>
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="px-12 py-4">
      <div className="mb-3 h-5 w-48 rounded bg-white/5" />
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[2/3] w-[clamp(150px,16vw,210px)] shrink-0 animate-[pulse-soft_1.6s_ease-in-out_infinite] rounded-[6px] bg-white/5"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
