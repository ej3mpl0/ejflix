import { useMemo } from "react";
import { DarkTheme, type Theme as NavTheme } from "@react-navigation/native";
import { useTheme } from "../theme/ThemeProvider";
import { FONTS } from "../theme/tokens";

/** React Navigation theme derived from the design tokens (background, card, text, accent). */
export function useNavigationTheme(): NavTheme {
  const t = useTheme();
  return useMemo<NavTheme>(
    () => ({
      ...DarkTheme,
      dark: true,
      colors: {
        ...DarkTheme.colors,
        primary: t.colors.accent,
        background: t.colors.base,
        card: t.colors.surface,
        text: t.colors.text,
        border: t.colors.line,
        notification: t.colors.accent,
      },
      fonts: {
        regular: { fontFamily: FONTS.regular, fontWeight: "400" },
        medium: { fontFamily: FONTS.medium, fontWeight: "500" },
        bold: { fontFamily: FONTS.bold, fontWeight: "700" },
        heavy: { fontFamily: FONTS.extrabold, fontWeight: "800" },
      },
    }),
    [t],
  );
}
