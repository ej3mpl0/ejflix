import React from "react";
import { View } from "react-native";
import { useI18n } from "../../lib/locale-context";
import { useSettings } from "../../lib/settings-context";
import { useLayout } from "../../theme/responsive";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Toggle } from "../ui/Toggle";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { ThemePicker } from "./ThemePicker";

/** Settings › Appearance: theme swatches, AMOLED black and the poster size. */
export function AppearanceSection() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const { wide } = useLayout();
  const { appearance } = settings;
  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title={t("theme")} description={t("themeHint")}>
        <SettingsRow stacked>
          <ThemePicker value={appearance.theme} onChange={(theme) => void update({ appearance: { theme } })} />
        </SettingsRow>
        <SettingsRow label={t("amoled")} hint={t("amoledHint")}>
          <Toggle checked={appearance.amoled} onChange={(amoled) => void update({ appearance: { amoled } })} label={t("amoled")} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("posterSize")}>
        <SettingsRow stacked={!wide}>
          <SegmentedControl
            label={t("posterSize")}
            value={appearance.posterSize}
            options={[
              { value: "small", label: t("sizeSmall") },
              { value: "medium", label: t("sizeMedium") },
              { value: "large", label: t("sizeLarge") },
            ]}
            onChange={(posterSize) => void update({ appearance: { posterSize } })}
          />
        </SettingsRow>
      </SettingsSection>
    </View>
  );
}
