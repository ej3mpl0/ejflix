import { useEffect, useMemo, useState } from "react";
import { Film } from "lucide-react";
import type { DiscordHeader, DiscordStatus } from "../../lib/types";
import { SegmentedControl } from "./SegmentedControl";
import { api } from "../../lib/api";
import { cn } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { useSettings } from "../../lib/settings-context";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { Toggle } from "./Toggle";
import { fieldClass as field } from "../../lib/ui";

const VARIABLES = ["{title}", "{episode}", "{year}", "{type}", "{source}"];

/** Fills a template with sample values for the preview card. */
function sample(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) out = out.split(`{${key}}`).join(value);
  return out
    .replace(/\(\)/g, "")
    .replace(/^[\s·\-|,]+|[\s·\-|,]+$/g, "")
    .trim();
}

/** Settings › Discord: Rich Presence toggle, templates and a live preview. */
export function DiscordSection() {
  const { t, locale } = useI18n();
  const { settings, update } = useSettings();
  const prefs = settings.discord;
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [details, setDetails] = useState(prefs.details);
  const [state, setState] = useState(prefs.state);

  useEffect(() => {
    setDetails(prefs.details);
    setState(prefs.state);
  }, [prefs.details, prefs.state]);

  useEffect(() => {
    if (!prefs.enabled) {
      setStatus(null);
      return;
    }
    let alive = true;
    const poll = () => {
      api
        .discordStatus()
        .then((next) => {
          if (alive) setStatus(next);
        })
        .catch(() => undefined);
    };
    poll();
    const handle = window.setInterval(poll, 5000);
    return () => {
      alive = false;
      window.clearInterval(handle);
    };
  }, [prefs.enabled]);

  const vars = useMemo(
    () => ({
      title: t("discordSampleTitle"),
      episode: t("discordSampleEpisode"),
      year: "1999",
      type: t("movie"),
      source: "Jellyfin",
    }),
    [t, locale],
  );
  const previewDetails = sample(details, vars) || t("discordSampleTitle");
  const previewState = sample(state, vars);
  const previewHeader =
    prefs.header === "name" ? "ejFlix" : prefs.header === "state" ? previewState || previewDetails : previewDetails;

  const commit = (patch: Partial<typeof prefs>) => void update({ discord: patch });

  const statusLine = !prefs.enabled
    ? null
    : status?.connected
      ? { text: t("discordConnected"), tone: "text-success" }
      : status?.error
        ? { text: `${t("discordDisconnected")} · ${status.error}`, tone: "text-dim" }
        : { text: t("discordIdle"), tone: "text-dim" };

  return (
    <>
      <SettingsSection title={t("discord")} description={t("discordHint")}>
        <SettingsRow label={t("discordEnable")} hint={statusLine?.text}>
          <div className="flex items-center gap-3">
            {statusLine ? (
              <span
                aria-hidden
                className={cn(
                  "h-2 w-2 rounded-full",
                  status?.connected ? "bg-success" : "bg-white/25",
                )}
              />
            ) : null}
            <Toggle checked={prefs.enabled} onChange={(enabled) => commit({ enabled })} label={t("discordEnable")} />
          </div>
        </SettingsRow>
        <SettingsRow label={t("discordHeader")} hint={t("discordHeaderHint")}>
          <SegmentedControl<DiscordHeader>
            label={t("discordHeader")}
            value={prefs.header}
            options={[
              { value: "details", label: t("discordDetails") },
              { value: "state", label: t("discordState") },
              { value: "name", label: t("discordHeaderName") },
            ]}
            onChange={(header) => commit({ header })}
          />
        </SettingsRow>
        <SettingsRow label={t("discordShowPoster")} hint={t("discordShowPosterHint")}>
          <Toggle checked={prefs.showPoster} onChange={(showPoster) => commit({ showPoster })} label={t("discordShowPoster")} />
        </SettingsRow>
        <SettingsRow label={t("discordShowTime")}>
          <Toggle checked={prefs.showTime} onChange={(showTime) => commit({ showTime })} label={t("discordShowTime")} />
        </SettingsRow>
        <SettingsRow label={t("discordShowPaused")} hint={t("discordShowPausedHint")}>
          <Toggle checked={prefs.showPaused} onChange={(showPaused) => commit({ showPaused })} label={t("discordShowPaused")} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("discordPreview")} description={t("discordTemplateHint")}>
        <div className="grid gap-6 py-4 md:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">{t("discordDetails")}</span>
              <input
                value={details}
                maxLength={128}
                onChange={(e) => setDetails(e.target.value)}
                onBlur={() => details !== prefs.details && commit({ details })}
                className={field}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">{t("discordState")}</span>
              <input
                value={state}
                maxLength={128}
                onChange={(e) => setState(e.target.value)}
                onBlur={() => state !== prefs.state && commit({ state })}
                className={field}
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {VARIABLES.map((v) => (
                <span key={v} className="rounded-md bg-white/6 px-2 py-0.5 font-mono text-[12px] text-muted">
                  {v}
                </span>
              ))}
            </div>
          </div>

          {/* Discord-style card */}
          <div className="self-start rounded-2xl bg-[#111214] p-4 text-white shadow-[0_0_0_1px_rgb(255_255_255_/_0.08)]">
            <p className="mb-3 truncate text-[11px] font-bold tracking-wide text-white/60 uppercase">
              {t("discordWatching", { what: previewHeader })}
            </p>
            <div className="flex gap-3">
              <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-[#2b2d31]">
                {prefs.showPoster ? (
                  <div className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,#1e88e5,#0d47a1)] text-white/90">
                    <Film size={28} />
                  </div>
                ) : (
                  <div className="grid h-full w-full place-items-center text-[20px] font-bold text-white/80">ej</div>
                )}
              </div>
              <div className="min-w-0 flex-1 text-[13px] leading-[1.35]">
                <p className="truncate font-semibold">ejFlix</p>
                <p className="truncate text-white/85">{previewDetails}</p>
                {previewState ? <p className="truncate text-white/85">{previewState}</p> : null}
                {prefs.showTime ? (
                  <div className="mt-1.5">
                    <div className="h-1 w-full overflow-hidden rounded-full bg-white/15">
                      <div className="h-full w-[38%] rounded-full bg-white/80" />
                    </div>
                    <p className="mt-1 text-[11px] text-white/60 tabular">
                      {t("discordRemaining", { time: "1:24:10" })}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}
