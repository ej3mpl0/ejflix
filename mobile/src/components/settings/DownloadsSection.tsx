import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { CloudDownload, Ellipsis, HardDrive, Pause, Play, RotateCcw } from "lucide-react-native";
import type { Movie } from "../../lib/types";
import { api } from "../../lib/api";
import { formatSize } from "../../lib/addons";
import { episodeCode } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { useDownloads } from "../../lib/use-downloads";
import { openPlayer } from "../../navigation/navigationRef";
import { progressOf, sortForDisplay, storageUsed, type DownloadEntry } from "../../services/downloads/downloads.pure";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { ActionSheet } from "../ui/ActionSheet";
import { EmptyCard } from "../ui/EmptyCard";
import { IconButton } from "../ui/IconButton";
import { ProgressBar } from "../ui/ProgressBar";
import { useDownloadActions, useDownloadLabel } from "../media/DownloadButton";
import { SettingsBlock, SettingsSection } from "./SettingsSection";

function titleOf(movie: Movie, pattern: string): { title: string; subtitle: string | null } {
  if (movie.kind !== "Episode") return { title: movie.name, subtitle: movie.year ? String(movie.year) : null };
  const code = episodeCode(movie, pattern);
  return { title: movie.seriesName ?? movie.name, subtitle: [code, movie.name].filter(Boolean).join(" · ") };
}

function DownloadRow({ entry, onMenu }: { entry: DownloadEntry; onMenu: (entry: DownloadEntry) => void }) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const label = useDownloadLabel()(entry);
  const { title, subtitle } = titleOf(entry.movie, tr("episodeCode"));
  const fraction = progressOf(entry);
  const done = entry.status === "done";
  const active = entry.status === "downloading" || entry.status === "queued";
  const size =
    entry.totalBytes > 0 && !done
      ? `${formatSize(entry.bytesWritten) || "0 MB"} / ${formatSize(entry.totalBytes)}`
      : formatSize(entry.bytesWritten);
  const image = entry.movie.thumbUrl ?? entry.movie.backdropUrl ?? entry.movie.posterUrl;
  const watched = done && entry.durationSeconds > 0 ? Math.min(1, entry.positionSeconds / entry.durationSeconds) : 0;

  const primary = () => {
    if (done) openPlayer(entry.movie);
    else if (active) api.downloadPause(entry.id);
    else api.downloadResume(entry.id);
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${label}`}
      onPress={() => (done ? openPlayer(entry.movie) : onMenu(entry))}
      onLongPress={() => onMenu(entry)}
      style={({ pressed }) => [s.row, pressed ? s.rowPressed : null]}
    >
      <View style={s.thumb}>
        {image ? <Image source={{ uri: image }} contentFit="cover" cachePolicy="memory-disk" style={StyleSheet.absoluteFill} /> : null}
        {watched > 0.01 ? <ProgressBar value={watched} height={3} animated={false} style={s.thumbProgress} /> : null}
      </View>
      <View style={s.body}>
        <Text numberOfLines={1} style={s.title}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={s.subtitle}>
            {subtitle}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={[s.status, entry.status === "error" ? { color: t.colors.accent } : null]}>
          {[label, size].filter(Boolean).join(" · ")}
        </Text>
        {!done ? <ProgressBar value={fraction ?? 0} height={3} style={s.progress} /> : null}
        {entry.status === "error" && entry.error ? (
          <Text numberOfLines={2} style={s.error}>
            {entry.error}
          </Text>
        ) : null}
      </View>
      <IconButton
        icon={done ? Play : active ? Pause : RotateCcw}
        label={done ? tr("playOffline") : active ? tr("downloadPause") : entry.status === "error" ? tr("downloadRetry") : tr("downloadResume")}
        onPress={primary}
        size={19}
        color={t.colors.text}
      />
      <IconButton icon={Ellipsis} label={tr("moreOptions")} onPress={() => onMenu(entry)} size={19} color={t.colors.muted} />
    </Pressable>
  );
}

/**
 * Settings › Downloads (the downloads screen on phones): space used, and every movie
 * or episode saved on the device with its progress and pause / resume / delete.
 */
export function DownloadsSection() {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const list = useDownloads();
  const sorted = useMemo(() => sortForDisplay(list), [list]);
  const [menu, setMenu] = useState<DownloadEntry | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const current = menu ? (list.find((entry) => entry.id === menu.id) ?? menu) : null;
  const actions = useDownloadActions(current);
  const label = useDownloadLabel()(current);
  const [free, setFree] = useState(0);
  const used = storageUsed(list);

  useEffect(() => {
    api.downloadsKick();
  }, []);

  // Free space only moves meaningfully when a transfer ends or a file goes.
  const settled = list.filter((entry) => entry.status !== "downloading").length;
  useEffect(() => {
    setFree(api.downloadsStorage().free);
  }, [settled, list.length]);

  const openMenu = (entry: DownloadEntry) => {
    setMenu(entry);
    setMenuOpen(true);
  };

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title={tr("downloadsStorageTitle")}>
        <SettingsBlock>
          <View style={s.storage}>
            <View style={s.storageIcon}>
              <HardDrive size={18} color={t.colors.accent} strokeWidth={2} />
            </View>
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={s.storageText}>
                {tr("downloadsStorage", { used: formatSize(used) || "0 MB", free: formatSize(free) || "—" })}
              </Text>
              <ProgressBar value={used + free > 0 ? used / (used + free) : 0} height={4} />
            </View>
          </View>
        </SettingsBlock>
      </SettingsSection>
      {sorted.length ? (
        <SettingsSection title={tr("downloadsTitle")} description={tr("downloadsHint")}>
          {sorted.map((entry) => (
            <DownloadRow key={entry.id} entry={entry} onMenu={openMenu} />
          ))}
        </SettingsSection>
      ) : (
        <EmptyCard icon={CloudDownload} title={tr("downloadsEmpty")} hint={tr("downloadsEmptyHint")} />
      )}
      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={current ? titleOf(current.movie, tr("episodeCode")).title : undefined}
        subtitle={label}
        actions={actions}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  storage: { flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 12 },
  storageIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: t.colors.accentSoft, alignItems: "center", justifyContent: "center" },
  storageText: { ...text(14, "medium", { tabular: true }), color: t.colors.text },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderRadius: 12 },
  rowPressed: { backgroundColor: t.white(0.05) },
  thumb: { width: 96, height: 54, borderRadius: t.radii.poster, backgroundColor: t.colors.panel, overflow: "hidden" },
  thumbProgress: { position: "absolute", left: 0, right: 0, bottom: 0, borderRadius: 0 },
  body: { flex: 1, minWidth: 0 },
  title: { ...text(14, "medium"), color: t.colors.text },
  subtitle: { ...text(12), color: t.colors.muted, marginTop: 1 },
  status: { ...text(12, "regular", { tabular: true }), color: t.colors.dim, marginTop: 3 },
  progress: { marginTop: 6 },
  error: { ...text(11, "regular", { lineHeight: 15 }), color: t.colors.dim, marginTop: 4 },
}));
