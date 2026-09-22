import React from "react";
import { Pressable, Text, View } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Compass, House, Search, Settings, Tv, type LucideIcon } from "lucide-react-native";
import { makeStyles, useTheme } from "../theme/ThemeProvider";
import { text } from "../theme/typography";
import { useI18n } from "../lib/locale-context";
import type { MessageKey } from "../lib/i18n";
import { Glass, LIQUID_GLASS } from "../components/ui/Glass";
import { TAB_BAR_HEIGHT } from "../components/ui/Toast";
import type { TabsParamList } from "./types";

const TAB_META: Record<keyof TabsParamList, { icon: LucideIcon; label: MessageKey }> = {
  HomeTab: { icon: House, label: "home" },
  DiscoverTab: { icon: Compass, label: "discover" },
  TvTab: { icon: Tv, label: "tvTab" },
  SearchTab: { icon: Search, label: "search" },
  SettingsTab: { icon: Settings, label: "settings" },
};

/**
 * Frosted bottom tab bar: glass surface + top hairline, accent on the active tab.
 * With Liquid Glass (iOS 26) it floats as a capsule above the home indicator,
 * like the system tab bars, and the active tab sits on a lighter lens.
 */
export function GlassTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const floating = LIQUID_GLASS;
  return (
    <Glass
      interactive={floating}
      style={
        floating
          ? [s.capsule, { bottom: Math.max(insets.bottom - 10, 12), left: 16 + insets.left, right: 16 + insets.right }]
          : [s.bar, { paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]
      }
    >
      {floating ? null : <View pointerEvents="none" style={s.topLine} />}
      <View style={[s.row, { height: floating ? TAB_BAR_HEIGHT - 4 : TAB_BAR_HEIGHT }, floating ? s.capsuleRow : null]}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const meta = TAB_META[route.name as keyof TabsParamList];
          const options = descriptors[route.key]?.options;
          const Icon = meta?.icon ?? House;
          const label = typeof options?.title === "string" ? options.title : meta ? tr(meta.label) : route.name;
          const color = focused ? t.colors.accent : t.colors.dim;
          const onPress = () => {
            const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key });
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options?.tabBarAccessibilityLabel ?? label}
              testID={options?.tabBarButtonTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              style={({ pressed }) => [
                s.tab,
                floating ? s.capsuleTab : null,
                floating && focused ? s.lens : null,
                pressed ? { opacity: 0.7 } : null,
              ]}
            >
              <Icon size={23} color={color} strokeWidth={focused ? 2.4 : 2} />
              <Text numberOfLines={1} style={[s.label, { color }]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Glass>
  );
}

const useStyles = makeStyles((t) => ({
  bar: { position: "absolute", left: 0, right: 0, bottom: 0 },
  capsule: { position: "absolute", borderRadius: 999 },
  capsuleRow: { paddingHorizontal: 4, paddingVertical: 4 },
  capsuleTab: { paddingTop: 2, borderRadius: 999 },
  lens: { backgroundColor: t.white(0.12) },
  topLine: { position: "absolute", top: 0, left: 0, right: 0, height: 1, backgroundColor: t.white(0.08) },
  row: { flexDirection: "row", alignItems: "stretch" },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minHeight: 44, paddingTop: 6 },
  label: { ...text(11, "medium", { lineHeight: 13 }) },
}));
