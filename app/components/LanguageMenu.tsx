import { useFetcher, useLocation } from "react-router";
import type { action as localeAction } from "../routes/api.locale";
import {
  useI18n,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  type AppLocale,
} from "../utils/i18n";

/** Switches the app language now and saves it for this store. */
export function useLanguageSwitch() {
  const { locale, setLocale } = useI18n();
  const fetcher = useFetcher<typeof localeAction>();
  const location = useLocation();
  return {
    locale,
    change(next: AppLocale) {
      if (!SUPPORTED_LOCALES.includes(next)) return;
      setLocale(next);
      fetcher.submit(
        { locale: next },
        { method: "post", action: `/api/locale${location.search}` },
      );
    },
  };
}

/** Page secondary-action group used by screens still on Polaris React. */
export function useLanguageActionGroup() {
  const { t } = useI18n();
  const { locale, change } = useLanguageSwitch();
  return {
    title: `${t("Language")}: ${LOCALE_LABELS[locale]}`,
    actions: SUPPORTED_LOCALES.map((option: AppLocale) => ({
      content: LOCALE_LABELS[option],
      active: option === locale,
      onAction: () => change(option),
    })),
  };
}
