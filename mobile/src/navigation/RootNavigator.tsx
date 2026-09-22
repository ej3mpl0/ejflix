import React, { useEffect, useState } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as ScreenOrientation from "expo-screen-orientation";
import { useSession } from "../lib/session-context";
import { useSettings } from "../lib/settings-context";
import { SetupScreen } from "../screens/SetupScreen";
import { useTheme } from "../theme/ThemeProvider";
import { useLayout } from "../theme/responsive";
import { AuthNavigator } from "./AuthNavigator";
import { MainTabs, useHasTv } from "./MainTabs";
import type { MainStackParamList, RootStackParamList } from "./types";
import { BootScreen } from "../screens/BootScreen";
import { DetailsScreen } from "../screens/DetailsScreen";
import { ExternalDetailsScreen } from "../screens/ExternalDetailsScreen";
import { SettingsSectionScreen } from "../screens/SettingsSectionScreen";
import { ProfileEditorScreen } from "../screens/ProfileEditorScreen";
import { PlayerScreen } from "../screens/PlayerScreen";
import { SeeAllScreen } from "../screens/SeeAllScreen";

const Root = createNativeStackNavigator<RootStackParamList>();
const Main = createNativeStackNavigator<MainStackParamList>();

function TabsRoute() {
  const hasTv = useHasTv();
  return <MainTabs hasTv={hasTv} />;
}

/** Signed-in area: tabs + details / settings / editor pushes + the full-screen player. */
function MainNavigator() {
  const t = useTheme();
  const { isTablet } = useLayout();

  // Phones stay portrait (the player flips to landscape on its own screen).
  useEffect(() => {
    if (isTablet) return undefined;
    void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => undefined);
    return () => {
      void ScreenOrientation.unlockAsync().catch(() => undefined);
    };
  }, [isTablet]);

  return (
    <Main.Navigator
      initialRouteName="Tabs"
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.colors.base },
        orientation: isTablet ? "default" : "portrait_up",
        animation: "slide_from_right",
        animationDuration: 300,
      }}
    >
      <Main.Screen name="Tabs" component={TabsRoute} options={{ animation: "fade" }} />
      <Main.Screen name="Details" component={DetailsScreen} options={{ animation: "fade_from_bottom" }} />
      <Main.Screen name="ExternalDetails" component={ExternalDetailsScreen} options={{ animation: "fade_from_bottom" }} />
      <Main.Screen name="SettingsSection" component={SettingsSectionScreen} />
      <Main.Screen name="SeeAll" component={SeeAllScreen} />
      <Main.Screen name="ProfileEditor" component={ProfileEditorScreen} options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      <Main.Screen
        name="Player"
        component={PlayerScreen}
        options={{
          presentation: "fullScreenModal",
          animation: "fade",
          gestureEnabled: false,
          orientation: "landscape",
          contentStyle: { backgroundColor: "#000000" },
          autoHideHomeIndicator: true,
        }}
      />
    </Main.Navigator>
  );
}

function MainRoute() {
  const { session } = useSession();
  const { settings, ready } = useSettings();
  const [setupClosed, setSetupClosed] = useState(false);
  // First-run setup of a new profile (look, addon import), once, before Home.
  if (ready && !settings.onboarding.setupDone && !setupClosed) {
    return <SetupScreen onDone={() => setSetupClosed(true)} />;
  }
  return <MainNavigator key={session?.userId ?? "none"} />;
}

/** Boot | Auth | Main, driven by the session context. */
export function RootNavigator() {
  const { boot, session } = useSession();
  const t = useTheme();
  return (
    <Root.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.colors.base }, animation: "fade", animationDuration: 260 }}>
      {boot ? (
        <Root.Screen name="Boot" component={BootScreen} />
      ) : session ? (
        <Root.Screen name="Main" component={MainRoute} />
      ) : (
        <Root.Screen name="Auth" component={AuthNavigator} />
      )}
    </Root.Navigator>
  );
}
