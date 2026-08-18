import { useEffect, useRef, useState } from "react";
import { LogOut, Search, Users } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Logo } from "./Logo";
import { WindowControls } from "./WindowControls";
import { Avatar } from "./Avatar";
import { LanguageSelect } from "./LanguageSelect";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";

export function Nav({
  userName,
  avatarUrl,
  view,
  onView,
  query,
  onQuery,
  scrolled,
  onSwitchProfile,
  onLogout,
}: {
  userName: string;
  avatarUrl?: string | null;
  view: "home" | "movies" | "series" | "search" | "mylist";
  onView: (view: "home" | "movies" | "series" | "mylist") => void;
  query: string;
  onQuery: (value: string) => void;
  scrolled: boolean;
  onSwitchProfile: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(view === "search" || query.length > 0);
  const [menu, setMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

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
        <nav className="flex items-center gap-5 text-[14px] text-[#E5E5E5]">
          <button
            type="button"
            className={cn("inline-flex min-h-10 items-center hover:text-white", view === "home" && "font-semibold text-white")}
            onClick={() => onView("home")}
          >
            {t("home")}
          </button>
          <button
            type="button"
            className={cn("inline-flex min-h-10 items-center hover:text-white", view === "movies" && "font-semibold text-white")}
            onClick={() => onView("movies")}
          >
            {t("movies")}
          </button>
          <button
            type="button"
            className={cn("inline-flex min-h-10 items-center hover:text-white", view === "series" && "font-semibold text-white")}
            onClick={() => onView("series")}
          >
            {t("series")}
          </button>
          <button
            type="button"
            className={cn("inline-flex min-h-10 items-center hover:text-white", view === "mylist" && "font-semibold text-white")}
            onClick={() => onView("mylist")}
          >
            {t("myList")}
          </button>
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
