import React from "react";
import { ScrollView, Text, View } from "react-native";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { useI18n } from "../../lib/locale-context";
import { Logo } from "../ui/Logo";
import { Pill } from "../ui/Pill";
import { ModalCard } from "../ui/ModalCard";
import { ReleaseNotesCard } from "./ReleaseNotesCard";

/** "Updated to x.y.z" card shown once after an update (desktop `UpdateModal`). */
export function WhatsNewModal({ version, onClose }: { version: string; onClose: () => void }) {
  const s = useStyles();
  const { t } = useI18n();
  return (
    <ModalCard visible width={440} onClose={onClose}>
      <View style={s.body}>
        <View style={{ alignItems: "center", marginBottom: 24 }}>
          <Logo size="login" />
        </View>
        <Text style={s.kicker}>{t("update")}</Text>
        <Text style={s.title}>{t("updatedTo", { version })}</Text>
        <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
          <ReleaseNotesCard />
        </ScrollView>
        <Pill variant="primary" size="lg" block label={t("gotIt")} onPress={onClose} style={{ marginTop: 28 }} />
      </View>
    </ModalCard>
  );
}

const useStyles = makeStyles((t) => ({
  body: { padding: 28 },
  kicker: { ...text(11, "semibold", { tracking: 0.08, uppercase: true }), color: t.colors.dim, textAlign: "center", marginBottom: 4 },
  title: { ...text(20, "semibold"), color: t.colors.text, textAlign: "center", marginBottom: 20 },
}));
