import { useEffect, useState } from "react";
import { Check, ExternalLink } from "lucide-react";
import type { Settings } from "../../lib/types";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/locale-context";
import { errorText } from "../../lib/errors";
import { useSettings } from "../../lib/settings-context";
import { fieldClass as field } from "../../lib/ui";
import { Select } from "../Select";
import { Pill } from "../Pill";
import { OUTLINES, SUB_POSITIONS, subPosLabel } from "../SubtitleTools";
import { OPENSUBTITLES_KEY_URL } from "../SubtitleSearch";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { SegmentedControl } from "./SegmentedControl";
import { Toggle } from "./Toggle";

type PlaybackPatch = Partial<Settings["playback"]>;

/** Text outline drawn with shadows, roughly as thick as mpv's outline at `size`. */
function outlineShadow(size: number): string {
  const w = Math.max(0.5, size * 0.45);
  return [`${-w}px ${-w}px 0 #000`, `${w}px ${-w}px 0 #000`, `${-w}px ${w}px 0 #000`, `${w}px ${w}px 0 #000`, `0 0 ${w}px #000`].join(", ");
}

/**
 * Subtitle look with a live preview: size, colour, background, outline, position and
 * whether styled (ASS) subtitles are restyled too. Changes also reach a video playing now.
 */
export function SubtitleStyleSection() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const playback = settings.playback;

  // Saved for the profile and, when something is playing, applied to it right away.
  const set = (patch: PlaybackPatch, live: Array<[string, unknown]>) => {
    void update({ playback: patch });
    for (const [name, value] of live) void api.playerSetProp(name, value).catch(() => undefined);
  };

  const box = playback.subBackground === "box";
  const shadow = box
    ? "none"
    : playback.subBackground === "shadow"
      ? `${outlineShadow(playback.subOutline)}, 2px 2px 3px #000`
      : outlineShadow(playback.subOutline);

  return (
    <SettingsSection title={t("subStyleTitle")} description={t("subStyleHint")}>
      {/* Preview over a frame-like backdrop; the text sits where mpv would put it. */}
      <div className="relative my-3 aspect-[16/6] max-h-44 w-full overflow-hidden rounded-btn bg-[linear-gradient(135deg,#3a4a5a,#1b232b_60%,#4a3a2a)]">
        <span
          className="absolute left-1/2 max-w-[90%] -translate-x-1/2 rounded px-2 text-center font-semibold whitespace-nowrap transition-[bottom] duration-150"
          style={{
            bottom: `calc(${100 - playback.subPos}% + 10px)`,
            color: playback.subColor,
            fontSize: `${Math.round(18 * playback.subScale)}px`,
            background: box ? "rgb(0 0 0 / 0.7)" : "transparent",
            textShadow: shadow,
          }}
        >
          {t("subPreview")}
        </span>
      </div>
      <SettingsRow label={t("subSize")}>
        <Select
          label={t("subSize")}
          value={String(playback.subScale)}
          onChange={(value) => set({ subScale: Number(value) }, [["sub-scale", Number(value)]])}
          className="min-w-[130px]"
          options={[0.7, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2].map((v) => ({ value: String(v), label: `${Math.round(v * 100)}%` }))}
        />
      </SettingsRow>
      <SettingsRow label={t("subColor")}>
        <SegmentedControl
          label={t("subColor")}
          value={playback.subColor}
          onChange={(subColor) => set({ subColor }, [["sub-color", subColor]])}
          options={[
            { value: "#FFFFFF", label: t("colorWhite") },
            { value: "#FFE45C", label: t("colorYellow") },
            { value: "#7DF9FF", label: t("colorCyan") },
            { value: "#9CFF8A", label: t("colorGreen") },
          ]}
        />
      </SettingsRow>
      <SettingsRow label={t("subBackground")}>
        <SegmentedControl
          label={t("subBackground")}
          value={playback.subBackground}
          onChange={(subBackground) => set({ subBackground }, [["sub-background", subBackground]])}
          options={[
            { value: "outline", label: t("subBgOutline") },
            { value: "shadow", label: t("subBgShadow") },
            { value: "box", label: t("subBgBox") },
          ]}
        />
      </SettingsRow>
      {!box ? (
        <SettingsRow label={t("subOutline")}>
          <SegmentedControl<number>
            label={t("subOutline")}
            value={playback.subOutline}
            onChange={(subOutline) => set({ subOutline }, [["sub-outline", subOutline]])}
            options={OUTLINES.map((option) => ({ value: option.value, label: t(option.key) }))}
          />
        </SettingsRow>
      ) : null}
      <SettingsRow label={t("subPosition")} hint={t("subPositionHint")}>
        <Select
          label={t("subPosition")}
          value={String(playback.subPos)}
          onChange={(value) => set({ subPos: Number(value) }, [["sub-pos", Number(value)]])}
          className="min-w-[170px]"
          options={[...new Set([...SUB_POSITIONS, playback.subPos])]
            .sort((a, b) => b - a)
            .map((v) => ({ value: String(v), label: subPosLabel(v, t) }))}
        />
      </SettingsRow>
      <SettingsRow label={t("subAssOverride")} hint={t("subAssOverrideHint")}>
        <Toggle
          checked={playback.subAssOverride}
          onChange={(subAssOverride) => set({ subAssOverride }, [["sub-ass-override", subAssOverride]])}
          label={t("subAssOverride")}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

/** When a title counts as watched, and night mode by default. */
export function WatchingSection() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const playback = settings.playback;
  return (
    <SettingsSection title={t("whilePlayingTitle")}>
      <SettingsRow label={t("watchedThreshold")} hint={t("watchedThresholdHint")}>
        <SegmentedControl<number>
          label={t("watchedThreshold")}
          value={playback.watchedThreshold}
          onChange={(watchedThreshold) => void update({ playback: { watchedThreshold } })}
          options={[80, 85, 90, 95].map((n) => ({ value: n, label: `${n}%` }))}
        />
      </SettingsRow>
      <SettingsRow label={t("nightModeDefault")} hint={t("nightModeHint")}>
        <Toggle
          checked={playback.nightMode}
          onChange={(nightMode) => void update({ playback: { nightMode } })}
          label={t("nightModeDefault")}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

/** OpenSubtitles.com: the API key (required), and an optional account for a bigger quota. */
export function OpenSubtitlesSection() {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const playback = settings.playback;
  const [apiKey, setApiKey] = useState(playback.opensubtitlesApiKey);
  const [user, setUser] = useState(playback.opensubtitlesUser);
  const [password, setPassword] = useState("");
  const [hasPassword, setHasPassword] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setApiKey(playback.opensubtitlesApiKey), [playback.opensubtitlesApiKey]);
  useEffect(() => setUser(playback.opensubtitlesUser), [playback.opensubtitlesUser]);
  useEffect(() => {
    api
      .opensubtitlesHasPassword()
      .then(setHasPassword)
      .catch(() => undefined);
  }, []);

  const savePassword = (value: string) => {
    setError("");
    api
      .opensubtitlesSetPassword(value)
      .then(() => {
        setHasPassword(Boolean(value));
        setPassword("");
        setSaved(Boolean(value));
      })
      .catch((err) => setError(errorText(t, err)));
  };

  return (
    <SettingsSection title={t("opensubtitlesTitle")} description={t("opensubtitlesHint")}>
      <div className="space-y-4 py-4">
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">{t("opensubtitlesApiKey")}</span>
          <input
            value={apiKey}
            maxLength={128}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setApiKey(e.target.value.trim())}
            onBlur={() => apiKey !== playback.opensubtitlesApiKey && void update({ playback: { opensubtitlesApiKey: apiKey } })}
            className={`${field} font-mono`}
          />
        </label>
        {!playback.opensubtitlesApiKey ? (
          <div className="flex flex-wrap items-center gap-3 rounded-btn bg-white/4 px-3 py-2.5 text-[12px] text-dim">
            <span className="min-w-0 flex-1">{t("opensubtitlesKeyHint")}</span>
            <Pill
              size="sm"
              variant="ghost"
              icon={<ExternalLink size={14} />}
              onClick={() => void api.openExternal(OPENSUBTITLES_KEY_URL).catch(() => undefined)}
            >
              {t("opensubtitlesGetKey")}
            </Pill>
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">{t("opensubtitlesUser")}</span>
            <input
              value={user}
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setUser(e.target.value)}
              onBlur={() => user.trim() !== playback.opensubtitlesUser && void update({ playback: { opensubtitlesUser: user.trim() } })}
              className={field}
            />
          </label>
          <form
            className="block"
            onSubmit={(e) => {
              e.preventDefault();
              if (password) savePassword(password);
            }}
          >
            <span className="mb-1.5 block text-[13px] font-medium">{t("opensubtitlesPassword")}</span>
            <span className="flex gap-2">
              <input
                type="password"
                value={password}
                maxLength={256}
                autoComplete="new-password"
                aria-label={t("opensubtitlesPassword")}
                placeholder={hasPassword ? "••••••••" : ""}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setSaved(false);
                }}
                className={field}
              />
              {password ? (
                <Pill type="submit" size="sm" className="h-11">
                  {t("save")}
                </Pill>
              ) : hasPassword ? (
                <Pill size="sm" variant="ghost" className="h-11" onClick={() => savePassword("")}>
                  {t("opensubtitlesForget")}
                </Pill>
              ) : null}
            </span>
          </form>
        </div>
        {saved ? (
          <p className="flex items-center gap-1.5 text-[12px] text-dim">
            <Check size={13} />
            {t("opensubtitlesSaved")}
          </p>
        ) : null}
        {error ? <p className="text-[12px] text-danger">{error}</p> : null}
        <p className="text-[12px] text-dim">{t("opensubtitlesAccountHint")}</p>
      </div>
    </SettingsSection>
  );
}
