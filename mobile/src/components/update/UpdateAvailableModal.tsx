import React, { useMemo } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Download, ExternalLink } from "lucide-react-native";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { useI18n } from "../../lib/locale-context";
import { formatBytes, useUpdates } from "../../lib/update-context";
import { Logo } from "../ui/Logo";
import { Pill } from "../ui/Pill";
import { Spinner } from "../ui/Spinner";
import { ModalCard } from "../ui/ModalCard";
import { PressableScale } from "../ui/PressableScale";

export type NoteBlock = { kind: "heading" | "bullet" | "text"; text: string };

/** Minimal markdown for GitHub release bodies: headings, bullets and paragraphs. */
export function parseNotes(markdown: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const plain = line
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\[(.+?)\]\((.+?)\)/g, "$1");
    if (/^#{1,6}\s/.test(plain)) blocks.push({ kind: "heading", text: plain.replace(/^#{1,6}\s+/, "") });
    else if (/^[-*•]\s/.test(plain)) blocks.push({ kind: "bullet", text: plain.replace(/^[-*•]\s+/, "") });
    else blocks.push({ kind: "text", text: plain });
  }
  // Drop a leading "# ejFlix x.y.z" heading: the dialog already says the version.
  if (blocks[0]?.kind === "heading" && /^ejflix\b/i.test(blocks[0].text)) blocks.shift();
  return blocks;
}

/** "A new version is available" dialog: notes from GitHub, download with progress, skip or later. */
export function UpdateAvailableModal() {
  const s = useStyles();
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const { check, phase, progress, installError, downloadAndInstall, skipVersion, later, openRelease } = useUpdates();
  const blocks = useMemo(() => parseNotes(check?.notes ?? ""), [check?.notes]);
  if (!check) return null;

  const working = phase === "downloading" || phase === "installing";
  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
  const fill = phase === "installing" ? 100 : percent;
  const primaryLabel =
    phase === "installing"
      ? tr("updateInstalling")
      : phase === "downloading"
        ? tr("updateDownloading", { percent })
        : check.assetSize
          ? tr("updateDownloadSize", { size: formatBytes(check.assetSize, locale) })
          : tr("updateDownload");

  return (
    <ModalCard visible width={520} onClose={working ? undefined : later}>
      <View style={s.body}>
        <View style={{ alignItems: "center", marginBottom: 20 }}>
          <Logo size="login" />
        </View>
        <Text style={s.kicker}>{tr("update")}</Text>
        <Text style={s.title}>{tr("updateAvailable")}</Text>
        <Text style={s.hint}>{tr("updateAvailableHint", { version: check.latest, current: check.current })}</Text>

        {blocks.length ? (
          <ScrollView style={s.notes} contentContainerStyle={s.notesInner} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            {blocks.map((block, i) =>
              block.kind === "heading" ? (
                <Text key={i} style={[s.noteHeading, i > 0 ? { marginTop: 12 } : null]}>
                  {block.text}
                </Text>
              ) : block.kind === "bullet" ? (
                <View key={i} style={s.bullet}>
                  <View style={s.dot} />
                  <Text style={s.noteText}>{block.text}</Text>
                </View>
              ) : (
                <Text key={i} style={s.noteText}>
                  {block.text}
                </Text>
              ),
            )}
          </ScrollView>
        ) : null}

        {check.assetUrl ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
            accessibilityState={{ busy: working }}
            disabled={working}
            onPress={() => void downloadAndInstall()}
            style={s.download}
          >
            {working ? <View pointerEvents="none" style={[s.downloadFill, { width: `${fill}%` }]} /> : null}
            <View style={s.downloadInner}>
              {working ? <Spinner size={16} color={t.colors.onAccent} /> : <Download size={16} color={t.colors.onAccent} strokeWidth={2.2} />}
              <Text style={[s.downloadLabel, { color: t.colors.onAccent }]}>{primaryLabel}</Text>
            </View>
          </PressableScale>
        ) : (
          <Pill variant="primary" size="lg" block icon={ExternalLink} label={tr("updateViewGithub")} onPress={openRelease} />
        )}
        <Text style={[s.footnote, installError ? { color: t.colors.danger } : null]}>
          {installError ? tr("updateDownloadError", { error: installError }) : check.assetUrl ? tr("updateInstallHint") : tr(Platform.OS === "ios" ? "updateSideload" : "updateNoAsset")}
        </Text>

        <View style={s.actions}>
          <Pressable accessibilityRole="link" onPress={openRelease} hitSlop={8} style={s.linkBtn}>
            <Text style={[s.link, { color: t.colors.muted }]}>{tr("updateViewGithub")}</Text>
          </Pressable>
          <View style={{ flexDirection: "row", gap: 20 }}>
            <Pressable accessibilityRole="button" disabled={working} onPress={() => void skipVersion()} hitSlop={8} style={[s.linkBtn, working ? { opacity: 0.5 } : null]}>
              <Text style={[s.link, { color: t.colors.dim }]}>{tr("updateSkipVersion")}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={working} onPress={later} hitSlop={8} style={[s.linkBtn, working ? { opacity: 0.5 } : null]}>
              <Text style={[s.link, text(13, "semibold"), { color: t.colors.text }]}>{tr("updateLater")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ModalCard>
  );
}

const useStyles = makeStyles((t) => ({
  body: { padding: 28 },
  kicker: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.colors.dim, textAlign: "center", marginBottom: 4 },
  title: { ...text(22, "semibold"), color: t.colors.text, textAlign: "center", marginBottom: 8 },
  hint: { ...text(14), color: t.colors.muted, textAlign: "center", marginBottom: 20 },
  notes: { maxHeight: 220, borderRadius: t.radii.btn, backgroundColor: t.black(0.25), marginBottom: 24 },
  notesInner: { paddingHorizontal: 16, paddingVertical: 12, gap: 6 },
  noteHeading: { ...text(12, "semibold", { tracking: 0.04, uppercase: true }), color: t.colors.dim },
  bullet: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.accent, marginTop: 8 },
  noteText: { ...text(14, "regular", { lineHeight: 22 }), color: t.colors.muted, flex: 1 },
  download: { height: 48, borderRadius: t.radii.btn, backgroundColor: t.colors.accent, overflow: "hidden", alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
  downloadFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: t.black(0.2) },
  downloadInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  downloadLabel: { ...text(14, "semibold") },
  footnote: { ...text(12), color: t.colors.dim, textAlign: "center", marginTop: 8 },
  actions: { marginTop: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  linkBtn: { minHeight: 44, justifyContent: "center" },
  link: { ...text(13) },
}));
