import { useEffect, useState } from "react";
import type { AddonCatalog, Movie } from "../lib/types";
import { api } from "../lib/api";
import { metaToMovie } from "../lib/addons";
import { useSettings } from "../lib/settings-context";
import { PosterRow } from "./PosterRow";
import { RowSkeleton } from "./Skeletons";

const MAX_ROWS = 12;
const MAX_ITEMS = 30;

function CatalogRow({
  catalog,
  onOpen,
  onPlay,
}: {
  catalog: AddonCatalog;
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
}) {
  const [items, setItems] = useState<Movie[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .addonCatalog({ addonUrl: catalog.addonUrl, type: catalog.type, id: catalog.id })
      .then((metas) => {
        if (alive) setItems(metas.slice(0, MAX_ITEMS).map(metaToMovie));
      })
      .catch(() => {
        if (alive) setItems([]);
      });
    return () => {
      alive = false;
    };
  }, [catalog.addonUrl, catalog.type, catalog.id]);

  if (items == null) return <RowSkeleton />;
  if (!items.length) return null;
  const title = `${catalog.name} · ${catalog.addonName}`;
  return <PosterRow title={title} items={items} onOpen={onOpen} onPlay={onPlay} />;
}

/** One rail per addon catalog (movies and series), in addon priority order. */
export function AddonRows({ onOpen, onPlay }: { onOpen: (movie: Movie) => void; onPlay: (movie: Movie) => void }) {
  const { settings } = useSettings();
  const [catalogs, setCatalogs] = useState<AddonCatalog[] | null>(null);
  const key = `${settings.addons.urls.join("|")}|${settings.addons.cinemeta}`;

  useEffect(() => {
    let alive = true;
    api
      .addonsList()
      .then((addons) => {
        if (!alive) return;
        const list = addons
          .flatMap((addon) => addon.catalogs)
          .filter((c) => !c.requiresExtra && (c.type === "movie" || c.type === "series"))
          .slice(0, MAX_ROWS);
        setCatalogs(list);
      })
      .catch(() => {
        if (alive) setCatalogs([]);
      });
    return () => {
      alive = false;
    };
  }, [key]);

  if (!catalogs?.length) return null;
  return (
    <>
      {catalogs.map((catalog) => (
        <CatalogRow key={`${catalog.addonUrl}|${catalog.type}|${catalog.id}`} catalog={catalog} onOpen={onOpen} onPlay={onPlay} />
      ))}
    </>
  );
}
