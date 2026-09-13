import { useMemo } from "react";
import { LANGUAGE_CODES, languageName } from "../../lib/languages";
import { useI18n } from "../../lib/locale-context";

export function LanguagePicker({
  value,
  kind,
  onChange,
  label,
}: {
  value: string;
  kind: "audio" | "subtitle";
  onChange: (code: string) => void;
  label: string;
}) {
  const { t, locale } = useI18n();
  const options = useMemo(
    () =>
      LANGUAGE_CODES.map((code) => ({ code, name: languageName(code, locale) })).sort((a, b) =>
        a.name.localeCompare(b.name, locale),
      ),
    [locale],
  );

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="h-10 max-w-[260px] rounded-btn border border-white/12 bg-black/40 px-3 text-sm text-text outline-none focus:border-accent"
    >
      <option value="">{t("langAuto")}</option>
      {kind === "subtitle" ? <option value="off">{t("langOff")}</option> : null}
      {options.map((option) => (
        <option key={option.code} value={option.code}>
          {option.name}
        </option>
      ))}
    </select>
  );
}
