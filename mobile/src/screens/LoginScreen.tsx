import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Server } from "lucide-react-native";
import { makeStyles } from "../theme/ThemeProvider";
import { useI18n } from "../lib/locale-context";
import { useSession } from "../lib/session-context";
import { api } from "../lib/api";
import { GrainBackdrop } from "../components/ui/GrainBackdrop";
import { Logo } from "../components/ui/Logo";
import { CardSurface } from "../components/ui/CardSurface";
import { TextField } from "../components/ui/TextField";
import { Pill } from "../components/ui/Pill";
import { AuthHeader } from "../components/auth/AuthHeader";
import type { AuthScreenProps } from "../navigation/types";

/** Server URL screen: probes the Jellyfin server and moves on to the user picker. */
export function LoginScreen({ navigation }: AuthScreenProps<"Login">) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { t } = useI18n();
  const { server, hasLocal, setServer, setGate } = useSession();
  const [url, setUrl] = useState(server?.serverUrl ?? "http://192.168.1.10:8096");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const back = () => {
    const target = server || hasLocal ? "Profiles" : "Welcome";
    setGate(target === "Profiles" ? "profiles" : "welcome");
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace(target);
  };

  const connect = async () => {
    const trimmed = url.trim();
    if (!trimmed || loading) return;
    setError("");
    setLoading(true);
    try {
      const info = await api.probeServer(trimmed);
      const saved = await api.savedServer().catch(() => null);
      setServer(saved ?? { serverUrl: trimmed.replace(/\/+$/, ""), serverName: info.serverName });
      setGate("profiles");
      navigation.replace("Profiles");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={s.root}>
      <GrainBackdrop glow={0.15} cy={0.2} vignette />
      <AuthHeader onBack={back} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.fill}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32, paddingHorizontal: Math.max(24, insets.left, insets.right) }]}
        >
          <Animated.View entering={reduced ? undefined : FadeInDown.duration(420)} style={s.cardWrap}>
            <CardSurface style={s.card}>
              <View style={{ alignItems: "center", marginBottom: 28 }}>
                <Logo size="login" />
              </View>
              <TextField
                label={t("jellyfinServer")}
                icon={Server}
                value={url}
                onChangeText={setUrl}
                placeholder="http://192.168.1.10:8096"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                textContentType="URL"
                returnKeyType="go"
                autoFocus
                onSubmitEditing={() => void connect()}
                error={error || null}
                containerStyle={{ marginBottom: error ? 16 : 20 }}
              />
              <Pill variant="primary" size="lg" block label={t("connect")} loading={loading} disabled={!url.trim()} onPress={() => void connect()} />
            </CardSurface>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base },
  fill: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", alignItems: "center", paddingTop: 16 },
  cardWrap: { width: "100%", maxWidth: 420 },
  card: { padding: 28, borderRadius: t.radii.card },
}));
