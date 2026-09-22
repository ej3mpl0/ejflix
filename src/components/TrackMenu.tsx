import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { PlayerTrack } from "../lib/types";
import { useI18n } from "../lib/locale-context";

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** Short name of a track for the toolbar chip: the language when known, else its title. */
export function trackShortName(track: PlayerTrack, locale: string): string {
  if (track.lang) {
    try {
      const name = new Intl.DisplayNames([locale], { type: "language" }).of(track.lang);
      if (name && name.toLowerCase() !== track.lang.toLowerCase()) return capitalize(name);
    } catch {
      /* unknown code: fall back to the title */
    }
  }
  return track.title || track.lang || String(track.id);
}

/** Lives outside TrackMenu so the buttons keep their identity (and focus) across player ticks. */
function Item({
  selected,
  primary,
  secondary,
  onClick,
}: {
  selected: boolean;
  primary: string;
  secondary?: string | null;
  onClick: () => void;
}) {
  return (
    <li role="none">
      <button
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        className={`flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/8 ${
          selected ? "text-white" : "text-white/85"
        }`}
        onClick={onClick}
      >
        <span className="grid w-4 shrink-0 place-items-center text-accent">
          {selected ? <Check size={14} strokeWidth={2.5} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[14px] ${selected ? "font-semibold" : ""}`}>{primary}</span>
          {secondary ? <span className="block truncate text-[11px] text-dim">{secondary}</span> : null}
        </span>
      </button>
    </li>
  );
}

/** Audio or subtitle picker, anchored above the toolbar chip that opened it. */
export function TrackMenu({
  kind,
  tracks,
  onSelect,
  footer,
}: {
  kind: "audio" | "sub";
  /** Extra controls under the list (delay, subtitle look). */
  footer?: ReactNode;
  tracks: PlayerTrack[];
  onSelect: (kind: string, id: number) => void;
}) {
  const { t, locale } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  // Opening the menu hands it the focus (on the current track).
  useEffect(() => {
    const menu = root.current;
    (menu?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? menu?.querySelector<HTMLButtonElement>("button"))?.focus();
  }, []);
  const list = tracks.filter((track) => track.kind === kind);
  const subOff = kind === "sub" && !list.some((track) => track.selected);

  const languageNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "language" });
    } catch {
      return null;
    }
  }, [locale]);

  const label = (track: PlayerTrack): { primary: string; secondary: string | null } => {
    let language: string | null = null;
    if (track.lang && languageNames) {
      try {
        const name = languageNames.of(track.lang);
        if (name && name.toLowerCase() !== track.lang.toLowerCase()) language = capitalize(name);
      } catch {
        language = null;
      }
    }
    const codec = track.codec ? track.codec.toUpperCase() : null;
    if (!language) return { primary: track.title, secondary: codec };
    const detail = track.title && track.title !== track.lang ? track.title : codec;
    return { primary: language, secondary: detail && detail !== language ? detail : null };
  };

  return (
    <div
      ref={root}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        // Arrows walk the list here instead of changing the volume.
        e.preventDefault();
        e.stopPropagation();
        const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = items[Math.min(items.length - 1, Math.max(0, index + (e.key === "ArrowDown" ? 1 : -1)))];
        next?.focus();
      }}
      className="modal-enter absolute bottom-[calc(100%+14px)] left-1/2 max-h-[calc(100vh-190px)] w-[330px] -translate-x-1/2 overflow-y-auto rounded-2xl bg-panel/95 p-3 text-sm shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md">
      <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
        {kind === "audio" ? t("audio") : t("subtitles")}
      </p>
      <ul
        role="menu"
        aria-label={kind === "audio" ? t("audio") : t("subtitles")}
        className="max-h-[320px] space-y-0.5 overflow-y-auto"
      >
        {kind === "sub" ? (
          <Item selected={subOff} primary={t("subtitlesOff")} onClick={() => onSelect("sub", 0)} />
        ) : null}
        {list.map((track) => {
          const { primary, secondary } = label(track);
          return (
            <Item
              key={track.id}
              selected={track.selected}
              primary={primary}
              secondary={secondary}
              onClick={() => onSelect(kind, track.id)}
            />
          );
        })}
        {!list.length && kind === "audio" ? <li role="none" className="px-2 text-dim">
            {t("noTracks")}
          </li> : null}
      </ul>
      {footer}
    </div>
  );
}
