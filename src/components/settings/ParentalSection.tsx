import { useEffect, useState } from "react";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { api } from "../../lib/api";
import { useI18n } from "../../lib/locale-context";
import { PARENTAL_LEVELS, parentalLevelKey, useParental } from "../../lib/parental";
import type { ParentalLevel } from "../../lib/types";
import { ParentalPinDialog } from "../ParentalPinDialog";
import { SegmentedControl } from "./SegmentedControl";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { Toggle } from "./Toggle";

const tonal =
  "btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-white/12 px-5 text-[14px] font-semibold hover:bg-white/18 disabled:opacity-60";

/**
 * Settings › Parental controls: the age limit of the open profile. The choice is staged
 * here and saved behind the parental PIN (created the first time a limit is set).
 */
export function ParentalSection({ onToast }: { onToast: (message: string) => void }) {
  const { t } = useI18n();
  const status = useParental();
  const [maxAge, setMaxAge] = useState<ParentalLevel>(18);
  const [hideUnrated, setHideUnrated] = useState(false);
  const [dialog, setDialog] = useState<"save" | "change-pin" | null>(null);

  useEffect(() => {
    if (!status) return;
    setMaxAge(status.maxAge);
    setHideUnrated(status.hideUnrated);
  }, [status]);

  if (!status) {
    return (
      <SettingsSection title={t("parentalTitle")}>
        <div className="grid place-items-center py-8">
          <LoaderCircle size={20} className="animate-spin text-dim" />
        </div>
      </SettingsSection>
    );
  }

  const dirty = maxAge !== status.maxAge || (maxAge < 18 && hideUnrated !== status.hideUnrated);
  const saveSteps = status.pinSet ? (["current"] as const) : (["new", "confirm"] as const);

  return (
    <>
      <SettingsSection title={t("parentalTitle")} description={t("parentalHint")}>
        <div className="flex items-center gap-3 py-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <ShieldCheck size={18} />
          </span>
          <p className="text-[14px] text-muted">
            {status.active
              ? t("parentalActive", { level: t(parentalLevelKey(status.maxAge)) })
              : t("parentalInactive")}
          </p>
        </div>
        <SettingsRow label={t("parentalMaxRating")} hint={t("parentalMaxRatingHint")} stacked>
          <SegmentedControl<ParentalLevel>
            label={t("parentalMaxRating")}
            value={maxAge}
            options={PARENTAL_LEVELS.map((level) => ({ value: level, label: t(parentalLevelKey(level)) }))}
            onChange={setMaxAge}
          />
        </SettingsRow>
        {maxAge < 18 ? (
          <SettingsRow label={t("parentalHideUnrated")} hint={t("parentalHideUnratedHint")}>
            <Toggle checked={hideUnrated} onChange={setHideUnrated} label={t("parentalHideUnrated")} />
          </SettingsRow>
        ) : null}
        <div className="flex flex-wrap gap-3 py-4">
          <button
            type="button"
            disabled={!dirty}
            onClick={() => setDialog("save")}
            className="btn-press inline-flex h-11 items-center gap-2 rounded-btn bg-accent px-5 text-[14px] font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
          >
            <ShieldCheck size={16} />
            {t("parentalSave")}
          </button>
          {status.pinSet ? (
            <button type="button" onClick={() => setDialog("change-pin")} className={tonal}>
              <KeyRound size={16} />
              {t("parentalChangePin")}
            </button>
          ) : null}
        </div>
        <p className="pb-3 text-[12px] text-dim">{t("parentalScopeHint")}</p>
      </SettingsSection>

      {dialog === "save" ? (
        <ParentalPinDialog
          steps={[...saveSteps]}
          title={status.pinSet ? t("parentalSave") : t("parentalCreatePin")}
          hint={status.pinSet ? undefined : t("parentalCreatePinHint")}
          onClose={() => setDialog(null)}
          onSubmit={async ({ current, next }) => {
            await api.parentalSet(status.pinSet ? current : next, maxAge, maxAge < 18 && hideUnrated);
            setDialog(null);
            onToast(t("parentalSaved"));
          }}
        />
      ) : null}
      {dialog === "change-pin" ? (
        <ParentalPinDialog
          steps={["current", "new", "confirm"]}
          title={t("parentalChangePin")}
          onClose={() => setDialog(null)}
          onSubmit={async ({ current, next }) => {
            await api.parentalSet(current, status.maxAge, status.hideUnrated, next);
            setDialog(null);
            onToast(t("parentalPinChanged"));
          }}
        />
      ) : null}
    </>
  );
}
