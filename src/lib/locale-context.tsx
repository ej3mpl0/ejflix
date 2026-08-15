import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import { detectLocale, translate, type Locale, type MessageKey } from "./i18n";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    void api
      .localeGet()
      .then((saved) => {
        if (saved === "en" || saved === "es") setLocaleState(saved);
      })
      .catch(() => undefined);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale: (next) => {
        setLocaleState(next);
        document.documentElement.lang = next;
        void api.localeSet(next).catch(() => undefined);
      },
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n requires I18nProvider");
  return ctx;
}
