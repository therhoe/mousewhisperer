export type AbTestTrendPoint = {
  date: string;
  visitors: number;
  conversions: number;
  conversionRate: number;
  addToCarts: number;
  addToCartRate: number;
  revenue: number;
  revenuePerVisitor: number;
  ctaVisitors: number;
  ctaClickRate: number;
  avgScrollDepth: number;
};

export type AbTestTrendAssignment = {
  visitorType: string;
  assignedAt: Date | string;
  addedToCart: boolean;
  addedToCartAt?: Date | string | null;
  converted: boolean;
  convertedAt?: Date | string | null;
  orderValue?: number | null;
  ctaClicks?: string | null;
  scrollDepth?: number | null;
  endedAt?: Date | string | null;
  updatedAt?: Date | string | null;
};

export type SourceQualityAssignment = {
  visitorType: string;
  sourceCategory?: string | null;
  source?: string | null;
  medium?: string | null;
  timeOnPage?: number | null;
  scrollDepth?: number | null;
  addedToCart: boolean;
  converted: boolean;
};

export type SourceQualityRow = {
  key: string;
  label: string;
  sessions: number;
  real: number;
  zombies: number;
  bots: number;
  pending: number;
  realPercent: number;
  zombiePercent: number;
  botPercent: number;
  avgTimeOnPage: number;
  avgScrollDepth: number;
  addToCarts: number;
  addToCartRate: number;
  conversions: number;
  conversionRate: number;
};

function validDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function startOfUtcDay(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function endOfUtcDay(value: Date) {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}

function addUtcDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function hasTrackedInteraction(value?: string | null) {
  if (!value) return false;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.some((click) => {
        const tag = String(click?.tag || "").toLowerCase();
        return ["a", "button", "input", "img"].includes(tag);
      });
    }
    if (parsed && typeof parsed === "object") {
      return Object.values(parsed).some(
        (count) => Number.isFinite(Number(count)) && Number(count) > 0,
      );
    }
  } catch {}
  return false;
}

export function buildCumulativeAbTestTrend(
  rows: AbTestTrendAssignment[],
  {
    startAt,
    endAt,
    maxPoints = 45,
    audience = "active",
  }: {
    startAt?: Date | string | null;
    endAt?: Date | string | null;
    maxPoints?: number;
    audience?: "all" | "active";
  } = {},
): AbTestTrendPoint[] {
  const realRows = rows
    .filter((row) => audience === "all" || row.visitorType === "REAL")
    .map((row) => ({ ...row, assignedDate: validDate(row.assignedAt) }))
    .filter(
      (row): row is typeof row & { assignedDate: Date } =>
        row.assignedDate !== null,
    )
    .sort(
      (left, right) =>
        left.assignedDate.getTime() - right.assignedDate.getTime(),
    );

  if (!realRows.length) return [];

  const requestedStart = validDate(startAt);
  const requestedEnd = validDate(endAt);
  const start = startOfUtcDay(requestedStart || realRows[0].assignedDate);
  const lastAssignment = realRows[realRows.length - 1].assignedDate;
  const end = endOfUtcDay(
    requestedEnd && requestedEnd >= start ? requestedEnd : lastAssignment,
  );
  const totalDays =
    Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000)) + 1;
  const bucketSize = Math.max(1, Math.ceil(totalDays / Math.max(1, maxPoints)));
  const points: AbTestTrendPoint[] = [];
  const conversionEvents = realRows
    .filter((row) => row.converted)
    .map((row) => {
      const convertedAt = validDate(row.convertedAt) || row.assignedDate;
      return {
        at: convertedAt >= row.assignedDate ? convertedAt : row.assignedDate,
        revenue: Number(row.orderValue || 0),
      };
    })
    .sort((left, right) => left.at.getTime() - right.at.getTime());
  const addToCartEvents = realRows
    .filter((row) => row.addedToCart)
    .map((row) => {
      const addedAt = validDate(row.addedToCartAt) || row.assignedDate;
      return { at: addedAt >= row.assignedDate ? addedAt : row.assignedDate };
    })
    .sort((left, right) => left.at.getTime() - right.at.getTime());
  const engagementEvents = realRows
    .map((row) => {
      const engagementAt =
        validDate(row.endedAt) || validDate(row.updatedAt) || row.assignedDate;
      return {
        at: engagementAt >= row.assignedDate ? engagementAt : row.assignedDate,
        hasCtaClick: hasTrackedInteraction(row.ctaClicks),
        scrollDepth: Number(row.scrollDepth || 0),
      };
    })
    .sort((left, right) => left.at.getTime() - right.at.getTime());
  let visitorIndex = 0;
  let conversionIndex = 0;
  let addToCartIndex = 0;
  let engagementIndex = 0;
  let revenue = 0;
  let ctaVisitors = 0;
  let scrollTotal = 0;
  let scrollSamples = 0;

  for (let offset = 0; offset < totalDays; offset += bucketSize) {
    const bucketDay = addUtcDays(
      start,
      Math.min(totalDays - 1, offset + bucketSize - 1),
    );
    const bucketEnd = endOfUtcDay(bucketDay);
    while (
      visitorIndex < realRows.length &&
      realRows[visitorIndex].assignedDate <= bucketEnd
    ) {
      visitorIndex += 1;
    }
    while (
      conversionIndex < conversionEvents.length &&
      conversionEvents[conversionIndex].at <= bucketEnd
    ) {
      revenue += conversionEvents[conversionIndex].revenue;
      conversionIndex += 1;
    }
    while (
      addToCartIndex < addToCartEvents.length &&
      addToCartEvents[addToCartIndex].at <= bucketEnd
    ) {
      addToCartIndex += 1;
    }
    while (
      engagementIndex < engagementEvents.length &&
      engagementEvents[engagementIndex].at <= bucketEnd
    ) {
      const event = engagementEvents[engagementIndex];
      if (event.hasCtaClick) ctaVisitors += 1;
      if (Number.isFinite(event.scrollDepth)) {
        scrollTotal += event.scrollDepth;
        scrollSamples += 1;
      }
      engagementIndex += 1;
    }
    const visitors = visitorIndex;

    points.push({
      date: bucketDay.toISOString().slice(0, 10),
      visitors,
      conversions: conversionIndex,
      conversionRate: visitors ? (conversionIndex / visitors) * 100 : 0,
      addToCarts: addToCartIndex,
      addToCartRate: visitors ? (addToCartIndex / visitors) * 100 : 0,
      revenue,
      revenuePerVisitor: visitors ? revenue / visitors : 0,
      ctaVisitors,
      ctaClickRate: visitors ? (ctaVisitors / visitors) * 100 : 0,
      avgScrollDepth: scrollSamples ? scrollTotal / scrollSamples : 0,
    });
  }

  return points;
}

function sourceLabel(row: SourceQualityAssignment) {
  return (
    row.sourceCategory ||
    row.source ||
    row.medium ||
    "Direct / unknown"
  ).trim();
}

export function buildSourceQualityBreakdown(
  rows: SourceQualityAssignment[],
  audience: "all" | "active" = "active",
): SourceQualityRow[] {
  const groups = new Map<string, SourceQualityAssignment[]>();

  for (const row of rows) {
    const label = sourceLabel(row) || "Direct / unknown";
    const key = label.toLowerCase();
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const realRows = group.filter((row) => row.visitorType === "REAL");
      const metricRows = audience === "all" ? group : realRows;
      const average = (getValue: (row: SourceQualityAssignment) => number) =>
        metricRows.length
          ? metricRows.reduce((sum, row) => sum + getValue(row), 0) /
            metricRows.length
          : 0;
      const sessions = group.length;
      const real = realRows.length;
      const zombies = group.filter(
        (row) => row.visitorType === "ZOMBIE",
      ).length;
      const bots = group.filter((row) => row.visitorType === "BOT").length;
      const pending = group.filter(
        (row) => row.visitorType === "PENDING",
      ).length;
      const addToCarts = metricRows.filter((row) => row.addedToCart).length;
      const conversions = metricRows.filter((row) => row.converted).length;
      const denominator = metricRows.length;

      return {
        key,
        label: sourceLabel(group[0]) || "Direct / unknown",
        sessions,
        real,
        zombies,
        bots,
        pending,
        realPercent: sessions ? (real / sessions) * 100 : 0,
        zombiePercent: sessions ? (zombies / sessions) * 100 : 0,
        botPercent: sessions ? (bots / sessions) * 100 : 0,
        avgTimeOnPage: average((row) => Number(row.timeOnPage || 0)),
        avgScrollDepth: average((row) => Number(row.scrollDepth || 0)),
        addToCarts,
        addToCartRate: denominator ? (addToCarts / denominator) * 100 : 0,
        conversions,
        conversionRate: denominator ? (conversions / denominator) * 100 : 0,
      };
    })
    .sort(
      (left, right) =>
        right.sessions - left.sessions || left.label.localeCompare(right.label),
    );
}
