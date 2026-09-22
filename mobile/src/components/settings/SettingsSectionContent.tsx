import React from "react";
import { View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { Languages, Palette, Play, Puzzle, Tv, UserRound } from "lucide-react-native";
import type { MessageKey } from "../../lib/i18n";
import { AccountSection } from "./AccountSection";
import { AddonsSection } from "./AddonsSection";
import { AppearanceSection } from "./AppearanceSection";
import { IptvSection } from "./IptvSection";
import { LanguageSection } from "./LanguageSection";
import { PlaybackSection } from "./PlaybackSection";
import { UpdatesSection } from "./UpdatesSection";

export type SettingsSectionId = "appearance" | "playback" | "addons" | "iptv" | "language" | "account";

/** The six settings sections in display order (Discord is desktop-only). */
export const SETTINGS_SECTIONS: ReadonlyArray<{ id: SettingsSectionId; icon: LucideIcon; labelKey: MessageKey; hintKey: MessageKey }> = [
  { id: "appearance", icon: Palette, labelKey: "appearance", hintKey: "appearanceHint" },
  { id: "playback", icon: Play, labelKey: "playback", hintKey: "playbackHint" },
  { id: "addons", icon: Puzzle, labelKey: "addons", hintKey: "addonsShortHint" },
  { id: "iptv", icon: Tv, labelKey: "iptv", hintKey: "iptvShortHint" },
  { id: "language", icon: Languages, labelKey: "language", hintKey: "languageHint" },
  { id: "account", icon: UserRound, labelKey: "account", hintKey: "accountHint" },
];

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return typeof value === "string" && SETTINGS_SECTIONS.some((s) => s.id === value);
}

/** Renders the cards of one settings section. */
export function SettingsSectionContent({ section }: { section: SettingsSectionId }) {
  switch (section) {
    case "appearance":
      return <AppearanceSection />;
    case "playback":
      return <PlaybackSection />;
    case "addons":
      return <AddonsSection />;
    case "iptv":
      return <IptvSection />;
    case "language":
      return <LanguageSection />;
    case "account":
      return (
        <View style={{ gap: 16 }}>
          <AccountSection />
          <UpdatesSection />
        </View>
      );
    default:
      return null;
  }
}
