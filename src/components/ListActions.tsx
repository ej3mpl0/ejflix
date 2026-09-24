import { ListVideo, Shuffle } from "lucide-react";
import type { Movie } from "../lib/types";
import { useI18n } from "../lib/locale-context";
import { playableFilms, startList } from "../lib/play-queue";
import { Pill } from "./Pill";

/** "Play all" and "Shuffle" over the films of a list (My list or a custom one). */
export function ListActions({ items, onPlay }: { items: Movie[]; onPlay: (movie: Movie) => void }) {
  const { t } = useI18n();
  const films = playableFilms(items).length;
  const start = (shuffle: boolean) => {
    const first = startList(items, shuffle);
    if (first) onPlay(first);
  };
  const hint = films ? t("playAllFilmsHint", { n: films }) : t("noFilmsToPlay");
  return (
    <>
      <Pill variant="primary" pill icon={<ListVideo size={17} />} disabled={!films} title={hint} onClick={() => start(false)}>
        {t("playAll")}
      </Pill>
      <Pill variant="tonal" pill icon={<Shuffle size={16} />} disabled={films < 2} title={hint} onClick={() => start(true)}>
        {t("shuffle")}
      </Pill>
    </>
  );
}
