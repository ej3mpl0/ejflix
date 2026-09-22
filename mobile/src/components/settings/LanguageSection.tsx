import React from "react";
import { useI18n } from "../../lib/locale-context";
import { LanguageSelect } from "./LanguageSelect";
import { SettingsRow, SettingsSection } from "./SettingsSection";

/** Settings › Language: the ES | EN toggle of the UI. */
export function LanguageSection() {
  const { t } = useI18n();
  return (
    <SettingsSection title={t("language")}>
      <SettingsRow label={t("appLanguage")}>
        <LanguageSelect />
      </SettingsRow>
    </SettingsSection>
  );
}
