import React from "react";
import { View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { Palette, Play, Puzzle, RefreshCw, ShieldCheck, Tv, UserRound } from "lucide-react-native";
import type { MessageKey } from "../../lib/i18n";
import { AccountSection } from "./AccountSection";
import { AddonsSection } from "./AddonsSection";
import { AppearanceSection } from "./AppearanceSection";
import { IptvSection } from "./IptvSection";
import { LanguageSection } from "./LanguageSection";
import { PlaybackSection } from "./PlaybackSection";
import { UpdatesSection } from "./UpdatesSection";
import { ParentalSection } from "./ParentalSection";

/** "language" stays a valid id (old links) but now lives inside General ("appearance"). */
export type SettingsSectionId = "appearance" | "playback" | "addons" | "iptv" | "language" | "account" | "updates" | "parental";

/** The settings sections in display order (Discord is desktop-only). */
export const SETTINGS_SECTIONS: ReadonlyArray<{ id: SettingsSectionId; icon: LucideIcon; labelKey: MessageKey; hintKey: MessageKey }> = [
  { id: "appearance", icon: Palette, labelKey: "general", hintKey: "generalHint" },
  { id: "playback", icon: Play, labelKey: "playback", hintKey: "playbackHint" },
  { id: "addons", icon: Puzzle, labelKey: "addons", hintKey: "addonsShortHint" },
  { id: "iptv", icon: Tv, labelKey: "iptv", hintKey: "iptvShortHint" },
  { id: "account", icon: UserRound, labelKey: "account", hintKey: "accountHint" },
  { id: "parental", icon: ShieldCheck, labelKey: "parentalTitle", hintKey: "parentalShortHint" },
  { id: "updates", icon: RefreshCw, labelKey: "updates", hintKey: "updatesHint" },
];

/** Titles and row labels of each section, for the settings search. */
export const SETTINGS_SEARCH: Record<Exclude<SettingsSectionId, "language">, MessageKey[]> = {
  appearance: ["language", "appLanguage", "theme", "amoled", "posterSize"],
  playback: ["seekStep", "skipIntro", "skipRecap", "skipOutro", "nextEpisodeCountdown", "tracks", "preferredAudio", "preferredSubtitles", "subStyleTitle", "subSize", "subColor", "subBackground", "playbackSpeed", "rememberSpeed", "showTimeRemaining"],
  addons: ["addons", "importAddons", "cinemetaRow"],
  iptv: ["iptv", "iptvPrefs", "iptvAutoRefresh", "iptvEpgEnabled"],
  account: ["account", "switchProfile", "jellyfinServer"],
  updates: ["updates", "updateAuto"],
  parental: ["parentalTitle", "parentalMaxRating", "parentalHideUnrated", "parentalChangePin"],
};

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === "string" && (value === "language" || SETTINGS_SECTIONS.some((s) => s.id === value));
}

/** Renders the cards of one settings section. */
export function SettingsSectionContent({ section }: { section: SettingsSectionId }) {
  switch (section) {
    case "appearance":
    case "language":
      return (
        <View style={{ gap: 16 }}>
          <LanguageSection />
          <AppearanceSection />
        </View>
      );
    case "playback":
      return <PlaybackSection />;
    case "addons":
      return <AddonsSection />;
    case "iptv":
      return <IptvSection />;
    case "account":
      return <AccountSection />;
    case "updates":
      return <UpdatesSection />;
    case "parental":
      return <ParentalSection />;
    default:
      return null;
  }
}
