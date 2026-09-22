import React from "react";
import { View } from "react-native";
import type { Countdown, SkipMode } from "../../lib/types";
import { useI18n } from "../../lib/locale-context";
import { useSettings } from "../../lib/settings-context";
import { useLayout } from "../../theme/responsive";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Toggle } from "../ui/Toggle";
import { LanguagePicker } from "./LanguagePicker";
import { SettingsRow, SettingsSection } from "./SettingsSection";

/** Settings › Playback: skip prompts, next-episode countdown, preferred tracks, speed. */
export function PlaybackSection() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const { wide } = useLayout();
  const { playback } = settings;
  const stacked = !wide;

  const skipOptions: { value: SkipMode; label: string }[] = [
    { value: "ask", label: t("skipAsk") },
    { value: "auto", label: t("skipAuto") },
    { value: "off", label: t("skipOff") },
  ];
  const countdownOptions: { value: Countdown; label: string }[] = [
    { value: 0, label: t("countdownManual") },
    { value: 5, label: t("countdownSeconds", { n: 5 }) },
    { value: 10, label: t("countdownSeconds", { n: 10 }) },
    { value: 15, label: t("countdownSeconds", { n: 15 }) },
  ];

  return (
    <View style={{ gap: 16 }}>
      <SettingsSection title={t("skipSectionTitle")} description={t("skipSectionHint")}>
        <SettingsRow label={t("skipIntro")} stacked={stacked}>
          <SegmentedControl label={t("skipIntro")} value={playback.skipIntro} options={skipOptions} onChange={(skipIntro) => void update({ playback: { skipIntro } })} />
        </SettingsRow>
        <SettingsRow label={t("skipRecap")} stacked={stacked}>
          <SegmentedControl label={t("skipRecap")} value={playback.skipRecap} options={skipOptions} onChange={(skipRecap) => void update({ playback: { skipRecap } })} />
        </SettingsRow>
        <SettingsRow label={t("skipOutro")} stacked={stacked}>
          <SegmentedControl label={t("skipOutro")} value={playback.skipOutro} options={skipOptions} onChange={(skipOutro) => void update({ playback: { skipOutro } })} />
        </SettingsRow>
        <SettingsRow label={t("nextEpisodeCountdown")} hint={t("nextEpisodeCountdownHint")} stacked={stacked}>
          <SegmentedControl
            label={t("nextEpisodeCountdown")}
            value={playback.nextEpisodeCountdown}
            options={countdownOptions}
            onChange={(nextEpisodeCountdown) => void update({ playback: { nextEpisodeCountdown } })}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("tracks")}>
        <SettingsRow label={t("preferredAudio")}>
          <LanguagePicker kind="audio" label={t("preferredAudio")} value={playback.audioLanguage} onChange={(audioLanguage) => void update({ playback: { audioLanguage } })} />
        </SettingsRow>
        <SettingsRow label={t("preferredSubtitles")}>
          <LanguagePicker
            kind="subtitle"
            label={t("preferredSubtitles")}
            value={playback.subtitleLanguage}
            onChange={(subtitleLanguage) => void update({ playback: { subtitleLanguage } })}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("playbackSpeed")}>
        <SettingsRow label={t("rememberSpeed")} hint={t("rememberSpeedHint")}>
          <Toggle checked={playback.rememberSpeed} onChange={(rememberSpeed) => void update({ playback: { rememberSpeed } })} label={t("rememberSpeed")} />
        </SettingsRow>
        <SettingsRow label={t("showTimeRemaining")}>
          <Toggle
            checked={playback.showTimeRemaining}
            onChange={(showTimeRemaining) => void update({ playback: { showTimeRemaining } })}
            label={t("showTimeRemaining")}
          />
        </SettingsRow>
      </SettingsSection>
    </View>
  );
}
