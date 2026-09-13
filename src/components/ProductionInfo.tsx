import type { Movie } from "../lib/types";
import { useI18n } from "../lib/locale-context";

/** Crew, studios and the technical line-up of the file. */
export function ProductionInfo({ movie }: { movie: Movie }) {
  const { t } = useI18n();
  const rows: { label: string; value: string }[] = [
    { label: t("genres"), value: movie.genres.join(", ") },
    { label: t("director"), value: movie.directors.join(", ") },
    { label: t("writers"), value: movie.writers.join(", ") },
    { label: t("studios"), value: movie.studios.join(", ") },
    { label: t("video"), value: movie.videoLabel ?? "" },
    { label: t("audio"), value: movie.audioLabel ?? "" },
    { label: t("subtitles"), value: movie.subtitleLabels.join(", ") },
  ].filter((row) => row.value);
  if (!rows.length) return null;

  return (
    <section>
      <h2 className="mb-4 text-[18px] font-semibold">{t("production")}</h2>
      <dl className="grid gap-x-8 gap-y-3 text-[13px] md:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex gap-3">
            <dt className="w-24 shrink-0 text-dim">{row.label}</dt>
            <dd className="min-w-0 text-text">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
