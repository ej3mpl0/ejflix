import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Pill } from "../components/Pill";
import { ChoiceRow, OnboardingFrame, StepHeading } from "../components/onboarding/OnboardingFrame";
import { PosterWall } from "../components/onboarding/Visuals";
import { useI18n } from "../lib/locale-context";

/**
 * First launch. The question is where the films come from, which is what ejFlix is:
 * addons, a Jellyfin server, or both later on. Live TV lists are added from Settings.
 */
export function Welcome({
  onServer,
  onOnline,
}: {
  onServer: () => void;
  onOnline: () => void;
}) {
  const { t } = useI18n();
  const [choice, setChoice] = useState<"online" | "server">("online");

  return (
    <OnboardingFrame
      step={1}
      visual={<PosterWall />}
      footer={
        <Pill variant="primary" size="lg" icon={<ArrowRight size={17} />} onClick={choice === "server" ? onServer : onOnline}>
          {t("continue")}
        </Pill>
      }
    >
      <StepHeading title={t("welcomeTitle")} text={t("welcomeHint")} />
      <div role="radiogroup" aria-label={t("welcomeTitle")} className="max-w-[460px]">
        <ChoiceRow active={choice === "online"} title={t("optionOnline")} hint={t("optionOnlineHint")} onClick={() => setChoice("online")} />
        <ChoiceRow active={choice === "server"} title={t("optionServer")} hint={t("optionServerHint")} onClick={() => setChoice("server")} />
      </div>
      <p className="mt-4 max-w-[44ch] text-[13.5px] leading-[1.5] text-dim">{t("welcomeIptvNote")}</p>
    </OnboardingFrame>
  );
}
