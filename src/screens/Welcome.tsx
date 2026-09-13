import { ArrowRight, Globe, Server } from "lucide-react";
import { Logo } from "../components/Logo";
import { WindowControls } from "../components/WindowControls";
import { LanguageSelect } from "../components/LanguageSelect";
import { useI18n } from "../lib/locale-context";

/** First launch: pick between a Jellyfin server and the online (addons only) mode. */
export function Welcome({
  onServer,
  onOnline,
}: {
  onServer: () => void;
  onOnline: () => void;
}) {
  const { t } = useI18n();

  const option = (
    icon: typeof Server,
    title: string,
    hint: string,
    onClick: () => void,
    delay: number,
    primary = false,
  ) => {
    const Icon = icon;
    return (
      <button
        type="button"
        onClick={onClick}
        style={{ animation: `fade-rise 520ms var(--ease-out-soft) ${delay}ms both` }}
        className="group card-depth btn-press flex w-[320px] max-w-full flex-col items-start gap-5 rounded-card bg-surface p-7 text-left transition-colors duration-200 hover:bg-panel focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span
          className={`grid h-14 w-14 place-items-center rounded-2xl ${
            primary ? "bg-accent text-on-accent" : "bg-accent-soft text-accent"
          }`}
        >
          <Icon size={26} />
        </span>
        <span className="block">
          <span className="block text-[20px] font-semibold tracking-[-0.01em]">{title}</span>
          <span className="mt-1.5 block text-[14px] leading-[1.5] text-muted">{hint}</span>
        </span>
        <span className="mt-auto inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent">
          {t("getStarted")}
          <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </button>
    );
  };

  return (
    <div className="grain relative flex h-full flex-col bg-base">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_50%_10%,color-mix(in_oklab,var(--color-accent)_16%,transparent),transparent_60%)]" />
      <div className="relative z-10 flex h-[60px] items-center justify-between px-6">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageSelect />
          <WindowControls />
        </div>
      </div>
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-16">
        <div className="mb-3" style={{ animation: "fade-rise 520ms var(--ease-out-soft) both" }}>
          <Logo size="login" />
        </div>
        <h1
          className="mb-2 text-center text-[34px] font-semibold tracking-tight [text-wrap:balance]"
          style={{ animation: "fade-rise 520ms var(--ease-out-soft) 60ms both" }}
        >
          {t("welcomeTitle")}
        </h1>
        <p
          className="mb-10 text-center text-[14px] text-dim"
          style={{ animation: "fade-rise 520ms var(--ease-out-soft) 120ms both" }}
        >
          {t("welcomeHint")}
        </p>
        <div className="flex flex-wrap items-stretch justify-center gap-5">
          {option(Server, t("optionServer"), t("optionServerHint"), onServer, 180, true)}
          {option(Globe, t("optionOnline"), t("optionOnlineHint"), onOnline, 260)}
        </div>
      </div>
    </div>
  );
}
