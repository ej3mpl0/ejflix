import React, { type ReactNode } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import type { PlayerTrack } from "../../lib/types";
import { languageName } from "../../lib/languages";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Sheet } from "../ui/Sheet";

export type TrackKind = "audio" | "sub";

type Row = { id: number; primary: string; secondary: string | null; selected: boolean };

function labelOf(track: PlayerTrack, locale: string): { primary: string; secondary: string | null } {
  const language = track.lang ? languageName(track.lang, locale) : null;
  const codec = track.codec ? track.codec.toUpperCase() : null;
  const known = language && track.lang && language.toUpperCase() !== track.lang.toUpperCase();
  if (!known || !language) return { primary: track.title || language || codec || String(track.id), secondary: track.title ? codec : null };
  const detail = track.title && track.title !== track.lang ? track.title : codec;
  return { primary: language, secondary: detail && detail !== language ? detail : null };
}

/** Short name of a track for the toolbar chip: the language when known, else its title. */
export function trackShortName(track: PlayerTrack, locale: string): string {
  return labelOf(track, locale).primary;
}

/** Audio or subtitle picker as a bottom sheet (desktop `TrackMenu`). */
export function TrackSheet({
  kind,
  visible,
  tracks,
  onSelect,
  onClose,
  footer,
}: {
  kind: TrackKind;
  /** Extra controls under the list (subtitle file, delay, look). */
  footer?: ReactNode;
  visible: boolean;
  tracks: PlayerTrack[];
  onSelect: (kind: string, id: number) => void;
  onClose: () => void;
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const list = tracks.filter((track) => track.kind === kind);
  const subOff = kind === "sub" && !list.some((track) => track.selected);
  const rows: Row[] = [
    ...(kind === "sub" ? [{ id: 0, primary: tr("subtitlesOff"), secondary: null, selected: subOff }] : []),
    ...list.map((track) => ({ id: track.id, selected: track.selected, ...labelOf(track, locale) })),
  ];

  return (
    <Sheet visible={visible} onClose={onClose} title={kind === "audio" ? tr("audio") : tr("subtitles")} snap="auto">
      <FlatList
        data={rows}
        keyExtractor={(row) => String(row.id)}
        contentContainerStyle={s.list}
        style={s.scroller}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: item.selected }}
            onPress={() => {
              onSelect(kind, item.id);
              onClose();
            }}
            style={({ pressed }) => [s.row, pressed ? s.rowPressed : null]}
          >
            <View style={s.check}>{item.selected ? <Check size={16} color={t.colors.accent} strokeWidth={2.5} /> : null}</View>
            <View style={s.labels}>
              <Text numberOfLines={1} style={[s.primary, item.selected ? s.primarySelected : null]}>
                {item.primary}
              </Text>
              {item.secondary ? (
                <Text numberOfLines={1} style={s.secondary}>
                  {item.secondary}
                </Text>
              ) : null}
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={s.empty}>{tr("noTracks")}</Text>}
        ListFooterComponent={footer ? <>{footer}</> : null}
      />
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  scroller: { maxHeight: 520 },
  list: { paddingHorizontal: 8, paddingBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 12, borderRadius: t.radii.btn },
  rowPressed: { backgroundColor: t.white(0.06) },
  check: { width: 20, alignItems: "center" },
  labels: { flex: 1, minWidth: 0 },
  primary: { ...text(15), color: t.white(0.85) },
  primarySelected: { ...text(15, "semibold"), color: t.colors.text },
  secondary: { ...text(11), color: t.colors.dim },
  empty: { ...text(14), color: t.colors.dim, paddingHorizontal: 20, paddingVertical: 16 },
}));
