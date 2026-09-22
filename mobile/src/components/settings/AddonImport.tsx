import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Check, ClipboardPaste, Download, LogIn } from "lucide-react-native";
import type { ImportedAddon } from "../../lib/types";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/locale-context";
import { useSettings } from "../../lib/settings-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Pill } from "../ui/Pill";
import { SegmentedControl } from "../ui/SegmentedControl";
import { TextField } from "../ui/TextField";

type Source = "stremio" | "paste";

/** Manifest URLs found in free text: one per line, or several mixed with other words. */
function urlsIn(value: string): string[] {
  const found = value.match(/(?:https?|stremio):\/\/[^\s"'<>,]+/gi) ?? [];
  return [...new Set(found.map((url) => url.replace(/[).;]+$/, "")))];
}

/**
 * Brings addons from another app: a Stremio account (its addon collection is read through
 * Stremio's API; the password is never stored) or pasted manifest URLs, which is what
 * Nuvio, Omni and most other Stremio-compatible apps can show or share.
 */
export function AddonImport({ onImported }: { onImported?: (added: number) => void }) {
  const s = useStyles();
  const th = useTheme();
  const { t } = useI18n();
  const { settings } = useSettings();
  const [source, setSource] = useState<Source>("stremio");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [found, setFound] = useState<ImportedAddon[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ added: number; failed: number } | null>(null);
  const installed = new Set(settings.addons.urls);

  const fetchStremio = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const list = await api.stremioAddons(email, password);
      setFound(list);
      setPassword("");
      setPicked(new Set(list.filter((a) => !a.official && !installed.has(a.url)).map((a) => a.url)));
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      setError(
        code === "stremio_auth"
          ? t("stremioErrAuth")
          : code === "stremio_network"
            ? t("stremioErrNetwork")
            : code === "stremio_unexpected"
              ? t("stremioErrUnexpected")
              : code,
      );
    } finally {
      setBusy(false);
    }
  };

  const install = async (urls: string[]) => {
    setBusy(true);
    setError("");
    let added = 0;
    let failed = 0;
    // One after another: each manifest is fetched and validated before it is saved.
    for (const url of urls) {
      try {
        await api.addonAdd(url);
        added += 1;
      } catch {
        failed += 1;
      }
    }
    setBusy(false);
    setResult({ added, failed });
    if (added) onImported?.(added);
  };

  const pastedUrls = urlsIn(pasted);
  const selected = found?.filter((addon) => picked.has(addon.url)) ?? [];

  return (
    <View style={{ gap: 14 }}>
      <SegmentedControl<Source>
        label={t("importFrom")}
        value={source}
        onChange={(next) => {
          setSource(next);
          setError("");
          setResult(null);
        }}
        options={[
          { value: "stremio", label: "Stremio" },
          { value: "paste", label: t("importPaste") },
        ]}
      />

      {source === "stremio" ? (
        found ? (
          <View style={{ gap: 10 }}>
            {found.length ? (
              <View style={s.list}>
                {found.map((addon) => {
                  const have = installed.has(addon.url);
                  const on = have || picked.has(addon.url);
                  return (
                    <Pressable
                      key={addon.url}
                      disabled={have || busy}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: have }}
                      onPress={() => {
                        const next = new Set(picked);
                        if (next.has(addon.url)) next.delete(addon.url);
                        else next.add(addon.url);
                        setPicked(next);
                      }}
                      style={[s.item, have ? { opacity: 0.55 } : null]}
                    >
                      <View style={[s.box, on ? s.boxOn : null]}>{on ? <Check size={13} color={th.colors.onAccent} strokeWidth={3} /> : null}</View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={s.name}>
                          {addon.name}
                        </Text>
                        <Text numberOfLines={1} style={s.meta}>
                          {have ? t("importAlready") : addon.official ? t("importOfficial") : addon.url}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={s.hint}>{t("importNoneFound")}</Text>
            )}
            <View style={s.row}>
              <Pill
                variant="primary"
                icon={Download}
                loading={busy}
                disabled={!selected.length}
                label={t("importSelected", { n: selected.length })}
                onPress={() => void install(selected.map((a) => a.url))}
              />
              <Pill variant="ghost" disabled={busy} label={t("importOtherAccount")} onPress={() => setFound(null)} />
            </View>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <TextField
              label={t("importStremioEmail")}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
            />
            <TextField
              label={t("password")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void fetchStremio()}
            />
            <Text style={s.hint}>{t("importStremioPrivacy")}</Text>
            <Pill
              variant="primary"
              icon={LogIn}
              loading={busy}
              disabled={!email.trim() || !password}
              label={t("importReadAddons")}
              onPress={() => void fetchStremio()}
            />
          </View>
        )
      ) : (
        <View style={{ gap: 10 }}>
          <Text style={s.label}>{t("importPasteLabel")}</Text>
          <TextInput
            value={pasted}
            onChangeText={setPasted}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={"https://…/manifest.json"}
            placeholderTextColor={th.colors.dim}
            style={s.area}
            textAlignVertical="top"
          />
          <Text style={s.hint}>{t("importPasteHint")}</Text>
          <Pill
            variant="primary"
            icon={ClipboardPaste}
            loading={busy}
            disabled={!pastedUrls.length}
            label={t("importSelected", { n: pastedUrls.length })}
            onPress={() => void install(pastedUrls.filter((url) => !installed.has(url)))}
          />
        </View>
      )}

      {error ? <Text style={s.error}>{error}</Text> : null}
      {result ? (
        <Text accessibilityLiveRegion="polite" style={s.hint}>
          {t("importResult", { n: result.added })}
          {result.failed ? <Text style={{ color: th.colors.danger }}> · {t("importFailed", { n: result.failed })}</Text> : null}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  list: { borderRadius: 16, backgroundColor: "rgba(0,0,0,0.25)", padding: 6, gap: 2 },
  item: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 10, paddingVertical: 10, borderRadius: 12 },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: t.white(0.3),
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: t.colors.accent, borderColor: t.colors.accent },
  name: { ...text(14, "medium"), color: t.colors.text },
  meta: { ...text(11), color: t.colors.dim, marginTop: 1 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  label: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.colors.dim },
  area: {
    ...text(12, "regular", { lineHeight: 18 }),
    color: t.colors.text,
    minHeight: 110,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: t.white(0.1),
    backgroundColor: t.white(0.06),
    padding: 12,
  },
  hint: { ...text(12, "regular", { lineHeight: 18 }), color: t.colors.dim },
  error: { ...text(13), color: t.colors.danger },
}));
