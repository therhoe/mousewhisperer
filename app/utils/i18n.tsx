import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  localeStorageKey,
  normalizeLocale,
  translate,
  type AppLocale,
  type TranslationValues,
} from "./i18n-core";

export * from "./i18n-core";

function helpers(locale: AppLocale) {
  return {
    locale,
    t: (source: string, values?: TranslationValues) =>
      translate(locale, source, values),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale, options).format(value),
    formatDate: (
      value: Date | string | number,
      options?: Intl.DateTimeFormatOptions,
    ) => {
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime())
        ? "—"
        : new Intl.DateTimeFormat(locale, options).format(date);
    },
  };
}
const I18nContext = createContext({
  ...helpers("en"),
  setLocale: (_locale: AppLocale) => {},
});

export function I18nProvider({
  locale: initialLocale,
  shop,
  children,
}: {
  locale: AppLocale;
  shop: string;
  children: ReactNode;
}) {
  const [locale, updateLocale] = useState(initialLocale);
  useEffect(() => {
    // Embedded browsers can reject third-party cookies. Retain a per-store local
    // preference too, but never block rendering if browser storage is unavailable.
    try {
      updateLocale(
        normalizeLocale(localStorage.getItem(localeStorageKey(shop))) ||
          initialLocale,
      );
    } catch {
      updateLocale(initialLocale);
    }
  }, [initialLocale, shop]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo(
    () => ({
      ...helpers(locale),
      setLocale(next: AppLocale) {
        updateLocale(next);
        try {
          localStorage.setItem(localeStorageKey(shop), next);
        } catch {
          /* Storage is optional. */
        }
      },
    }),
    [locale, shop],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
