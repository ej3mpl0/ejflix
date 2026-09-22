import React, { useState } from "react";
import { Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Link2, LogOut, Pencil, Server, Unlink, Users } from "lucide-react-native";
import { api } from "../../lib/api";
import { sessionAvatar } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { useSession } from "../../lib/session-context";
import { useToast } from "../../lib/toast-context";
import { hasServer, type Session } from "../../lib/types";
import type { MainStackParamList } from "../../navigation/types";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";
import { Avatar } from "../ui/Avatar";
import { Pill } from "../ui/Pill";
import { TextField } from "../ui/TextField";
import { SettingsBlock, SettingsSection } from "./SettingsSection";

/** Settings › Account for a local profile: edit it, link or unlink a Jellyfin account. */
function LocalAccount({ session }: { session: Session }) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { toast } = useToast();
  const { setSession, switchProfile, refreshServer } = useSession();
  const { wide } = useLayout();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [url, setUrl] = useState("http://192.168.1.10:8096");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const linked = hasServer(session);

  const link = async () => {
    if (busy || !url.trim() || !username.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.probeServer(url.trim());
      setSession(await api.linkServer(url.trim(), username.trim(), password));
      setPassword("");
      void refreshServer();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setSession(await api.unlinkServer());
      void refreshServer();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsSection title={tr("account")}>
        <View style={s.identity}>
          <Avatar src={sessionAvatar(session)} name={session.userName} size={56} />
          <View style={s.identityText}>
            <Text numberOfLines={1} style={s.name}>
              {session.userName}
            </Text>
            <Text numberOfLines={1} style={s.meta}>
              {tr("localProfile")}
            </Text>
          </View>
        </View>
        <SettingsBlock style={s.actions}>
          <Pill icon={Pencil} label={tr("editProfile")} onPress={() => navigation.navigate("ProfileEditor", { profileId: session.userId })} />
          <Pill icon={Users} label={tr("switchProfile")} onPress={() => void switchProfile()} />
        </SettingsBlock>
      </SettingsSection>
      <SettingsSection title={tr("jellyfinServer")} description={linked ? tr("serverLinkedHint") : tr("linkServerHint")}>
        {linked ? (
          <>
            <View style={s.identity}>
              <View style={s.serverDisc}>
                <Server size={18} color={t.colors.accent} strokeWidth={2} />
              </View>
              <View style={s.identityText}>
                <Text numberOfLines={1} style={s.serverName}>
                  {session.serverName ?? "Jellyfin"}
                </Text>
                <Text numberOfLines={1} style={s.meta}>
                  {session.serverUrl}
                  {session.jellyfinUserName ? ` · ${session.jellyfinUserName}` : ""}
                </Text>
              </View>
            </View>
            <SettingsBlock style={s.actions}>
              <Pill icon={Unlink} label={tr("disconnectServer")} loading={busy} onPress={() => void unlink()} />
            </SettingsBlock>
          </>
        ) : (
          <SettingsBlock style={{ gap: 12 }}>
            <TextField
              label={tr("jellyfinServer")}
              value={url}
              onChangeText={setUrl}
              placeholder="http://192.168.1.10:8096"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="next"
            />
            <View style={wide ? s.twoCols : { gap: 12 }}>
              <TextField
                label={tr("username")}
                value={username}
                onChangeText={setUsername}
                placeholder={tr("usernamePlaceholder")}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                containerStyle={wide ? { flex: 1 } : null}
              />
              <TextField
                label={tr("password")}
                value={password}
                onChangeText={setPassword}
                placeholder={tr("passwordPlaceholder")}
                secureTextEntry
                autoCapitalize="none"
                returnKeyType="go"
                onSubmitEditing={() => void link()}
                containerStyle={wide ? { flex: 1 } : null}
              />
            </View>
            {error ? <Text style={s.error}>{error}</Text> : null}
            <Pill variant="primary" icon={Link2} label={tr("connect")} loading={busy} disabled={!url.trim() || !username.trim()} onPress={() => void link()} style={{ marginTop: 4 }} />
          </SettingsBlock>
        )}
      </SettingsSection>
    </>
  );
}

/** Settings › Account for a Jellyfin user: who is signed in, switch profile, sign out, change server. */
function JellyfinAccount({ session }: { session: Session }) {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { server, switchProfile, logout, logoutServer } = useSession();
  return (
    <SettingsSection title={tr("account")}>
      <View style={s.identity}>
        <Avatar src={sessionAvatar(session)} name={session.userName} size={56} />
        <View style={s.identityText}>
          <Text numberOfLines={1} style={s.name}>
            {session.userName}
          </Text>
          <View style={s.metaRow}>
            <Server size={13} color={t.colors.dim} strokeWidth={2} />
            <Text numberOfLines={1} style={[s.meta, { flexShrink: 1 }]}>
              {server?.serverName ?? session.serverName ?? "Jellyfin"} · {server?.serverUrl ?? session.serverUrl}
            </Text>
          </View>
        </View>
      </View>
      <SettingsBlock style={s.actions}>
        <Pill icon={Users} label={tr("switchProfile")} onPress={() => void switchProfile()} />
        <Pill icon={LogOut} label={tr("signOut")} onPress={() => void logout()} />
        <Pill icon={Server} label={tr("changeServer")} onPress={() => void logoutServer()} />
      </SettingsBlock>
    </SettingsSection>
  );
}

/** Settings › Account (local profile or Jellyfin user). Updates live in `UpdatesSection`. */
export function AccountSection() {
  const { session } = useSession();
  if (!session) return null;
  return session.mode === "local" ? <LocalAccount session={session} /> : <JellyfinAccount session={session} />;
}

const useStyles = makeStyles((t) => ({
  identity: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12 },
  identityText: { flex: 1, minWidth: 0 },
  name: { ...text(16, "semibold"), color: t.colors.text },
  serverName: { ...text(14, "medium"), color: t.colors.text },
  meta: { ...text(13), color: t.colors.dim, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  serverDisc: { width: 44, height: 44, borderRadius: 12, backgroundColor: t.colors.accentSoft, alignItems: "center", justifyContent: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  twoCols: { flexDirection: "row", gap: 12 },
  error: { ...text(13), color: t.colors.accent },
}));
