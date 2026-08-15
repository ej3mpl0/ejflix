import { cn } from "../lib/format";
import { useI18n } from "../lib/locale-context";
import type { Locale } from "../lib/i18n";

export function LanguageSelect({ className }: { className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const option = (code: Locale, label: string) => (
    <button
      type="button"
      aria-pressed={locale === code}
      className={cn(
        "inline-flex min-h-10 min-w-10 items-center justify-center px-2 text-[12px] font-semibold tracking-[0.06em] transition-colors duration-150",
        locale === code ? "text-white" : "text-dim hover:text-muted",
      )}
      onClick={() => setLocale(code)}
    >
      {label}
    </button>
  );

  return (
    <div
      role="group"
      aria-label={t("language")}
      className={cn("inline-flex items-center rounded-md bg-white/5 px-0.5", className)}
    >
      {option("es", "ES")}
      <span className="text-white/20" aria-hidden>
        |
      </span>
      {option("en", "EN")}
    </div>
  );
}
