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
