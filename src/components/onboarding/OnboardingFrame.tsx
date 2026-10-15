import type { ReactNode } from "react";
import { Logo } from "../Logo";
import { WindowControls } from "../WindowControls";
import { LanguageSelect } from "../LanguageSelect";
import { useI18n } from "../../lib/locale-context";
import { cn } from "../../lib/format";

/** Welcome, connect (server or profile), account, language, torrents, addons. */
export const ONBOARDING_STEPS = 6;

/** Where you are in the first run: done steps white, this one is the red dot. */
export function StepDots({ step, total = ONBOARDING_STEPS }: { step: number; total?: number }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 whitespace-nowrap" aria-label={t("setupProgress", { n: step, total })}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={cn(
            "h-[7px] w-[7px] rounded-full transition-colors duration-300",
            i + 1 < step && "bg-text",
            i + 1 === step && "bg-live shadow-[0_0_0_4px_var(--color-live-soft)]",
            i + 1 > step && "bg-line",
          )}
        />
      ))}
      <span className="ml-2 text-[13px] text-dim tabular">{t("setupProgress", { n: step, total })}</span>
    </div>
  );
}

/**
 * One step of the first run: the question on the left (wordmark, title, body, progress and
 * buttons), and on the right a picture of what the answer changes.
 */
export function OnboardingFrame({
  step,
  visual,
  footer,
  overlay = false,
  children,
}: {
  step?: number;
  visual?: ReactNode;
  /** Buttons at the bottom, after the progress dots. */
  footer?: ReactNode;
  /** Laid over the app (setup after sign-in) instead of being the whole window. */
  overlay?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex bg-base", overlay ? "fixed inset-0 z-[65]" : "relative h-full")}>
      <div className="relative z-10 flex h-full w-full min-w-0 flex-col overflow-y-auto px-[clamp(28px,5vw,64px)] pt-10 pb-10 lg:w-[600px] lg:shrink-0">
        <div className="flex h-8 shrink-0 items-center gap-6 max-lg:pr-[230px]" data-tauri-drag-region>
          <Logo />
          {step != null ? (
            <span className="ml-auto">
              <StepDots step={step} />
            </span>
          ) : null}
        </div>
        <div className="modal-enter my-auto py-8">{children}</div>
        {footer ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5">{footer}</div> : null}
      </div>
      <div className="relative hidden min-w-0 flex-1 overflow-hidden lg:block" data-tauri-drag-region>
        {visual}
      </div>
      <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
        <LanguageSelect />
        <WindowControls />
      </div>
    </div>
  );
}

/** Heading and lead of a step, the same type everywhere. */
export function StepHeading({ title, text }: { title: string; text?: string }) {
  return (
    <>
      <h1 className="mb-4 max-w-[13ch] text-[44px] leading-[1.04] font-extrabold tracking-[-0.03em]">{title}</h1>
      {text ? <p className="mb-7 max-w-[44ch] text-[16px] leading-[1.55] text-muted">{text}</p> : null}
    </>
  );
}

/** A large radio row: title and what choosing it means. */
export function ChoiceRow({
  active,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "btn-press mb-2.5 flex w-full items-start gap-4 rounded-[16px] px-5 py-[18px] text-left transition-[background-color,box-shadow] duration-150",
        active ? "bg-panel shadow-[inset_0_0_0_2px_var(--color-text)]" : "bg-surface hover:bg-panel",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border-2",
          active ? "border-text bg-text" : "border-dim",
        )}
      >
        {active ? <span className="h-2 w-2 rounded-full bg-live" /> : null}
      </span>
      <span className="min-w-0">
        <span className="mb-1 block font-display text-[18px] font-semibold">{title}</span>
        <span className="block text-[14px] leading-[1.5] text-muted">{hint}</span>
      </span>
    </button>
  );
}
