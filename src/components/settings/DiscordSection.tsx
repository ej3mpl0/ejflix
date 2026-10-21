import { useEffect, useMemo, useRef, useState } from "react";
import { Film, RotateCcw } from "lucide-react";
import type { DiscordHeader, DiscordStatus } from "../../lib/types";
import { SegmentedControl } from "./SegmentedControl";
import { api } from "../../lib/api";
import { cn } from "../../lib/format";
import { useI18n } from "../../lib/locale-context";
import { useSettings } from "../../lib/settings-context";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { Toggle } from "./Toggle";
import { fieldClass as field } from "../../lib/ui";
import { Mark } from "../Mark";

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
      year: "2008",
      type: t("discordSampleType"),
      source: "Jellyfin",
    }),
    [t, locale],
  );
  const previewDetails = sample(details, vars) || t("discordSampleTitle");
  const previewState = sample(state, vars);
  // Discord adds "(1 of 7)" after the state line; the app only sends it when that line has the episode.
  const previewParty = state.includes("{episode}") ? t("discordPartyCount", { n: 1, max: 7 }) : "";
  const previewHeader =
    prefs.header === "name" ? "ejFlix" : prefs.header === "state" ? previewState || previewDetails : previewDetails;

  const commit = (patch: Partial<typeof prefs>) => void update({ discord: patch });
  const detailsRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);
  /** Field the variable chips write into: the last one focused. */
  const lastField = useRef<"details" | "state">("details");

  /** Puts a variable at the caret of the last focused template and saves it. */
  const insert = (variable: string) => {
    const which = lastField.current;
    const input = which === "details" ? detailsRef.current : stateRef.current;
    const value = which === "details" ? details : state;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    const next = (value.slice(0, start) + variable + value.slice(end)).slice(0, 128);
    if (which === "details") setDetails(next);
    else setState(next);
    commit({ [which]: next });
    requestAnimationFrame(() => {
      input?.focus();
      const caret = Math.min(next.length, start + variable.length);
      input?.setSelectionRange(caret, caret);
    });
  };

  const resetTemplates = () => {
    setDetails("{title}");
    setState("{episode}");
    commit({ details: "{title}", state: "{episode}" });
  };

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
                ref={detailsRef}
                value={details}
                maxLength={128}
                onFocus={() => (lastField.current = "details")}
                onChange={(e) => setDetails(e.target.value)}
                onBlur={() => details !== prefs.details && commit({ details })}
                className={field}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">{t("discordState")}</span>
              <input
                ref={stateRef}
                value={state}
                maxLength={128}
                onFocus={() => (lastField.current = "state")}
                onChange={(e) => setState(e.target.value)}
                onBlur={() => state !== prefs.state && commit({ state })}
                className={field}
              />
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  // Keep the caret in the field while clicking a chip.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(v)}
                  title={t("discordInsertVar")}
                  className="rounded-md bg-white/6 px-2 py-0.5 font-mono text-[12px] text-muted hover:bg-white/12 hover:text-text"
                >
                  {v}
                </button>
              ))}
              <button
                type="button"
                onClick={resetTemplates}
                disabled={details === "{title}" && state === "{episode}"}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-medium text-dim hover:bg-white/8 hover:text-text disabled:opacity-40"
              >
                <RotateCcw size={12} />
                {t("discordResetTemplates")}
              </button>
            </div>
          </div>

          {/* Discord-style card: poster with the ejFlix j in its corner (the j alone without a poster). */}
          <div className="self-start rounded-2xl bg-[#111214] p-4 text-white shadow-[0_0_0_1px_rgb(255_255_255_/_0.08)]">
            <p className="mb-3 truncate text-[13px] font-bold text-white/90">
              {t("discordWatching", { what: previewHeader })}
            </p>
            <div className="flex items-center gap-3">
              <div className="relative h-[72px] w-[72px] shrink-0">
                {prefs.showPoster ? (
                  <>
                    <div className="grid h-full w-full place-items-center overflow-hidden rounded-lg bg-[linear-gradient(160deg,#3d5a2a,#16210f)] text-white/80">
                      <Film size={26} />
                    </div>
                    <span className="absolute -right-1.5 -bottom-1.5 grid h-[26px] w-[26px] place-items-center rounded-full bg-base ring-4 ring-[#111214]">
                      <Mark size={20} />
                    </span>
                  </>
                ) : (
                  <Mark size={72} tile />
                )}
              </div>
              <div className="min-w-0 flex-1 text-[13px] leading-[1.4]">
                <p className="truncate text-[14px] font-semibold">{previewDetails}</p>
                {previewState || previewParty ? (
                  <p className="truncate text-white/80">{[previewState, previewParty].filter(Boolean).join(" ")}</p>
                ) : null}
                {prefs.showTime ? (
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-white/70 tabular">
                    <span>00:10</span>
                    <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/20">
                      <span className="block h-full w-[8%] rounded-full bg-white" />
                    </span>
                    <span>47:12</span>
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
