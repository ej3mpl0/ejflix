import { useMemo } from "react";
import { LANGUAGE_CODES, languageName } from "../../lib/languages";
import { useI18n } from "../../lib/locale-context";
import { Select, type SelectOption } from "../Select";

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
  const options = useMemo<SelectOption<string>[]>(() => {
    const languages = LANGUAGE_CODES.map((code) => ({ value: code, label: languageName(code, locale) })).sort(
      (a, b) => a.label.localeCompare(b.label, locale),
    );
    const head: SelectOption<string>[] = [{ value: "", label: t("langAuto") }];
    if (kind === "subtitle") head.push({ value: "off", label: t("langOff") });
    return [...head, ...languages];
  }, [locale, kind, t]);

  return <Select value={value} options={options} onChange={onChange} label={label} className="max-w-[260px]" />;
}
