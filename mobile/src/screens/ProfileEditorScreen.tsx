import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { makeStyles } from "../theme/ThemeProvider";
import { text } from "../theme/typography";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";
import { useSession } from "../lib/session-context";
import { useToast } from "../lib/toast-context";
import type { LocalProfile } from "../lib/types";
import { GrainBackdrop } from "../components/ui/GrainBackdrop";
import { CardSurface } from "../components/ui/CardSurface";
import { Spinner } from "../components/ui/Spinner";
import { AuthHeader } from "../components/auth/AuthHeader";
import { ProfileForm } from "../components/profile/ProfileForm";

type EditorParams = { profileId?: string; from?: "welcome" | "profiles" };

/**
 * Create / edit a local profile. Lives in both stacks: in Auth (`from` decides where
 * cancel goes, a new profile is entered right away) and in Main (edit the active one).
 */
export function ProfileEditorScreen() {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<Record<string, EditorParams>, string>>();
  const params = route.params ?? {};
  const { t } = useI18n();
  const { toast } = useToast();
  const { session, locals, refreshLocals, setSession, setGate, switchProfile } = useSession();
  const [initial, setInitial] = useState<LocalProfile | null | undefined>(() =>
    params.profileId ? (locals.find((p) => p.id === params.profileId) ?? undefined) : null,
  );
  const creating = !params.profileId;
  const inAuth = session == null;

  useEffect(() => {
    if (initial !== undefined) return;
    void refreshLocals().then((list) => setInitial(list.find((p) => p.id === params.profileId) ?? null));
  }, [initial, params.profileId, refreshLocals]);

  const leave = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    if (inAuth) {
      const target = params.from === "welcome" && !locals.length ? "welcome" : "profiles";
      setGate(target);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigation as any).replace(target === "welcome" ? "Welcome" : "Profiles");
    }
  };

  const saved = (profile: LocalProfile, pin: string | null) => {
    void refreshLocals();
    if (creating && inAuth) {
      api
        .localProfileEnter(profile.id, pin)
        .then(setSession)
        .catch((err) => {
          toast(err instanceof Error ? err.message : String(err));
          setGate("profiles");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (navigation as any).replace("Profiles");
        });
      return;
    }
    if (!inAuth && session && profile.id === session.userId) {
      // Name / avatar of the active profile changed: refresh what the header shows.
      setSession({ ...session, userName: profile.name, avatarUrl: profile.avatar });
    }
    leave();
  };

  const deleted = (profile: LocalProfile) => {
    void refreshLocals();
    if (!inAuth && session && profile.id === session.userId) {
      void switchProfile();
      return;
    }
    leave();
  };

  return (
    <View style={s.root}>
      <GrainBackdrop glow={0.12} cy={0} />
      <AuthHeader onBack={leave} showLanguage={inAuth} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.fill}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32, paddingHorizontal: Math.max(24, insets.left, insets.right) }]}
        >
          <Animated.View entering={reduced ? undefined : FadeIn.duration(240)} style={s.cardWrap}>
            <CardSurface style={s.card}>
              <Text style={s.title}>{creating ? t("newProfile") : t("editProfile")}</Text>
              {creating ? <Text style={s.hint}>{t("optionOnlineHint")}</Text> : <View style={{ height: 16 }} />}
              {initial === undefined ? (
                <View style={{ alignItems: "center", paddingVertical: 40 }}>
                  <Spinner />
                </View>
              ) : (
                <ProfileForm initial={initial} onCancel={leave} onSaved={saved} onDeleted={!creating ? deleted : undefined} />
              )}
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
  scroll: { flexGrow: 1, alignItems: "center", paddingTop: 8 },
  cardWrap: { width: "100%", maxWidth: 460 },
  card: { padding: 24 },
  title: { ...text(24, "semibold", { tracking: -0.025 }), color: t.colors.text, marginBottom: 4 },
  hint: { ...text(13), color: t.colors.dim, marginBottom: 24 },
}));
