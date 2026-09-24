import React, { useState } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { CircleCheck, Download, Pause, Play, RotateCcw, Trash, X } from "lucide-react-native";
import type { AddonStream, Movie } from "../../lib/types";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/locale-context";
import { useToast } from "../../lib/toast-context";
import { useDownloadEntry } from "../../lib/use-downloads";
import { haptic } from "../../lib/haptics";
import { openPlayer } from "../../navigation/navigationRef";
import { canDownload, isDownloadableStream, progressOf, type DownloadEntry } from "../../services/downloads/downloads.pure";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { ActionSheet, type SheetAction } from "../ui/ActionSheet";
import { IconButton } from "../ui/IconButton";
import { Pill } from "../ui/Pill";
import { PressableScale } from "../ui/PressableScale";
import { StreamPickerSheet } from "./StreamPickerSheet";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Short state line of a download ("Downloading 42%", "Paused"...). */
export function useDownloadLabel(): (entry: DownloadEntry | null) => string {
  const { t } = useI18n();
  return (entry) => {
    if (!entry) return t("download");
    const fraction = progressOf(entry);
    switch (entry.status) {
      case "queued":
        return t("downloadQueued");
      case "downloading":
        return fraction == null ? t("downloading") : t("downloadingPercent", { percent: Math.floor(fraction * 100) });
      case "paused":
        return fraction == null ? t("downloadPaused") : `${t("downloadPaused")} · ${Math.floor(fraction * 100)}%`;
      case "error":
        return t("downloadFailed");
      case "done":
        return t("downloaded");
    }
  };
}

/** Actions for an existing download (pause / resume / play / delete). */
export function useDownloadActions(entry: DownloadEntry | null): SheetAction[] {
  const { t } = useI18n();
  if (!entry) return [];
  const actions: SheetAction[] = [];
  if (entry.status === "done") {
    actions.push({ key: "play", label: t("playOffline"), icon: Play, onPress: () => openPlayer(entry.movie) });
  } else if (entry.status === "downloading" || entry.status === "queued") {
    actions.push({ key: "pause", label: t("downloadPause"), icon: Pause, onPress: () => api.downloadPause(entry.id) });
  } else {
    actions.push({
      key: "resume",
      label: entry.status === "error" ? t("downloadRetry") : t("downloadResume"),
      icon: RotateCcw,
      onPress: () => api.downloadResume(entry.id),
    });
  }
  actions.push({
    key: "remove",
    label: entry.status === "done" ? t("downloadDelete") : t("downloadCancel"),
    icon: entry.status === "done" ? Trash : X,
    destructive: true,
    onPress: () => {
      haptic("warning");
      api.downloadRemove(entry.id);
    },
  });
  return actions;
}

/**
 * Download control of a movie or episode. Jellyfin items save the original file; online
 * titles ask for a source first (direct links only). Once queued, pressing it opens the
 * pause / resume / delete menu. `variant="icon"` is the compact one of the episode rows.
 */
export function DownloadButton({
  movie,
  variant = "pill",
  style,
}: {
  movie: Movie;
  variant?: "pill" | "icon";
  style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { toast } = useToast();
  const entry = useDownloadEntry(movie.id);
  const label = useDownloadLabel()(entry);
  const actions = useDownloadActions(entry);
  const [menu, setMenu] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canDownload(movie)) return null;

  const start = () => {
    haptic("light");
    if (movie.external) {
      setPicking(true);
      return;
    }
    setBusy(true);
    api
      .downloadJellyfin(movie)
      .then(() => toast(tr("downloadAdded", { title: movie.name })))
      .catch((err) => toast(errorText(err)))
      .finally(() => setBusy(false));
  };

  const pickStream = (_item: Movie, stream: AddonStream) => {
    if (!isDownloadableStream(stream)) {
      toast(tr("downloadNotDirect"));
      return;
    }
    setPicking(false);
    try {
      api.downloadAddon(movie, stream);
      toast(tr("downloadAdded", { title: movie.name }));
    } catch (err) {
      toast(errorText(err));
    }
  };

  const press = () => {
    if (!entry || entry.status === "error") {
      if (entry) setMenu(true);
      else start();
      return;
    }
    setMenu(true);
  };

  const fraction = entry ? progressOf(entry) : null;
  const done = entry?.status === "done";
  const active = entry?.status === "downloading" || entry?.status === "queued";

  const sheets = (
    <>
      <ActionSheet
        visible={menu}
        onClose={() => setMenu(false)}
        title={movie.name}
        subtitle={label}
        thumb={movie.thumbUrl ?? movie.posterUrl}
        thumbAspect={movie.thumbUrl ? 16 / 9 : 2 / 3}
        actions={actions}
      />
      {movie.external ? (
        <StreamPickerSheet movie={picking ? movie : null} visible={picking} onClose={() => setPicking(false)} onPick={pickStream} />
      ) : null}
    </>
  );

  if (variant === "icon") {
    return (
      <View style={style}>
        {active ? (
          <PressableScale accessibilityRole="button" accessibilityLabel={label} onPress={press} hitSlop={6} style={s.ring}>
            <Text style={s.ringText}>{fraction == null ? "…" : `${Math.floor(fraction * 100)}`}</Text>
          </PressableScale>
        ) : (
          <IconButton
            icon={done ? CircleCheck : entry?.status === "paused" ? Pause : Download}
            label={label}
            onPress={press}
            disabled={busy}
            size={19}
            color={done ? t.colors.accent : entry?.status === "error" ? t.colors.accent : t.colors.muted}
          />
        )}
        {sheets}
      </View>
    );
  }

  return (
    <>
      <Pill
        variant="tonal"
        pill
        size="lg"
        icon={done ? CircleCheck : active ? Pause : Download}
        label={label}
        loading={busy}
        onPress={press}
        style={style}
      />
      {sheets}
    </>
  );
}

const useStyles = makeStyles((t) => ({
  ring: {
    width: 32,
    height: 32,
    margin: 6,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: t.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  ringText: { ...text(10, "bold", { tabular: true }), color: t.colors.text },
}));
