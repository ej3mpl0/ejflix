import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, ExternalLink, LoaderCircle } from "lucide-react";
import { AddonImport } from "../components/AddonImport";
import { Pill } from "../components/Pill";
import { Chip } from "../components/Chip";
import { Toggle } from "../components/settings/Toggle";
import { LanguageSelect } from "../components/LanguageSelect";
import { LanguagePicker } from "../components/settings/LanguagePicker";
import { ChoiceRow, OnboardingFrame, StepHeading } from "../components/onboarding/OnboardingFrame";
import { HomeRowsVisual, SubtitleVisual, TorrentsVisual } from "../components/onboarding/Visuals";
import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import { useSettings } from "../lib/settings-context";
import { api } from "../lib/api";
import { isPeerflixFree, isPeerflixUrl, PEERFLIX_CONFIG_URL } from "../lib/addons";
import { errorText } from "../lib/errors";
import { fieldClass } from "../lib/ui";

type Step = "language" | "torrents" | "addons";

/** Steps 1–3 of the first run are welcome, connect and account; these are the last three. */
const STEP_NUMBER: Record<Step, number> = { language: 4, torrents: 5, addons: 6 };

/** Subtitle languages offered as one-click chips; the picker below has every other one. */
const QUICK_SUBTITLES = ["spa", "eng", "off"] as const;

/**
 * First-run setup of a profile, shown once before Home: language and subtitles, whether
 * addon sources that come as torrents may play, and the addons (Peerflix comes installed,
 * free or configured; the rest are brought from Stremio or pasted). Everything stays
 * editable in Settings, so each step can be skipped.
 */
export function SetupStep({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const { settings, update } = useSettings();
  const [step, setStep] = useState<Step>("language");
  const [imported, setImported] = useState(0);
  const [configuring, setConfiguring] = useState(false);
  const [manifest, setManifest] = useState("");
  const [peerflixError, setPeerflixError] = useState<string | null>(null);
  const [peerflixBusy, setPeerflixBusy] = useState(false);
  const torrents = settings.torrents.enabled;
  const subtitle = settings.playback.subtitleLanguage;
  const peerflixConfigured = settings.addons.urls.some((url) => isPeerflixUrl(url) && !isPeerflixFree(url));

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
      setConfiguring(false);
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
      setConfiguring(false);
      setManifest("");
    } catch (err) {
      setPeerflixError(errorText(t, err));
    } finally {
      setPeerflixBusy(false);
    }
  };

  const subtitleLabel = (code: string) =>
    code === "spa" ? t("langEsName") : code === "eng" ? t("langEnName") : t("subtitlesNever");

  const back = (to: Step) => (
    <Pill variant="tonal" size="lg" className="mr-auto" icon={<ArrowLeft size={17} />} onClick={() => setStep(to)}>
      {t("back")}
    </Pill>
  );

  if (step === "language") {
    return (
      <OnboardingFrame
        overlay
        step={STEP_NUMBER.language}
        visual={<SubtitleVisual language={subtitle || "spa"} />}
        footer={
          <>
            <Pill variant="ghost" size="lg" className="mr-auto" onClick={finish}>
              {t("setupSkip")}
            </Pill>
            <Pill variant="primary" size="lg" icon={<ArrowRight size={17} />} onClick={() => setStep("torrents")}>
              {t("next")}
            </Pill>
          </>
        }
      >
        <div className="max-w-[460px]">
          <StepHeading title={t("setupStyleTitle")} text={t("setupStyleText")} />
          <p className="mb-2.5 text-[13.5px] font-semibold text-muted">{t("appLanguage")}</p>
          <LanguageSelect />
          <p className="mt-7 mb-2.5 text-[13.5px] font-semibold text-muted">{t("preferredSubtitles")}</p>
          <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label={t("preferredSubtitles")}>
            {QUICK_SUBTITLES.map((code) => (
              <Chip
                key={code}
                role="radio"
                aria-checked={subtitle === code}
                selected={subtitle === code}
                onClick={() => void update({ playback: { subtitleLanguage: code } })}
              >
                {subtitleLabel(code)}
              </Chip>
            ))}
          </div>
          <div className="max-w-[320px]">
            <LanguagePicker
              kind="subtitle"
              label={t("preferredSubtitles")}
              value={subtitle}
              onChange={(subtitleLanguage) => void update({ playback: { subtitleLanguage } })}
            />
          </div>
        </div>
      </OnboardingFrame>
    );
  }

  if (step === "torrents") {
    return (
      <OnboardingFrame
        overlay
        step={STEP_NUMBER.torrents}
        visual={<TorrentsVisual enabled={torrents} />}
        footer={
          <>
            {back("language")}
            <Pill variant="primary" size="lg" icon={<ArrowRight size={17} />} onClick={() => setStep("addons")}>
              {t("next")}
            </Pill>
          </>
        }
      >
        <div className="max-w-[460px]">
          <StepHeading title={t("setupTorrentsTitle")} text={t("setupTorrentsText")} />
          <div role="radiogroup" aria-label={t("setupTorrentsTitle")}>
            <ChoiceRow
              active={torrents}
              title={t("setupTorrentsOn")}
              hint={t("setupTorrentsOnHint")}
              onClick={() => void update({ torrents: { enabled: true } })}
            />
            <ChoiceRow
              active={!torrents}
              title={t("setupTorrentsOff")}
              hint={t("setupTorrentsOffHint")}
              onClick={() => void update({ torrents: { enabled: false } })}
            />
          </div>
          {torrents ? (
            <div className="mt-3 flex items-center gap-4 px-1">
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold">{t("torrentsShare")}</p>
                <p className="mt-0.5 text-[13px] text-muted">{t("torrentsShareHint")}</p>
              </div>
              <Toggle
                checked={settings.torrents.share}
                onChange={(share) => void update({ torrents: { share } })}
                label={t("torrentsShare")}
              />
            </div>
          ) : null}
        </div>
      </OnboardingFrame>
    );
  }

  const peerflixRow = (
    <div className="border-b border-line py-3">
      <div className="flex items-center gap-3.5">
        <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[11px] bg-panel font-display text-[14px] font-bold">P</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Peerflix</span>
          <span className="block text-[13px] text-muted">{t("addonsPeerflixHint")}</span>
        </span>
        <span className="text-[13px] text-muted">{peerflixConfigured ? t("addonsConfigured") : t("addonsPeerflixInstalled")}</span>
        <Pill variant="tonal" size="sm" aria-expanded={configuring} onClick={() => setConfiguring((v) => !v)}>
          {t("configure")}
        </Pill>
      </div>
      {!torrents && !peerflixConfigured ? (
        <p className="mt-2 text-[12.5px] leading-[1.45] text-dim">{t("setupPeerflixTorrentsOff")}</p>
      ) : null}
      {configuring ? (
        <form
          className="mt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void applyPeerflix();
          }}
        >
          <p className="mb-2 text-[13px] leading-[1.45] text-muted">{t("setupPeerflixConfigureHint")}</p>
          <button
            type="button"
            onClick={openPeerflixConfig}
            className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-text hover:underline"
          >
            <ExternalLink size={14} />
            {t("setupPeerflixOpen")}
          </button>
          <div className="flex gap-2">
            <input
              value={manifest}
              onChange={(e) => {
                setManifest(e.target.value);
                setPeerflixError(null);
              }}
              placeholder="https://addon.peerflix.mov/…/manifest.json"
              aria-label={t("setupPeerflixPaste")}
              autoComplete="off"
              spellCheck={false}
              className={cn(fieldClass, "min-w-0 flex-1")}
            />
            <Pill
              variant="primary"
              type="submit"
              disabled={peerflixBusy || !manifest.trim()}
              icon={peerflixBusy ? <LoaderCircle size={15} className="animate-spin" /> : <Check size={15} />}
            >
              {t("setupPeerflixApply")}
            </Pill>
          </div>
          {peerflixConfigured ? (
            <button
              type="button"
              onClick={() => void keepFreePeerflix()}
              disabled={peerflixBusy}
              className="mt-2 text-[13px] text-muted hover:text-text"
            >
              {t("setupPeerflixKeepFree")}
            </button>
          ) : null}
          {peerflixError ? (
            <p className="mt-2 text-[13px] text-danger" role="alert">
              {peerflixError}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );

  return (
    <OnboardingFrame
      overlay
      step={STEP_NUMBER.addons}
      visual={
        <HomeRowsVisual
          rows={[
            ...(imported
              ? [{ title: t("setupRowImported"), fresh: true, covers: ["tt15239678", "tt15398776", "tt9362722", "tt1856101", "tt7784604"] }]
              : []),
            { title: t("setupRowPeerflix"), fresh: !imported, covers: ["tt3581920", "tt13443470", "tt14452776", "tt1190634", "tt5180504"] },
            { title: t("setupRowCinemeta"), fresh: false, covers: ["tt0816692", "tt0468569", "tt0110912", "tt6751668", "tt1375666"] },
          ]}
        />
      }
      footer={
        <>
          {back("torrents")}
          <Pill variant="primary" size="lg" icon={<Check size={17} />} onClick={finish}>
            {t("setupFinish")}
          </Pill>
        </>
      }
    >
      <div className="max-w-[480px]">
        <StepHeading title={t("setupAddonsTitle")} text={t("setupAddonsText")} />
        <AddonImport onImported={(n) => setImported((total) => total + n)} />
        <div className="mt-6">
          {peerflixRow}
          <div className="flex items-center gap-3.5 py-3">
            <span className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[11px] bg-panel font-display text-[14px] font-bold">C</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold">Cinemeta</span>
              <span className="block text-[13px] text-muted">{t("addonsCinemetaHint")}</span>
            </span>
            <span className="text-[13px] text-muted">{t("addonsIncluded")}</span>
          </div>
        </div>
        <p className="mt-3 text-[13px] text-dim">{t("setupAddonsLater")}</p>
      </div>
    </OnboardingFrame>
  );
}
