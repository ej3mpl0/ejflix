import React, { useCallback, useEffect, useState } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { api } from "../lib/api";
import { GlassTabBar } from "./GlassTabBar";
import type { TabsParamList } from "./types";
import { HomeScreen } from "../screens/HomeScreen";
import { DiscoverScreen } from "../screens/DiscoverScreen";
import { LiveTvScreen } from "../screens/LiveTvScreen";
import { SearchScreen } from "../screens/SearchScreen";
import { SettingsScreen } from "../screens/SettingsScreen";

const Tab = createBottomTabNavigator<TabsParamList>();

/** True when at least one enabled IPTV source exists (the TV tab is shown then). */
export function useHasTv(): boolean {
  const [hasTv, setHasTv] = useState(false);
  const load = useCallback(() => {
    api
      .iptvStatus()
      .then((status) => setHasTv(status.sources.some((s) => s.enabled)))
      .catch(() => setHasTv(false));
  }, []);
  useEffect(() => {
    load();
    const unlisten = api.onIptvChanged(load);
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [load]);
  return hasTv;
}

/** Home / Discover / (TV) / Search / Settings behind the glass tab bar. */
export function MainTabs({ hasTv }: { hasTv: boolean }) {
  return (
    <Tab.Navigator
      initialRouteName="HomeTab"
      backBehavior="initialRoute"
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: "transparent" }, lazy: true }}
    >
      <Tab.Screen name="HomeTab" component={HomeScreen} />
      <Tab.Screen name="DiscoverTab" component={DiscoverScreen} />
      {hasTv ? <Tab.Screen name="TvTab" component={LiveTvScreen} /> : null}
      <Tab.Screen name="SearchTab" component={SearchScreen} />
      <Tab.Screen name="SettingsTab" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
