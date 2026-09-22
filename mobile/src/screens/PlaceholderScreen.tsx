import React from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles } from "../theme/ThemeProvider";
import { text } from "../theme/typography";

/**
 * Minimal stand-in used by the screens that other modules replace. Renders the
 * screen name (and an optional detail) on the base background.
 */
export function PlaceholderScreen({ name, detail, children }: { name: string; detail?: string; children?: React.ReactNode }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 80 }]}>
      <Text style={s.title}>{name}</Text>
      {detail ? <Text style={s.detail}>{detail}</Text> : null}
      {children}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 12 },
  title: { ...text(22, "semibold", { tracking: -0.02 }), color: t.colors.text },
  detail: { ...text(13), color: t.colors.dim, textAlign: "center" },
}));
