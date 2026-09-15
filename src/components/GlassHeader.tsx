import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LogOut, Search, Settings as SettingsIcon, Users, X } from "lucide-react";
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
  const [jellyKey, setJellyKey] = useState(0);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
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
          <Tab id="discover" label={t("discover")} />
          <Tab id="mylist" label={t("myList")} />
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
          {hasTv ? <Tab id="tv" label={t("tvTab")} /> : null}
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
        <DownloadsButton />
        <form
          role="search"
          onSubmit={(e) => e.preventDefault()}
          className={cn(
            "flex h-9 items-center gap-2 rounded-pill border bg-white/6 pl-3 transition-[border-color,background-color,width] duration-200 ease-std",
            "w-[188px] focus-within:w-[260px] focus-within:bg-white/10",
            view === "search" && search ? "border-accent/60" : "border-white/10 focus-within:border-accent/60",
          )}
        >
          <Search size={15} className="shrink-0 text-dim" aria-hidden />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onFocus={onSearchFocus}
            // The long hint does not fit a header-sized field.
            placeholder={t("search")}
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
