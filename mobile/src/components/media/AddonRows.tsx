import React, { memo, useEffect, useState } from "react";
import type { AddonCatalog, Movie } from "../../lib/types";
import { api } from "../../lib/api";
import { metaToMovie } from "../../lib/addons";
import { useSettings } from "../../lib/settings-context";
import { RowSkeleton } from "../ui/Skeletons";
import { PosterRow } from "./PosterRow";

const MAX_ROWS = 12;
const MAX_ITEMS = 30;

function CatalogRow({ catalog, onOpen, onPlay }: { catalog: AddonCatalog; onOpen: (movie: Movie) => void; onPlay: (movie: Movie) => void }) {
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
  return (
    <PosterRow
      title={`${catalog.name} · ${catalog.addonName}`}
      items={items}
      onOpen={onOpen}
      onPlay={onPlay}
      catalog={{ addonUrl: catalog.addonUrl, type: catalog.type, id: catalog.id }}
    />
  );
}

/** One rail per addon catalog (movies and series), in addon priority order. */
function AddonRowsInner({
  onOpen,
  onPlay,
  empty = null,
}: {
  onOpen: (movie: Movie) => void;
  onPlay: (movie: Movie) => void;
  /** Rendered when no addon offers a catalog. */
  empty?: React.ReactNode;
}) {
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

  if (catalogs == null) return null;
  if (!catalogs.length) return <>{empty}</>;
  return (
    <>
      {catalogs.map((catalog) => (
        <CatalogRow key={`${catalog.addonUrl}|${catalog.type}|${catalog.id}`} catalog={catalog} onOpen={onOpen} onPlay={onPlay} />
      ))}
    </>
  );
}

export const AddonRows = memo(AddonRowsInner);
