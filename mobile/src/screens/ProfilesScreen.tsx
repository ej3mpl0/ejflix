import React, { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Pencil, Plus, Server, UserRoundPlus, X } from "lucide-react-native";
import { makeStyles, useTheme } from "../theme/ThemeProvider";
import { useLayout } from "../theme/responsive";
import { text } from "../theme/typography";
import { api } from "../lib/api";
import { useI18n } from "../lib/locale-context";
import { useSession } from "../lib/session-context";
import type { LocalProfile, PublicUser } from "../lib/types";
import { GrainBackdrop } from "../components/ui/GrainBackdrop";
import { Spinner } from "../components/ui/Spinner";
import { TextField } from "../components/ui/TextField";
import { Pill } from "../components/ui/Pill";
import { IconButton } from "../components/ui/IconButton";
import { AuthHeader } from "../components/auth/AuthHeader";
import { ProfileTile, avatarHue } from "../components/profile/ProfileTile";
import { useBackHandler } from "../navigation/useBackHandler";
import type { AuthScreenProps } from "../navigation/types";

const MAX_LOCAL = 8;

/**
 * Who is watching: local (online) profiles first, then the users of the saved Jellyfin
 * server. Local profiles can be created, edited (long-press or edit mode) and opened.
 */
export function ProfilesScreen({ navigation }: AuthScreenProps<"Profiles">) {
  const s = useStyles();
  const t = useTheme();
  const l = useLayout();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const { t: tr } = useI18n();
  const { server, locals, refreshLocals, setSession, setGate, logoutServer } = useSession();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<PublicUser | null>(null);
  const [manual, setManual] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [signing, setSigning] = useState(false);
  const [editing, setEditing] = useState(false);
  const tileSize = l.wide ? 116 : 100;

  useFocusEffect(
    useCallback(() => {
      void refreshLocals();
    }, [refreshLocals]),
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const job = server
      ? api
          .listPublicUsers(server.serverUrl)
          .then((list) => {
            if (!cancelled) setUsers(list);
          })
          .catch((err) => {
            if (!cancelled) setError(err instanceof Error ? err.message : String(err));
          })
      : Promise.resolve(setUsers([]));
    void job.finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [server]);

  const showForm = !!server && (manual || selected != null);
  const closeForm = () => {
    setSelected(null);
    setManual(false);
    setError("");
  };

  useBackHandler(editing || showForm, () => {
    if (showForm) closeForm();
    else setEditing(false);
    return true;
  });

  const signIn = async (name: string, pw: string) => {
    if (!server) return;
    setError("");
    setSigning(true);
    try {
      setSession(await api.login(server.serverUrl, name.trim(), pw));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigning(false);
    }
  };

  const pick = (user: PublicUser) => {
    setError("");
    setPassword("");
    setUsername(user.name);
    setManual(false);
    if (!user.hasPassword) {
      void signIn(user.name, "");
      return;
    }
    setSelected(user);
  };

  const openEditor = (profile: LocalProfile) => navigation.navigate("ProfileEditor", { profileId: profile.id, from: "profiles" });

  const enterLocal = async (profile: LocalProfile) => {
    if (editing) {
      openEditor(profile);
      return;
    }
    if (profile.hasPin) {
      navigation.navigate("Pin", { profileId: profile.id });
      return;
    }
    setSigning(true);
    try {
      setSession(await api.localProfileEnter(profile.id, null));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigning(false);
    }
  };

  const canAddLocal = locals.length < MAX_LOCAL;
  const title = selected ? tr("helloName", { name: selected.name }) : tr("whoIsWatching");

  return (
    <View style={s.root}>
      <GrainBackdrop glow={0.12} cy={0} />
      <AuthHeader />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.fill}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 40, paddingHorizontal: Math.max(24, insets.left, insets.right) }]}
        >
          <Text style={[s.title, l.sizeClass === "compact" ? { fontSize: 28, lineHeight: 34 } : null]}>{title}</Text>

          {loading ? (
            <Spinner size={28} color={t.colors.muted} />
          ) : (
            <>
              <View style={s.grid}>
                {locals.map((profile, index) => (
                  <ProfileTile
                    key={profile.id}
                    name={profile.name}
                    avatar={profile.avatar}
                    size={tileSize}
                    locked={profile.hasPin}
                    editing={editing}
                    disabled={signing}
                    delay={index * 80}
                    onPress={() => void enterLocal(profile)}
                    onLongPress={() => openEditor(profile)}
                  />
                ))}
                {canAddLocal ? (
                  <ProfileTile
                    name={tr("newProfile")}
                    icon={Plus}
                    size={tileSize}
                    disabled={signing}
                    delay={locals.length * 80}
                    onPress={() => navigation.navigate("ProfileEditor", { from: "profiles" })}
                  />
                ) : null}
              </View>

              {server ? (
                <>
                  <View style={s.sectionHead}>
                    <Server size={13} color={t.colors.dim} strokeWidth={2.2} />
                    <Text style={s.sectionLabel}>{tr("jellyfinUsers", { server: server.serverName })}</Text>
                  </View>
                  <View style={s.grid}>
                    {users.map((user, index) => (
                      <ProfileTile
                        key={user.id}
                        name={user.name}
                        imageUrl={user.avatarUrl}
                        hue={avatarHue(user.name)}
                        size={tileSize}
                        locked={user.hasPassword}
                        selected={selected?.id === user.id}
                        disabled={signing}
                        delay={index * 80}
                        onPress={() => pick(user)}
                      />
                    ))}
                    <ProfileTile
                      name={tr("otherUser")}
                      icon={UserRoundPlus}
                      size={tileSize}
                      disabled={signing}
                      delay={users.length * 80}
                      onPress={() => {
                        setSelected(null);
                        setUsername("");
                        setPassword("");
                        setError("");
                        setManual(true);
                      }}
                    />
                  </View>
                </>
              ) : null}
            </>
          )}

          {showForm && !loading ? (
            <Animated.View entering={reduced ? undefined : FadeIn.duration(240)} style={s.form}>
              {manual || !selected ? (
                <TextField
                  label={tr("username")}
                  value={username}
                  onChangeText={setUsername}
                  placeholder={tr("usernamePlaceholder")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus={!selected}
                  returnKeyType="next"
                  containerStyle={{ marginBottom: 16 }}
                />
              ) : null}
              <TextField
                label={tr("password")}
                value={password}
                onChangeText={setPassword}
                placeholder={tr("passwordPlaceholder")}
                secureTextEntry
                autoFocus={selected != null}
                returnKeyType="go"
                onSubmitEditing={() => void signIn(selected?.name || username, password)}
                error={error || null}
                containerStyle={{ marginBottom: 16 }}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pill
                  variant="primary"
                  size="lg"
                  label={tr("signIn")}
                  loading={signing}
                  disabled={!(selected?.name || username.trim())}
                  onPress={() => void signIn(selected?.name || username, password)}
                  style={{ flex: 1 }}
                />
                <IconButton icon={X} label={tr("cancel")} variant="tonal" hit={48} onPress={closeForm} style={{ borderRadius: t.radii.btn }} />
              </View>
            </Animated.View>
          ) : error && !loading ? (
            <Text style={s.error}>{error}</Text>
          ) : null}

          {!loading ? (
            <View style={s.footer}>
              {locals.length ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setEditing((v) => !v)}
                  style={({ pressed }) => [s.footerBtn, editing ? s.footerBtnOn : null, pressed ? { opacity: 0.7 } : null]}
                >
                  <Pencil size={14} color={editing ? t.colors.text : t.colors.dim} strokeWidth={2.2} />
                  <Text style={[s.footerText, editing ? { color: t.colors.text } : null]}>{editing ? tr("done") : tr("editProfiles")}</Text>
                </Pressable>
              ) : null}
              {server ? (
                <Pressable accessibilityRole="button" onPress={() => void logoutServer()} style={({ pressed }) => [s.footerBtn, pressed ? { opacity: 0.7 } : null]}>
                  <Text style={s.footerText}>{tr("changeServer")}</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setGate("login");
                    navigation.navigate("Login");
                  }}
                  style={({ pressed }) => [s.footerBtn, pressed ? { opacity: 0.7 } : null]}
                >
                  <Server size={14} color={t.colors.dim} strokeWidth={2.2} />
                  <Text style={s.footerText}>{tr("connectServer")}</Text>
                </Pressable>
              )}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.base },
  fill: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: "center", paddingTop: 16 },
  title: { ...text(36, "semibold", { tracking: -0.025 }), color: t.colors.text, textAlign: "center", marginBottom: 36, maxWidth: 560 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12, maxWidth: 720 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 44, marginBottom: 20 },
  sectionLabel: { ...text(11, "semibold", { tracking: 0.14, uppercase: true }), color: t.colors.dim },
  form: { marginTop: 36, width: "100%", maxWidth: 340 },
  error: { ...text(14), color: t.colors.accent, marginTop: 28, textAlign: "center" },
  footer: { marginTop: 44, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 8 },
  footerBtn: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 16, borderRadius: t.radii.pill },
  footerBtnOn: { backgroundColor: t.white(0.12) },
  footerText: { ...text(14), color: t.colors.dim },
}));
