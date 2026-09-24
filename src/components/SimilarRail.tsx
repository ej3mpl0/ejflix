import { useEffect, useState } from "react";
import type { Movie } from "../lib/types";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";
import { PosterRow } from "./PosterRow";
import { RowSkeleton } from "./Skeletons";

/** "More like this" rail for a details page. */
export function SimilarRail({
  itemId,
  name,
  onOpen,
  onPlay,
}: {
  itemId: string;
  /** Title of the page, for the "Similar to X" caption. */
  name?: string;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<Movie[] | null>(null);

  useEffect(() => {
    let alive = true;
    setItems(null);
    api
      .getSimilar(itemId)
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, [itemId]);

  if (items == null) return <RowSkeleton />;
  if (!items.length) return null;
  return (
    <PosterRow
      title={t("moreLikeThis")}
      caption={name ? t("similarTo", { name }) : undefined}
      items={items}
      onOpen={onOpen}
      onPlay={onPlay}
    />
  );
}
