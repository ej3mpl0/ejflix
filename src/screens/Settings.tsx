import { useState } from "react";
import { ArrowLeft, Info, LogOut, Palette, Play, Puzzle, Server, Users, Languages as LanguagesIcon } from "lucide-react";
import { AddonsSection } from "../components/settings/AddonsSection";
import type { SavedServer, Session, SkipMode, Countdown } from "../lib/types";
import { cn, sessionAvatar } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
import { Avatar } from "../components/Avatar";
import { LanguageSelect } from "../components/LanguageSelect";
import { ReleaseNotes } from "../components/ReleaseNotes";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsSection";
import { Toggle } from "../components/settings/Toggle";
import { SegmentedControl } from "../components/settings/SegmentedControl";
import { ThemePicker } from "../components/settings/ThemePicker";
import { LanguagePicker } from "../components/settings/LanguagePicker";

type Section = "appearance" | "playback" | "addons" | "language" | "account";

export function Settings({
  session,
  server,
  version,
  onSwitchProfile,
  onLogout,
  onBack,
  onToast,
}: {
  session: Session;
  server: SavedServer | null;
  version: string | null;
  onSwitchProfile: () => void;
  onLogout: () => void;
  onBack: () => void;
  onToast: (message: string) => void;
}) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const [section, setSection] = useState<Section>("appearance");
  const { appearance, playback } = settings;

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

  const sections: { id: Section; label: string; icon: typeof Palette }[] = [
    { id: "appearance", label: t("appearance"), icon: Palette },
    { id: "playback", label: t("playback"), icon: Play },
    { id: "addons", label: t("addons"), icon: Puzzle },
    { id: "language", label: t("language"), icon: LanguagesIcon },
    { id: "account", label: t("account"), icon: Users },
  ];

  return (
    <div className="page-enter mx-auto max-w-[1100px] px-page pt-24 pb-16">
      <div className="mb-8 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label={t("back")}
          className="icon-hit grid h-10 w-10 place-items-center rounded-full text-white hover:bg-white/10"
        >
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-[28px] font-semibold tracking-[-0.02em]">{t("settings")}</h1>
      </div>
      <div className="grid gap-10 md:grid-cols-[240px_1fr]">
        <nav aria-label={t("settings")} className="space-y-1">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
              className={cn(
                "flex h-11 w-full items-center gap-3 rounded-btn px-3 text-left text-[14px] transition-colors duration-150",
                section === id ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-white/6 hover:text-text",
              )}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>

        <div className="space-y-6">
          {section === "appearance" ? (
            <>
              <SettingsSection title={t("theme")} description={t("themeHint")}>
                <SettingsRow label={t("theme")} stacked>
                  <ThemePicker
                    value={appearance.theme}
                    onChange={(theme) => void update({ appearance: { theme } })}
                  />
                </SettingsRow>
                <SettingsRow label={t("amoled")} hint={t("amoledHint")}>
                  <Toggle
                    checked={appearance.amoled}
                    onChange={(amoled) => void update({ appearance: { amoled } })}
                    label={t("amoled")}
                  />
                </SettingsRow>
              </SettingsSection>
              <SettingsSection title={t("posterSize")}>
                <SettingsRow label={t("posterSize")}>
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
            </>
          ) : null}

          {section === "playback" ? (
            <>
              <SettingsSection title={t("skipSectionTitle")} description={t("skipSectionHint")}>
                <SettingsRow label={t("skipIntro")}>
                  <SegmentedControl
                    label={t("skipIntro")}
                    value={playback.skipIntro}
                    options={skipOptions}
                    onChange={(skipIntro) => void update({ playback: { skipIntro } })}
                  />
                </SettingsRow>
                <SettingsRow label={t("skipRecap")}>
                  <SegmentedControl
                    label={t("skipRecap")}
                    value={playback.skipRecap}
                    options={skipOptions}
                    onChange={(skipRecap) => void update({ playback: { skipRecap } })}
                  />
                </SettingsRow>
                <SettingsRow label={t("skipOutro")}>
                  <SegmentedControl
                    label={t("skipOutro")}
                    value={playback.skipOutro}
                    options={skipOptions}
                    onChange={(skipOutro) => void update({ playback: { skipOutro } })}
                  />
                </SettingsRow>
                <SettingsRow label={t("nextEpisodeCountdown")} hint={t("nextEpisodeCountdownHint")}>
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
                  <LanguagePicker
                    kind="audio"
                    label={t("preferredAudio")}
                    value={playback.audioLanguage}
                    onChange={(audioLanguage) => void update({ playback: { audioLanguage } })}
                  />
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
                  <Toggle
                    checked={playback.rememberSpeed}
                    onChange={(rememberSpeed) => void update({ playback: { rememberSpeed } })}
                    label={t("rememberSpeed")}
                  />
                </SettingsRow>
                <SettingsRow label={t("showTimeRemaining")}>
                  <Toggle
                    checked={playback.showTimeRemaining}
                    onChange={(showTimeRemaining) => void update({ playback: { showTimeRemaining } })}
                    label={t("showTimeRemaining")}
                  />
                </SettingsRow>
              </SettingsSection>
            </>
          ) : null}

          {section === "addons" ? <AddonsSection onToast={onToast} /> : null}

          {section === "language" ? (
            <SettingsSection title={t("language")}>
              <SettingsRow label={t("appLanguage")}>
                <LanguageSelect />
              </SettingsRow>
            </SettingsSection>
          ) : null}

          {section === "account" ? (
            <>
              <SettingsSection title={t("account")}>
                <div className="flex items-center gap-4 py-3">
                  <Avatar src={sessionAvatar(session)} name={session.userName} size={56} />
                  <div className="min-w-0">
                    <p className="truncate text-[16px] font-semibold">{session.userName}</p>
                    <p className="flex items-center gap-1.5 truncate text-[13px] text-dim">
                      <Server size={13} />
                      {server?.serverName ?? "Jellyfin"} · {server?.serverUrl ?? session.serverUrl}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 py-4">
                  <button
                    type="button"
                    onClick={onSwitchProfile}
                    className="btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-white/12 px-5 text-[14px] font-semibold hover:bg-white/18"
                  >
                    <Users size={16} />
                    {t("switchProfile")}
                  </button>
                  <button
                    type="button"
                    onClick={onLogout}
                    className="btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-white/12 px-5 text-[14px] font-semibold hover:bg-white/18"
                  >
                    <LogOut size={16} />
                    {t("signOut")}
                  </button>
                </div>
              </SettingsSection>
              <SettingsSection title={t("releaseNotes")}>
                <div className="py-3">
                  <p className="mb-3 flex items-center gap-1.5 text-[13px] text-dim">
                    <Info size={13} />
                    {t("version")} {version ?? "—"}
                  </p>
                  <ReleaseNotes />
                </div>
              </SettingsSection>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
