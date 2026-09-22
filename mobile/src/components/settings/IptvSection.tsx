import React, { useCallback, useEffect, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { CircleAlert, EllipsisVertical, FileText, Link2, Pencil, Plus, RefreshCw, Server, Trash2, Upload } from "lucide-react-native";
import type { IptvSource, IptvSourceKind, XtreamAccount } from "../../lib/types";
import { api } from "../../lib/api";
import { formatAgo } from "../../lib/iptv";
import { useI18n } from "../../lib/locale-context";
import { useSettings } from "../../lib/settings-context";
import { useToast } from "../../lib/toast-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { useLayout } from "../../theme/responsive";
import { text } from "../../theme/typography";
import { ActionSheet } from "../ui/ActionSheet";
import { IconButton } from "../ui/IconButton";
import { Pill } from "../ui/Pill";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Spinner } from "../ui/Spinner";
import { TextField } from "../ui/TextField";
import { Toggle } from "../ui/Toggle";
import { SettingsBlock, SettingsRow, SettingsSection } from "./SettingsSection";

type Form = {
  id: string | null;
  name: string;
  kind: IptvSourceKind;
  url: string;
  username: string;
  password: string;
  epgUrl: string;
  output: "ts" | "m3u8";
  userAgent: string;
  includeVod: boolean;
  enabled: boolean;
  /** Content of a playlist picked with the document picker (imported on save). */
  fileText: string | null;
  fileName: string;
};

const EMPTY: Form = {
  id: null,
  name: "",
  kind: "m3uUrl",
  url: "",
  username: "",
  password: "",
  epgUrl: "",
  output: Platform.OS === "ios" ? "m3u8" : "ts",
  userAgent: "",
  includeVod: false,
  enabled: true,
  fileText: null,
  fileName: "",
};

const PLAYLIST_TYPES = ["audio/x-mpegurl", "application/x-mpegurl", "application/vnd.apple.mpegurl", "text/plain", "*/*"];

function formOf(source: IptvSource): Form {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    url: source.url,
    username: source.username,
    password: "",
    epgUrl: source.epgUrl,
    output: source.output === "m3u8" ? "m3u8" : "ts",
    userAgent: source.userAgent,
    includeVod: source.includeVod,
    enabled: source.enabled,
    fileText: null,
    fileName: source.imported ? source.path : "",
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Settings › IPTV: playlists (M3U by URL or file), Xtream Codes accounts, guide and preferences. */
export function IptvSection() {
  const s = useStyles();
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const { toast } = useToast();
  const { settings, update } = useSettings();
  const { wide } = useLayout();
  const prefs = settings.iptv;
  const [sources, setSources] = useState<IptvSource[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [account, setAccount] = useState<XtreamAccount | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [menu, setMenu] = useState<IptvSource | null>(null);

  const load = useCallback(async () => {
    try {
      setSources((await api.iptvStatus()).sources);
    } catch {
      setSources([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const unlisten = api.onIptvChanged(() => void load());
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [load]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));

  const openForm = (next: Form) => {
    setForm(next);
    setError("");
    setAccount(null);
  };

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: PLAYLIST_TYPES, copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const content = await new File(asset.uri).text();
      const fileName = asset.name || "playlist.m3u";
      setForm((f) => (f ? { ...f, fileText: content, fileName, name: f.name || fileName.replace(/\.[^.]+$/, "") } : f));
      setError("");
    } catch {
      setError(tr("iptvFileError"));
    }
  };

  const save = async () => {
    if (!form || busy) return;
    setBusy(true);
    setError("");
    try {
      let id = form.id;
      if (form.kind === "m3uFile" && form.fileText != null) {
        const imported = await api.iptvSourceImport({ id, name: form.name, fileName: form.fileName, text: form.fileText });
        id = imported.id;
      }
      const saved = await api.iptvSourceSave({
        id,
        name: form.name,
        kind: form.kind,
        url: form.url,
        path: "",
        username: form.username,
        password: form.password || null,
        epgUrl: form.epgUrl,
        output: form.output,
        userAgent: form.userAgent,
        includeVod: form.includeVod,
        enabled: form.enabled,
      });
      setForm(null);
      setAccount(null);
      toast(tr("iptvSaved", { name: saved.name }));
      void load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    if (!form || checking) return;
    setChecking(true);
    setError("");
    setAccount(null);
    try {
      setAccount(await api.iptvXtreamCheck({ url: form.url, username: form.username, password: form.password, userAgent: form.userAgent }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setChecking(false);
    }
  };

  const remove = async (source: IptvSource) => {
    setConfirmId(null);
    try {
      await api.iptvSourceRemove(source.id);
      if (form?.id === source.id) setForm(null);
      void load();
    } catch (err) {
      toast(errorText(err));
    }
  };

  const refresh = (source: IptvSource) => {
    api.iptvRefresh(source.id).catch((err) => toast(errorText(err)));
  };

  const kindLabel = (kind: IptvSourceKind) => (kind === "xtream" ? tr("iptvKindXtream") : kind === "m3uFile" ? tr("iptvKindM3uFile") : tr("iptvKindM3uUrl"));
  const KindIcon = kindIcon;

  const accountLine = (info: XtreamAccount) => {
    const parts = [
      info.status.toLowerCase() === "active" ? tr("iptvAccountActive") : info.status,
      info.expiresMs ? tr("iptvAccountExpires", { date: new Date(info.expiresMs).toLocaleDateString(locale === "en" ? "en-GB" : "es-ES") }) : null,
      info.maxConnections != null
        ? tr("iptvAccountConnections", { n: info.activeConnections != null ? `${info.activeConnections}/${info.maxConnections}` : String(info.maxConnections) })
        : null,
      info.trial ? tr("iptvAccountTrial") : null,
    ];
    return parts.filter(Boolean).join(" · ");
  };

  const statusLine = (source: IptvSource) => {
    if (source.loading) return tr("iptvDownloading");
    if (source.error) return source.error;
    if (!source.channelCount) return tr("iptvNotLoaded");
    const parts = [
      tr("iptvChannels", { n: source.channelCount }),
      tr("iptvGroups", { n: source.groupCount }),
      source.epgChannels ? tr("iptvEpgChannels", { n: source.epgChannels }) : source.epgError ? tr("iptvEpgError") : tr("iptvEpgNone"),
      source.updatedMs ? tr("iptvUpdated", { time: formatAgo(source.updatedMs, locale) }) : null,
    ];
    return parts.filter(Boolean).join(" · ");
  };

  const canSave =
    !!form &&
    !busy &&
    !(form.kind === "m3uUrl" && !form.url.trim()) &&
    !(form.kind === "xtream" && (!form.url.trim() || !form.username.trim() || (!form.password && !form.id))) &&
    !(form.kind === "m3uFile" && form.fileText == null && !form.fileName);

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title={tr("iptv")} description={tr("iptvHint")}>
        {sources == null ? (
          <Text style={s.note}>{tr("loading")}…</Text>
        ) : sources.length ? (
          sources.map((source) => (
            <View key={source.id} style={[s.item, !source.enabled ? { opacity: t.opacity.muted } : null]}>
              <View style={s.itemRow}>
                <View style={s.kindDisc}>
                  <KindIcon kind={source.kind} color={t.colors.accent} />
                </View>
                <View style={s.itemText}>
                  <View style={s.nameRow}>
                    <Text numberOfLines={1} style={[s.name, { flexShrink: 1 }]}>
                      {source.name}
                    </Text>
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{kindLabel(source.kind)}</Text>
                    </View>
                    {!source.enabled ? (
                      <View style={s.badge}>
                        <Text style={s.badgeText}>{tr("iptvDisabled")}</Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={s.statusRow}>
                    {source.loading ? <Spinner size={12} color={t.colors.dim} /> : source.error ? <CircleAlert size={12} color={t.colors.accent} strokeWidth={2.2} /> : null}
                    <Text numberOfLines={2} style={[s.meta, source.error ? { color: t.colors.accent } : null, { flexShrink: 1 }]}>
                      {statusLine(source)}
                    </Text>
                  </View>
                  {source.account ? (
                    <Text numberOfLines={1} style={s.meta}>
                      {accountLine(source.account)}
                    </Text>
                  ) : null}
                </View>
                {wide ? (
                  <View style={s.actions}>
                    <IconButton icon={RefreshCw} label={tr("iptvRefresh")} size={17} disabled={source.loading || !source.enabled} onPress={() => refresh(source)} />
                    <IconButton icon={Pencil} label={tr("edit")} size={17} onPress={() => openForm(formOf(source))} />
                    <IconButton icon={Trash2} label={tr("iptvRemove")} size={17} onPress={() => setConfirmId(source.id)} />
                  </View>
                ) : (
                  <IconButton icon={EllipsisVertical} label={`${tr("edit")} ${source.name}`} size={19} onPress={() => setMenu(source)} />
                )}
              </View>
              {confirmId === source.id ? (
                <View style={s.confirmRow}>
                  <Text style={s.confirmText}>{tr("iptvRemove")} · {source.name}</Text>
                  <Pill variant="primary" size="sm" label={tr("delete")} onPress={() => void remove(source)} />
                  <Pill size="sm" label={tr("cancel")} onPress={() => setConfirmId(null)} />
                </View>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={s.note}>{tr("iptvNoSourcesYet")}</Text>
        )}
        {!form ? (
          <SettingsBlock>
            <Pill variant="primary" icon={Plus} label={tr("iptvAddSource")} onPress={() => openForm({ ...EMPTY })} />
          </SettingsBlock>
        ) : null}
      </SettingsSection>

      {form ? (
        <SettingsSection title={form.id ? tr("iptvEditSource") : tr("iptvAddSource")}>
          <SettingsBlock style={{ gap: 16 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20 }}>
              <SegmentedControl<IptvSourceKind>
                label={tr("iptvKind")}
                value={form.kind}
                options={[
                  { value: "m3uUrl", label: tr("iptvKindM3uUrl") },
                  { value: "m3uFile", label: tr("iptvKindM3uFile") },
                  { value: "xtream", label: tr("iptvKindXtream") },
                ]}
                onChange={(kind) => {
                  set("kind", kind);
                  setAccount(null);
                }}
              />
            </ScrollView>

            <TextField label={tr("iptvSourceName")} value={form.name} onChangeText={(v) => set("name", v)} placeholder={tr("iptvSourceNamePlaceholder")} returnKeyType="next" />

            {form.kind === "m3uUrl" ? (
              <TextField
                label={tr("iptvUrl")}
                value={form.url}
                onChangeText={(v) => set("url", v)}
                placeholder={tr("iptvUrlPlaceholder")}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            ) : null}

            {form.kind === "m3uFile" ? (
              <View style={s.fileRow}>
                <Pill icon={Upload} label={tr("iptvChooseFile")} onPress={() => void pickFile()} />
                {form.fileName ? (
                  <Text numberOfLines={1} style={s.fileName}>
                    {tr("iptvFileChosen", { name: form.fileName })}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {form.kind === "xtream" ? (
              <>
                <TextField
                  label={tr("iptvXtreamUrl")}
                  value={form.url}
                  onChangeText={(v) => set("url", v)}
                  placeholder="http://servidor.tv:8080"
                  hint={tr("iptvXtreamUrlHint")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <View style={wide ? s.twoCols : null}>
                  <TextField
                    label={tr("username")}
                    value={form.username}
                    onChangeText={(v) => set("username", v)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    containerStyle={wide ? { flex: 1 } : null}
                  />
                  <TextField
                    label={tr("password")}
                    value={form.password}
                    onChangeText={(v) => set("password", v)}
                    placeholder={form.id ? tr("iptvPasswordKeep") : ""}
                    secureTextEntry
                    autoCapitalize="none"
                    autoComplete="off"
                    containerStyle={wide ? { flex: 1 } : { marginTop: 16 }}
                  />
                </View>
                <View style={s.checkRow}>
                  <Pill icon={Server} label={checking ? tr("iptvChecking") : tr("iptvCheck")} loading={checking} disabled={!form.url.trim()} onPress={() => void check()} />
                  {account ? <Text style={s.accountText}>{accountLine(account)}</Text> : null}
                </View>
                {/* iOS always plays Xtream live channels as HLS (see `streamFor`). */}
                {Platform.OS === "ios" ? null : (
                <SettingsRow label={tr("iptvOutput")} hint={tr("iptvOutputHint")}>
                  <SegmentedControl<"ts" | "m3u8">
                    label={tr("iptvOutput")}
                    size="sm"
                    value={form.output}
                    options={[
                      { value: "ts", label: tr("iptvOutputTs") },
                      { value: "m3u8", label: tr("iptvOutputHls") },
                    ]}
                    onChange={(output) => set("output", output)}
                  />
                </SettingsRow>
                )}
                <SettingsRow label={tr("iptvIncludeVod")} hint={tr("iptvIncludeVodHint")}>
                  <Toggle checked={form.includeVod} onChange={(v) => set("includeVod", v)} label={tr("iptvIncludeVod")} />
                </SettingsRow>
              </>
            ) : null}

            <TextField
              label={tr("iptvEpgUrl")}
              value={form.epgUrl}
              onChangeText={(v) => set("epgUrl", v)}
              placeholder="https://…/guide.xml.gz"
              hint={form.kind === "xtream" ? tr("iptvEpgHintXtream") : tr("iptvEpgHint")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TextField
              label={tr("iptvUserAgent")}
              value={form.userAgent}
              onChangeText={(v) => set("userAgent", v)}
              placeholder="VLC/3.0.20 LibVLC/3.0.20"
              hint={tr("iptvUserAgentHint")}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {form.id ? (
              <SettingsRow label={tr("iptvEnabled")} hint={tr("iptvEnabledHint")}>
                <Toggle checked={form.enabled} onChange={(v) => set("enabled", v)} label={tr("iptvEnabled")} />
              </SettingsRow>
            ) : null}

            {error ? (
              <View style={s.errorRow}>
                <CircleAlert size={14} color={t.colors.accent} strokeWidth={2.2} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}
            <View style={s.formActions}>
              <Pill variant="primary" label={tr("save")} loading={busy} disabled={!canSave} onPress={() => void save()} />
              <Pill
                label={tr("cancel")}
                disabled={busy}
                onPress={() => {
                  setForm(null);
                  setError("");
                  setAccount(null);
                }}
              />
            </View>
          </SettingsBlock>
        </SettingsSection>
      ) : null}

      <SettingsSection title={tr("iptvPrefs")}>
        <SettingsRow label={tr("iptvAutoRefresh")} hint={tr("iptvAutoRefreshHint")}>
          <Toggle checked={prefs.autoRefresh} onChange={(autoRefresh) => void update({ iptv: { autoRefresh } })} label={tr("iptvAutoRefresh")} />
        </SettingsRow>
        <SettingsRow label={tr("iptvEpgEnabled")} hint={tr("iptvEpgEnabledHint")}>
          <Toggle checked={prefs.epg} onChange={(epg) => void update({ iptv: { epg } })} label={tr("iptvEpgEnabled")} />
        </SettingsRow>
      </SettingsSection>

      <ActionSheet
        visible={menu != null}
        onClose={() => setMenu(null)}
        title={menu?.name}
        subtitle={menu ? kindLabel(menu.kind) : undefined}
        actions={
          menu
            ? [
                { key: "refresh", label: tr("iptvRefresh"), icon: RefreshCw, disabled: menu.loading || !menu.enabled, onPress: () => refresh(menu) },
                { key: "edit", label: tr("edit"), icon: Pencil, onPress: () => openForm(formOf(menu)) },
                { key: "remove", label: tr("iptvRemove"), icon: Trash2, destructive: true, onPress: () => setConfirmId(menu.id) },
              ]
            : []
        }
      />
    </View>
  );
}

function kindIcon({ kind, color }: { kind: IptvSourceKind; color: string }) {
  if (kind === "xtream") return <Server size={18} color={color} strokeWidth={2} />;
  if (kind === "m3uFile") return <FileText size={18} color={color} strokeWidth={2} />;
  return <Link2 size={18} color={color} strokeWidth={2} />;
}

const useStyles = makeStyles((t) => ({
  note: { ...text(13), color: t.colors.dim, paddingVertical: 16 },
  item: { paddingVertical: 12 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  kindDisc: { width: 44, height: 44, borderRadius: 12, backgroundColor: t.colors.accentSoft, alignItems: "center", justifyContent: "center" },
  itemText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  name: { ...text(14, "medium"), color: t.colors.text },
  badge: { borderRadius: 999, backgroundColor: t.white(0.08), paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { ...text(10, "semibold", { tracking: 0.04, uppercase: true }), color: t.colors.muted },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  meta: { ...text(12, "regular", { lineHeight: 16 }), color: t.colors.dim },
  actions: { flexDirection: "row", alignItems: "center" },
  confirmRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 10, paddingLeft: 56 },
  confirmText: { ...text(13), color: t.colors.muted, flexBasis: "100%" },
  fileRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 },
  fileName: { ...text(13), color: t.colors.muted, flexShrink: 1 },
  twoCols: { flexDirection: "row", gap: 12 },
  checkRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 },
  accountText: { ...text(13), color: t.colors.muted, flexShrink: 1 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorText: { ...text(13), color: t.colors.accent, flex: 1 },
  formActions: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingTop: 4 },
}));
