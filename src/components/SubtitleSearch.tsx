import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Ear, KeyRound, LoaderCircle, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import type { Movie, OnlineSubtitle, SubtitleQuery } from "../lib/types";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { fieldClass } from "../lib/ui";
import { useI18n } from "../lib/locale-context";
import { errorText } from "../lib/errors";
import { useSettings } from "../lib/settings-context";
import { Dialog } from "./Dialog";
import { Chip } from "./Chip";
import { EmptyState } from "./EmptyState";
import { Pill } from "./Pill";
import { Shimmer } from "./Shimmer";

export const OPENSUBTITLES_KEY_URL = "https://www.opensubtitles.com/consumers";

/** Ids first (IMDb of the film / episode, or of the show with season and episode), the title as the fallback. */
function queryOf(movie: Movie, languages: string[]): SubtitleQuery {
  const ext = movie.external;
  if (ext) {
    const imdb = ext.imdb ?? (ext.metaId.startsWith("tt") ? ext.metaId : null);
    if (ext.type === "series" && ext.season != null && ext.episode != null) {
      return { parentImdb: imdb, season: ext.season, episode: ext.episode, title: movie.seriesName ?? movie.name, languages };
    }
    return { imdb, title: movie.name, languages };
  }
  const episode = movie.kind === "Episode";
  return {
    imdb: movie.providerIds?.Imdb ?? null,
    title: episode ? (movie.seriesName ?? movie.name) : movie.name,
    season: episode ? movie.seasonNumber : null,
    episode: episode ? movie.episodeNumber : null,
    languages,
  };
}

/**
 * "Search online" of the subtitle menu: OpenSubtitles.com results for what is playing,
 * in the profile's subtitle language (or every language), loaded into mpv on click.
 */
export function SubtitleSearch({
  movie,
  onClose,
  onLoaded,
}: {
  movie: Movie;
  onClose: () => void;
  onLoaded: () => void;
}) {
  const { t, locale } = useI18n();
  const { settings } = useSettings();
  const apiKey = settings.playback.opensubtitlesApiKey;
  const preferred = settings.playback.subtitleLanguage;
  // The profile's subtitle language; without one, the app's.
  const profileLanguages = useMemo(
    () => (preferred && preferred !== "off" ? [preferred] : [locale]),
    [preferred, locale],
  );
  const [allLanguages, setAllLanguages] = useState(false);
  const base = useMemo(() => queryOf(movie, profileLanguages), [movie, profileLanguages]);
  const [text, setText] = useState(base.title ?? "");
  /** null = search by the ids; a string = the person typed their own search. */
  const [typed, setTyped] = useState<string | null>(null);
  const [results, setResults] = useState<OnlineSubtitle[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null);
  const seq = useRef(0);

  const languageNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "language" });
    } catch {
      return null;
    }
  }, [locale]);
  const languageName = (code: string) => {
    try {
      const name = languageNames?.of(code);
      return name ? name.charAt(0).toLocaleUpperCase() + name.slice(1) : code;
    } catch {
      return code;
    }
  };

  useEffect(() => {
    if (!apiKey) return;
    const mine = ++seq.current;
    const languages = allLanguages ? [] : profileLanguages;
    const query: SubtitleQuery =
      typed == null ? { ...base, languages } : { title: typed, season: base.season, episode: base.episode, languages };
    setLoading(true);
    setError("");
    api
      .opensubtitlesSearch(query)
      .then((list) => {
        if (mine === seq.current) setResults(list);
      })
      .catch((err) => {
        if (mine !== seq.current) return;
        setResults(null);
        setError(errorText(t, err));
      })
      .finally(() => {
        if (mine === seq.current) setLoading(false);
      });
  }, [apiKey, base, typed, allLanguages, profileLanguages]);

  const load = (item: OnlineSubtitle) => {
    if (downloading != null) return;
    setDownloading(item.fileId);
    setError("");
    api
      .opensubtitlesDownload(item.fileId)
      .then(() => {
        onLoaded();
        onClose();
      })
      .catch((err) => setError(errorText(t, err)))
      .finally(() => setDownloading(null));
  };

  return (
    <Dialog
      labelledBy="subsearch-title"
      onEscape={onClose}
      onBackdrop={onClose}
      z="z-[60]"
      className="flex max-h-[min(640px,86vh)] w-[min(620px,94vw)] flex-col overflow-hidden rounded-card bg-surface shadow-[0_24px_80px_rgb(0_0_0_/_0.55)]"
    >
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <h2 id="subsearch-title" className="min-w-0 flex-1 truncate text-[16px] font-semibold">
          {t("subSearchTitle")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10"
        >
          <X size={16} />
        </button>
      </div>

      {!apiKey ? (
        <EmptyState
          className="mx-5 mb-5 bg-white/4"
          icon={<KeyRound size={24} />}
          title={t("subSearchNoKey")}
          hint={t("subSearchNoKeyHint")}
          action={{ label: t("opensubtitlesGetKey"), onClick: () => void api.openExternal(OPENSUBTITLES_KEY_URL).catch(() => undefined) }}
        />
      ) : (
        <>
          <form
            className="flex gap-2 px-5"
            onSubmit={(e) => {
              e.preventDefault();
              const value = text.trim();
              setTyped(value && value !== base.title ? value : null);
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label={t("subSearchQuery")}
              placeholder={t("subSearchQuery")}
              className={cn(fieldClass, "h-10")}
            />
            <Pill type="submit" size="sm" icon={<Search size={15} />} className="h-10">
              {t("search")}
            </Pill>
          </form>
          <div className="flex flex-wrap items-center gap-2 px-5 pt-3 pb-2">
            <Chip selected={!allLanguages} onClick={() => setAllLanguages(false)}>
              {profileLanguages.map(languageName).join(", ")}
            </Chip>
            <Chip selected={allLanguages} onClick={() => setAllLanguages(true)}>
              {t("subSearchAllLanguages")}
            </Chip>
          </div>
          {error ? <p className="px-5 pb-2 text-[13px] text-danger">{error}</p> : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {loading && !results ? (
              <div className="space-y-2 px-2 pt-1">
                {[0, 1, 2, 3].map((i) => (
                  <Shimmer key={i} className="h-12 rounded-btn" delay={i * 80} />
                ))}
              </div>
            ) : results && !results.length ? (
              <p className="px-2 py-8 text-center text-[13px] text-dim">{t("subSearchEmpty")}</p>
            ) : (
              <ul className={cn("space-y-0.5 transition-opacity", loading && "opacity-50")}>
                {(results ?? []).map((item) => (
                  <li key={item.fileId}>
                    <button
                      type="button"
                      disabled={downloading != null}
                      onClick={() => load(item)}
                      className="flex min-h-12 w-full items-center gap-3 rounded-btn px-2 py-2 text-left hover:bg-white/6 disabled:cursor-wait"
                    >
                      <span className="min-w-[72px] shrink-0 text-[12px] font-semibold text-accent">{languageName(item.language)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-text" title={item.release}>
                          {item.release || "—"}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-2.5 text-[11px] text-dim">
                          <span className="tabular">{t("subSearchDownloads", { n: item.downloads.toLocaleString(locale) })}</span>
                          {item.fps ? <span className="tabular">{item.fps} fps</span> : null}
                          {item.trusted ? (
                            <span className="inline-flex items-center gap-1">
                              <ShieldCheck size={11} />
                              {t("subSearchTrusted")}
                            </span>
                          ) : null}
                          {item.hearingImpaired ? (
                            <span className="inline-flex items-center gap-1">
                              <Ear size={11} />
                              {t("subSearchHearing")}
                            </span>
                          ) : null}
                          {item.machineTranslated ? (
                            <span className="inline-flex items-center gap-1">
                              <Sparkles size={11} />
                              {t("subSearchMachine")}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="grid h-8 w-8 shrink-0 place-items-center text-white/70">
                        {downloading === item.fileId ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="border-t border-white/6 px-5 py-2.5 text-[11px] text-dim">{t("subSearchCredit")}</p>
        </>
      )}
    </Dialog>
  );
}
