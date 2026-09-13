import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Film, LogOut, Plus, Search, Settings as SettingsIcon, Tv, Users, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Logo } from "./Logo";
import { WindowControls } from "./WindowControls";
import { Avatar } from "./Avatar";
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
  | "search"
  | "settings"
  | `lib:${string}`;

export function libraryView(id: string): NavView {
  return `lib:${id}`;
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
  view,
  onView,
  libraries,
  available,
  onAddLibrary,
  onRemoveLibrary,
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
  view: NavView;
  onView: (view: NavView) => void;
  /** Libraries pinned as tabs. */
  libraries: Library[];
  /** Every library on the server the app can browse. */
  available: Library[];
  onAddLibrary: (library: Library) => void;
  onRemoveLibrary: (id: string) => void;
  scrolled: boolean;
  /** Slide the header away (a details page has its own bar). */
  hidden?: boolean;
  onSwitchProfile: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const [add, setAdd] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);
  const [jellyKey, setJellyKey] = useState(0);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
      if (!addRef.current?.contains(e.target as Node)) setAdd(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

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
  }, [view, libraries.length, hasServer, hasTv]);

  useEffect(() => {
    setJellyKey((n) => n + 1);
  }, [view]);

  const pinned = new Set(libraries.map((lib) => lib.id));
  // The "My server" tab already shows every movie. With a single movies library on
  // the server that tab *is* that library, so offering it again would only duplicate it.
  const movieLibraries = available.filter((lib) => lib.collectionType === "movies");
  const addable = available.filter(
    (lib) =>
      !pinned.has(lib.id) && !(lib.collectionType === "movies" && movieLibraries.length === 1),
  );

  const Tab = ({ id, label, className }: { id: NavView; label: string; className?: string }) => {
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
      </button>
    );
  };

  return (
    <header
      className={cn(
        "glass-header fixed inset-x-0 top-0 z-40 flex h-[60px] items-center transition-transform duration-[var(--duration-sheet)] ease-std",
        hidden && "-translate-y-full",
      )}
      style={{ ["--glass-line" as string]: scrolled ? 0.9 : 0.35 }}
    >
      <div
        className="flex h-full min-w-0 flex-1 items-center gap-8 px-6"
        data-tauri-drag-region
        onDoubleClick={() => getCurrentWindow().toggleMaximize().catch(() => undefined)}
      >
        <div data-tauri-drag-region>
          <Logo />
        </div>
        <nav ref={navRef} className="relative flex h-full min-w-0 items-center gap-5">
          <Tab id="home" label={t("home")} />
          {hasServer ? <Tab id="myserver" label={t("myServer")} /> : null}
          {hasServer
            ? libraries.map((lib) => {
                const id = libraryView(lib.id);
                return (
                  <div key={lib.id} className="group/tab relative flex h-full min-w-0 items-center">
                    <Tab id={id} label={lib.name} className="max-w-[180px] truncate" />
                    <button
                      type="button"
                      aria-label={`${t("removeLibrary")}: ${lib.name}`}
                      title={t("removeLibrary")}
                      onClick={() => onRemoveLibrary(lib.id)}
                      className="ml-1 hidden h-5 w-5 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white group-hover/tab:grid group-focus-within/tab:grid"
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })
            : null}
          <Tab id="discover" label={t("discover")} />
          {hasTv ? <Tab id="tv" label={t("tvTab")} /> : null}
          {hasServer ? <Tab id="mylist" label={t("myList")} /> : null}
          {hasServer ? (
            <div className="relative flex items-center" ref={addRef}>
              <button
                type="button"
                aria-label={t("addLibrary")}
                title={t("addLibrary")}
                aria-expanded={add}
                onClick={() => setAdd((v) => !v)}
                className={cn(
                  "icon-hit grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white",
                  add && "bg-white/10 text-white",
                )}
              >
                <Plus size={18} />
              </button>
              {add ? (
                <div className="modal-enter absolute top-11 left-0 w-64 rounded-2xl bg-panel/95 p-2 shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md">
                  <p className="px-3 py-2 text-[11px] font-semibold tracking-wide text-dim uppercase">{t("addLibrary")}</p>
                  {addable.map((lib) => (
                    <button
                      key={lib.id}
                      type="button"
                      className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-white/5"
                      onClick={() => {
                        onAddLibrary(lib);
                        setAdd(false);
                      }}
                    >
                      {lib.collectionType === "tvshows" ? (
                        <Tv size={15} className="shrink-0 text-muted" />
                      ) : (
                        <Film size={15} className="shrink-0 text-muted" />
                      )}
                      <span className="truncate">{lib.name}</span>
                    </button>
                  ))}
                  {!addable.length ? (
                    <p className="px-3 py-2 text-[13px] text-muted">{t("noMoreLibraries")}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {indicator ? (
            <span
              key={jellyKey}
              aria-hidden
              className="jelly pointer-events-none absolute bottom-0 h-[3px] rounded-full bg-accent transition-[left,width] duration-[var(--duration-slow)] ease-std"
              style={{ left: indicator.left, width: indicator.width }}
            />
          ) : null}
        </nav>
      </div>
      <div className="flex h-full items-center gap-1 pr-1">
        <button
          type="button"
          aria-label={t("search")}
          title={t("search")}
          aria-pressed={view === "search"}
          className={cn(
            "icon-hit grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/10",
            view === "search" && "bg-white/10",
          )}
          onClick={() => onView("search")}
        >
          <Search size={18} />
        </button>
        <button
          type="button"
          aria-label={t("settings")}
          title={t("settings")}
          aria-pressed={view === "settings"}
          className={cn(
            "icon-hit grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/10",
            view === "settings" && "bg-white/10",
          )}
          onClick={() => onView("settings")}
        >
          <SettingsIcon size={18} />
        </button>
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
