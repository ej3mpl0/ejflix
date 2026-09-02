import { useEffect, useRef, useState } from "react";
import { Film, LogOut, Plus, Search, Tv, Users, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Logo } from "./Logo";
import { WindowControls } from "./WindowControls";
import { Avatar } from "./Avatar";
import { LanguageSelect } from "./LanguageSelect";
import type { Library } from "../lib/types";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";

/** `lib:<id>` selects a pinned Jellyfin library. */
export type NavView = "home" | "movies" | "search" | `lib:${string}`;

export function libraryView(id: string): NavView {
  return `lib:${id}`;
}

export function Nav({
  userName,
  avatarUrl,
  view,
  onView,
  libraries,
  available,
  onAddLibrary,
  onRemoveLibrary,
  query,
  onQuery,
  scrolled,
  onSwitchProfile,
  onLogout,
}: {
  userName: string;
  avatarUrl?: string | null;
  view: NavView;
  onView: (view: NavView) => void;
  /** Libraries pinned as tabs. */
  libraries: Library[];
  /** Every library on the server the app can browse. */
  available: Library[];
  onAddLibrary: (library: Library) => void;
  onRemoveLibrary: (id: string) => void;
  query: string;
  onQuery: (value: string) => void;
  scrolled: boolean;
  onSwitchProfile: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(view === "search" || query.length > 0);
  const [menu, setMenu] = useState(false);
  const [add, setAdd] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
      if (!addRef.current?.contains(e.target as Node)) setAdd(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pinned = new Set(libraries.map((lib) => lib.id));
  // The built-in "Movies" tab already shows every movie. With a single movies library on
  // the server that tab *is* that library, so offering it again would only duplicate it.
  // With several movie libraries each one can still be pinned on its own.
  const movieLibraries = available.filter((lib) => lib.collectionType === "movies");
  const addable = available.filter(
    (lib) =>
      !pinned.has(lib.id) && !(lib.collectionType === "movies" && movieLibraries.length === 1),
  );
  const tab = (active: boolean) =>
    cn("inline-flex min-h-10 items-center hover:text-white", active && "font-semibold text-white");

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 flex h-[60px] items-center transition-colors duration-200",
        scrolled ? "border-b border-white/5 bg-base/95 backdrop-blur-md" : "bg-gradient-to-b from-black/70 to-transparent",
      )}
    >
      <div
        className="flex h-full min-w-0 flex-1 items-center gap-8 px-6"
        data-tauri-drag-region
        onDoubleClick={() => getCurrentWindow().toggleMaximize().catch(() => undefined)}
      >
        <div data-tauri-drag-region>
          <Logo />
        </div>
        <nav className="flex min-w-0 items-center gap-5 text-[14px] text-[#E5E5E5]">
          <button type="button" className={tab(view === "home")} onClick={() => onView("home")}>
            {t("home")}
          </button>
          <button type="button" className={tab(view === "movies")} onClick={() => onView("movies")}>
            {t("movies")}
          </button>
          {libraries.map((lib) => {
            const id = libraryView(lib.id);
            return (
              <div key={lib.id} className="group/tab relative flex min-w-0 items-center">
                <button type="button" className={cn(tab(view === id), "max-w-[180px] truncate")} onClick={() => onView(id)}>
                  {lib.name}
                </button>
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
          })}
          <div className="relative" ref={addRef}>
            <button
              type="button"
              aria-label={t("addLibrary")}
              title={t("addLibrary")}
              aria-expanded={add}
              onClick={() => setAdd((v) => !v)}
              className={cn(
                "icon-hit grid h-8 w-8 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white",
                add && "bg-white/10 text-white",
              )}
            >
              <Plus size={18} />
            </button>
            {add ? (
              <div className="absolute top-10 left-0 w-64 rounded-xl bg-panel/95 p-2 shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md">
                <p className="px-3 py-2 text-[11px] font-semibold tracking-wide text-dim uppercase">{t("addLibrary")}</p>
                {addable.map((lib) => (
                  <button
                    key={lib.id}
                    type="button"
                    className="flex min-h-10 w-full items-center gap-2.5 rounded px-3 text-left text-sm hover:bg-white/5"
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
        </nav>
      </div>
      <div className="flex h-full items-center gap-3 pr-1">
        <div className="flex items-center">
          <button
            type="button"
            aria-label={t("search")}
            className="icon-hit grid h-10 w-10 place-items-center text-white"
            onClick={() => {
              setOpen(true);
              inputRef.current?.focus();
            }}
          >
            <Search size={18} />
          </button>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onBlur={() => {
              if (!query) setOpen(false);
            }}
            placeholder={t("searchPlaceholder")}
            className={cn(
              "h-10 rounded-md border border-white/15 bg-black/60 px-3 text-sm text-white outline-none transition-[width,opacity,padding,border-color] duration-200 placeholder:text-dim",
              open ? "w-[240px] opacity-100" : "w-0 border-0 px-0 opacity-0",
            )}
          />
        </div>
        <LanguageSelect />
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full"
            onClick={() => setMenu((v) => !v)}
            aria-label={t("account")}
          >
            <Avatar src={avatarUrl} name={userName} size={32} />
          </button>
          {menu ? (
            <div className="absolute top-11 right-0 w-52 rounded-xl bg-panel/95 p-2 shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md">
              <p className="truncate px-3 py-2 text-[13px] text-muted">{userName}</p>
              <button
                type="button"
                className="flex min-h-10 w-full items-center gap-2 rounded px-3 text-left text-sm hover:bg-white/5"
                onClick={onSwitchProfile}
              >
                <Users size={14} />
                {t("switchProfile")}
              </button>
              <button
                type="button"
                className="flex min-h-10 w-full items-center gap-2 rounded px-3 text-left text-sm hover:bg-white/5"
                onClick={onLogout}
              >
                <LogOut size={14} />
                {t("signOut")}
              </button>
            </div>
          ) : null}
        </div>
        <WindowControls />
      </div>
    </header>
  );
}
