import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import { Plus, Puzzle, Trash2 } from "lucide-react-native";
import type { AddonInfo } from "../../lib/types";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/locale-context";
import { useSettings } from "../../lib/settings-context";
import { useToast } from "../../lib/toast-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { IconButton } from "../ui/IconButton";
import { Pill } from "../ui/Pill";
import { TextField } from "../ui/TextField";
import { Toggle } from "../ui/Toggle";
import { SettingsBlock, SettingsRow, SettingsSection } from "./SettingsSection";

/** Settings › Addons: Stremio addon manifests (catalogs + online sources) and Cinemeta. */
export function AddonsSection() {
  const s = useStyles();
  const t = useTheme();
  const { t: tr } = useI18n();
  const { toast } = useToast();
  const { settings, update } = useSettings();
  const [addons, setAddons] = useState<AddonInfo[] | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const key = `${settings.addons.urls.join("|")}|${settings.addons.cinemeta}`;

  useEffect(() => {
    let alive = true;
    api
      .addonsList()
      .then((list) => {
        if (alive) setAddons(list);
      })
      .catch(() => {
        if (alive) setAddons([]);
      });
    return () => {
      alive = false;
    };
  }, [key]);

  const add = async () => {
    const value = url.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const info = await api.addonAdd(value);
      setUrl("");
      toast(tr("addonAdded", { name: info.name }));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (addon: AddonInfo) => {
    try {
      await api.addonRemove(addon.url);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title={tr("addons")} description={tr("addonsHint")}>
        <SettingsBlock>
          <View style={s.addRow}>
            <TextField
              value={url}
              onChangeText={setUrl}
              placeholder={tr("addonUrlPlaceholder")}
              accessibilityLabel={tr("addAddon")}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
              onSubmitEditing={() => void add()}
              height={44}
              containerStyle={{ flex: 1, minWidth: 0 }}
            />
            <Pill variant="primary" icon={Plus} label={tr("addAddon")} loading={busy} disabled={!url.trim()} onPress={() => void add()} />
          </View>
        </SettingsBlock>
        {addons == null ? (
          <Text style={s.note}>{tr("loading")}…</Text>
        ) : addons.length ? (
          addons.map((addon) => (
            <View key={addon.url} style={s.item}>
              <View style={s.logo}>
                {addon.logo ? (
                  <Image source={{ uri: addon.logo }} contentFit="cover" transition={150} style={s.logoImage} />
                ) : (
                  <Puzzle size={18} color={t.colors.muted} strokeWidth={2} />
                )}
              </View>
              <View style={s.itemText}>
                <View style={s.nameRow}>
                  <Text numberOfLines={1} style={[s.name, { flexShrink: 1 }]}>
                    {addon.name}
                  </Text>
                  {addon.version ? <Text style={s.version}>v{addon.version}</Text> : null}
                  {addon.builtin ? (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{tr("builtinAddon")}</Text>
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={s.meta}>
                  {addon.description || addon.url}
                  {addon.catalogs.length ? ` · ${addon.catalogs.length} ${tr("catalogs")}` : ""}
                  {addon.resources.includes("stream") ? ` · ${tr("streams")}` : ""}
                </Text>
              </View>
              <IconButton icon={Trash2} label={tr("removeAddon")} size={18} onPress={() => void remove(addon)} />
            </View>
          ))
        ) : (
          <Text style={s.note}>{tr("noAddons")}</Text>
        )}
      </SettingsSection>
      <SettingsSection title="Cinemeta">
        <SettingsRow label={tr("cinemetaRow")} hint={tr("cinemetaHint")}>
          <Toggle checked={settings.addons.cinemeta} onChange={(cinemeta) => void update({ addons: { cinemeta } })} label={tr("cinemetaRow")} />
        </SettingsRow>
      </SettingsSection>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  addRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  note: { ...text(13), color: t.colors.dim, paddingVertical: 16 },
  item: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12 },
  logo: { width: 44, height: 44, borderRadius: 12, backgroundColor: t.white(0.06), alignItems: "center", justifyContent: "center", overflow: "hidden" },
  logoImage: { width: "100%", height: "100%" },
  itemText: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { ...text(14, "medium"), color: t.colors.text },
  version: { ...text(11, "regular", { tabular: true }), color: t.colors.dim },
  badge: { borderRadius: 999, backgroundColor: t.white(0.08), paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { ...text(10, "semibold", { tracking: 0.04, uppercase: true }), color: t.colors.muted },
  meta: { ...text(12), color: t.colors.dim, marginTop: 2 },
}));
