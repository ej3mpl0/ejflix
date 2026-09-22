import React from "react";
import { View } from "react-native";
import { makeStyles } from "../theme/ThemeProvider";
import { Logo } from "../components/ui/Logo";

/** Shown while the session is being restored (the native splash usually covers it). */
export function BootScreen() {
  const s = useStyles();
  return (
    <View style={s.root}>
      <Logo size="login" />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base, alignItems: "center", justifyContent: "center" },
}));
