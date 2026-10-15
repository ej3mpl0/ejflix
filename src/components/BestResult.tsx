import { Info, Play } from "lucide-react";
import type { Movie } from "../lib/types";
import { useI18n } from "../lib/locale-context";
import { MetaChips } from "./MetaChips";
import { Pill } from "./Pill";

/** The closest match of a search, as a small hero: open it or press play from here. */
export function BestResult({
  movie,
  onOpen,
  onPlay,
}: {
  movie: Movie;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const art = movie.backdropUrl ?? movie.thumbUrl ?? movie.posterUrl;
  const resume = movie.playbackPositionTicks > 0;
  return (
    <article className="relative flex min-h-[380px] items-end overflow-hidden rounded-card bg-surface">
      {art ? <img src={art} alt="" className="img-fade absolute inset-0 h-full w-full object-cover" /> : null}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(16_13_14_/_0.94)_8%,rgb(16_13_14_/_0.25)_72%),linear-gradient(0deg,rgb(16_13_14_/_0.7),transparent_50%)]" />
      <div className="relative w-full max-w-[460px] p-8">
        {movie.logoUrl ? (
          <img src={movie.logoUrl} alt={movie.name} className="mb-4 max-h-[84px] max-w-[80%] object-contain object-left" />
        ) : (
          <h2 className="mb-3 text-[34px] leading-[1.02] font-extrabold tracking-[-0.02em]">{movie.name}</h2>
        )}
        <MetaChips movie={movie} className="mb-2" />
        <p className="mb-5 text-[13.5px] text-muted">{movie.external ? t("online") : t("myServer")}</p>
        <div className="flex flex-wrap gap-2.5">
          <Pill variant="primary" pill size="lg" className="btn-play" icon={<Play size={18} fill="currentColor" />} onClick={() => onPlay(movie)}>
            {resume ? t("resume") : t("play")}
          </Pill>
          <Pill variant="tonal" pill size="lg" className="backdrop-blur-md" icon={<Info size={18} />} onClick={() => onOpen(movie)}>
            {t("viewDetails")}
          </Pill>
        </div>
      </div>
    </article>
  );
}
