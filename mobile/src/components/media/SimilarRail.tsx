import React, { memo, useEffect, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import type { Movie } from "../../lib/types";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/locale-context";
import { RowSkeleton } from "../ui/Skeletons";
import { PosterRow } from "./PosterRow";

/** "More like this" rail of a details page (bleeds to the page edges by itself). */
function SimilarRailInner({
  itemId,
  onOpen,
  onPlay,
  style,
}: {
  itemId: string;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  style?: StyleProp<ViewStyle>;
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
  return <PosterRow title={t("moreLikeThis")} items={items} onOpen={onOpen} onPlay={onPlay} style={style} />;
}

export const SimilarRail = memo(SimilarRailInner);
