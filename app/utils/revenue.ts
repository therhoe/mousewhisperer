import type { TranslationValues } from "./i18n-core";

/** Revenue for one set of sessions, as the report query returns it (spec 7.2). */
export type RevenueCounts = {
  /** Sum of order amounts recorded in the shop's currency, over converted sessions. */
  revenue: number;
  /** Converted sessions with at least one order amount in the shop's currency. */
  pricedConversions: number;
  /** Converted sessions with an order that has no amount, or one in another currency. */
  unpricedConversions: number;
};

export type RevenueState =
  | { kind: "amount"; amount: number; partial: boolean }
  | { kind: "notRecorded" };

export type MoneyFormatters = {
  t: (source: string, values?: TranslationValues) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
};

export type RevenueText = { value: string; partial: boolean; hint: string | null };

/** Ends a partly recorded figure in a table cell; one line under the table explains it. */
export const PARTIAL_REVENUE_MARK = "*";

const positive = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/**
 * Spec 7.2, missing amounts:
 * - no conversions show the zero amount;
 * - conversions without any recorded amount show "Not recorded";
 * - some missing amounts show the recorded sum, flagged as partial.
 */
export function revenueState(
  conversions: number,
  counts: Partial<RevenueCounts> | null | undefined,
): RevenueState {
  const total = positive(conversions);
  if (!total) return { kind: "amount", amount: 0, partial: false };
  const priced = positive(counts?.pricedConversions);
  if (!priced) return { kind: "notRecorded" };
  const amount = Number(counts?.revenue);
  return {
    kind: "amount",
    amount: Number.isFinite(amount) ? amount : 0,
    partial: positive(counts?.unpricedConversions) > 0 || priced < total,
  };
}

/** The one money format: the shop's currency in the app's language. */
export function formatMoney(
  amount: number,
  currency: string,
  formatNumber: MoneyFormatters["formatNumber"],
): string {
  return formatNumber(amount, { style: "currency", currency });
}

/**
 * Revenue as shown beside a conversion rate. Without a shop currency nothing was
 * summed and nothing can be formatted, so it shows "Not recorded".
 */
export function revenueText(
  conversions: number,
  counts: Partial<RevenueCounts> | null | undefined,
  currency: string | null | undefined,
  { t, formatNumber }: MoneyFormatters,
): RevenueText {
  const state = revenueState(conversions, counts);
  if (state.kind === "notRecorded" || !currency)
    return { value: t("Not recorded"), partial: false, hint: null };
  return {
    value: formatMoney(state.amount, currency, formatNumber),
    partial: state.partial,
    hint: state.partial ? t("Some orders have no recorded amount") : null,
  };
}

/** A table cell: the figure, ending in the partial mark when partly recorded. */
export function revenueCell(text: RevenueText): string {
  return text.partial ? `${text.value}${PARTIAL_REVENUE_MARK}` : text.value;
}
