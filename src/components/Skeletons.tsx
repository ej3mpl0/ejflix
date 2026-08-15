export function HeroSkeleton() {
  return (
    <div className="relative min-h-[480px] h-[78vh] bg-surface">
      <div className="absolute inset-0 animate-[pulse-soft_1.6s_ease-in-out_infinite] bg-white/5" />
    </div>
  );
}

export function RowSkeleton() {
  return (
    <div className="px-12 py-4">
      <div className="mb-3 h-5 w-48 rounded bg-white/5" />
      <div className="flex gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-[2/3] w-[180px] shrink-0 rounded-[6px] bg-white/5" />
        ))}
      </div>
    </div>
  );
}
