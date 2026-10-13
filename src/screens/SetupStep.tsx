import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, ExternalLink, LoaderCircle, Magnet, Palette, Play, Puzzle, Settings2, ShieldOff } from "lucide-react";
import { Logo } from "../components/Logo";
import { WindowControls } from "../components/WindowControls";
import { LanguageSelect } from "../components/LanguageSelect";
import { AddonImport } from "../components/AddonImport";
import { Pill } from "../components/Pill";
import { Toggle } from "../components/settings/Toggle";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
import { ThemePicker } from "../components/settings/ThemePicker";
import { LanguagePicker } from "../components/settings/LanguagePicker";
import { api } from "../lib/api";
import { isPeerflixFree, isPeerflixUrl, PEERFLIX_CONFIG_URL } from "../lib/addons";
import { errorText } from "../lib/errors";
import { fieldClass } from "../lib/ui";

type Step = "style" | "torrents" | "peerflix" | "addons";

/**
 * First-run setup of a profile, shown once before Home: whether addon sources that come as
 * torrents may play in the app, Peerflix (free or configured), and bringing the addons the
 * person already uses elsewhere. Everything here stays editable in Settings, so each step
 * can be skipped.
 */
export function SetupStep({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const [step, setStep] = useState<Step>("style");
  const [imported, setImported] = useState(0);
  const [peerflixMode, setPeerflixMode] = useState<"free" | "configure">("free");
  const [manifest, setManifest] = useState("");
  const [peerflixError, setPeerflixError] = useState<string | null>(null);
  const [peerflixBusy, setPeerflixBusy] = useState(false);
  const torrents = settings.torrents.enabled;

  const finish = () => {
    void update({ onboarding: { setupDone: true } });
    onDone();
  };

  const openPeerflixConfig = () => {
    void api.openExternal(PEERFLIX_CONFIG_URL).catch(() => undefined);
  };

  /** Drops a configured Peerflix manifest and leaves the free one installed. */
  const keepFreePeerflix = async () => {
    setPeerflixBusy(true);
    setPeerflixError(null);
    try {
      await update({
        addons: {
          urls: settings.addons.urls.filter((url) => !isPeerflixUrl(url)),
          disabled: settings.addons.disabled.filter((url) => !isPeerflixUrl(url)),
          peerflix: true,
        },
      });
      setStep("addons");
    } catch (err) {
      setPeerflixError(errorText(t, err));
    } finally {
      setPeerflixBusy(false);
    }
  };

  /** Replaces the free install with the manifest copied from the Peerflix page. */
  const applyPeerflix = async () => {
    const value = manifest.trim();
    if (!isPeerflixUrl(value)) {
      setPeerflixError(t("setupPeerflixInvalid"));
      return;
    }
    if (isPeerflixFree(value)) {
      await keepFreePeerflix();
      return;
    }
    setPeerflixBusy(true);
    setPeerflixError(null);
    try {
      await api.addonAdd(value);
      setStep("addons");
    } catch (err) {
      setPeerflixError(errorText(t, err));
    } finally {
      setPeerflixBusy(false);
    }
  };

  const choice = (active: boolean, icon: typeof Magnet, title: string, hint: string, onClick: () => void) => {
    const Icon = icon;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        onClick={onClick}
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

  const steps: Step[] = ["style", "torrents", "peerflix", "addons"];
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

          {step === "style" ? (
            <>
              <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
                <Palette size={24} />
              </span>
              <h1 className="mb-1 text-[24px] font-semibold tracking-tight [text-wrap:balance]">{t("setupStyleTitle")}</h1>
              <p className="mb-6 text-[13px] leading-[1.55] text-dim">{t("setupStyleText")}</p>
              <p className="mb-2 text-[13px] font-medium">{t("theme")}</p>
              <ThemePicker
                value={settings.appearance.theme}
                onChange={(theme) => void update({ appearance: { theme, autoAccent: false } })}
                auto={settings.appearance.autoAccent}
                onAuto={() => void update({ appearance: { autoAccent: true } })}
              />
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-[13px] font-medium">{t("appLanguage")}</p>
                  <LanguageSelect />
                </div>
                <div>
                  <p className="mb-2 text-[13px] font-medium">{t("preferredSubtitles")}</p>
                  <LanguagePicker
                    kind="subtitle"
                    label={t("preferredSubtitles")}
                    value={settings.playback.subtitleLanguage}
                    onChange={(subtitleLanguage) => void update({ playback: { subtitleLanguage } })}
                  />
                </div>
              </div>
              <div className="mt-8 flex items-center justify-between gap-3">
                <Pill variant="ghost" onClick={finish}>
                  {t("setupSkip")}
                </Pill>
                <Pill variant="primary" icon={<ArrowRight size={16} />} onClick={() => setStep("torrents")}>
                  {t("next")}
                </Pill>
              </div>
            </>
          ) : step === "torrents" ? (
            <>
              <h1 className="mb-1 text-[24px] font-semibold tracking-tight [text-wrap:balance]">{t("setupTorrentsTitle")}</h1>
              <p className="mb-6 text-[13px] leading-[1.55] text-dim">{t("setupTorrentsText")}</p>
              <div role="radiogroup" aria-label={t("setupTorrentsTitle")} className="flex flex-wrap gap-3">
                {choice(torrents, Magnet, t("setupTorrentsOn"), t("setupTorrentsOnHint"), () => void update({ torrents: { enabled: true } }))}
                {choice(!torrents, ShieldOff, t("setupTorrentsOff"), t("setupTorrentsOffHint"), () => void update({ torrents: { enabled: false } }))}
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
                <Pill variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => setStep("style")}>
                  {t("back")}
                </Pill>
                <Pill variant="primary" icon={<ArrowRight size={16} />} onClick={() => setStep("peerflix")}>
                  {t("next")}
                </Pill>
              </div>
            </>
          ) : step === "peerflix" ? (
            <>
              <h1 className="mb-1 text-[24px] font-semibold tracking-tight [text-wrap:balance]">{t("setupPeerflixTitle")}</h1>
              <p className="mb-6 text-[13px] leading-[1.55] text-dim">{t("setupPeerflixText")}</p>
              <div role="radiogroup" aria-label={t("setupPeerflixTitle")} className="flex flex-wrap gap-3">
                {choice(peerflixMode === "free", Play, t("setupPeerflixFree"), t("setupPeerflixFreeHint"), () => {
                  setPeerflixMode("free");
                  setPeerflixError(null);
                })}
                {choice(peerflixMode === "configure", Settings2, t("setupPeerflixConfigure"), t("setupPeerflixConfigureHint"), () => {
                  setPeerflixMode("configure");
                  setPeerflixError(null);
                  openPeerflixConfig();
                })}
              </div>
              {peerflixMode === "free" && !torrents ? (
                <div className="mt-4 rounded-btn bg-black/25 px-4 py-3">
                  <p className="text-[13px] leading-[1.5] text-dim">{t("setupPeerflixTorrentsOff")}</p>
                  <Pill className="mt-3" onClick={() => void update({ torrents: { enabled: true } })}>
                    {t("setupPeerflixEnableTorrents")}
                  </Pill>
                </div>
              ) : null}
              {peerflixMode === "configure" ? (
                <form
                  className="mt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void applyPeerflix();
                  }}
                >
                  <label className="mb-1.5 block text-[13px] font-medium" htmlFor="peerflix-manifest">
                    {t("setupPeerflixPaste")}
                  </label>
                  <input
                    id="peerflix-manifest"
                    value={manifest}
                    onChange={(e) => {
                      setManifest(e.target.value);
                      setPeerflixError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void applyPeerflix();
                      }
                    }}
                    placeholder="https://addon.peerflix.mov/…/manifest.json"
                    autoComplete="off"
                    spellCheck={false}
                    className={fieldClass}
                  />
                  <p className="mt-1.5 text-[12px] leading-[1.45] text-dim">{t("setupPeerflixPasteHint")}</p>
                  <button
                    type="button"
                    onClick={openPeerflixConfig}
                    className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
                  >
                    <ExternalLink size={14} />
                    {t("setupPeerflixOpen")}
                  </button>
                </form>
              ) : null}
              {peerflixError ? (
                <p className="mt-3 text-[13px] text-danger" role="alert">
                  {peerflixError}
                </p>
              ) : null}
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <Pill variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => setStep("torrents")} disabled={peerflixBusy}>
                  {t("back")}
                </Pill>
                {peerflixMode === "free" ? (
                  <Pill
                    variant="primary"
                    icon={peerflixBusy ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                    onClick={() => void keepFreePeerflix()}
                    disabled={peerflixBusy}
                  >
                    {t("next")}
                  </Pill>
                ) : (
                  <div className="flex items-center gap-2">
                    <Pill variant="ghost" onClick={() => void keepFreePeerflix()} disabled={peerflixBusy}>
                      {t("setupPeerflixKeepFree")}
                    </Pill>
                    <Pill
                      variant="primary"
                      icon={peerflixBusy ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}
                      onClick={() => void applyPeerflix()}
                      disabled={peerflixBusy || !manifest.trim()}
                    >
                      {t("setupPeerflixApply")}
                    </Pill>
                  </div>
                )}
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
                <Pill variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => setStep("peerflix")}>
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
