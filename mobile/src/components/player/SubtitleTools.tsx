import React from "react";
import { Pressable, Text, View } from "react-native";
import { FileUp, Minus, Plus, X } from "lucide-react-native";
import type { SubBackground } from "../../lib/types";
import { useI18n } from "../../lib/locale-context";
import { useSettings } from "../../lib/settings-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";

const COLORS = ["#FFFFFF", "#FFE45C", "#7DF9FF", "#9CFF8A"];
const BACKGROUNDS: SubBackground[] = ["outline", "shadow", "box"];

/** −/+ stepper for a delay in seconds (0.1 s steps); a tap on the value resets it. */
export function DelayStepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const s = useStyles();
  const th = useTheme();
  const { t } = useI18n();
  const step = (dir: number) => onChange(Math.round((value + dir * 0.1) * 10) / 10);
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <View style={s.controls}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} −0.1 s`} onPress={() => step(-1)} style={s.round}>
          <Minus size={15} color={th.colors.text} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("resetDelay")} onPress={() => onChange(0)} style={s.valueBox}>
          <Text style={s.value}>
            {value > 0 ? "+" : ""}
            {value.toFixed(1)} s
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} +0.1 s`} onPress={() => step(1)} style={s.round}>
          <Plus size={15} color={th.colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Bottom of the subtitle sheet: loading a file from the device and, for such a file (the
 * app draws it), its delay and look. The look is saved with the profile.
 */
export function SubtitleTools({
  fileName,
  delay,
  onDelay,
  onPickFile,
  onClearFile,
}: {
  /** Loaded file, or null. */
  fileName: string | null;
  delay: number;
  onDelay: (value: number) => void;
  onPickFile: () => void;
  onClearFile: () => void;
}) {
  const s = useStyles();
  const th = useTheme();
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const { subScale, subColor, subBackground } = settings.playback;
  const setScale = (next: number) => void update({ playback: { subScale: Math.min(2.5, Math.max(0.5, Math.round(next * 10) / 10)) } });

  return (
    <View style={s.wrap}>
      {fileName ? (
        <View style={s.fileRow}>
          <Text numberOfLines={1} style={s.fileName}>
            {fileName}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t("subRemoveFile")} onPress={onClearFile} hitSlop={10}>
            <X size={17} color={th.colors.dim} />
          </Pressable>
        </View>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onPickFile} style={({ pressed }) => [s.load, pressed ? { opacity: 0.7 } : null]}>
        <FileUp size={16} color={th.colors.text} />
        <Text style={s.loadText}>{fileName ? t("subLoadOther") : t("subLoadFile")}</Text>
      </Pressable>
      {fileName ? (
        <>
          <DelayStepper label={t("subDelay")} value={delay} onChange={onDelay} />
          <View style={s.row}>
            <Text style={s.label}>{t("subSize")}</Text>
            <View style={s.controls}>
              <Pressable accessibilityRole="button" accessibilityLabel={t("subSmaller")} onPress={() => setScale(subScale - 0.1)} style={s.round}>
                <Text style={[s.value, { fontSize: 11 }]}>A</Text>
              </Pressable>
              <Text style={[s.value, { minWidth: 48, textAlign: "center" }]}>{Math.round(subScale * 100)}%</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t("subBigger")} onPress={() => setScale(subScale + 0.1)} style={s.round}>
                <Text style={[s.value, { fontSize: 17 }]}>A</Text>
              </Pressable>
            </View>
          </View>
          <View style={s.row}>
            <Text style={s.label}>{t("subColor")}</Text>
            <View style={s.controls}>
              {COLORS.map((color) => (
                <Pressable
                  key={color}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: subColor === color }}
                  accessibilityLabel={color}
                  onPress={() => void update({ playback: { subColor: color } })}
                  style={[s.swatch, { backgroundColor: color, borderWidth: subColor === color ? 2 : 1, borderColor: subColor === color ? "#fff" : th.white(0.2) }]}
                />
              ))}
            </View>
          </View>
          <View style={s.row}>
            <Text style={s.label}>{t("subBackground")}</Text>
            <View style={s.segment}>
              {BACKGROUNDS.map((kind) => (
                <Pressable
                  key={kind}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: subBackground === kind }}
                  onPress={() => void update({ playback: { subBackground: kind } })}
                  style={[s.segmentItem, subBackground === kind ? s.segmentOn : null]}
                >
                  <Text style={[s.segmentText, subBackground === kind ? { color: "#000" } : null]}>
                    {t(kind === "outline" ? "subBgOutline" : kind === "shadow" ? "subBgShadow" : "subBgBox")}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </>
      ) : (
        <Text style={s.hint}>{t("subFileHint")}</Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { borderTopWidth: 1, borderTopColor: t.white(0.1), marginTop: 4, paddingTop: 8, paddingHorizontal: 12, paddingBottom: 12, gap: 4 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 6 },
  fileName: { ...text(13, "medium"), color: t.colors.text, flex: 1 },
  load: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 8, borderRadius: t.radii.btn },
  loadText: { ...text(14), color: t.colors.text },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 8, minHeight: 44 },
  label: { ...text(13), color: t.white(0.85) },
  controls: { flexDirection: "row", alignItems: "center", gap: 8 },
  round: { width: 34, height: 34, borderRadius: 17, backgroundColor: t.white(0.08), alignItems: "center", justifyContent: "center" },
  valueBox: { minWidth: 60, alignItems: "center", paddingHorizontal: 4, paddingVertical: 4, borderRadius: 6 },
  value: { ...text(13, "semibold", { tabular: true }), color: t.colors.text },
  swatch: { width: 26, height: 26, borderRadius: 13 },
  segment: { flexDirection: "row", borderRadius: 999, backgroundColor: t.white(0.06), padding: 2 },
  segmentItem: { paddingHorizontal: 10, height: 30, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  segmentOn: { backgroundColor: "#fff" },
  segmentText: { ...text(12), color: t.white(0.85) },
  hint: { ...text(12, "regular", { lineHeight: 17 }), color: t.colors.dim, paddingHorizontal: 8, paddingBottom: 4 },
}));
