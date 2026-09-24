import { X } from "lucide-react";
import { useI18n } from "../lib/locale-context";
import type { MessageKey } from "../lib/i18n";
import { useSettings } from "../lib/settings-context";

const VOD: Array<[string[], MessageKey]> = [
  [["Space", "K"], "keyPlayPause"],
  [["←", "→"], "keySeek"],
  [["J", "L"], "keySeek"],
  [["↑", "↓"], "keyVolume"],
  [["M"], "keyMute"],
  [["F"], "keyFullscreen"],
  [["V"], "keySubtitles"],
  [["Z", "X"], "keySubDelay"],
  [["G", "H"], "keyAudioDelay"],
  [["D"], "keyNight"],
  [["P"], "keyMini"],
  [["I"], "keyStats"],
  [["<", ">"], "keySpeed"],
  [["0–9"], "keyJump"],
  [["S", "Enter"], "keySkip"],
  [["N"], "keyNext"],
  [["E"], "keyPanel"],
  [["?"], "keyHelp"],
  [["Esc"], "keyBack"],
];

const LIVE: Array<[string[], MessageKey]> = [
  [["Space", "K"], "keyPlayPause"],
  [["←", "→"], "keyZap"],
  [["↑", "↓"], "keyVolume"],
  [["M"], "keyMute"],
  [["F"], "keyFullscreen"],
  [["C"], "keyChannels"],
  [["D"], "keyNight"],
  [["P"], "keyMini"],
  [["?"], "keyHelp"],
  [["Esc"], "keyBack"],
];

/** "?" overlay in the player: every keyboard shortcut of the current mode. */
export function ShortcutsHelp({ live, onClose }: { live: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const seekStep = useSettings().settings.playback.seekStep;
  const rows = live ? LIVE : VOD;
  return (
    <div
      className="absolute inset-0 z-40 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="modal-enter max-h-[92vh] w-[min(460px,92vw)] overflow-y-auto rounded-card bg-surface/95 p-6 shadow-[0_24px_64px_rgb(0_0_0_/_0.5),0_0_0_1px_rgb(255_255_255_/_0.08)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-[17px] font-semibold">
            {t("keyboardShortcuts")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="icon-hit grid h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-5 gap-y-2.5 text-[13px]">
          {rows.map(([keys, label]) => (
            <div key={`${keys.join("")}${label}`} className="contents">
              <dt className="flex gap-1">
                {keys.map((key) => (
                  <kbd
                    key={key}
                    className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-white/15 bg-white/8 px-1.5 font-sans text-[11px] font-semibold text-text"
                  >
                    {key === "Space" ? t("keySpace") : key}
                  </kbd>
                ))}
              </dt>
              <dd className="text-muted">{t(label, { n: seekStep })}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
