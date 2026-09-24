import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { TorrentStatus } from "../lib/types";
import { api } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useI18n } from "../lib/locale-context";

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const kbps = (bits: unknown) => {
  const value = num(bits);
  return value == null ? "—" : value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)} Mb/s` : `${Math.round(value / 1000)} kb/s`;
};

/** "I" overlay in the player: source, codecs, resolution, bitrates, dropped frames, cache and torrent. */
export function StatsPanel({
  torrent,
  delays,
  source,
  speed,
  night,
  onClose,
}: {
  torrent: TorrentStatus | null;
  delays: { sub: number; audio: number };
  /** Where the stream comes from (direct play, online, torrent, live). */
  source: string;
  speed: number;
  night: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [props, setProps] = useState<Record<string, unknown>>({});

  useEffect(() => {
    let alive = true;
    const load = () => {
      api
        .playerProps()
        .then((next) => {
          if (alive) setProps(next);
        })
        .catch(() => undefined);
    };
    load();
    const handle = window.setInterval(load, 1000);
    return () => {
      alive = false;
      window.clearInterval(handle);
    };
  }, []);

  const width = num(props.width);
  const height = num(props.height);
  const fps = num(props["estimated-vf-fps"]);
  const cache = num(props["demuxer-cache-duration"]);
  const drops = (num(props["frame-drop-count"]) ?? 0) + (num(props["decoder-frame-drop-count"]) ?? 0);
  const channels = num(props["audio-params/channel-count"]);
  const outChannels = num(props["audio-out-params/channel-count"]);
  const rate = num(props["audio-params/samplerate"]);
  const container = typeof props["file-format"] === "string" ? props["file-format"].split(",")[0] : null;
  const rows: Array<[string, string]> = [
    [t("statsSource"), [source, container].filter(Boolean).join(" · ")],
    [
      t("statsVideo"),
      [
        props["video-codec"],
        width && height ? `${width}×${height}` : null,
        fps ? `${fps.toFixed(2)} fps` : null,
        props["video-params/pixelformat"],
      ]
        .filter(Boolean)
        .join(" · ") || "—",
    ],
    [
      t("statsAudio"),
      [
        props["audio-codec-name"],
        channels ? t("statsChannels", { n: channels }) : null,
        rate ? `${(rate / 1000).toFixed(1)} kHz` : null,
        outChannels && channels && outChannels !== channels ? `→ ${t("statsChannels", { n: outChannels })}` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "—",
    ],
    [t("statsBitrate"), `${kbps(props["video-bitrate"])} / ${kbps(props["audio-bitrate"])}`],
    [t("statsDecoder"), props["hwdec-current"] && props["hwdec-current"] !== "no" ? `${t("statsHardware")} (${props["hwdec-current"]})` : t("statsSoftware")],
    [t("statsDropped"), String(drops)],
    [t("statsCache"), cache == null ? "—" : `${cache.toFixed(1)} s`],
    [t("statsDelays"), `${t("subtitles")} ${delays.sub.toFixed(1)} s · ${t("audio")} ${delays.audio.toFixed(1)} s`],
    [t("playbackSpeed"), `${Number(speed.toFixed(2))}x`],
    [t("nightMode"), night ? t("statsOn") : t("statsOff")],
  ];
  if (torrent?.known) {
    rows.push([
      "Torrent",
      `${t("torrentPeers", { n: torrent.peers })} · ↓ ${torrent.downMbps.toFixed(1)} MB/s · ↑ ${torrent.upMbps.toFixed(1)} MB/s · ${formatBytes(torrent.progressBytes)} / ${formatBytes(torrent.totalBytes)}`,
    ]);
  }

  return (
    <div
      className="absolute top-20 left-6 z-30 w-[min(440px,calc(100vw-48px))] rounded-2xl bg-black/75 p-4 text-[12px] text-white/90 shadow-[0_12px_32px_rgb(0_0_0_/_0.5)] backdrop-blur-md"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold tracking-[0.08em] text-dim uppercase">{t("statsTitle")}</p>
        <button type="button" onClick={onClose} aria-label={t("close")} className="grid h-7 w-7 place-items-center rounded-full hover:bg-white/10">
          <X size={14} />
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 font-mono">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-dim">{label}</dt>
            <dd className="[overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
