import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Magnet, Puzzle, ShieldOff } from "lucide-react";
import { Logo } from "../components/Logo";
import { WindowControls } from "../components/WindowControls";
import { LanguageSelect } from "../components/LanguageSelect";
import { AddonImport } from "../components/AddonImport";
import { Pill } from "../components/Pill";
import { Toggle } from "../components/settings/Toggle";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";

type Step = "torrents" | "addons";

/**
 * First-run setup of a profile, shown once before Home: whether addon sources that come as
 * torrents may play in the app, and bringing the addons the person already uses elsewhere.
 * Everything here stays editable in Settings, so each step can be skipped.
 */
export function SetupStep({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const [step, setStep] = useState<Step>("torrents");
  const [imported, setImported] = useState(0);
  const torrents = settings.torrents.enabled;

  const finish = () => {
    void update({ onboarding: { setupDone: true } });
    onDone();
  };

  const choice = (on: boolean, icon: typeof Magnet, title: string, hint: string) => {
    const Icon = icon;
    const active = torrents === on;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => void update({ torrents: { enabled: on } })}
        className={cn(
          "btn-press flex flex-1 basis-[180px] flex-col items-start gap-3 rounded-btn border p-4 text-left transition-colors duration-150",
          active ? "border-accent bg-accent-soft" : "border-white/10 bg-black/25 hover:border-white/20",
        )}
      >
        <span className="flex w-full items-center justify-between">
          <span
            className={cn(
              "grid h-10 w-10 place-items-center rounded-xl",
              active ? "bg-accent text-on-accent" : "bg-white/8 text-muted",
            )}
          >
            <Icon size={20} />
          </span>
          {active ? <Check size={18} className="text-accent" /> : null}
        </span>
        <span>
          <span className="block text-[15px] font-semibold">{title}</span>
          <span className="mt-1 block text-[12px] leading-[1.5] text-dim">{hint}</span>
        </span>
      </button>
    );
  };

  const steps: Step[] = ["torrents", "addons"];
  const index = steps.indexOf(step);

  return (
    <div className="grain fixed inset-0 z-[65] flex flex-col bg-base">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_0%,color-mix(in_oklab,var(--color-accent)_12%,transparent),transparent_55%)]" />
      <div className="relative z-10 flex h-[60px] items-center justify-between px-6" data-tauri-drag-region>
        <div data-tauri-drag-region>
          <Logo />
        </div>
        <div className="flex items-center gap-2">
          <LanguageSelect />
          <WindowControls />
        </div>
      </div>
      <div className="relative z-10 flex flex-1 items-start justify-center overflow-y-auto px-6 py-8">
        <div className="modal-enter w-[560px] max-w-full rounded-card bg-surface p-8 shadow-[0_24px_64px_rgb(0_0_0_/_0.45),0_0_0_1px_rgb(255_255_255_/_0.06)]">
          {/* Step indicator */}
          <div className="mb-6 flex items-center gap-3" aria-label={t("setupProgress", { n: index + 1, total: steps.length })}>
            {steps.map((s, i) => (
              <span
                key={s}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors duration-300",
                  i <= index ? "bg-accent" : "bg-white/12",
                )}
              />
            ))}
            <span className="shrink-0 text-[12px] text-dim tabular">
              {index + 1}/{steps.length}
            </span>
          </div>

          {step === "torrents" ? (
            <>
              <h1 className="mb-1 text-[24px] font-semibold tracking-tight [text-wrap:balance]">{t("setupTorrentsTitle")}</h1>
              <p className="mb-6 text-[13px] leading-[1.55] text-dim">{t("setupTorrentsText")}</p>
              <div role="radiogroup" aria-label={t("setupTorrentsTitle")} className="flex flex-wrap gap-3">
                {choice(true, Magnet, t("setupTorrentsOn"), t("setupTorrentsOnHint"))}
                {choice(false, ShieldOff, t("setupTorrentsOff"), t("setupTorrentsOffHint"))}
              </div>
              {torrents ? (
                <div className="mt-4 flex items-center justify-between gap-4 rounded-btn bg-black/25 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">{t("torrentsShare")}</p>
                    <p className="mt-0.5 text-[12px] text-dim">{t("torrentsShareHint")}</p>
                  </div>
                  <Toggle
                    checked={settings.torrents.share}
                    onChange={(share) => void update({ torrents: { share } })}
                    label={t("torrentsShare")}
                  />
                </div>
              ) : null}
              <p className="mt-4 text-[12px] text-dim">{t("setupLater")}</p>
              <div className="mt-6 flex items-center justify-between gap-3">
                <Pill variant="ghost" onClick={finish}>
                  {t("setupSkip")}
                </Pill>
                <Pill variant="primary" icon={<ArrowRight size={16} />} onClick={() => setStep("addons")}>
                  {t("next")}
                </Pill>
              </div>
            </>
          ) : (
            <>
              <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
                <Puzzle size={24} />
              </span>
              <h1 className="mb-1 text-[24px] font-semibold tracking-tight [text-wrap:balance]">{t("setupAddonsTitle")}</h1>
              <p className="mb-6 text-[13px] leading-[1.55] text-dim">{t("setupAddonsText")}</p>
              <AddonImport onImported={(n) => setImported((total) => total + n)} />
              <p className="mt-4 text-[12px] text-dim">{t("setupAddonsLater")}</p>
              <div className="mt-6 flex items-center justify-between gap-3">
                <Pill variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => setStep("torrents")}>
                  {t("back")}
                </Pill>
                <Pill variant="primary" icon={<Check size={16} />} onClick={finish}>
                  {imported ? t("setupFinish") : t("setupFinishNoAddons")}
                </Pill>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
