import React, { createContext, useContext, useMemo } from "react";
import { StyleSheet } from "react-native";
import { buildTheme, DEFAULT_THEME, type Theme, type ThemePrefs } from "./tokens";

const ThemeContext = createContext<Theme>(DEFAULT_THEME);

/**
 * Provides the token object for the given appearance prefs. Wrap it around the app
 * inside `SettingsProvider` and pass `settings.appearance`.
 */
export function ThemeProvider({ prefs, children }: { prefs: ThemePrefs; children: React.ReactNode }) {
  const theme = useMemo(() => buildTheme(prefs), [prefs.theme, prefs.amoled, prefs.posterSize]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

type NamedStyles<T> = { [P in keyof T]: import("react-native").ViewStyle | import("react-native").TextStyle | import("react-native").ImageStyle };

/**
 * `const useStyles = makeStyles((t) => ({ card: { backgroundColor: t.colors.surface } }))`
 * Styles are created once per theme object (themes are memoised, so this is cheap).
 */
export function makeStyles<T extends NamedStyles<T>>(factory: (theme: Theme) => T): () => T {
  const cache = new WeakMap<Theme, T>();
  return function useStyles(): T {
    const theme = useTheme();
    let styles = cache.get(theme);
    if (!styles) {
      styles = StyleSheet.create(factory(theme)) as T;
      cache.set(theme, styles);
    }
    return styles;
  };
}
