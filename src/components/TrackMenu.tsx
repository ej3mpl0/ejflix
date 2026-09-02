import { useMemo } from "react";
import { Check } from "lucide-react";
import type { PlayerTrack } from "../lib/types";
import { useI18n } from "../lib/locale-context";

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

export function TrackMenu({
  tracks,
  onSelect,
}: {
  tracks: PlayerTrack[];
  onSelect: (kind: string, id: number) => void;
}) {
  const { t, locale } = useI18n();
  const audio = tracks.filter((track) => track.kind === "audio");
  const subs = tracks.filter((track) => track.kind === "sub");
  const subOff = !subs.some((track) => track.selected);

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

  const Item = ({
    selected,
    primary,
    secondary,
    onClick,
  }: {
    selected: boolean;
    primary: string;
    secondary?: string | null;
    onClick: () => void;
  }) => (
    <li>
      <button
        type="button"
        className={`flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white/8 ${
          selected ? "text-white" : "text-white/85"
        }`}
        onClick={onClick}
      >
        <span className="grid w-4 shrink-0 place-items-center text-white">
          {selected ? <Check size={14} strokeWidth={2.5} /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[14px] ${selected ? "font-semibold" : ""}`}>{primary}</span>
          {secondary ? <span className="block truncate text-[11px] text-dim">{secondary}</span> : null}
        </span>
      </button>
    </li>
  );

  return (
    <div className="absolute right-0 bottom-12 w-[400px] rounded-xl bg-panel/95 p-4 text-sm shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">{t("audio")}</p>
          <ul className="max-h-[300px] space-y-0.5 overflow-y-auto">
            {audio.map((track) => {
              const { primary, secondary } = label(track);
              return (
                <Item
                  key={track.id}
                  selected={track.selected}
                  primary={primary}
                  secondary={secondary}
                  onClick={() => onSelect("audio", track.id)}
                />
              );
            })}
            {!audio.length ? <li className="px-2 text-dim">{t("noTracks")}</li> : null}
          </ul>
        </div>
        <div>
          <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
            {t("subtitles")}
          </p>
          <ul className="max-h-[300px] space-y-0.5 overflow-y-auto">
            <Item selected={subOff} primary={t("subtitlesOff")} onClick={() => onSelect("sub", 0)} />
            {subs.map((track) => {
              const { primary, secondary } = label(track);
              return (
                <Item
                  key={track.id}
                  selected={track.selected}
                  primary={primary}
                  secondary={secondary}
                  onClick={() => onSelect("sub", track.id)}
                />
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
