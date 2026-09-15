import { useEffect, useState } from "react";
import type { AddonMetaFull, Movie } from "../lib/types";
import { api } from "../lib/api";
import { metaToMovie } from "../lib/addons";
import { useI18n } from "../lib/locale-context";
import { PosterRow } from "./PosterRow";
import { RowSkeleton } from "./Skeletons";

const MAX_ITEMS = 20;

/**
 * What to watch next to an online title.
 *
 * Addon metadata states exactly one real relation: the collection a title belongs to,
 * its saga. That is what this shows, under the collection's own name. Everything else
 * on offer is guesswork — browsing a genre answers with whatever the catalog is
 * pushing this week, and searching the director's name turns up documentaries about
 * them — so without a collection the rail says what it really is: more of the genre.
 */
export function OnlineSimilarRail({
  meta,
  movie,
  onOpen,
  onPlay,
}: {
  meta: AddonMetaFull | null;
  movie: Movie;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const { t } = useI18n();
  const [rail, setRail] = useState<{ title: string; items: Movie[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const kind = movie.external?.type ?? "movie";
  const id = movie.id;
  const genre = movie.genres[0] ?? "";
  const collection = (meta?.related ?? []).filter((related) => related.type === kind);
  const collectionKey = collection.map((related) => related.id).join(",");

  useEffect(() => {
    if (!meta) return;
    let alive = true;
    setRail(null);
    setLoading(true);
    (async () => {
      if (collection.length) {
        const metas = await api.addonMetas(kind, collection.map((related) => related.id)).catch(() => []);
        const items = metas.map(metaToMovie).filter((item) => item.id !== id);
        if (items.length) {
          if (alive) setRail({ title: collection[0].group, items: items.slice(0, MAX_ITEMS) });
          return;
        }
      }
      if (!genre) return;
      const addons = await api.addonsList().catch(() => []);
      for (const catalog of addons.flatMap((addon) => addon.catalogs)) {
        if (catalog.type !== kind || !catalog.genres.includes(genre)) continue;
        const metas = await api
          .addonCatalog({ addonUrl: catalog.addonUrl, type: catalog.type, id: catalog.id, genre })
          .catch(() => []);
        const items = metas.map(metaToMovie).filter((item) => item.id !== id);
        if (items.length) {
          if (alive) setRail({ title: t("moreOfGenre", { genre }), items: items.slice(0, MAX_ITEMS) });
          return;
        }
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [meta, kind, id, genre, collectionKey, t]);

  if (!meta) return null;
  if (loading && !rail) return <RowSkeleton />;
  if (!rail) return null;
  return <PosterRow title={rail.title} items={rail.items} onOpen={onOpen} onPlay={onPlay} />;
}
