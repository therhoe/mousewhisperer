import { de } from "../locales/de";
import { zhCN } from "../locales/zh-CN";
import { zhTW } from "../locales/zh-TW";

export const SUPPORTED_LOCALES = ["en", "de", "zh-CN", "zh-TW"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type TranslationValues = Record<string, string | number>;
export const LOCALE_LABELS: Record<AppLocale, string> = {
  en: "English",
  de: "Deutsch",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
};
export const dictionaries: Record<AppLocale, Record<string, string>> = {
  en: {},
  de,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
};

/** Resolve Shopify language tags without confusing Chinese script with region. */
export function normalizeLocale(value: unknown): AppLocale | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const parts = value.trim().replace(/_/g, "-").toLowerCase().split("-");
  if (parts[0] === "en") return "en";
  if (parts[0] === "de") return "de";
  if (parts[0] !== "zh") return null;
  if (parts.includes("hant")) return "zh-TW";
  if (parts.includes("hans")) return "zh-CN";
  return parts.some((part) => ["tw", "hk", "mo"].includes(part))
    ? "zh-TW"
    : "zh-CN";
}

export function preferredLocale(header: string | null): AppLocale {
  const candidates = (header || "")
    .split(",")
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const quality = parameters.find((parameter) =>
        parameter.trim().startsWith("q="),
      );
      const weight = quality ? Number(quality.trim().slice(2)) : 1;
      return { locale: normalizeLocale(tag), weight, index };
    })
    .filter(
      ({ locale, weight }) =>
        locale && Number.isFinite(weight) && weight > 0 && weight <= 1,
    )
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  return candidates[0]?.locale || "en";
}

export function translate(
  locale: AppLocale,
  source: string,
  values: TranslationValues = {},
): string {
  const dictionary = dictionaries[locale];
  const translation = Object.prototype.hasOwnProperty.call(dictionary, source)
    ? dictionary[source]
    : source;
  // Callback replacement prevents user-provided values containing "$&" being interpreted.
  return translation.replace(/\{(\w+)\}/g, (token, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : token,
  );
}

export function localeStorageKey(shop: string): string {
  return `snapshot:locale:${shop.toLowerCase()}`;
}
