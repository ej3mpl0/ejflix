import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { I18nProvider } from "./lib/locale-context";
import { SessionProvider, useSession } from "./lib/session-context";
import { SettingsProvider, useSettings } from "./lib/settings-context";
import { UserDataProvider } from "./lib/userdata-context";
import { ToastProvider, useToast } from "./lib/toast-context";
import { StreamPickerProvider } from "./lib/stream-picker-context";
import { UpdateProvider, useUpdate } from "./lib/update-context";
import { ThemeProvider } from "./theme/ThemeProvider";
import type { ThemePrefs } from "./theme/tokens";
import { RootNavigator } from "./navigation/RootNavigator";
import { navigationRef } from "./navigation/navigationRef";
import { useNavigationTheme } from "./navigation/navTheme";
import { UpdateAvailableModal } from "./components/update/UpdateAvailableModal";
import { WhatsNewModal } from "./components/update/WhatsNewModal";

// Keep the native splash until the session restore resolved.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
SplashScreen.setOptions({ fade: true, duration: 300 });

export default function App() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.fill}>
        <I18nProvider>
          <SessionProvider onBooted={() => void SplashScreen.hideAsync().catch(() => undefined)}>
            <Settled />
          </SessionProvider>
        </I18nProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

/** Settings are keyed by profile; the store answers with the last profile's look before login. */
function Settled() {
  const { session } = useSession();
  const userId = session?.userId ?? null;
  return (
    <SettingsProvider key={userId ?? "anonymous"} userId={userId}>
      <Themed />
    </SettingsProvider>
  );
}

function Themed() {
  const { settings } = useSettings();
  const prefs = useMemo<ThemePrefs>(
    () => ({ theme: settings.appearance.theme, amoled: settings.appearance.amoled, posterSize: settings.appearance.posterSize }),
    [settings.appearance.theme, settings.appearance.amoled, settings.appearance.posterSize],
  );
  return (
    <ThemeProvider prefs={prefs}>
      <ToastProvider>
        <WithToast />
      </ToastProvider>
    </ThemeProvider>
  );
}

function WithToast() {
  const { toast } = useToast();
  return (
    <UserDataProvider onError={toast}>
      <UpdateProvider>
        <Shell />
      </UpdateProvider>
    </UserDataProvider>
  );
}

function Shell() {
  const navTheme = useNavigationTheme();
  const [playing, setPlaying] = useState(false);
  const onStateChange = useCallback(() => {
    setPlaying(navigationRef.getCurrentRoute()?.name === "Player");
  }, []);
  return (
    <>
      <StatusBar style="light" hidden={playing} />
      <NavigationContainer ref={navigationRef} theme={navTheme} onStateChange={onStateChange}>
        {/* One stream picker for the whole app: Home, the item menus and both details pages open it. */}
        <StreamPickerProvider>
          <RootNavigator />
        </StreamPickerProvider>
      </NavigationContainer>
      <Overlays playing={playing} />
    </>
  );
}

/** Update dialogs above everything: the "what's new" card first, never while watching. */
function Overlays({ playing }: { playing: boolean }) {
  const { boot, notesVersion, dismissNotes } = useSession();
  const { modalOpen } = useUpdate();
  if (boot) return null;
  return (
    <>
      {notesVersion ? <WhatsNewModal version={notesVersion} onClose={dismissNotes} /> : null}
      {modalOpen && !notesVersion && !playing ? <UpdateAvailableModal /> : null}
    </>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
