import { Chip } from "./Chip";
import { ScrollRow } from "./ScrollRow";
import { useI18n } from "../lib/locale-context";

/** Anything with an id and a name: Jellyfin seasons, or an addon's season numbers. */
export type SeasonTab = { id: string; name: string; childCount?: number | null };

export function SeasonChips({
  seasons,
  value,
  onChange,
}: {
  seasons: SeasonTab[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  if (seasons.length <= 1) return null;
  return (
    <ScrollRow gap="gap-2" className="pb-1" role="tablist" aria-label={t("seasons")}>
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
    </ScrollRow>
  );
}
