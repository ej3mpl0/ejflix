import React, { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft } from "lucide-react-native";
import { makeStyles, useTheme } from "../theme/ThemeProvider";
import { text } from "../theme/typography";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";
import { useSession } from "../lib/session-context";
import type { LocalProfile } from "../lib/types";
import { GrainBackdrop } from "../components/ui/GrainBackdrop";
import { Avatar } from "../components/ui/Avatar";
import { AuthHeader } from "../components/auth/AuthHeader";
import { PinInput } from "../components/profile/PinInput";
import type { AuthScreenProps } from "../navigation/types";

/** PIN prompt for a protected local profile. */
export function PinScreen({ route, navigation }: AuthScreenProps<"Pin">) {
  const s = useStyles();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { t: tr } = useI18n();
  const { locals, refreshLocals, setSession } = useSession();
  const [profile, setProfile] = useState<LocalProfile | null>(() => locals.find((p) => p.id === route.params.profileId) ?? null);
  const [pinError, setPinError] = useState(false);
  const [signing, setSigning] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (profile) return;
    void refreshLocals().then((list) => setProfile(list.find((p) => p.id === route.params.profileId) ?? null));
  }, [profile, refreshLocals, route.params.profileId]);

  const submit = async (pin: string) => {
    if (signing) return;
    setSigning(true);
    setMessage("");
    try {
      setSession(await api.localProfileEnter(route.params.profileId, pin));
    } catch (err) {
      setPinError(true);
      setMessage(tr("wrongPin"));
      setTimeout(() => setPinError(false), 600);
      if (!(err instanceof Error) || !/pin/i.test(err.message)) {
        setMessage(err instanceof Error ? err.message : tr("wrongPin"));
      }
    } finally {
      setSigning(false);
    }
  };

  const name = useMemo(() => profile?.name ?? "", [profile]);

  return (
    <View style={s.root}>
      <GrainBackdrop glow={0.12} cy={0} />
      <AuthHeader />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.fill}>
        <View style={[s.body, { paddingBottom: insets.bottom + 48, paddingHorizontal: Math.max(24, insets.left, insets.right) }]}>
          <Avatar src={profile?.avatar} name={name || "?"} size={96} />
          <Text style={s.title}>{tr("enterPin", { name })}</Text>
          <PinInput error={pinError} disabled={signing || !profile} onSubmit={(pin) => void submit(pin)} />
          <Text style={s.error}>{message}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={tr("back")} onPress={() => navigation.goBack()} style={({ pressed }) => [s.back, pressed ? { opacity: 0.6 } : null]}>
            <ArrowLeft size={15} color={t.colors.dim} strokeWidth={2.2} />
            <Text style={s.backText}>{tr("back")}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base },
  fill: { flex: 1 },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { ...text(28, "semibold", { tracking: -0.025 }), color: t.colors.text, textAlign: "center", marginTop: 20, marginBottom: 32, maxWidth: 480 },
  error: { ...text(13), color: t.colors.accent, marginTop: 16, minHeight: 20, textAlign: "center" },
  back: { marginTop: 24, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 12 },
  backText: { ...text(14), color: t.colors.dim },
}));
