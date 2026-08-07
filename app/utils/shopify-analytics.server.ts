import { cachedValue } from "./loader-cache.server";
import type {
  ConversionPeriod,
  ConversionPoint,
  ConversionProgress,
} from "../types/conversion-progress";

type ShopifyAdminClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type CalendarRange = {
  period: ConversionPeriod;
  periodLabel: string;
  grain: "day" | "week";
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
};

type ShopifyqlResponse = {
  data?: {
    shopifyqlQuery?: {
      tableData?: {
        columns?: Array<{ name?: string }>;
        rows?: unknown;
      } | null;
      parseErrors?: string[];
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

const CONVERSION_CACHE_TTL_MS = 5 * 60_000;

const PERIOD_LABELS: Record<ConversionPeriod, string> = {
  week: "Week to date",
  month: "Month to date",
  quarter: "Quarter to date",
  year: "Year to date",
};

export function isConversionPeriod(
  value: string | null,
): value is ConversionPeriod {
  return (
    value === "week" ||
    value === "month" ||
    value === "quarter" ||
    value === "year"
  );
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysBetween(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function calendarDateInTimeZone(now: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value || 0);
    const year = value("year");
    const month = value("month");
    const day = value("day");
    if (year && month && day) return new Date(Date.UTC(year, month - 1, day));
  } catch {}

  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function getConversionCalendarRange(
  period: ConversionPeriod,
  timeZone = "UTC",
  now = new Date(),
): CalendarRange {
  const today = calendarDateInTimeZone(now, timeZone);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  let currentStart: Date;
  let previousStart: Date;
  let previousLimit: Date;

  if (period === "week") {
    const daysSinceMonday = (today.getUTCDay() + 6) % 7;
    currentStart = addDays(today, -daysSinceMonday);
    previousStart = addDays(currentStart, -7);
    previousLimit = addDays(currentStart, -1);
  } else if (period === "month") {
    currentStart = new Date(Date.UTC(year, month, 1));
    previousStart = new Date(Date.UTC(year, month - 1, 1));
    previousLimit = new Date(Date.UTC(year, month, 0));
  } else if (period === "quarter") {
    const quarterStartMonth = Math.floor(month / 3) * 3;
    currentStart = new Date(Date.UTC(year, quarterStartMonth, 1));
    previousStart = new Date(Date.UTC(year, quarterStartMonth - 3, 1));
    previousLimit = new Date(Date.UTC(year, quarterStartMonth, 0));
  } else {
    currentStart = new Date(Date.UTC(year, 0, 1));
    previousStart = new Date(Date.UTC(year - 1, 0, 1));
    previousLimit = new Date(Date.UTC(year - 1, 11, 31));
  }

  const elapsedDays = daysBetween(currentStart, today);
  const previousEndCandidate = addDays(previousStart, elapsedDays);
  const previousEnd =
    previousEndCandidate.getTime() > previousLimit.getTime()
      ? previousLimit
      : previousEndCandidate;

  return {
    period,
    periodLabel: PERIOD_LABELS[period],
    grain: period === "week" || period === "month" ? "day" : "week",
    currentStart: formatDate(currentStart),
    currentEnd: formatDate(today),
    previousStart: formatDate(previousStart),
    previousEnd: formatDate(previousEnd),
  };
}

function compactDateRange(start: string, end: string) {
  const startDate = new Date(`${start}T12:00:00.000Z`);
  const endDate = new Date(`${end}T12:00:00.000Z`);
  const format = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year:
      startDate.getUTCFullYear() === endDate.getUTCFullYear()
        ? undefined
        : "numeric",
    timeZone: "UTC",
  });
  const endFormat = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${format.format(startDate)}–${endFormat.format(endDate)}`;
}

function emptyProgress(
  range: CalendarRange,
  status: ConversionProgress["status"],
  message: string,
): ConversionProgress {
  return {
    status,
    period: range.period,
    periodLabel: range.periodLabel,
    currentLabel: compactDateRange(range.currentStart, range.currentEnd),
    previousLabel: compactDateRange(range.previousStart, range.previousEnd),
    rangeStart: range.currentStart,
    rangeEnd: range.currentEnd,
    previousRangeStart: range.previousStart,
    previousRangeEnd: range.previousEnd,
    currentRate: 0,
    previousRate: 0,
    currentSessions: 0,
    currentCompletedCheckouts: 0,
    previousSessions: 0,
    previousCompletedCheckouts: 0,
    deltaPoints: 0,
    deltaPercent: null,
    currentSeries: [],
    previousSeries: [],
    message,
    source: "SHOPIFY_ANALYTICS",
    updatedAt: new Date().toISOString(),
  };
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseRows(rows: unknown, grain: "day" | "week"): ConversionPoint[] {
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const date = String(row[grain] || "");
    if (!date) return [];
    const sessions = numberValue(row.sessions);
    const completedCheckouts = numberValue(
      row.sessions_that_completed_checkout,
    );
    return [
      {
        date: date.slice(0, 10),
        sessions,
        completedCheckouts,
        conversionRate:
          sessions > 0 ? (completedCheckouts / sessions) * 100 : 0,
      },
    ];
  });
}

function summarize(points: ConversionPoint[]) {
  const sessions = points.reduce((sum, point) => sum + point.sessions, 0);
  const completedCheckouts = points.reduce(
    (sum, point) => sum + point.completedCheckouts,
    0,
  );
  return {
    sessions,
    completedCheckouts,
    conversionRate: sessions > 0 ? (completedCheckouts / sessions) * 100 : 0,
  };
}

async function getShopTimeZone(admin: ShopifyAdminClient) {
  try {
    const response = await admin.graphql(`#graphql
      query ConversionProgressShopTimeZone {
        shop {
          ianaTimezone
        }
      }
    `);
    const payload = (await response.json()) as {
      data?: { shop?: { ianaTimezone?: string | null } };
    };
    return payload.data?.shop?.ianaTimezone || "UTC";
  } catch {
    return "UTC";
  }
}

async function runConversionQuery(
  admin: ShopifyAdminClient,
  rangeStart: string,
  rangeEnd: string,
  grain: "day" | "week",
) {
  const shopifyql = `FROM sessions
SHOW sessions, sessions_that_completed_checkout, conversion_rate
WHERE human_or_bot_session = 'human'
TIMESERIES ${grain}
SINCE ${rangeStart} UNTIL ${rangeEnd}
ORDER BY ${grain} ASC`;

  const response = await admin.graphql(
    `#graphql
      query ConversionProgress($query: String!) {
        shopifyqlQuery(query: $query) {
          tableData {
            columns {
              name
              dataType
              displayName
            }
            rows
          }
          parseErrors
        }
      }
    `,
    { variables: { query: shopifyql } },
  );
  const payload = (await response.json()) as ShopifyqlResponse;
  const graphErrors =
    payload.errors?.map(
      (error) => error.message || "Shopify Analytics request failed",
    ) || [];
  const parseErrors = payload.data?.shopifyqlQuery?.parseErrors || [];
  const errors = [...graphErrors, ...parseErrors];

  if (!response.ok || errors.length > 0) {
    throw new Error(
      errors.join(" · ") || `Shopify Analytics returned ${response.status}`,
    );
  }

  return parseRows(payload.data?.shopifyqlQuery?.tableData?.rows, grain);
}

export async function getShopifyConversionProgress({
  admin,
  shop,
  sessionScope,
  period,
}: {
  admin: ShopifyAdminClient;
  shop: string;
  sessionScope: string | null | undefined;
  period: ConversionPeriod;
}): Promise<ConversionProgress> {
  const scopes = new Set(
    (sessionScope || "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );

  if (!scopes.has("read_reports")) {
    return emptyProgress(
      getConversionCalendarRange(period),
      "missing_scope",
      "Reconnect Mouse Whisperer to grant Shopify Analytics report access.",
    );
  }

  const timeZone = await getShopTimeZone(admin);
  const range = getConversionCalendarRange(period, timeZone);

  return cachedValue(
    `shopify-conversion:${shop}:${period}:${range.currentEnd}`,
    CONVERSION_CACHE_TTL_MS,
    async () => {
      try {
        const [currentSeries, previousSeries] = await Promise.all([
          runConversionQuery(
            admin,
            range.currentStart,
            range.currentEnd,
            range.grain,
          ),
          runConversionQuery(
            admin,
            range.previousStart,
            range.previousEnd,
            range.grain,
          ),
        ]);
        const currentSummary = summarize(currentSeries);
        const previousSummary = summarize(previousSeries);
        const currentRate = currentSummary.conversionRate;
        const previousRate = previousSummary.conversionRate;
        const deltaPoints = currentRate - previousRate;

        return {
          ...emptyProgress(range, "ready", ""),
          status: "ready",
          currentRate,
          previousRate,
          currentSessions: currentSummary.sessions,
          currentCompletedCheckouts: currentSummary.completedCheckouts,
          previousSessions: previousSummary.sessions,
          previousCompletedCheckouts: previousSummary.completedCheckouts,
          deltaPoints,
          deltaPercent:
            previousRate > 0 ? (deltaPoints / previousRate) * 100 : null,
          currentSeries,
          previousSeries,
          message: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const lowerMessage = message.toLowerCase();
        const approvalRequired =
          lowerMessage.includes("protected customer data") &&
          lowerMessage.includes("level 2");

        return emptyProgress(
          range,
          approvalRequired ? "approval_required" : "error",
          approvalRequired
            ? "Mouse Whisperer has report access for this store, but Shopify is blocking conversion reports until the app receives Level 2 protected customer data approval."
            : "Shopify Analytics could not be loaded right now. Try again shortly.",
        );
      }
    },
  );
}
