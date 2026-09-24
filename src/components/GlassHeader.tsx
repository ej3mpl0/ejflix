import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Search, Settings as SettingsIcon, Users, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Logo } from "./Logo";
import { WindowControls } from "./WindowControls";
import { Avatar } from "./Avatar";
import { DownloadsButton } from "./DownloadsButton";
import type { Library } from "../lib/types";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";

/** `lib:<id>` selects a pinned Jellyfin library. */
export type NavView =
  | "home"
  | "myserver"
  | "discover"
  | "tv"
  | "mylist"
  | "calendar"
  | "search"
  | "settings"
  | `lib:${string}`;

export function libraryView(id: string): NavView {
  return `lib:${id}`;
}

/** Outside GlassHeader so a re-render (the scroll flag flips often) keeps the buttons and their focus. */
function Tab({
  id,
  label,
  view,
  onView,
  className,
  badge = 0,
}: {
  id: NavView;
  label: string;
  view: NavView;
  onView: (view: NavView) => void;
  className?: string;
  /** Something new behind the tab (new episodes on the calendar). */
  badge?: number;
}) {
  const active = view === id;
  return (
    <button
      type="button"
      data-tab={active ? "active" : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-[60px] items-center px-1 text-[14px] transition-colors duration-150 hover:text-text",
        active ? "font-semibold text-text" : "text-text/70",
        className,
      )}
      onClick={() => onView(id)}
    >
      {label}
      {badge > 0 ? (
        <span
          className="ml-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[10.5px] font-bold text-on-accent tabular"
          aria-label={String(badge)}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Fixed glass header: brand, tabs with a springy indicator, library pinning, search,
 * settings, account menu and the window controls. Doubles as the window drag region.
 */
export function GlassHeader({
  userName,
  avatarUrl,
  mode,
  hasServer,
  hasTv = false,
  badges = {},
  view,
  onView,
  libraries,
  onRemoveLibrary,
  search,
  onSearch,
  onSearchFocus,
  scrolled,
  hidden = false,
  onSwitchProfile,
  onLogout,
}: {
  userName: string;
  avatarUrl?: string | null;
  /** Jellyfin user or local profile (decides the account menu entries). */
  mode: "jellyfin" | "local";
  /** Server tabs (My server, libraries, My list) only make sense with a server. */
  hasServer: boolean;
  /** The profile has IPTV lists: show the TV tab. */
  hasTv?: boolean;
  /** Counters on the tabs (new episodes on the calendar). */
  badges?: Partial<Record<NavView, number>>;
  view: NavView;
  onView: (view: NavView) => void;
  /** Libraries pinned as tabs. */
  libraries: Library[];
  onRemoveLibrary: (id: string) => void;
  /** The query of the search box, which lives here and drives the search view. */
  search: string;
  onSearch: (query: string) => void;
  onSearchFocus: () => void;
  scrolled: boolean;
  /** Slide the header away (a details page has its own bar). */
  hidden?: boolean;
  onSwitchProfile: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** How many tabs fit before the rest folds into "More" (all of them when there is room). */
  const [fit, setFit] = useState(Number.POSITIVE_INFINITY);
  const [moreOpen, setMoreOpen] = useState(false);

  const entries: Array<{ id: NavView; label: string; library?: Library }> = [
    { id: "home", label: t("home") },
    { id: "discover", label: t("discover") },
    { id: "mylist", label: t("myList") },
    { id: "calendar", label: t("calendar") },
    ...(hasServer ? [{ id: "myserver" as NavView, label: t("myServer") }] : []),
    ...(hasServer ? libraries.map((lib) => ({ id: libraryView(lib.id), label: lib.name, library: lib })) : []),
    ...(hasTv ? [{ id: "tv" as NavView, label: t("tvTab") }] : []),
  ];
  const entriesKey = entries.map((entry) => `${entry.id}:${entry.label}:${badges[entry.id] ? 1 : 0}`).join("|");
  const shown = Number.isFinite(fit) ? entries.slice(0, fit) : entries;
  const folded = Number.isFinite(fit) ? entries.slice(fit) : [];
  const foldedActive = folded.some((entry) => entry.id === view);

  // "/" jumps to the search box from anywhere in the app (not while typing); Ctrl+K opens
  // the command palette instead (Home).
  useEffect(() => {
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key !== "/" || typing || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
      // A dialog keeps the keyboard: the search box sits behind it.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden]);

  // Fold the tabs that do not fit the bar into a "More" menu (narrow windows, many libraries).
  useLayoutEffect(() => {
    const bar = barRef.current;
    const ruler = measureRef.current;
    if (!bar || !ruler) return;
    const GAP = 20;
    const MORE = 88;
    const compute = () => {
      const widths = [...ruler.children].map((child) => (child as HTMLElement).offsetWidth);
      const style = getComputedStyle(bar);
      const room =
        bar.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight) -
        (logoRef.current?.offsetWidth ?? 0) -
        32;
      const total = widths.reduce((sum, w, i) => sum + w + (i ? GAP : 0), 0);
      if (total <= room) {
        setFit(Number.POSITIVE_INFINITY);
        return;
      }
      let used = MORE;
      let count = 0;
      for (const w of widths) {
        if (used + w + GAP > room) break;
        used += w + GAP;
        count += 1;
      }
      setFit(Math.max(1, count));
    };
    compute();
    // The ruler changes width when the web font arrives, the bar when the window resizes.
    const observer = new ResizeObserver(compute);
    observer.observe(bar);
    observer.observe(ruler);
    void document.fonts?.ready.then(compute);
    return () => observer.disconnect();
  }, [entriesKey]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setMoreOpen(false);
      moreRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [moreOpen]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setMenu(false);
      menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [menu]);

  // Indicator follows the active tab; re-measured when tabs change size.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>('[data-tab="active"]');
      if (!active) {
        setIndicator(null);
        return;
      }
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [view, entriesKey, fit]);

  // Squash the indicator on every tab change without remounting it, so it also slides.
  useEffect(() => {
    const el = indicatorRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate([{ transform: "scale(1, 1)" }, { transform: "scale(1.18, 0.8)", offset: 0.45 }, { transform: "scale(1, 1)" }], {
      duration: 400,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
  }, [view]);

  const tab = { view, onView };

  return (
    <header
      className={cn(
        "glass-header fixed inset-x-0 top-0 z-40 flex h-[60px] items-center transition-transform duration-[var(--duration-sheet)] ease-std",
        hidden && "-translate-y-full",
      )}
      style={{ ["--glass-line" as string]: scrolled ? 0.9 : 0.35 }}
    >
      <div
        ref={barRef}
        className="relative flex h-full min-w-0 flex-1 items-center gap-8 px-6"
        data-tauri-drag-region
        onDoubleClick={() => getCurrentWindow().toggleMaximize().catch(() => undefined)}
      >
        <div ref={logoRef} data-tauri-drag-region>
          <Logo />
        </div>
        {/* Invisible copy of every tab, only to measure how many fit. */}
        <div ref={measureRef} aria-hidden className="pointer-events-none invisible absolute top-0 left-0 flex h-0 overflow-hidden">
          {entries.map((entry) => (
            <span
              key={entry.id}
              className={cn(
                "shrink-0 px-1 text-[14px] font-semibold whitespace-nowrap",
                entry.library && "max-w-[180px] truncate",
              )}
            >
              {entry.label}
              {badges[entry.id] ? <span className="ml-1.5 inline-block w-[18px]" /> : null}
            </span>
          ))}
        </div>
        <nav ref={navRef} className="relative flex h-full min-w-0 items-center gap-5">
          {shown.map((entry) =>
            entry.library ? (
              <div key={entry.id} className="group/tab relative flex h-full min-w-0 items-center">
                <Tab {...tab} id={entry.id} label={entry.label} className="max-w-[180px] truncate" />
                <button
                  type="button"
                  aria-label={`${t("removeLibrary")}: ${entry.label}`}
                  title={t("removeLibrary")}
                  onClick={() => onRemoveLibrary(entry.library!.id)}
                  className="ml-1 hidden h-5 w-5 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white group-hover/tab:grid group-focus-within/tab:grid"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <Tab key={entry.id} {...tab} id={entry.id} label={entry.label} badge={badges[entry.id]} />
            ),
          )}
          {folded.length ? (
            <div ref={moreRef} className="relative flex h-full items-center">
              <button
                type="button"
                data-tab={foldedActive ? "active" : undefined}
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
                className={cn(
                  "inline-flex h-[60px] items-center gap-1 px-1 text-[14px] transition-colors duration-150 hover:text-text",
                  foldedActive ? "font-semibold text-text" : "text-text/70",
                )}
              >
                {foldedActive ? folded.find((entry) => entry.id === view)?.label : t("moreTabs")}
                <ChevronDown size={14} className={cn("transition-transform duration-150", moreOpen && "rotate-180")} />
              </button>
              {moreOpen ? (
                <div
                  role="menu"
                  className="modal-enter absolute top-[52px] left-0 w-56 rounded-2xl bg-panel/95 p-2 shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md"
                >
                  {folded.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      role="menuitem"
                      aria-current={entry.id === view ? "page" : undefined}
                      onClick={() => {
                        setMoreOpen(false);
                        onView(entry.id);
                      }}
                      className={cn(
                        "flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm hover:bg-white/5",
                        entry.id === view ? "font-semibold text-accent" : "text-text",
                      )}
                    >
                      <span className="truncate">{entry.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {indicator ? (
            <span
              ref={indicatorRef}
              aria-hidden
              className="pointer-events-none absolute bottom-0 h-[3px] rounded-full bg-accent transition-[left,width] duration-[var(--duration-slow)] ease-std"
              style={{ left: indicator.left, width: indicator.width }}
            />
          ) : null}
        </nav>
      </div>
      <div className="flex h-full items-center gap-1 pr-1">
        <DownloadsButton />
        <form
          role="search"
          onSubmit={(e) => e.preventDefault()}
          // Narrow windows collapse the box to its icon; a click anywhere on it opens it.
          onClick={() => searchRef.current?.focus()}
          // Only a click opens Search here; tabbing through the header must not leave the page
          // (typing opens it through onSearch).
          onPointerDown={onSearchFocus}
          className={cn(
            "flex h-9 cursor-text items-center overflow-hidden gap-2 rounded-pill border bg-white/6 pl-3 transition-[border-color,background-color,width] duration-200 ease-std",
            search ? "w-[188px]" : "w-9 lg:w-[188px]",
            "focus-within:w-[min(260px,40vw)] focus-within:bg-white/10",
            view === "search" && search ? "border-accent/60" : "border-white/10 focus-within:border-accent/60",
          )}
        >
          <Search size={15} className="shrink-0 text-dim" aria-hidden />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            // The long hint does not fit a header-sized field.
            placeholder={t("search")}
            title={`${t("search")} ( / )`}
            aria-label={t("search")}
            // The app-wide focus ring is a hard outline: on a pill field the border does the job.
            className="field-own-focus h-full min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-dim"
          />
          <button
            type="button"
            aria-label={t("clearSearch")}
            onClick={() => onSearch("")}
            className={cn(
              "mr-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-dim hover:bg-white/10 hover:text-text",
              !search && "invisible",
            )}
          >
            <X size={14} />
          </button>
        </form>
        <div className="relative ml-1" ref={menuRef}>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full"
            onClick={() => setMenu((v) => !v)}
            aria-label={t("account")}
            aria-expanded={menu}
          >
            <Avatar src={avatarUrl} name={userName} size={32} />
          </button>
          {menu ? (
            <div className="modal-enter absolute top-11 right-0 w-56 rounded-2xl bg-panel/95 p-2 shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md">
              <p className="truncate px-3 py-2 text-[13px] text-muted">{userName}</p>
              <button
                type="button"
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-white/5"
                onClick={() => {
                  setMenu(false);
                  onView("settings");
                }}
              >
                <SettingsIcon size={14} />
                {t("settings")}
              </button>
              <button
                type="button"
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-white/5"
                onClick={onSwitchProfile}
              >
                <Users size={14} />
                {t("switchProfile")}
              </button>
              {mode === "jellyfin" ? (
                <button
                  type="button"
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-white/5"
                  onClick={onLogout}
                >
                  <LogOut size={14} />
                  {t("signOut")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <WindowControls />
      </div>
    </header>
  );
}
