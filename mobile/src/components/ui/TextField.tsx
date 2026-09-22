import React, { forwardRef, useState } from "react";
import { Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";

export type TextFieldProps = Omit<TextInputProps, "style"> & {
  /** Small uppercase label above the field (desktop 11 px / tracking .08em). */
  label?: string;
  /** Message under the field in the accent colour. */
  error?: string | null;
  /** Neutral hint under the field. */
  hint?: string | null;
  icon?: LucideIcon;
  /** Node at the right edge (clear / visibility button). */
  right?: React.ReactNode;
  height?: number;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
};

/** Dark input: white/6 fill, white/10 edge, accent ring while focused. */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, icon: Icon, right, height = 48, containerStyle, inputStyle, onFocus, onBlur, editable = true, ...rest },
  ref,
) {
  const s = useStyles();
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={containerStyle}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <View style={[s.ring, focused ? s.ringOn : null]}>
        <View style={[s.field, { height }, focused ? s.fieldOn : null, !editable ? { opacity: t.opacity.muted } : null]}>
          {Icon ? <Icon size={17} color={focused ? t.colors.text : t.colors.dim} strokeWidth={2} /> : null}
          <TextInput
            ref={ref}
            {...rest}
            editable={editable}
            placeholderTextColor={t.colors.dim}
            selectionColor={t.colors.accent}
            cursorColor={t.colors.accent}
            keyboardAppearance="dark"
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
            style={[s.input, text(15), { color: t.colors.text }, inputStyle]}
          />
          {right}
        </View>
      </View>
      {error ? (
        <Text style={s.error}>{error}</Text>
      ) : hint ? (
        <Text style={s.hint}>{hint}</Text>
      ) : null}
    </View>
  );
});

const useStyles = makeStyles((t) => ({
  label: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.colors.dim, marginBottom: 8 },
  ring: { borderRadius: t.radii.btn + 2, borderWidth: 2, borderColor: "transparent" },
  ringOn: { borderColor: `${t.colors.accent}4d` },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: t.radii.btn,
    borderWidth: 1,
    borderColor: t.white(0.1),
    backgroundColor: t.white(0.06),
  },
  fieldOn: { borderColor: t.colors.accent },
  input: { flex: 1, paddingVertical: 0, minWidth: 0 },
  error: { ...text(13), color: t.colors.accent, marginTop: 8 },
  hint: { ...text(12), color: t.colors.dim, marginTop: 8 },
}));
