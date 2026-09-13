import { useState } from "react";
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
  Server,
  Unlink,
  Users,
  Languages as LanguagesIcon,
} from "lucide-react";
import { AddonsSection } from "../components/settings/AddonsSection";
import { DiscordSection } from "../components/settings/DiscordSection";
import { UpdatesSection } from "../components/settings/UpdatesSection";
import { hasServer as sessionHasServer, type SavedServer, type Session, type SkipMode, type Countdown } from "../lib/types";
import { api } from "../lib/api";
import { cn, sessionAvatar } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
import { Avatar } from "../components/Avatar";
import { LanguageSelect } from "../components/LanguageSelect";
import { ProfileForm } from "../components/ProfileForm";
import { SettingsRow, SettingsSection } from "../components/settings/SettingsSection";
import { Toggle } from "../components/settings/Toggle";
import { SegmentedControl } from "../components/settings/SegmentedControl";
import { ThemePicker } from "../components/settings/ThemePicker";
import { LanguagePicker } from "../components/settings/LanguagePicker";

type Section = "appearance" | "playback" | "addons" | "discord" | "language" | "account";

const field =
  "h-11 w-full rounded-btn border border-white/12 bg-black/40 px-3 text-sm text-text outline-none placeholder:text-dim focus:border-accent";
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
  onToast: (message: string) => void;
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
      setError(err instanceof Error ? err.message : String(err));
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
      onToast(err instanceof Error ? err.message : String(err));
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
              <button type="button" disabled={busy} onClick={() => void unlink()} className={tonal}>
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : <Unlink size={16} />}
                {t("disconnectServer")}
              </button>
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
            {error ? <p className="text-[13px] text-accent">{error}</p> : null}
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

export function Settings({
  session,
  server,
  version,
  onSessionChange,
  onSwitchProfile,
  onLogout,
  onBack,
  onToast,
}: {
  session: Session;
  server: SavedServer | null;
  version: string | null;
  onSessionChange: (session: Session) => void;
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
    { id: "discord", label: t("discord"), icon: MessageCircle },
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

          {section === "discord" ? <DiscordSection /> : null}

          {section === "language" ? (
            <SettingsSection title={t("language")}>
              <SettingsRow label={t("appLanguage")}>
                <LanguageSelect />
              </SettingsRow>
            </SettingsSection>
          ) : null}

          {section === "account" ? (
            <>
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
                    <button type="button" onClick={onLogout} className={tonal}>
                      <LogOut size={16} />
                      {t("signOut")}
                    </button>
                  </div>
                </SettingsSection>
              )}
              <UpdatesSection version={version} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
