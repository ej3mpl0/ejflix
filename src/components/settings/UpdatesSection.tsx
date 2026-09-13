import { ExternalLink, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { useI18n } from "../../lib/locale-context";
import { useUpdate } from "../../lib/update-context";
import { ReleaseNotes } from "../ReleaseNotes";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { Toggle } from "./Toggle";

const tonal =
  "btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-white/12 px-5 text-[14px] font-semibold hover:bg-white/18 disabled:opacity-60";

/** Settings › Account: version, automatic checks, "check now" and this build's notes. */
export function UpdatesSection({ version }: { version: string | null }) {
  const { t } = useI18n();
  const { check, prefs, phase, checkError, checkNow, openModal, setAuto, openRelease } = useUpdate();
  const checking = phase === "checking";

  let status: { text: string; tone: string; action?: "view" } | null = null;
  if (checking) status = { text: t("updateChecking"), tone: "text-dim" };
  else if (checkError) status = { text: t("updateError", { error: checkError }), tone: "text-accent" };
  else if (check?.available) status = { text: t("updateFound", { version: check.latest }), tone: "text-success", action: "view" };
  else if (check) status = { text: t("updateUpToDate"), tone: "text-dim" };
  else if (prefs.skipped) status = { text: t("updateSkippedHint", { version: prefs.skipped }), tone: "text-dim" };

  return (
    <SettingsSection title={t("updates")}>
      <SettingsRow label={t("updateAuto")} hint={t("updateAutoHint")}>
        <Toggle checked={prefs.auto} onChange={(auto) => void setAuto(auto)} label={t("updateAuto")} />
      </SettingsRow>
      <SettingsRow label={`${t("version")} ${version ?? check?.current ?? "—"}`} hint={status?.text}>
        <div className="flex items-center gap-2">
          {status?.action === "view" ? (
            <button type="button" onClick={openModal} className={`${tonal} bg-accent text-on-accent hover:bg-accent-hover`}>
              {t("updateView")}
            </button>
          ) : null}
          <button type="button" disabled={checking} onClick={() => void checkNow()} className={tonal}>
            {checking ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {t("updateCheckNow")}
          </button>
        </div>
      </SettingsRow>
      <div className="py-3">
        <p className="mb-3 flex items-center gap-1.5 text-[13px] text-dim">
          <Info size={13} />
          {t("releaseNotes")}
        </p>
        <ReleaseNotes />
        <button type="button" onClick={openRelease} className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-text">
          <ExternalLink size={14} />
          {t("updateViewGithub")}
        </button>
      </div>
    </SettingsSection>
  );
}
