import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown, CircleCheck, Server, Wifi } from "lucide-react-native";
import { makeStyles, useTheme } from "../theme/ThemeProvider";
import { text } from "../theme/typography";
import { useI18n } from "../lib/locale-context";
import { errorText } from "../services/errors";
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
  const th = useTheme();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  const test = async () => {
    const trimmed = url.trim();
    if (!trimmed || testing) return;
    setError("");
    setTested(null);
    setTesting(true);
    try {
      const info = await api.testServer(trimmed);
      setTested(`${info.serverName} · Jellyfin ${info.version}`);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setTesting(false);
    }
  };

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
      setError(errorText(err, t));
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
                onChangeText={(value) => {
                  setUrl(value);
                  setTested(null);
                }}
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
              {tested ? (
                <View style={s.tested} accessibilityLiveRegion="polite">
                  <CircleCheck size={15} color={th.colors.success} />
                  <Text style={s.testedText}>{tested}</Text>
                </View>
              ) : null}
              <Pill variant="primary" size="lg" block label={t("connect")} loading={loading} disabled={!url.trim()} onPress={() => void connect()} />
              <Pill
                variant="tonal"
                size="md"
                block
                icon={Wifi}
                label={t("testConnection")}
                loading={testing}
                disabled={!url.trim() || loading}
                onPress={() => void test()}
                style={{ marginTop: 10 }}
              />
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: help }} onPress={() => setHelp((v) => !v)} style={s.helpToggle}>
                <Text style={s.helpToggleText}>{t("serverHelpTitle")}</Text>
                <ChevronDown size={14} color={th.colors.dim} style={help ? { transform: [{ rotate: "180deg" }] } : null} />
              </Pressable>
              {help ? (
                <View style={s.help}>
                  {(["serverHelpSamePcMobile", "serverHelpLan", "serverHelpRemote", "serverHelpDashboard"] as const).map((key) => (
                    <Text key={key} style={s.helpText}>
                      {t(key)}
                    </Text>
                  ))}
                </View>
              ) : null}
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
  tested: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -8, marginBottom: 14 },
  testedText: { ...text(13), color: t.colors.success, flexShrink: 1 },
  helpToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 16, paddingVertical: 6 },
  helpToggleText: { ...text(13), color: t.colors.dim },
  help: { marginTop: 8, gap: 8, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.25)", padding: 14 },
  helpText: { ...text(12.5, "regular", { lineHeight: 18 }), color: t.colors.muted },
}));
