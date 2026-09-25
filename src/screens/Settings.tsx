import { useEffect, useState } from "react";
import type { LocalProfile } from "../lib/types";
import {
  ArrowLeft,
  Link2,
  MessageCircle,
  LoaderCircle,
  LogOut,
  Palette,
  Pencil,
  Play,
  Puzzle,
  Info,
  Server,
  Tv,
  Unlink,
  Users,
  Magnet,
  RefreshCw,
  Search,
  ShieldCheck,
  Clapperboard,
} from "lucide-react";
import { AddonsSection } from "../components/settings/AddonsSection";
import { IptvSection } from "../components/settings/IptvSection";
import { DiscordSection } from "../components/settings/DiscordSection";
import { AboutSection } from "../components/settings/AboutSection";
import { AccountSettings } from "../components/account/AccountSettings";
import { hasServer as sessionHasServer, type SavedServer, type Session, type SkipMode, type Countdown } from "../lib/types";
import { api } from "../lib/api";
import { cn, sessionAvatar } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { errorText } from "../lib/errors";
import { useSettings } from "../lib/settings-context";
import { Avatar } from "../components/Avatar";
import { LanguageSelect } from "../components/LanguageSelect";
import { Select } from "../components/Select";
import { CONTENT_LANGUAGES } from "../lib/localized";
import { ProfileForm } from "../components/ProfileForm";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsSection";
import { Toggle } from "../components/settings/Toggle";
import { SegmentedControl } from "../components/settings/SegmentedControl";
import { ThemePicker } from "../components/settings/ThemePicker";
import { LanguagePicker } from "../components/settings/LanguagePicker";
import { ConfirmButton } from "../components/ConfirmButton";
import { fieldClass as field } from "../lib/ui";
import { UpdatesSection } from "../components/settings/UpdatesSection";
import { OpenSubtitlesSection, SubtitleStyleSection, WatchingSection } from "../components/settings/PlaybackExtras";
import type { MessageKey } from "../lib/i18n";
import { ParentalSection } from "../components/settings/ParentalSection";
import { TraktSection } from "../components/settings/TraktSection";

/** "language" is kept as an id (old deep links) but lives in the General section now. */
type Section =
  | "appearance"
  | "playback"
  | "addons"
  | "torrents"
  | "iptv"
  | "discord"
  | "language"
  | "account"
  | "updates"
  | "about"
  | "parental"
  | "trakt";

/** Titles and row labels of each section, for the settings search. */
const SEARCH_INDEX: Record<Exclude<Section, "language">, MessageKey[]> = {
  appearance: ["language", "appLanguage", "contentLanguage", "theme", "themeAuto", "amoled", "posterSize", "autoplayTrailers"],
  playback: ["seekStep", "skipSectionTitle", "skipIntro", "skipRecap", "skipOutro", "nextEpisodeCountdown", "tracks", "preferredAudio", "preferredSubtitles", "subStyleTitle", "subSize", "subColor", "subBackground", "subOutline", "subPosition", "subAssOverride", "playbackSpeed", "rememberSpeed", "showTimeRemaining", "whilePlayingTitle", "watchedThreshold", "nightModeDefault", "opensubtitlesTitle", "opensubtitlesApiKey"],
  addons: ["addons", "importAddons", "cinemetaRow"],
  torrents: ["torrentsTitle", "torrentsEnabled", "torrentsShare", "torrentsUpload", "torrentsDownload", "torrentsCache"],
  iptv: ["iptv", "iptvPrefs", "iptvAutoRefresh", "iptvEpgEnabled", "iptvWheelZap", "iptvIncludeVod"],
  discord: ["discord", "discordEnable", "discordHeader", "discordShowPoster", "discordShowTime", "discordShowPaused"],
  account: ["account", "accountEjflix", "accountCredentials", "accountSignOutAccount", "accountDelete", "jellyfinServer", "switchProfile", "signOut"],
  updates: ["updates", "updateAuto"],
  about: ["about", "version", "sourceCode"],
  parental: ["parentalTitle", "parentalMaxRating", "parentalHideUnrated", "parentalChangePin"],
  trakt: ["traktTitle", "traktImport", "traktSyncBack", "traktClientId"],
};
export type SettingsSectionId = Section;

const tonal =
  "btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-white/12 px-5 text-[14px] font-semibold hover:bg-white/18 disabled:opacity-60";

/** Settings › Account for a local profile: edit it, link or unlink a Jellyfin account. */
function LocalAccount({
  session,
  onSessionChange,
  onSwitchProfile,
  onToast,
}: {
  session: Session;
  onSessionChange: (session: Session) => void;
  onSwitchProfile: () => void;
  onToast: (message: string, action?: { label: string; run: () => void }) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<LocalProfile | null>(null);
  const [url, setUrl] = useState("http://localhost:8096");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const linked = sessionHasServer(session);

  const link = async () => {
    setBusy(true);
    setError("");
    try {
      await api.probeServer(url);
      onSessionChange(await api.linkServer(url, username.trim(), password));
      setPassword("");
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const startEditing = async () => {
    const fallback: LocalProfile = {
      id: session.userId,
      name: session.userName,
      avatar: session.avatarUrl ?? "preset:0",
      hasPin: false,
      linked,
    };
    try {
      const list = await api.localProfilesList();
      setEditing(list.find((p) => p.id === session.userId) ?? fallback);
    } catch {
      setEditing(fallback);
    }
  };

  const unlink = async () => {
    setBusy(true);
    try {
      onSessionChange(await api.unlinkServer());
    } catch (err) {
      onToast(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsSection title={t("account")}>
        {editing ? (
          <div className="py-4">
            <ProfileForm
              initial={editing}
              onCancel={() => setEditing(null)}
              onSaved={(profile) => {
                setEditing(null);
                onSessionChange({ ...session, userName: profile.name, avatarUrl: profile.avatar });
              }}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4 py-3">
              <Avatar src={sessionAvatar(session)} name={session.userName} size={56} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-semibold">{session.userName}</p>
                <p className="truncate text-[13px] text-dim">{t("localProfile")}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 py-4">
              <button type="button" onClick={() => void startEditing()} className={tonal}>
                <Pencil size={16} />
                {t("editProfile")}
              </button>
              <button type="button" onClick={onSwitchProfile} className={tonal}>
                <Users size={16} />
                {t("switchProfile")}
              </button>
            </div>
          </>
        )}
      </SettingsSection>
      <SettingsSection
        title={t("jellyfinServer")}
        description={linked ? t("serverLinkedHint") : t("linkServerHint")}
      >
        {linked ? (
          <>
            <div className="flex items-center gap-4 py-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                <Server size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{session.serverName ?? "Jellyfin"}</p>
                <p className="truncate text-[12px] text-dim">
                  {session.serverUrl}
                  {session.jellyfinUserName ? ` · ${session.jellyfinUserName}` : ""}
                </p>
              </div>
            </div>
            <div className="py-4">
              <ConfirmButton
                confirmLabel={t("disconnectServer")}
                onConfirm={() => unlink()}
                trigger={(ask) => (
                  <button type="button" disabled={busy} onClick={ask} className={tonal}>
                    {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Unlink size={16} />}
                    {t("disconnectServer")}
                  </button>
                )}
              />
            </div>
          </>
        ) : (
          <form
            className="space-y-3 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              void link();
            }}
          >
            <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://192.168.1.10:8096"
                aria-label={t("jellyfinServer")}
                className={field}
              />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t("username")}
                aria-label={t("username")}
                className={field}
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("password")}
                aria-label={t("password")}
                className={field}
              />
            </div>
            {error ? <p className="text-[13px] text-danger">{error}</p> : null}
            <button
              type="submit"
              disabled={busy || !url.trim() || !username.trim()}
              className="btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-accent px-5 text-[14px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
            >
              {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Link2 size={16} />}
              {t("connect")}
            </button>
          </form>
        )}
      </SettingsSection>
    </>
  );
}

/** Reopening Settings lands on the section used last (for the rest of the session). */
let lastSection: Section = "appearance";

export function Settings({
  session,
  server,
  version,
  initialSection,
  sectionRequest = 0,
  onSessionChange,
  onSwitchProfile,
  onLogout,
  onBack,
  onToast,
}: {
  session: Session;
  server: SavedServer | null;
  version: string | null;
  /** Section to open first (defaults to Appearance). */
  initialSection?: SettingsSectionId;
  /** Bumped by every deep link, so the same section can be asked for again after moving away. */
  sectionRequest?: number;
  onSessionChange: (session: Session) => void;
  onSwitchProfile: () => void;
  onLogout: () => void;
  onBack: () => void;
  onToast: (message: string, action?: { label: string; run: () => void }) => void;
}) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const [rawSection, setSection] = useState<Section>(initialSection ?? lastSection);
  // Language moved into General (appearance).
  const section: Section = rawSection === "language" ? "appearance" : rawSection;
  lastSection = section;
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? (Object.entries(SEARCH_INDEX) as Array<[Section, MessageKey[]]>).flatMap(([id, keys]) =>
        keys.filter((key) => t(key).toLocaleLowerCase().includes(needle)).map((key) => ({ id, label: t(key) })),
      )
    : [];

  /** Jump to a search hit: open its section, then bring the matching heading or row into view. */
  const goTo = (id: Section, label: string) => {
    setSection(id);
    setQuery("");
    window.setTimeout(() => {
      const root = document.querySelector("[data-settings-content]");
      const target = [...(root?.querySelectorAll<HTMLElement>("h3, p") ?? [])].find((el) => el.textContent?.trim() === label);
      const row = target?.closest<HTMLElement>("section > div > div, section") ?? target;
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      row?.classList.add("setting-hit");
      window.setTimeout(() => row?.classList.remove("setting-hit"), 1600);
    }, 60);
  };
  const { appearance, playback } = settings;

  useEffect(() => {
    if (initialSection) setSection(initialSection);
  }, [initialSection, sectionRequest]);

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
    { id: "appearance", label: t("general"), icon: Palette },
    { id: "playback", label: t("playback"), icon: Play },
    { id: "addons", label: t("addons"), icon: Puzzle },
    { id: "torrents", label: t("torrentsTitle"), icon: Magnet },
    { id: "iptv", label: t("iptv"), icon: Tv },
    { id: "discord", label: t("discord"), icon: MessageCircle },
    { id: "account", label: t("account"), icon: Users },
    { id: "parental", label: t("parentalTitle"), icon: ShieldCheck },
    { id: "trakt", label: t("traktTitle"), icon: Clapperboard },
    { id: "updates", label: t("updates"), icon: RefreshCw },
    { id: "about", label: t("about"), icon: Info },
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
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[240px_minmax(0,1fr)] md:gap-10">
        {/* A scrolling strip of sections on narrow windows, a column beside the content otherwise. */}
        <div className="min-w-0 space-y-3">
        <label className="relative flex items-center">
          <span className="sr-only">{t("searchSettings")}</span>
          <Search size={15} className="pointer-events-none absolute left-3 text-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches[0]) goTo(matches[0].id, matches[0].label);
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
            placeholder={t("searchSettings")}
            className={cn(field, "h-10 pl-9")}
          />
        </label>
        {needle ? (
          <div role="listbox" aria-label={t("searchSettings")} className="space-y-0.5">
            {matches.length ? (
              matches.map((hit) => (
                <button
                  key={`${hit.id}:${hit.label}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => goTo(hit.id, hit.label)}
                  className="flex w-full flex-col rounded-btn px-3 py-2 text-left hover:bg-white/6"
                >
                  <span className="text-[14px] text-text">{hit.label}</span>
                  <span className="text-[12px] text-dim">{sections.find((s) => s.id === hit.id)?.label}</span>
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-[13px] text-dim">{t("noResults")}</p>
            )}
          </div>
        ) : (
        <nav
          aria-label={t("settings")}
          className="no-scrollbar -mx-page flex gap-1 overflow-x-auto px-page md:mx-0 md:block md:space-y-1 md:overflow-visible md:px-0"
        >
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
              className={cn(
                "flex h-11 shrink-0 items-center gap-3 rounded-btn px-3 text-left text-[14px] whitespace-nowrap transition-colors duration-150 md:w-full",
                section === id ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-white/6 hover:text-text",
              )}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
        )}
        </div>

        <div className="space-y-6" data-settings-content>
          {section === "appearance" ? (
            <>
              <SettingsSection title={t("language")}>
                <SettingsRow label={t("appLanguage")}>
                  <LanguageSelect />
                </SettingsRow>
                <SettingsRow label={t("contentLanguage")} hint={t("contentLanguageHint")}>
                  <Select
                    label={t("contentLanguage")}
                    value={appearance.contentLanguage}
                    options={[
                      { value: "auto", label: t("contentLanguageAuto") },
                      { value: "source", label: t("contentLanguageSource") },
                      ...CONTENT_LANGUAGES.map(({ tag, label }) => ({ value: tag, label })),
                    ]}
                    onChange={(contentLanguage) => void update({ appearance: { contentLanguage } })}
                  />
                </SettingsRow>
              </SettingsSection>
              <SettingsSection title={t("theme")} description={t("themeHint")}>
                <SettingsRow label={t("theme")} stacked>
                  <ThemePicker
                    value={appearance.theme}
                    onChange={(theme) => void update({ appearance: { theme, autoAccent: false } })}
                    auto={appearance.autoAccent}
                    onAuto={() => void update({ appearance: { autoAccent: true } })}
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
              <SettingsSection title={t("trailersTitle")}>
                <SettingsRow label={t("autoplayTrailers")} hint={t("autoplayTrailersHint")}>
                  <Toggle
                    checked={appearance.autoplayTrailers}
                    onChange={(autoplayTrailers) => void update({ appearance: { autoplayTrailers } })}
                    label={t("autoplayTrailers")}
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
              <SubtitleStyleSection />
              <SettingsSection title={t("seekStepTitle")}>
                <SettingsRow label={t("seekStep")} hint={t("seekStepHint")}>
                  <SegmentedControl<number>
                    label={t("seekStep")}
                    value={playback.seekStep}
                    onChange={(seekStep) => void update({ playback: { seekStep } })}
                    options={[5, 10, 15, 30].map((n) => ({ value: n, label: `${n} s` }))}
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
              <WatchingSection />
              <OpenSubtitlesSection />
            </>
          ) : null}

          {section === "addons" ? <AddonsSection onToast={onToast} /> : null}

          {section === "torrents" ? <AddonsSection onToast={onToast} part="torrents" /> : null}

          {section === "updates" ? <UpdatesSection version={version} /> : null}

          {section === "iptv" ? <IptvSection onToast={onToast} /> : null}

          {section === "discord" ? <DiscordSection /> : null}


          {section === "account" ? (
            <>
              <AccountSettings onToast={onToast} />
              {session.mode === "local" ? (
                <LocalAccount
                  session={session}
                  onSessionChange={onSessionChange}
                  onSwitchProfile={onSwitchProfile}
                  onToast={onToast}
                />
              ) : (
                <SettingsSection title={t("account")}>
                  <div className="flex items-center gap-4 py-3">
                    <Avatar src={sessionAvatar(session)} name={session.userName} size={56} />
                    <div className="min-w-0">
                      <p className="truncate text-[16px] font-semibold">{session.userName}</p>
                      <p className="flex items-center gap-1.5 truncate text-[13px] text-dim">
                        <Server size={13} />
                        {server?.serverName ?? session.serverName ?? "Jellyfin"} · {server?.serverUrl ?? session.serverUrl}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3 py-4">
                    <button type="button" onClick={onSwitchProfile} className={tonal}>
                      <Users size={16} />
                      {t("switchProfile")}
                    </button>
                    <ConfirmButton
                      confirmLabel={t("signOut")}
                      onConfirm={onLogout}
                      trigger={(ask) => (
                        <button type="button" onClick={ask} className={tonal}>
                          <LogOut size={16} />
                          {t("signOut")}
                        </button>
                      )}
                    />
                  </div>
                </SettingsSection>
              )}
            </>
          ) : null}

          {section === "about" ? <AboutSection version={version} withUpdates={false} /> : null}

          {section === "parental" ? <ParentalSection onToast={onToast} /> : null}

          {section === "trakt" ? <TraktSection onToast={onToast} /> : null}
        </div>
      </div>
    </div>
  );
}
