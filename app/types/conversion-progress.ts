export type ConversionPeriod = "week" | "month" | "quarter" | "year";

export type ConversionPoint = {
  date: string;
  sessions: number;
  completedCheckouts: number;
  conversionRate: number;
};

export type ConversionProgress = {
  status: "ready" | "missing_scope" | "approval_required" | "error";
  period: ConversionPeriod;
  periodLabel: string;
  currentLabel: string;
  previousLabel: string;
  rangeStart: string;
  rangeEnd: string;
  previousRangeStart: string;
  previousRangeEnd: string;
  currentRate: number;
  previousRate: number;
  deltaPoints: number;
  deltaPercent: number | null;
  currentSeries: ConversionPoint[];
  previousSeries: ConversionPoint[];
  message: string | null;
  source: "SHOPIFY_ANALYTICS";
  updatedAt: string;
};

export type ProgressTimelineEvent = {
  id: string;
  kind: "OPTIMIZATION" | "AB_TEST" | "SNAPSHOT" | "STORE_SNAPSHOT";
  title: string;
  description: string | null;
  category: string | null;
  scope: string | null;
  pagePath: string | null;
  start: string;
  end: string | null;
  sourceType: string;
  editable: boolean;
};

export type ConversionDashboardPayload = {
  progress: ConversionProgress;
  events: ProgressTimelineEvent[];
};
