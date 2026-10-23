import { useFetcher, useLocation } from "@remix-run/react";
import type { action as localeAction } from "../routes/api.locale";
import {
  useI18n,
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  type AppLocale,
} from "../utils/i18n";

/** Page secondary-action group that switches and persists the app language. */
export function useLanguageActionGroup() {
  const { locale, setLocale, t } = useI18n();
  const fetcher = useFetcher<typeof localeAction>();
  const location = useLocation();
  return {
    title: `${t("Language")}: ${LOCALE_LABELS[locale]}`,
    actions: SUPPORTED_LOCALES.map((option: AppLocale) => ({
      content: LOCALE_LABELS[option],
      active: option === locale,
      onAction: () => {
        setLocale(option);
        fetcher.submit(
          { locale: option },
          { method: "post", action: `/api/locale${location.search}` },
        );
      },
    })),
  };
}
