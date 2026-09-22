import React from "react";
import { Text, View } from "react-native";
import type { Countdown, SkipMode, SubBackground } from "../../lib/types";
import { useI18n } from "../../lib/locale-context";
import { useSettings } from "../../lib/settings-context";
import { useLayout } from "../../theme/responsive";
import { SegmentedControl } from "../ui/SegmentedControl";
import { Toggle } from "../ui/Toggle";
import { LanguagePicker } from "./LanguagePicker";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { makeStyles } from "../../theme/ThemeProvider";

/** Settings › Playback: skip prompts, next-episode countdown, preferred tracks, speed. */
export function PlaybackSection() {
  const { t } = useI18n();
  const s = useStyles();
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
      <SettingsSection title={t("seekStepTitle")}>
        <SettingsRow label={t("seekStep")} hint={t("seekStepHint")} stacked={stacked}>
          <SegmentedControl<number>
            label={t("seekStep")}
            value={playback.seekStep}
            onChange={(seekStep) => void update({ playback: { seekStep } })}
            options={[5, 10, 15, 30].map((n) => ({ value: n, label: `${n} s` }))}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t("subStyleTitle")} description={t("subStyleHintMobile")}>
        <View style={s.preview}>
          <Text
            style={[
              s.previewText,
              {
                color: playback.subColor,
                fontSize: Math.round(18 * playback.subScale),
                backgroundColor: playback.subBackground === "box" ? "rgba(0,0,0,0.7)" : "transparent",
                textShadowRadius: playback.subBackground === "box" ? 0 : playback.subBackground === "shadow" ? 6 : 3,
                textShadowOffset: playback.subBackground === "shadow" ? { width: 2, height: 2 } : { width: 0, height: 0 },
              },
            ]}
          >
            {t("subPreview")}
          </Text>
        </View>
        <SettingsRow label={t("subSize")} stacked={stacked}>
          <SegmentedControl<number>
            label={t("subSize")}
            value={playback.subScale}
            onChange={(subScale) => void update({ playback: { subScale } })}
            options={[0.8, 1, 1.25, 1.5, 2].map((v) => ({ value: v, label: `${Math.round(v * 100)}%` }))}
          />
        </SettingsRow>
        <SettingsRow label={t("subColor")} stacked={stacked}>
          <SegmentedControl<string>
            label={t("subColor")}
            value={playback.subColor}
            onChange={(subColor) => void update({ playback: { subColor } })}
            options={[
              { value: "#FFFFFF", label: t("colorWhite") },
              { value: "#FFE45C", label: t("colorYellow") },
              { value: "#7DF9FF", label: t("colorCyan") },
              { value: "#9CFF8A", label: t("colorGreen") },
            ]}
          />
        </SettingsRow>
        <SettingsRow label={t("subBackground")} stacked={stacked}>
          <SegmentedControl<SubBackground>
            label={t("subBackground")}
            value={playback.subBackground}
            onChange={(subBackground) => void update({ playback: { subBackground } })}
            options={[
              { value: "outline", label: t("subBgOutline") },
              { value: "shadow", label: t("subBgShadow") },
              { value: "box", label: t("subBgBox") },
            ]}
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

const useStyles = makeStyles((t) => ({
  preview: {
    height: 110,
    borderRadius: 16,
    marginVertical: 12,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 14,
    backgroundColor: "#26323d",
  },
  previewText: { fontWeight: "600", paddingHorizontal: 8, borderRadius: 4, overflow: "hidden", textShadowColor: "#000", textAlign: "center" },
}));
