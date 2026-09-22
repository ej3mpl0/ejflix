import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";

/** Four-digit PIN entry: one hidden number-pad input, four boxes; submits by itself on the 4th digit. */
export function PinInput({
  onSubmit,
  error = false,
  disabled = false,
  autoFocus = true,
}: {
  onSubmit: (pin: string) => void;
  /** Flashes the boxes in the accent colour and shakes them. */
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const s = useStyles();
  const t = useTheme();
  const reduced = useReducedMotion();
  const [value, setValue] = useState("");
  const input = useRef<TextInput>(null);
  const shake = useSharedValue(0);

  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => input.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  useEffect(() => {
    if (!error) return;
    setValue("");
    if (reduced) return;
    const step = (x: number) => withTiming(x, { duration: 80, easing: Easing.bezier(0.2, 0, 0, 1) });
    shake.value = withSequence(step(-6), step(6), step(-6), step(6), step(0));
  }, [error, reduced, shake]);

  const update = (next: string) => {
    const digits = next.replace(/\D/g, "").slice(0, 4);
    setValue(digits);
    if (digits.length === 4) onSubmit(digits);
  };

  const shaking = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  return (
    <Pressable accessibilityLabel="PIN" onPress={() => input.current?.focus()} style={{ alignSelf: "center" }}>
      <TextInput
        ref={input}
        value={value}
        onChangeText={update}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
        editable={!disabled}
        caretHidden
        autoComplete="off"
        importantForAutofill="no"
        keyboardAppearance="dark"
        style={s.hidden}
      />
      <Animated.View style={[s.boxes, shaking]} accessibilityElementsHidden>
        {[0, 1, 2, 3].map((i) => {
          const current = i === value.length;
          return (
            <View key={i} style={[s.box, current || error ? { borderColor: t.colors.accent } : null]}>
              <Text style={s.dot}>{value[i] ? "•" : ""}</Text>
            </View>
          );
        })}
      </Animated.View>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  hidden: { position: "absolute", opacity: 0, width: 1, height: 1 },
  boxes: { flexDirection: "row", gap: 12 },
  box: {
    width: 56,
    height: 64,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.white(0.12),
    backgroundColor: t.black(0.4),
    alignItems: "center",
    justifyContent: "center",
  },
  dot: { ...text(26, "semibold"), color: t.colors.text },
}));
