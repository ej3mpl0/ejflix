import React from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Download, ExternalLink, Info, RefreshCw } from "lucide-react-native";
import { useI18n } from "../../lib/locale-context";
import { useSession } from "../../lib/session-context";
import { formatBytes, useUpdate } from "../../lib/update-context";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { ReleaseNotesCard } from "../update/ReleaseNotesCard";
import { Pill } from "../ui/Pill";
import { ProgressBar } from "../ui/ProgressBar";
import { Toggle } from "../ui/Toggle";
import { SettingsBlock, SettingsRow, SettingsSection } from "./SettingsSection";

/** Settings › Account: version, automatic checks, "check now", download/install and this build's notes. */
export function UpdatesSection() {
  const s = useStyles();
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const { version } = useSession();
  const { check, prefs, phase, progress, checkError, installError, checkNow, downloadAndInstall, skipVersion, setAuto, openRelease } = useUpdate();
  const checking = phase === "checking";
  const busy = phase === "downloading" || phase === "installing";

  let status: { text: string; color: string } | null = null;
  if (checking) status = { text: tr("updateChecking"), color: t.colors.dim };
  else if (checkError) status = { text: tr("updateError", { error: checkError }), color: t.colors.danger };
  else if (check?.available) status = { text: tr("updateFound", { version: check.latest }), color: t.colors.success };
  else if (check) status = { text: tr("updateUpToDate"), color: t.colors.dim };
  else if (prefs.skipped) status = { text: tr("updateSkippedHint", { version: prefs.skipped }), color: t.colors.dim };

  const downloadLabel =
    phase === "downloading"
      ? tr("updateDownloading")
      : phase === "installing"
        ? tr("updateInstalling")
        : check?.assetSize
          ? tr("updateDownloadSize", { size: formatBytes(check.assetSize, locale) })
          : tr("updateDownload");
  const fraction = progress && progress.total > 0 ? progress.received / progress.total : 0;

  return (
    <SettingsSection title={tr("updates")}>
      <SettingsRow label={tr("updateAuto")} hint={tr("updateAutoHint")}>
        <Toggle checked={prefs.auto} onChange={(auto) => void setAuto(auto)} label={tr("updateAuto")} />
      </SettingsRow>
      <SettingsBlock>
        <Text style={s.version}>
          {tr("version")} {version ?? check?.current ?? "—"}
        </Text>
        {status ? <Text style={[s.status, { color: status.color }]}>{status.text}</Text> : null}
        <View style={s.actions}>
          <Pill icon={RefreshCw} label={tr("updateCheckNow")} loading={checking} disabled={busy} onPress={() => void checkNow()} />
          {check?.available ? (
            check.assetUrl ? (
              <Pill variant="primary" icon={Download} label={downloadLabel} loading={busy} onPress={() => void downloadAndInstall()} />
            ) : (
              <Pill variant="primary" icon={ExternalLink} label={tr("updateView")} onPress={openRelease} />
            )
          ) : null}
          {check?.available && !check.skipped && !busy ? <Pill variant="ghost" label={tr("updateSkipVersion")} onPress={() => void skipVersion()} /> : null}
        </View>
        {busy ? (
          <View style={s.progress}>
            <ProgressBar value={fraction} height={4} />
            {progress && progress.total > 0 ? (
              <Text style={s.progressText}>
                {formatBytes(progress.received, locale)} / {formatBytes(progress.total, locale)}
              </Text>
            ) : null}
          </View>
        ) : null}
        {check?.available && !check.assetUrl ? <Text style={s.hint}>{tr(Platform.OS === "ios" ? "updateSideload" : "updateNoAsset")}</Text> : null}
        {installError ? <Text style={[s.hint, { color: t.colors.danger }]}>{tr("updateDownloadError", { error: installError })}</Text> : null}
      </SettingsBlock>
      <SettingsBlock>
        <View style={s.notesHeader}>
          <Info size={13} color={t.colors.dim} strokeWidth={2} />
          <Text style={s.notesTitle}>{tr("releaseNotes")}</Text>
        </View>
        <ReleaseNotesCard size={14} />
        <Pressable accessibilityRole="link" onPress={openRelease} style={({ pressed }) => [s.link, pressed ? { opacity: 0.6 } : null]}>
          <ExternalLink size={14} color={t.colors.muted} strokeWidth={2} />
          <Text style={s.linkText}>{tr("updateViewGithub")}</Text>
        </Pressable>
      </SettingsBlock>
    </SettingsSection>
  );
}

const useStyles = makeStyles((t) => ({
  version: { ...text(14, "medium"), color: t.colors.text },
  status: { ...text(12, "regular", { lineHeight: 16 }), marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  progress: { marginTop: 12, gap: 6 },
  progressText: { ...text(12, "regular", { tabular: true }), color: t.colors.dim },
  hint: { ...text(12, "regular", { lineHeight: 16 }), color: t.colors.dim, marginTop: 10 },
  notesHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 },
  notesTitle: { ...text(13), color: t.colors.dim },
  link: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, alignSelf: "flex-start", marginTop: 8 },
  linkText: { ...text(13), color: t.colors.muted },
}));
