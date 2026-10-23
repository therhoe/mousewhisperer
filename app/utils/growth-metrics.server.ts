import { cachedValue } from "./loader-cache.server";
import { getShopifyConversionProgress } from "./shopify-analytics.server";
import type { ConversionPeriod } from "../types/conversion-progress";

type Admin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};
export function analyticsRows(
  table:
    | { columns?: Array<{ name?: string }>; rows?: unknown }
    | null
    | undefined,
): Record<string, unknown>[] {
  let rows = table?.rows;
  if (typeof rows === "string") {
    try {
      rows = JSON.parse(rows);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) =>
    Array.isArray(row)
      ? [
          Object.fromEntries(
            (table?.columns || []).map((column, index) => [
              column.name || String(index),
              row[index],
            ]),
          ),
        ]
      : row && typeof row === "object"
        ? [row as Record<string, unknown>]
        : [],
  );
}
export function analyticsNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
async function salesQuery(admin: Admin, query: string) {
  const response = await admin.graphql(
    `query ProjectGrowthSales($query: String!) {
    shopifyqlQuery(query: $query) { tableData { columns { name } rows } parseErrors }
  }`,
    { variables: { query } },
  );
  const payload = await response.json();
  if (
    !response.ok ||
    payload.errors?.length ||
    payload.data?.shopifyqlQuery?.parseErrors?.length
  )
    throw new Error("Sales analytics unavailable");
  return analyticsRows(payload.data?.shopifyqlQuery?.tableData);
}
export async function getGrowthMetrics(input: {
  shop: string;
  admin: Admin;
  sessionScope?: string | null;
  period: ConversionPeriod;
}) {
  const progress = await getShopifyConversionProgress({
    ...input,
    sessionScope: input.sessionScope,
  });
  const sales = await cachedValue(
    `growth-sales:${input.shop}:${progress.rangeStart}:${progress.rangeEnd}`,
    300_000,
    async () => {
      if (!input.sessionScope?.split(",").includes("read_reports")) return null;
      try {
        const base = `FROM sales\nSHOW average_order_value, amount_spent_per_customer, orders\nWHERE sales_channel = 'Online Store'`;
        const range = `SINCE ${progress.rangeStart} UNTIL ${progress.rangeEnd}`;
        const [totals, series, currencyResponse] = await Promise.all([
          salesQuery(input.admin, `${base}\n${range}`),
          salesQuery(
            input.admin,
            `${base}\nTIMESERIES day\n${range}\nORDER BY day ASC`,
          ),
          input.admin.graphql(
            `query ProjectGrowthCurrency { shop { currencyCode } }`,
          ),
        ]);
        const currencyPayload = await currencyResponse.json();
        const currency = currencyPayload.data?.shop?.currencyCode || null;
        return {
          aov: analyticsNumber(totals[0]?.average_order_value),
          ltv: analyticsNumber(totals[0]?.amount_spent_per_customer),
          currency,
          series: series
            .map((row) => ({
              date: String(row.day || "").slice(0, 10),
              aov: analyticsNumber(row.average_order_value),
              ltv: analyticsNumber(row.amount_spent_per_customer),
            }))
            .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date)),
        };
      } catch {
        return null;
      }
    },
  );
  return { progress, sales };
}
