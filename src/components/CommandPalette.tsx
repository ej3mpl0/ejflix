import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Clapperboard,
  Clock,
  CalendarDays,
  Command,
  Compass,
  Film,
  Globe,
  Heart,
  Home as HomeIcon,
  Keyboard,
  Moon,
  Palette,
  PartyPopper,
  Play,
  Puzzle,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Tv,
  Users,
} from "lucide-react";
import type { AddonCatalog, Movie } from "../lib/types";
import { api } from "../lib/api";
import { metaToMovie } from "../lib/addons";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
import { THEMES } from "../lib/theme";
import type { MessageKey } from "../lib/i18n";
import type { NavView } from "./GlassHeader";
import type { SettingsSectionId } from "../screens/Settings";
import { Dialog } from "./Dialog";
import { Shimmer } from "./Shimmer";

const RECENT_KEY = "ejflix.palette.recent";
const RECENT_MAX = 6;
const TITLE_MAX = 8;
const DEBOUNCE_MS = 250;
/** Online catalogs asked per query (the palette is a quick jump, not the full search). */
const MAX_CATALOGS = 3;

type Recent = { kind: "title"; movie: Movie } | { kind: "command"; id: string };

type Entry = {
  id: string;
  group: "recent" | "titles" | "go" | "settings" | "actions";
  label: string;
  hint?: string;
  icon: ReactNode;
  /** Extra words the filter matches (e.g. the Spanish and English names of a section). */
  keywords?: string;
  run: () => void;
  /** A title entry, remembered as such. */
  movie?: Movie;
};

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** A title as it is kept in the recent list: without the heavy parts a details page reloads anyway. */
function slim(movie: Movie): Movie {
  return { ...movie, cast: [], mediaSources: [], chapters: [], trickplay: null, overview: movie.overview?.slice(0, 200) ?? null };
}

function loadRecent(userId: string): Recent[] {
  try {
    const raw = localStorage.getItem(`${RECENT_KEY}.${userId}`);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as Recent[]).filter((item) => item && (item.kind === "title" || item.kind === "command")) : [];
  } catch {
    return [];
  }
}

function saveRecent(userId: string, list: Recent[]) {
  try {
    localStorage.setItem(`${RECENT_KEY}.${userId}`, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* storage unavailable */
  }
}

const SECTIONS: Array<{ id: SettingsSectionId; label: MessageKey; icon: ReactNode }> = [
  { id: "appearance", label: "general", icon: <Palette size={16} /> },
  { id: "playback", label: "playback", icon: <Play size={16} /> },
  { id: "addons", label: "addons", icon: <Puzzle size={16} /> },
  { id: "torrents", label: "torrentsTitle", icon: <Film size={16} /> },
  { id: "iptv", label: "iptv", icon: <Tv size={16} /> },
  { id: "discord", label: "discord", icon: <Globe size={16} /> },
  { id: "account", label: "account", icon: <Users size={16} /> },
  { id: "parental", label: "parentalTitle", icon: <ShieldCheck size={16} /> },
  { id: "trakt", label: "traktTitle", icon: <Clapperboard size={16} /> },
  { id: "updates", label: "updates", icon: <Sparkles size={16} /> },
  { id: "about", label: "about", icon: <SettingsIcon size={16} /> },
];

/**
 * Ctrl+K palette: titles (the same search the Search page uses, server and online),
 * the app's views, every Settings section and quick actions, all from the keyboard.
 * What was run last comes back first as "Recent".
 */
export function CommandPalette({
  userId,
  hasServer,
  hasTv,
  onClose,
  onView,
  onSettings,
  onOpen,
  onSearch,
  onSwitchProfile,
  onShortcuts,
  onParty,
}: {
  userId: string;
  hasServer: boolean;
  hasTv: boolean;
  onClose: () => void;
  onView: (view: NavView) => void;
  onSettings: (section: SettingsSectionId) => void;
  onOpen: (movie: Movie) => void;
  /** Full results for the query in the Search view. */
  onSearch: (query: string) => void;
  onSwitchProfile: () => void;
  onShortcuts: () => void;
  /** Watch party dialog (join with a code, or the party in progress). */
  onParty?: () => void;
}) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [titles, setTitles] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [catalogs, setCatalogs] = useState<AddonCatalog[]>([]);
  const [recent, setRecent] = useState<Recent[]>(() => loadRecent(userId));
  const listRef = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const trimmed = query.trim();

  useEffect(() => {
    let alive = true;
    api
      .addonsList()
      .then((addons) => {
        if (!alive) return;
        const searchable = [...addons]
          .sort((a, b) => Number(a.builtin) - Number(b.builtin))
          .flatMap((addon) => addon.catalogs)
          .filter((c) => c.searchable && (c.type === "movie" || c.type === "series"));
        setCatalogs(searchable.slice(0, MAX_CATALOGS));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Titles: server first, then online ones it does not have.
  useEffect(() => {
    const id = ++request.current;
    if (trimmed.length < 2) {
      setTitles([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = window.setTimeout(async () => {
      const [server, online] = await Promise.all([
        hasServer ? api.searchItems(trimmed).catch(() => [] as Movie[]) : Promise.resolve([] as Movie[]),
        Promise.all(
          catalogs.map((c) =>
            api.addonCatalog({ addonUrl: c.addonUrl, type: c.type, id: c.id, search: trimmed }).catch(() => []),
          ),
        ),
      ]);
      if (id !== request.current) return;
      const known = new Set(server.map((m) => m.providerIds.Imdb).filter(Boolean));
      const seen = new Set<string>();
      const extra: Movie[] = [];
      for (const movie of online.flat().map(metaToMovie)) {
        const imdb = movie.external?.imdb;
        if (seen.has(movie.id) || (imdb && known.has(imdb))) continue;
        seen.add(movie.id);
        extra.push(movie);
      }
      setTitles([...server, ...extra].slice(0, TITLE_MAX));
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [trimmed, hasServer, catalogs]);

  const remember = (item: Recent) => {
    const key = (r: Recent) => (r.kind === "title" ? `t:${r.movie.id}` : `c:${r.id}`);
    const next = [item, ...recent.filter((r) => key(r) !== key(item))].slice(0, RECENT_MAX);
    setRecent(next);
    saveRecent(userId, next);
  };

  const titleEntry = (movie: Movie, group: Entry["group"]): Entry => ({
    id: `title:${movie.id}`,
    group,
    label: movie.name,
    hint: [movie.kind === "Series" ? t("seriesOne") : t("movie"), movie.year ? String(movie.year) : null, movie.external ? t("online") : null]
      .filter(Boolean)
      .join(" · "),
    icon: movie.posterUrl ? (
      <img src={movie.posterUrl} alt="" className="h-9 w-6 rounded-[3px] object-cover" />
    ) : (
      <Film size={16} />
    ),
    movie,
    run: () => onOpen(movie),
  });

  const commands: Entry[] = useMemo(() => {
    const go = (view: NavView, label: string, icon: ReactNode, keywords = ""): Entry => ({
      id: `go:${view}`,
      group: "go",
      label,
      hint: t("paletteGoTo"),
      icon,
      keywords,
      run: () => onView(view),
    });
    const themeIndex = THEMES.findIndex((theme) => theme.id === settings.appearance.theme);
    const nextTheme = THEMES[(themeIndex + 1) % THEMES.length];
    return [
      go("home", t("home"), <HomeIcon size={16} />, "inicio home"),
      go("discover", t("discover"), <Compass size={16} />, "descubrir discover explore"),
      go("mylist", t("myList"), <Heart size={16} />, "mi lista my list favoritos favorites"),
      go("calendar", t("calendar"), <CalendarDays size={16} />, "calendario calendar estrenos upcoming episodios episodes"),
      ...(hasTv ? [go("tv", t("liveTv"), <Tv size={16} />, "tv iptv canales channels directo live")] : []),
      ...(hasServer ? [go("myserver", t("myServer"), <Film size={16} />, "jellyfin servidor server")] : []),
      go("settings", t("settings"), <SettingsIcon size={16} />, "ajustes settings preferencias"),
      ...SECTIONS.map(
        (section): Entry => ({
          id: `settings:${section.id}`,
          group: "settings",
          label: t(section.label),
          hint: t("settings"),
          icon: section.icon,
          keywords: `ajustes settings ${section.id}`,
          run: () => onSettings(section.id),
        }),
      ),
      {
        id: "action:switch-profile",
        group: "actions",
        label: t("switchProfile"),
        icon: <Users size={16} />,
        keywords: "perfil profile usuario user",
        run: onSwitchProfile,
      },
      {
        id: "action:amoled",
        group: "actions",
        label: settings.appearance.amoled ? t("paletteAmoledOff") : t("paletteAmoledOn"),
        icon: <Moon size={16} />,
        keywords: "tema theme amoled negro black oscuro dark",
        run: () => void update({ appearance: { amoled: !settings.appearance.amoled } }),
      },
      {
        id: "action:next-theme",
        group: "actions",
        label: t("paletteNextTheme", { name: t(nextTheme.labelKey) }),
        icon: <Palette size={16} />,
        keywords: "tema theme color colour acento accent",
        run: () => void update({ appearance: { theme: nextTheme.id, autoAccent: false } }),
      },
      {
        id: "action:auto-accent",
        group: "actions",
        label: settings.appearance.autoAccent ? t("paletteAutoAccentOff") : t("paletteAutoAccentOn"),
        icon: <Sparkles size={16} />,
        keywords: "tema theme color colour acento accent auto",
        run: () => void update({ appearance: { autoAccent: !settings.appearance.autoAccent } }),
      },
      {
        id: "action:trailers",
        group: "actions",
        label: settings.appearance.autoplayTrailers ? t("paletteTrailersOff") : t("paletteTrailersOn"),
        icon: <Film size={16} />,
        keywords: "trailer trailers tráiler autoplay",
        run: () => void update({ appearance: { autoplayTrailers: !settings.appearance.autoplayTrailers } }),
      },
      {
        id: "action:shortcuts",
        group: "actions",
        label: t("keyboardShortcuts"),
        icon: <Keyboard size={16} />,
        keywords: "atajos shortcuts teclado keyboard mando gamepad",
        run: onShortcuts,
      },
      ...(onParty
        ? [
            {
              id: "action:party",
              group: "actions" as const,
              label: t("partyJoinTitle"),
              icon: <PartyPopper size={16} />,
              keywords: "party watch together grupo juntos sesión código code unirse join",
              run: onParty,
            },
          ]
        : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, settings.appearance, hasServer, hasTv]);

  const entries: Entry[] = useMemo(() => {
    const needle = fold(trimmed);
    if (!needle) {
      const byId = new Map(commands.map((entry) => [entry.id, entry]));
      const recents = recent
        .map((item) =>
          item.kind === "title"
            ? titleEntry(item.movie, "recent")
            : byId.has(item.id)
              ? { ...byId.get(item.id)!, group: "recent" as const }
              : null,
        )
        .filter((entry): entry is Entry => entry != null);
      const shown = new Set(recents.map((entry) => entry.id));
      return [...recents, ...commands.filter((entry) => !shown.has(entry.id))];
    }
    const matching = commands.filter((entry) => fold(`${entry.label} ${entry.keywords ?? ""}`).includes(needle));
    const search: Entry = {
      id: "action:search",
      group: "titles",
      label: t("paletteSearchAll", { query: trimmed }),
      icon: <Search size={16} />,
      run: () => onSearch(trimmed),
    };
    return [...titles.map((movie) => titleEntry(movie, "titles")), search, ...matching];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, titles, commands, recent]);

  useEffect(() => setActive(0), [trimmed]);
  const current = Math.min(active, Math.max(0, entries.length - 1));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = (entry: Entry) => {
    remember(entry.movie ? { kind: "title", movie: slim(entry.movie) } : { kind: "command", id: entry.id });
    onClose();
    entry.run();
  };

  const groupLabel: Record<Entry["group"], string> = {
    recent: t("recent"),
    titles: t("paletteTitles"),
    go: t("paletteGo"),
    settings: t("settings"),
    actions: t("paletteActions"),
  };

  return (
    <Dialog
      labelledBy="palette-title"
      onEscape={onClose}
      onBackdrop={onClose}
      z="z-[80]"
      className="w-[min(640px,94vw)] self-start overflow-hidden rounded-card bg-panel shadow-[0_24px_80px_rgb(0_0_0_/_0.6),0_0_0_1px_rgb(255_255_255_/_0.08)] mt-[12vh]"
    >
      <h2 id="palette-title" className="sr-only">
        {t("paletteTitle")}
      </h2>
      <div className="flex items-center gap-3 border-b border-white/8 px-4">
        <Command size={17} className="shrink-0 text-dim" aria-hidden />
        <input
          data-autofocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive((entries.length ? (current + step + entries.length) % entries.length : 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const entry = entries[current];
              if (entry) run(entry);
            } else if (e.key === "Home" && !query) {
              setActive(0);
            } else if (e.key === "End" && !query) {
              setActive(entries.length - 1);
            }
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={entries[current] ? `palette-${current}` : undefined}
          aria-label={t("paletteTitle")}
          placeholder={t("palettePlaceholder")}
          className="field-own-focus h-14 min-w-0 flex-1 bg-transparent text-[15px] text-text outline-none placeholder:text-dim"
        />
        <kbd className="hidden h-6 items-center rounded-md border border-white/15 bg-white/8 px-1.5 text-[11px] font-semibold text-muted sm:inline-flex">
          Esc
        </kbd>
      </div>
      <div ref={listRef} id="palette-list" role="listbox" aria-label={t("paletteTitle")} className="max-h-[min(460px,60vh)] overflow-y-auto p-2">
        {loading && !titles.length ? (
          <div className="space-y-1 px-1 pb-1" aria-hidden>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-1.5">
                <Shimmer className="h-9 w-6 rounded-[3px]" delay={i * 80} />
                <Shimmer className="h-3.5 w-2/5 rounded" delay={i * 80} />
              </div>
            ))}
          </div>
        ) : null}
        {entries.map((entry, i) => (
          <div key={`${entry.group}:${entry.id}`}>
            {i === 0 || entries[i - 1].group !== entry.group ? (
              <p className="px-3 pt-2.5 pb-1 text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">
                {entry.group === "recent" ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={11} />
                    {groupLabel.recent}
                  </span>
                ) : (
                  groupLabel[entry.group]
                )}
              </p>
            ) : null}
            <div
              id={`palette-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === current}
              onMouseMove={() => setActive(i)}
              onClick={() => run(entry)}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-3 py-1.5",
                i === current ? "bg-accent-soft text-text" : "text-text/90",
              )}
            >
              <span className={cn("grid w-6 shrink-0 place-items-center", i === current ? "text-accent" : "text-dim")}>{entry.icon}</span>
              <span className="min-w-0 flex-1 truncate text-[14px]">{entry.label}</span>
              {entry.hint ? <span className="shrink-0 truncate text-[12px] text-dim">{entry.hint}</span> : null}
              {i === current ? <ArrowRight size={14} className="shrink-0 text-accent" aria-hidden /> : null}
            </div>
          </div>
        ))}
        {!entries.length && !loading ? <p className="px-3 py-6 text-center text-[13px] text-dim">{t("noResults")}</p> : null}
      </div>
      <div className="flex items-center gap-4 border-t border-white/8 px-4 py-2 text-[11px] text-dim">
        <span>↑ ↓ {t("paletteNavigate")}</span>
        <span>Enter {t("paletteRun")}</span>
        <span className="ml-auto">Ctrl K</span>
      </div>
    </Dialog>
  );
}
