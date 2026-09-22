import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { engine } from "../../services/player/engine";
import type { PlayerState } from "../../lib/types";
import { useI18n } from "../../lib/locale-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Sheet } from "../ui/Sheet";

const rate = (bits: number | null | undefined) =>
  bits == null || !Number.isFinite(bits) || bits <= 0
    ? "—"
    : bits >= 1_000_000
      ? `${(bits / 1_000_000).toFixed(1)} Mb/s`
      : `${Math.round(bits / 1000)} kb/s`;

type Snapshot = { video: string; bitrate: string; audio: string };

function read(): Snapshot {
  try {
    const track = engine.player.videoTrack;
    const audio = engine.player.audioTrack;
    const size = track?.size && track.size.width ? `${track.size.width}×${track.size.height}` : null;
    const fps = track?.frameRate ? `${track.frameRate.toFixed(2)} fps` : null;
    return {
      video: [track?.mimeType?.replace(/^video\//, ""), size, fps].filter(Boolean).join(" · ") || "—",
      bitrate: rate(track?.averageBitrate ?? track?.peakBitrate ?? track?.bitrate ?? null),
      audio: [audio?.label || audio?.name, audio?.language].filter(Boolean).join(" · ") || "—",
    };
  } catch {
    return { video: "—", bitrate: "—", audio: "—" };
  }
}

/** Technical numbers of what is playing: format, resolution, bitrate, buffer, delays. */
export function StatsSheet({
  visible,
  state,
  subDelay,
  onClose,
}: {
  visible: boolean;
  state: PlayerState;
  subDelay: number;
  onClose: () => void;
}) {
  const s = useStyles();
  const { t } = useI18n();
  const [snap, setSnap] = useState<Snapshot>(read);

  useEffect(() => {
    if (!visible) return;
    setSnap(read());
    const handle = setInterval(() => setSnap(read()), 1000);
    return () => clearInterval(handle);
  }, [visible]);

  const buffer = Math.max(0, state.cacheTime - state.time);
  const rows: Array<[string, string]> = [
    [t("statsVideo"), snap.video],
    [t("statsBitrate"), snap.bitrate],
    [t("statsAudio"), snap.audio],
    [t("statsCache"), `${buffer.toFixed(1)} s`],
    [t("playbackSpeed"), `${Number(state.speed.toFixed(2))}x`],
    [t("subDelay"), `${subDelay.toFixed(1)} s`],
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title={t("statsTitle")} snap="auto">
      <View style={s.list}>
        {rows.map(([label, value]) => (
          <View key={label} style={s.row}>
            <Text style={s.label}>{label}</Text>
            <Text style={s.value}>{value}</Text>
          </View>
        ))}
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  list: { paddingHorizontal: 20, paddingBottom: 16, gap: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 16 },
  label: { ...text(13), color: t.colors.dim },
  value: { ...text(13, "medium", { tabular: true }), color: t.colors.text, flexShrink: 1, textAlign: "right" },
}));
