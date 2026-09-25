import { useEffect, useState } from "react";
import { api } from "./api";
import { useI18n } from "./locale-context";
import { useSettings } from "./settings-context";
import type { LocalizedInfo, Movie } from "./types";

/** Languages offered for overviews and trailers (TMDB tags), each named in itself. */
export const CONTENT_LANGUAGES: { tag: string; label: string }[] = [
  { tag: "es-ES", label: "Español (España)" },
  { tag: "es-MX", label: "Español (Latinoamérica)" },
  { tag: "en-US", label: "English (US)" },
  { tag: "en-GB", label: "English (UK)" },
  { tag: "fr-FR", label: "Français" },
  { tag: "de-DE", label: "Deutsch" },
  { tag: "it-IT", label: "Italiano" },
  { tag: "pt-PT", label: "Português (Portugal)" },
  { tag: "pt-BR", label: "Português (Brasil)" },
  { tag: "ca-ES", label: "Català" },
];

/**
 * The TMDB tag overviews and trailers are asked in, or null to keep what the addon or the
 * server sends. "auto" follows the app's language: a choice, never where the user is.
 */
export function useContentLanguage(): string | null {
  const { settings, ready } = useSettings();
  const { locale } = useI18n();
  const choice = settings.appearance.contentLanguage;
  // Nothing before the profile's settings are in: the defaults could ask in the wrong one.
  if (!ready || choice === "source") return null;
  if (/^[a-z]{2}-[A-Z]{2}$/.test(choice)) return choice;
  return locale === "en" ? "en-US" : "es-ES";
}

/** What TMDB knows a film or a series by (catalog id first); null for anything else. */
function lookup(movie: Movie): { kind: "movie" | "series"; ids: string[] } | null {
  const kind = movie.kind === "Movie" ? "movie" : movie.kind === "Series" ? "series" : null;
  if (!kind || movie.live) return null;
  const tmdb = movie.providerIds?.Tmdb;
  const ids = [movie.external?.metaId, movie.external?.imdb, tmdb ? `tmdb:${tmdb}` : null, movie.providerIds?.Imdb].filter(
    (id): id is string => Boolean(id && (id.startsWith("tt") || id.startsWith("tmdb:"))),
  );
  return ids.length ? { kind, ids: [...new Set(ids)] } : null;
}

/** One question per title and language for the whole session (a failure is asked again). */
const asked = new Map<string, Promise<LocalizedInfo | null>>();

/**
 * A film's or a series' overview and trailers in the content language. `undefined` while
 * asking (so a trailer is not picked twice); `null` when there is nothing to change: the
 * option is off, the title has no TMDB or IMDb id, or TMDB does not have it.
 */
export function useLocalizedInfo(movie: Movie | null | undefined, wanted = true): LocalizedInfo | null | undefined {
  const lang = useContentLanguage();
  const target = movie && lang && wanted ? lookup(movie) : null;
  // Keyed by the first id only: a details page starts from the catalog card and the full
  // metadata may add an IMDb id later, which must not ask (and blank the trailer) again.
  const key = target && lang ? `${lang}|${target.kind}|${target.ids[0]}` : "";
  const [answer, setAnswer] = useState<{ key: string; info: LocalizedInfo | null } | null>(null);

  useEffect(() => {
    if (!target || !lang) return;
    let alive = true;
    let job = asked.get(key);
    if (!job) {
      job = api.localizedInfo(target.kind, target.ids, lang).catch(() => {
        asked.delete(key);
        return null;
      });
      asked.set(key, job);
    }
    void job.then((info) => {
      if (alive) setAnswer({ key, info });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return null;
  return answer && answer.key === key ? answer.info : undefined;
}
