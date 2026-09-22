import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useSession } from "../lib/session-context";
import { useTheme } from "../theme/ThemeProvider";
import type { AuthStackParamList } from "./types";
import { WelcomeScreen } from "../screens/WelcomeScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { ProfilesScreen } from "../screens/ProfilesScreen";
import { PinScreen } from "../screens/PinScreen";
import { ProfileEditorScreen } from "../screens/ProfileEditorScreen";

const Stack = createNativeStackNavigator<AuthStackParamList>();

/** Welcome → Login → Profiles → PIN / editor. The first screen follows the session gate. */
export function AuthNavigator() {
  const { gate } = useSession();
  const t = useTheme();
  const initial: keyof AuthStackParamList = gate === "profiles" ? "Profiles" : gate === "login" ? "Login" : gate === "create" ? "ProfileEditor" : "Welcome";
  return (
    <Stack.Navigator
      initialRouteName={initial}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: t.colors.base },
        animation: "fade_from_bottom",
        animationDuration: 300,
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ animation: "fade" }} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Profiles" component={ProfilesScreen} options={{ animation: "fade" }} />
      <Stack.Screen name="Pin" component={PinScreen} />
      <Stack.Screen name="ProfileEditor" component={ProfileEditorScreen} initialParams={{ from: "welcome" }} />
    </Stack.Navigator>
  );
}
