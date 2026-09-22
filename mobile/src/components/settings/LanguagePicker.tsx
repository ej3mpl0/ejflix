import React, { useMemo, useState } from "react";
import { Text, type StyleProp, type ViewStyle } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { LANGUAGE_CODES, languageName } from "../../lib/languages";
import { useI18n } from "../../lib/locale-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { PressableScale } from "../ui/PressableScale";
import { SelectSheet, type SelectOption } from "../ui/SelectSheet";

/**
 * Preferred audio / subtitle language: a pill that opens a searchable sheet with
 * "Default" (""), "Off" ("off", subtitles only) and every ISO 639-2 code.
 */
export function LanguagePicker({
  value,
  kind,
  onChange,
  label,
}: {
  value: string;
  kind: "audio" | "subtitle";
  onChange: (code: string) => void;
  label: string;
}) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const [open, setOpen] = useState(false);

  const options = useMemo<SelectOption<string>[]>(() => {
    const list = LANGUAGE_CODES.map((code) => ({ value: code, label: languageName(code, locale), hint: code.toUpperCase() })).sort((a, b) =>
      a.label.localeCompare(b.label, locale),
    );
    const head: SelectOption<string>[] = [{ value: "", label: tr("langAuto") }];
    if (kind === "subtitle") head.push({ value: "off", label: tr("langOff") });
    return [...head, ...list];
  }, [kind, locale, tr]);

  const current = value === "" ? tr("langAuto") : value === "off" ? tr("langOff") : languageName(value, locale);

  return (
    <>
      <PressableScale accessibilityRole="button" accessibilityLabel={`${label}: ${current}`} onPress={() => setOpen(true)} style={s.pill}>
        <Text numberOfLines={1} style={s.value}>
          {current}
        </Text>
        <ChevronDown size={15} color={t.colors.dim} strokeWidth={2} />
      </PressableScale>
      <SelectSheet visible={open} onClose={() => setOpen(false)} title={label} options={options} value={value} onSelect={onChange} searchable />
    </>
  );
}

/** Same pill used by other pickers (year, sort, source). */
export function PickerPill({ label, value, onPress, style }: { label: string; value: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  const t = useTheme();
  return (
    <PressableScale accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={[s.pill, style]}>
      <Text numberOfLines={1} style={s.value}>
        {value}
      </Text>
      <ChevronDown size={15} color={t.colors.dim} strokeWidth={2} />
    </PressableScale>
  );
}

const useStyles = makeStyles((t) => ({
  pill: {
    height: 40,
    minHeight: 40,
    maxWidth: 260,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 16,
    paddingRight: 12,
    borderRadius: t.radii.pill,
    backgroundColor: t.white(0.06),
    alignSelf: "flex-start",
  },
  value: { ...text(13, "medium"), color: t.colors.text, flexShrink: 1 },
}));
