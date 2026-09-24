import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { KeyRound, ShieldCheck } from "lucide-react-native";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/locale-context";
import { PARENTAL_LEVELS, parentalLevelKey, useParental } from "../../lib/parental";
import type { ParentalLevel } from "../../lib/types";
import { useToast } from "../../lib/toast-context";
import { makeStyles } from "../../theme/ThemeProvider";
import { text } from "../../theme/typography";
import { ParentalPinModal } from "../profile/ParentalPinModal";
import { Pill } from "../ui/Pill";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Spinner } from "../ui/Spinner";
import { Toggle } from "../ui/Toggle";
import { SettingsRow, SettingsSection } from "./SettingsSection";

/**
 * Settings › Parental controls (desktop `ParentalSection`): the age limit of the open
 * profile, staged here and saved behind the parental PIN.
 */
export function ParentalSection() {
  const s = useStyles();
  const { t } = useI18n();
  const { toast } = useToast();
  const status = useParental();
  const [maxAge, setMaxAge] = useState<ParentalLevel>(18);
  const [hideUnrated, setHideUnrated] = useState(false);
  const [dialog, setDialog] = useState<"save" | "change-pin" | null>(null);

  useEffect(() => {
    if (!status) return;
    setMaxAge(status.maxAge);
    setHideUnrated(status.hideUnrated);
  }, [status]);

  if (!status) {
    return (
      <SettingsSection title={t("parentalTitle")}>
        <View style={s.loading}>
          <Spinner />
        </View>
      </SettingsSection>
    );
  }

  const dirty = maxAge !== status.maxAge || (maxAge < 18 && hideUnrated !== status.hideUnrated);

  return (
    <>
      <SettingsSection title={t("parentalTitle")} description={t("parentalHint")}>
        <Text style={s.status}>
          {status.active ? t("parentalActive", { level: t(parentalLevelKey(status.maxAge)) }) : t("parentalInactive")}
        </Text>
        <SettingsRow label={t("parentalMaxRating")} hint={t("parentalMaxRatingHint")} stacked>
          <SegmentedControl<ParentalLevel>
            label={t("parentalMaxRating")}
            value={maxAge}
            options={PARENTAL_LEVELS.map((level) => ({ value: level, label: t(parentalLevelKey(level)) }))}
            onChange={setMaxAge}
          />
        </SettingsRow>
        {maxAge < 18 ? (
          <SettingsRow label={t("parentalHideUnrated")} hint={t("parentalHideUnratedHint")}>
            <Toggle checked={hideUnrated} onChange={setHideUnrated} label={t("parentalHideUnrated")} />
          </SettingsRow>
        ) : null}
        <View style={s.actions}>
          <Pill variant="primary" icon={ShieldCheck} label={t("parentalSave")} disabled={!dirty} onPress={() => setDialog("save")} />
          {status.pinSet ? <Pill icon={KeyRound} label={t("parentalChangePin")} onPress={() => setDialog("change-pin")} /> : null}
        </View>
        <Text style={s.note}>{t("parentalScopeHint")}</Text>
      </SettingsSection>

      {dialog === "save" ? (
        <ParentalPinModal
          steps={status.pinSet ? ["current"] : ["new", "confirm"]}
          title={status.pinSet ? t("parentalSave") : t("parentalCreatePin")}
          hint={status.pinSet ? undefined : t("parentalCreatePinHint")}
          onClose={() => setDialog(null)}
          onSubmit={async ({ current, next }) => {
            await api.parentalSet(status.pinSet ? current : next, maxAge, maxAge < 18 && hideUnrated);
            setDialog(null);
            toast(t("parentalSaved"));
          }}
        />
      ) : null}
      {dialog === "change-pin" ? (
        <ParentalPinModal
          steps={["current", "new", "confirm"]}
          title={t("parentalChangePin")}
          onClose={() => setDialog(null)}
          onSubmit={async ({ current, next }) => {
            await api.parentalSet(current, status.maxAge, status.hideUnrated, next);
            setDialog(null);
            toast(t("parentalPinChanged"));
          }}
        />
      ) : null}
    </>
  );
}

const useStyles = makeStyles((t) => ({
  loading: { paddingVertical: 24, alignItems: "center" },
  status: { ...text(14), color: t.colors.muted, paddingVertical: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingVertical: 16 },
  note: { ...text(12), color: t.colors.dim, paddingBottom: 12 },
}));
