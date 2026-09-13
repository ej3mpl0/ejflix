import { useEffect, useState } from "react";
import type { AddonCatalog, Movie } from "../lib/types";
import { api } from "../lib/api";
import { metaToMovie } from "../lib/addons";
import { useSettings } from "../lib/settings-context";

const PER_CATALOG = 4;

/**
 * Hero candidates from the addon catalogs: the first movie and the first series
 * catalog, keeping only titles that carry a backdrop. `catalogs` is null while the
 * addon list loads, so Home can tell "no addons" from "not loaded yet".
 */
export function useAddonFeatured(): { featured: Movie[]; catalogs: number | null } {
  const { settings } = useSettings();
  const key = `${settings.addons.urls.join("|")}|${settings.addons.cinemeta}`;
  const [featured, setFeatured] = useState<Movie[]>([]);
  const [catalogs, setCatalogs] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .addonsList()
      .then(async (addons) => {
        const list = addons
          .flatMap((addon) => addon.catalogs)
          .filter((c) => !c.requiresExtra && (c.type === "movie" || c.type === "series"));
        if (!alive) return;
        setCatalogs(list.length);
        const firstOf = (type: string): AddonCatalog | undefined => list.find((c) => c.type === type);
        const picks = [firstOf("movie"), firstOf("series")].filter((c): c is AddonCatalog => Boolean(c));
        const pages = await Promise.all(
          picks.map((c) =>
            api
              .addonCatalog({ addonUrl: c.addonUrl, type: c.type, id: c.id })
              .then((metas) =>
                metas
                  .filter((m) => m.background)
                  .slice(0, PER_CATALOG)
                  .map(metaToMovie),
              )
              .catch(() => [] as Movie[]),
          ),
        );
        if (!alive) return;
        // Alternate movies and series so the carousel does not open with four films in a row.
        const out: Movie[] = [];
        const max = Math.max(...pages.map((p) => p.length), 0);
        for (let i = 0; i < max; i++) {
          for (const page of pages) if (page[i]) out.push(page[i]);
        }
        setFeatured(out);
      })
      .catch(() => {
        if (alive) {
          setCatalogs(0);
          setFeatured([]);
        }
      });
    return () => {
      alive = false;
    };
  }, [key]);

  return { featured, catalogs };
}

/** Server hero items first, addon titles woven in between; the same film is not repeated. */
export function mixFeatured(server: Movie[], online: Movie[], max = 10): Movie[] {
  const known = new Set(server.map((m) => m.providerIds.Imdb).filter(Boolean));
  const extra = online.filter((m) => !m.external?.imdb || !known.has(m.external.imdb));
  const out: Movie[] = [];
  let i = 0;
  let j = 0;
  while (out.length < max && (i < server.length || j < extra.length)) {
    if (i < server.length) out.push(server[i++]);
    if (out.length < max && j < extra.length) out.push(extra[j++]);
  }
  return out;
}
