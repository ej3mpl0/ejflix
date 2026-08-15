import { Check } from "lucide-react";
import type { PlayerTrack } from "../lib/types";
import { useI18n } from "../lib/locale-context";

export function TrackMenu({
  tracks,
  onSelect,
}: {
  tracks: PlayerTrack[];
  onSelect: (kind: string, id: number) => void;
}) {
  const { t } = useI18n();
  const audio = tracks.filter((track) => track.kind === "audio");
  const subs = tracks.filter((track) => track.kind === "sub");
  const subOff = !subs.some((t) => t.selected);

  return (
    <div className="absolute right-0 bottom-12 w-[360px] rounded-xl bg-panel/95 p-4 text-sm shadow-[0_16px_40px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)] backdrop-blur-md">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">{t("audio")}</p>
          <ul className="space-y-1">
            {audio.map((track) => (
              <li key={track.id}>
                <button
                  type="button"
                  className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-white/5"
                  onClick={() => onSelect("audio", track.id)}
                >
                  <span className="w-4 text-accent">{track.selected ? <Check size={14} /> : null}</span>
                  <span>{track.title}</span>
                </button>
              </li>
            ))}
            {!audio.length ? <li className="px-2 text-dim">{t("noTracks")}</li> : null}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-dim">
            {t("subtitles")}
          </p>
          <ul className="space-y-1">
            <li>
              <button
                type="button"
                className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-white/5"
                onClick={() => onSelect("sub", 0)}
              >
                <span className="w-4 text-accent">{subOff ? <Check size={14} /> : null}</span>
                <span>{t("subtitlesOff")}</span>
              </button>
            </li>
            {subs.map((track) => (
              <li key={track.id}>
                <button
                  type="button"
                  className="flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-white/5"
                  onClick={() => onSelect("sub", track.id)}
                >
                  <span className="w-4 text-accent">{track.selected ? <Check size={14} /> : null}</span>
                  <span>{track.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
