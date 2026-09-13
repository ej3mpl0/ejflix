import type { Movie } from "../lib/types";
import { Chip } from "./Chip";
import { useI18n } from "../lib/locale-context";

export function SeasonChips({
  seasons,
  value,
  onChange,
}: {
  seasons: Movie[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  if (seasons.length <= 1) return null;
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t("seasons")}>
      {seasons.map((season) => (
        <Chip
          key={season.id}
          role="tab"
          aria-selected={season.id === value}
          selected={season.id === value}
          onClick={() => onChange(season.id)}
        >
          {season.name}
          {season.childCount ? <span className="text-[11px] opacity-70 tabular">{season.childCount}</span> : null}
        </Chip>
      ))}
    </div>
  );
}
