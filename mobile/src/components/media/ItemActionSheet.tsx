import React from "react";
import { Check, CircleCheck, Clapperboard, Eye, Globe, Info, Play, Plus, X } from "lucide-react-native";
import { Linking } from "react-native";
import type { Movie } from "../../lib/types";
import { externalRefForJellyfin } from "../../lib/addons";
import { episodeCode, formatRuntime } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { useSettings } from "../../lib/settings-context";
import { useUserData } from "../../lib/userdata-context";
import { usePlay } from "../../lib/play";
import { useStreamPicker } from "../../lib/stream-picker-context";
import { openDetails } from "../../navigation/navigationRef";
import { ActionSheet, type SheetAction } from "../ui/ActionSheet";

export type ItemActionSheetProps = {
  /** Item the menu is about (null keeps the sheet closed). */
  movie: Movie | null;
  visible: boolean;
  onClose: () => void;
  /** Defaults to the shared play dispatch (`usePlay`). */
  onPlay?: (movie: Movie) => void;
  /** Defaults to `openDetails`. */
  onOpen?: (movie: Movie) => void;
  /** Defaults to the stream picker of the nearest `StreamPickerProvider`. */
  onOnline?: (movie: Movie) => void;
  /** Hide "View details" (episode rows of the page already showing them). */
  showDetails?: boolean;
  /** IMDb id of the parent series (online sources of Jellyfin episodes). */
  seriesImdb?: string | null;
  /** Shown from a "Continue watching" card: offer to take it out of that row. */
  continueRow?: boolean;
};

/**
 * Long-press menu of a poster / continue card / episode row: play or resume, details,
 * My list, watched (Jellyfin items) and the online sources when addons can serve them.
 */
export function ItemActionSheet({
  movie,
  visible,
  onClose,
  onPlay,
  onOpen,
  onOnline,
  showDetails = true,
  seriesImdb = null,
  continueRow = false,
}: ItemActionSheetProps) {
  const { t } = useI18n();
  const { settings } = useSettings();
  const { flags, setFavorite, setPlayed, pending, removeProgress } = useUserData();
  const play = usePlay();
  const picker = useStreamPicker();

  if (!movie) return <ActionSheet visible={false} onClose={onClose} actions={[]} />;

  const state = flags(movie);
  const busy = pending(movie.id);
  const isEpisode = movie.kind === "Episode";
  const jellyfin = !movie.external && !movie.live;
  const resume = state.playbackPositionTicks > 10_000_000 * 30;
  const watched = state.played || state.unplayedCount === 0;
  const code = isEpisode ? episodeCode(movie, t("episodeCode")) : "";
  const hasAddons = settings.addons.urls.length > 0 || settings.addons.cinemeta;
  const onlineRef = jellyfin && hasAddons ? externalRefForJellyfin(movie, seriesImdb) : null;
  const onlineItem: Movie | null = onlineRef
    ? { ...movie, external: onlineRef }
    : movie.external && movie.kind !== "Series"
      ? movie
      : null;

  const title = isEpisode ? (movie.seriesName ?? movie.name) : movie.name;
  const meta = [movie.year ? String(movie.year) : null, formatRuntime(movie.runtimeTicks) || null].filter(Boolean).join(" • ");
  const subtitle = isEpisode ? [code, movie.name].filter(Boolean).join(" · ") : meta || undefined;
  const thumb = isEpisode ? movie.thumbUrl ?? movie.posterUrl : movie.posterUrl;

  const actions: SheetAction[] = [
    {
      key: "play",
      label: resume ? t("resume") : t("play"),
      hint: code || undefined,
      icon: Play,
      onPress: () => (onPlay ?? play)(movie),
    },
  ];
  if (showDetails && !movie.live) {
    actions.push({ key: "details", label: t("viewDetails"), icon: Info, onPress: () => (onOpen ?? openDetails)(movie) });
  }
  // Online titles keep their marks in the local list, so they get these two as well.
  if (jellyfin || (movie.external && !movie.live)) {
    actions.push({
      key: "favorite",
      label: state.favorite ? t("removeFromList") : t("addToList"),
      icon: state.favorite ? Check : Plus,
      disabled: busy,
      onPress: () => void setFavorite(movie, !state.favorite),
    });
    actions.push({
      key: "watched",
      label: watched ? t("markUnwatched") : t("markWatched"),
      icon: watched ? Eye : CircleCheck,
      disabled: busy,
      // Online progress lives apart from the watched mark: drop it as well.
      onPress: () =>
        void setPlayed(movie, !watched).then(() => (!watched && movie.external ? removeProgress(movie) : undefined)),
    });
  }
  if (continueRow) {
    actions.push({
      key: "removeContinue",
      label: t("removeFromContinue"),
      icon: X,
      disabled: busy,
      onPress: () => void removeProgress(movie),
    });
  }
  const trailer = movie.remoteTrailers?.find((url) => /youtu\.?be/.test(url));
  if (trailer) {
    actions.push({ key: "trailer", label: t("trailer"), icon: Clapperboard, onPress: () => void Linking.openURL(trailer).catch(() => undefined) });
  }
  if (onlineItem) {
    actions.push({
      key: "online",
      label: t("onlineSources"),
      icon: Globe,
      onPress: () => (onOnline ?? picker.open)(onlineItem),
    });
  }

  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      thumb={thumb}
      thumbAspect={isEpisode && movie.thumbUrl ? 16 / 9 : 2 / 3}
      actions={actions}
    />
  );
}
