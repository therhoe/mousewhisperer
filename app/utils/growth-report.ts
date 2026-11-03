import type { EngagementOutcomes } from "./click-engagement";
export type GrowthReportFilters = {
  audience: "all" | "active";
  source: string;
  medium: string;
  campaign: string;
};
export function growthReportFilters(
  params: URLSearchParams,
  defaults: {
    defaultSource?: string | null;
    defaultMedium?: string | null;
    defaultCampaign?: string | null;
  },
): GrowthReportFilters {
  const value = (key: string, fallback?: string | null) =>
    (params.has(key) ? params.get(key) || "" : fallback || "")
      .trim()
      .slice(0, 240);
  return {
    audience: params.get("audience") === "active" ? "active" : "all",
    source: value("source", defaults.defaultSource),
    medium: value("medium", defaults.defaultMedium),
    campaign: value("campaign", defaults.defaultCampaign),
  };
}
export type GrowthReport = {
  sessions: number;
  addedToCart: number;
  conversions: number;
  conversionRate: number;
  atcRate: number;
  pageViews: number;
  averageTime: number;
  averageScroll: number;
  series: Array<{
    date: string;
    sessions: number;
    conversions: number;
    conversionRate: number;
  }>;
  channels: Array<{
    source: string;
    medium: string;
    campaign: string;
    sessions: number;
    addedToCart: number;
    conversions: number;
    conversionRate: number;
  }>;
  sources: string[];
  engagement: EngagementOutcomes | null;
  engagementUnavailable: boolean;
};
export type GrowthReportLayout = "store" | "page";
export type GrowthPageType =
  | "PRODUCT"
  | "COLLECTION"
  | "PAGE"
  | "BLOG"
  | "HOMEPAGE";
export type GrowthEngagementSummary = {
  available: boolean;
  timeMedianSeconds: number;
  pagesPerSession: number;
  averageScroll: number;
  clickThroughRate: number;
  searchRate: number;
  topSearches: Array<{ term: string; sessions: number }>;
  devices: Array<{
    device: string;
    sessions: number;
    share: number;
    conversionRate: number;
  }>;
};
export type GrowthFunnel = {
  sessions: number;
  addedToCart: number;
  checkoutStarted: number;
  purchased: number;
};
// Tracker exit types in display order; "unknown" collects page views with none.
export const EXIT_OUTCOMES = [
  "internal_link",
  "checkout",
  "back_button",
  "window_closed",
  "idle",
  "external_link",
  "unknown",
] as const;
export type GrowthExitOutcome = (typeof EXIT_OUTCOMES)[number];
export type GrowthExitPaths = {
  available: boolean;
  outcomes: Array<{ type: GrowthExitOutcome; pageViews: number; share: number }>;
  nextPages: Array<{ path: string; pageViews: number }>;
  exitPages: Array<{
    path: string;
    exits: number;
    sessions: number;
    exitRate: number;
  }>;
};
export type GrowthPageRow = {
  path: string;
  type: string | null;
  sessions: number;
  carts: number;
  forwards: number;
  conversions: number;
  exits: number;
};
export type RankedGrowthPage = GrowthPageRow & {
  keyRate: number | null;
  exitRate: number;
  conversionRate: number;
  typicalRate: number | null;
  missed: number | null;
  focus: boolean;
};

export const PAGE_RANK_MIN_SESSIONS = 20;
export const PAGE_RANK_MIN_PAGES = 3;
export const PAGE_FOCUS_COUNT = 3;
const CLICK_THROUGH_TYPES = new Set(["COLLECTION", "PAGE", "BLOG", "HOMEPAGE"]);
const share = (part: number, whole: number) => (whole ? (100 * part) / whole : 0);

// Products move forward by adding to cart; every other page type by a click-through.
export function pageKeyRate(row: GrowthPageRow): number | null {
  if (!row.sessions) return null;
  if (row.type === "PRODUCT") return share(row.carts, row.sessions);
  if (row.type && CLICK_THROUGH_TYPES.has(row.type))
    return share(row.forwards, row.sessions);
  return null;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Missed sessions: how many more sessions would have moved forward if the page
// matched the typical (median) page of its type in this measurement.
export function rankGrowthPages(rows: GrowthPageRow[]): RankedGrowthPage[] {
  const eligible = new Map<string, number[]>();
  for (const row of rows) {
    const keyRate = pageKeyRate(row);
    if (keyRate === null || !row.type || row.sessions < PAGE_RANK_MIN_SESSIONS)
      continue;
    eligible.set(row.type, [...(eligible.get(row.type) || []), keyRate]);
  }
  const typical = new Map<string, number>();
  for (const [type, rates] of eligible)
    if (rates.length >= PAGE_RANK_MIN_PAGES) typical.set(type, median(rates));
  const ranked: RankedGrowthPage[] = rows.map((row) => {
    const keyRate = pageKeyRate(row);
    const typicalRate =
      row.type && row.sessions >= PAGE_RANK_MIN_SESSIONS
        ? (typical.get(row.type) ?? null)
        : null;
    const comparable = keyRate !== null && typicalRate !== null;
    return {
      ...row,
      keyRate,
      exitRate: share(row.exits, row.sessions),
      conversionRate: share(row.conversions, row.sessions),
      typicalRate: comparable ? typicalRate : null,
      missed: comparable
        ? Math.max(0, Math.round((row.sessions * (typicalRate - keyRate)) / 100))
        : null,
      focus: false,
    };
  });
  ranked.sort(
    (a, b) =>
      (b.missed ?? -1) - (a.missed ?? -1) ||
      b.sessions - a.sessions ||
      a.path.localeCompare(b.path),
  );
  let focused = 0;
  for (const row of ranked) {
    if (focused === PAGE_FOCUS_COUNT) break;
    if ((row.missed ?? 0) > 0) {
      row.focus = true;
      focused += 1;
    }
  }
  return ranked;
}
