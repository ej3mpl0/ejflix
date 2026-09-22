import { useRef, useState } from "react";
import { FileUp, Minus, Plus } from "lucide-react";
import type { SubBackground } from "../lib/types";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";

const COLORS = ["#FFFFFF", "#FFE45C", "#7DF9FF", "#9CFF8A"];
const BACKGROUNDS: SubBackground[] = ["outline", "shadow", "box"];

/** Subtitle files are often Windows-1252 (Spanish releases above all): UTF-8 first, else that. */
function decodeSubtitle(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

/** −/+ stepper for a delay in seconds (0.1 s steps), with a reset on the value. */
export function DelayStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useI18n();
  const step = (dir: number) => onChange(Math.round((value + dir * 0.1) * 10) / 10);
  const button = "grid h-8 w-8 place-items-center rounded-full bg-white/8 text-white hover:bg-white/15";
  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5">
      <span className="text-[13px] text-white/85">{label}</span>
      <span className="flex items-center gap-1.5">
        <button type="button" className={button} aria-label={`${label} −0.1 s`} onClick={() => step(-1)}>
          <Minus size={14} />
        </button>
        <button
          type="button"
          title={t("resetDelay")}
          onClick={() => onChange(0)}
          className="min-w-[58px] rounded-md px-1 text-center text-[13px] text-white tabular hover:bg-white/8"
        >
          {value > 0 ? "+" : ""}
          {value.toFixed(1)} s
        </button>
        <button type="button" className={button} aria-label={`${label} +0.1 s`} onClick={() => step(1)}>
          <Plus size={14} />
        </button>
      </span>
    </div>
  );
}

/**
 * Bottom of the subtitle menu: delay, loading a file from disk, and the look (size,
 * colour, background). The look is saved with the profile and applied to the video now.
 */
export function SubtitleTools({ delay, onDelay }: { delay: number; onDelay: (value: number) => void }) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const file = useRef<HTMLInputElement>(null);
  const [loadError, setLoadError] = useState("");
  const { subScale, subColor, subBackground } = settings.playback;

  const setScale = (next: number) => {
    const value = Math.min(2.5, Math.max(0.5, Math.round(next * 10) / 10));
    void update({ playback: { subScale: value } });
    void api.playerSetProp("sub-scale", value);
  };

  return (
    <div className="mt-2 border-t border-white/10 pt-2">
      <DelayStepper label={t("subDelay")} value={delay} onChange={onDelay} />
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="text-[13px] text-white/85">{t("subSize")}</span>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={t("subSmaller")}
            onClick={() => setScale(subScale - 0.1)}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/8 text-[11px] font-bold text-white hover:bg-white/15"
          >
            A
          </button>
          <span className="min-w-[44px] text-center text-[13px] text-white tabular">{Math.round(subScale * 100)}%</span>
          <button
            type="button"
            aria-label={t("subBigger")}
            onClick={() => setScale(subScale + 0.1)}
            className="grid h-8 w-8 place-items-center rounded-full bg-white/8 text-[16px] font-bold text-white hover:bg-white/15"
          >
            A
          </button>
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="text-[13px] text-white/85">{t("subColor")}</span>
        <span className="flex gap-1.5" role="radiogroup" aria-label={t("subColor")}>
          {COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={subColor === color}
              aria-label={color}
              onClick={() => {
                void update({ playback: { subColor: color } });
                void api.playerSetProp("sub-color", color);
              }}
              className={cn(
                "h-6 w-6 rounded-full ring-offset-2 ring-offset-panel",
                subColor === color ? "ring-2 ring-white" : "ring-1 ring-white/20",
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <span className="text-[13px] text-white/85">{t("subBackground")}</span>
        <span className="flex rounded-full bg-white/6 p-0.5" role="radiogroup" aria-label={t("subBackground")}>
          {BACKGROUNDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={subBackground === kind}
              onClick={() => {
                void update({ playback: { subBackground: kind } });
                void api.playerSetProp("sub-background", kind);
              }}
              className={cn(
                "h-7 rounded-full px-2.5 text-[12px]",
                subBackground === kind ? "bg-white text-black" : "text-white/80 hover:text-white",
              )}
            >
              {t(kind === "outline" ? "subBgOutline" : kind === "shadow" ? "subBgShadow" : "subBgBox")}
            </button>
          ))}
        </span>
      </div>
      <button
        type="button"
        onClick={() => file.current?.click()}
        className="mt-1 flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-white/85 hover:bg-white/8"
      >
        <FileUp size={15} />
        {t("subLoadFile")}
      </button>
      {loadError ? <p className="px-2 pb-1 text-[12px] text-danger">{loadError}</p> : null}
      <input
        ref={file}
        type="file"
        accept=".srt,.vtt,.ass,.ssa,.sub"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (!picked) return;
          setLoadError("");
          picked
            .arrayBuffer()
            .then(decodeSubtitle)
            .then((content) => api.playerSubAddText(picked.name, content))
            .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
        }}
      />
    </div>
  );
}
