import React, { useState } from "react";
import { Text, View } from "react-native";
import { Crown, LogIn, LogOut, Play } from "lucide-react-native";
import { useI18n } from "../../lib/locale-context";
import { useSession } from "../../lib/session-context";
import { partyErrorKey } from "../../lib/party-errors";
import { partyJoin, partyLeave, type PartyStatus } from "../../services/party";
import { titleLabel } from "../../services/party.pure";
import { makeStyles, useTheme } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { Avatar } from "../ui/Avatar";
import { Pill } from "../ui/Pill";
import { Sheet } from "../ui/Sheet";
import { TextField } from "../ui/TextField";
import { Spinner } from "../ui/Spinner";

/**
 * Watch party on the phone (desktop `PartyDialog`, guest side): join with a code; once
 * in, the code, who is in, the host's title and the way out.
 */
export function PartySheet({
  visible,
  status,
  onClose,
  onOpenTitle,
}: {
  visible: boolean;
  status: PartyStatus;
  onClose: () => void;
  onOpenTitle: () => void;
}) {
  const s = useStyles();
  const theme = useTheme();
  const { t } = useI18n();
  const { session } = useSession();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const shownError = error ?? (!status.active && status.phase === "ended" ? status.error : null);

  const join = () => {
    setError(null);
    const avatar = session?.avatarUrl?.startsWith("preset:") ? session.avatarUrl : null;
    try {
      partyJoin(code, session?.userName ?? "ejFlix", avatar);
    } catch (err) {
      setError(err instanceof Error ? err.message : "party:generic");
    }
  };

  const waiting = status.phase === "connecting" || status.phase === "reconnecting";
  const phaseText = status.hostAway
    ? t("partyHostAway")
    : status.phase === "connecting"
      ? t("partyConnecting")
      : status.phase === "reconnecting"
        ? t("partyReconnecting")
        : t("partyLive");

  return (
    <Sheet visible={visible} onClose={onClose} title={t("partyTitle")}>
      {status.active ? (
        <View style={s.root}>
          <View style={s.codeBox}>
            <Text style={s.label}>{t("partyCode")}</Text>
            <Text selectable style={s.code}>
              {status.code}
            </Text>
          </View>
          <View style={s.phase}>
            {waiting ? <Spinner size={14} /> : <View style={[s.dot, { backgroundColor: status.hostAway ? theme.colors.warning : theme.colors.success }]} />}
            <Text style={[s.phaseText, (waiting || status.hostAway) && { color: theme.colors.warning }]}>{phaseText}</Text>
          </View>
          {status.title && status.title.kind !== "unsupported" ? (
            <Pill block pill variant="primary" icon={Play} label={t("partyOpenTitle", { title: titleLabel(status.title) })} onPress={onOpenTitle} />
          ) : (
            <Text style={s.note}>{status.title ? t("partyUnsupported") : t("partyWaitingTitle")}</Text>
          )}
          <Text style={[s.label, s.membersLabel]}>{t("partyMembers", { n: status.members.length })}</Text>
          {status.members.map((member) => (
            <View key={member.id} style={s.member}>
              <Avatar src={member.avatar} name={member.name} size={30} />
              <Text numberOfLines={1} style={s.memberName}>
                {member.name}
                {member.id === status.selfId ? <Text style={s.you}> ({t("partyYou")})</Text> : null}
              </Text>
              {member.host ? (
                <View style={s.hostBadge}>
                  <Crown size={11} color={theme.colors.accent} />
                  <Text style={s.hostText}>{t("partyHostBadge")}</Text>
                </View>
              ) : null}
            </View>
          ))}
          <Pill block pill variant="tonal" icon={LogOut} label={t("partyLeave")} onPress={partyLeave} style={s.leave} />
        </View>
      ) : (
        <View style={s.root}>
          <TextField
            label={t("partyJoinTitle")}
            value={code}
            onChangeText={(value) => setCode(value.toUpperCase())}
            placeholder={t("partyCodePlaceholder")}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={24}
            returnKeyType="go"
            onSubmitEditing={join}
            hint={t("partyJoinHint")}
            error={shownError ? t(partyErrorKey(shownError)) : null}
          />
          <Pill block pill variant="primary" icon={LogIn} label={t("partyJoin")} disabled={!code.trim()} onPress={join} style={s.join} />
        </View>
      )}
    </Sheet>
  );
}

const useStyles = makeStyles((t) => ({
  root: { paddingHorizontal: 20, paddingBottom: 12 },
  codeBox: { backgroundColor: t.white(0.06), borderRadius: 14, padding: 14, marginBottom: 12 },
  label: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.colors.dim },
  code: { ...text(22, "semibold", { tabular: true, tracking: 0.06 }), color: t.colors.text, marginTop: 4 },
  phase: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  phaseText: { ...text(12), color: t.colors.dim, flex: 1 },
  note: { ...text(13, "regular", { lineHeight: 19 }), color: t.colors.muted, backgroundColor: t.white(0.06), borderRadius: 12, padding: 12 },
  membersLabel: { marginTop: 18, marginBottom: 6 },
  member: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  memberName: { ...text(15), color: t.colors.text, flex: 1 },
  you: { color: t.colors.dim },
  hostBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: t.colors.accentSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  hostText: { ...text(11, "semibold"), color: t.colors.accent },
  leave: { marginTop: 18 },
  join: { marginTop: 16 },
}));
