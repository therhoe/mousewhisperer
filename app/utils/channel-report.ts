export const CHANNEL_NAMES = [
  "Direct",
  "Organic Search",
  "Paid Search",
  "Organic Social",
  "Paid Social",
  "Email",
  "Referral",
  "Unknown",
] as const;

export const CHANNEL_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
export const CHANNEL_PAGE_SIZE = 10;

export type ChannelAcquisition = {
  id: string;
  startedAt: Date;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  referrer: string | null;
  channel: string;
  landingPath: string | null;
};

export type ChannelSessionRow = {
  id: string;
  channel: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  visitorType: string;
  pageViews: number;
  timeOnPage: number;
  averageScrollDepth: number;
  addedToCart: boolean;
  checkoutStarted: boolean;
  converted: boolean;
};

export type ChannelMetrics = {
  sessions: number;
  real: number;
  zombies: number;
  bots: number;
  pending: number;
  humanSessions: number;
  pageViews: number;
  averageTimeSeconds: number;
  averageScrollDepth: number;
  addedToCart: number;
  checkoutStarted: number;
  conversions: number;
  atcRate: number;
  conversionRate: number;
  unknownSessions: number;
};

export type ChannelReportFilters = {
  channel?: string;
  source?: string;
  campaign?: string;
  page?: number;
};

export function boundedText(value: unknown, maxLength: number): string | null {
  return typeof value === "string"
    ? value
        .trim()
        .replace(/\p{Cc}/gu, "")
        .slice(0, maxLength) || null
    : null;
}

export function channelPagePath(value: unknown): string | null {
  const text = boundedText(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text, "https://store.invalid");
    if (!["https:", "http:"].includes(url.protocol)) return null;
    return url.pathname.slice(0, 600) || "/";
  } catch {
    return null;
  }
}

export function readChannelAcquisition(
  value: unknown,
  now = new Date(),
): ChannelAcquisition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const id = boundedText(input.id, 128);
  const startedAt = new Date(Number(input.startedAt));
  if (
    !id ||
    !/^acq_[a-zA-Z0-9_-]+$/.test(id) ||
    !Number.isFinite(startedAt.getTime()) ||
    startedAt.getTime() > now.getTime() + 60_000 ||
    startedAt.getTime() < now.getTime() - 7 * 24 * 60 * 60 * 1000
  )
    return null;

  let referrer: string | null = null;
  try {
    const url = new URL(String(input.referrer || ""));
    if (url.protocol === "http:" || url.protocol === "https:") {
      // Query strings can contain personal data; only keep navigation context.
      referrer = `${url.origin}${url.pathname}`.slice(0, 1024);
    }
  } catch {
    /* No usable external referrer. */
  }

  const channel =
    CHANNEL_NAMES.find((name) => name === input.sourceCategory) || "Unknown";
  return {
    id,
    startedAt,
    source: boundedText(input.source, 160),
    medium: boundedText(input.medium, 160),
    campaign: boundedText(input.campaign, 240),
    referrer,
    channel,
    landingPath: channelPagePath(input.landingPath),
  };
}

export function channelPercent(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

export function summarizeChannelSessions(
  rows: ChannelSessionRow[],
): ChannelMetrics {
  const humanRows = rows.filter(
    (row) => row.visitorType === "REAL" || row.visitorType === "ZOMBIE",
  );
  const real = rows.filter((row) => row.visitorType === "REAL").length;
  const zombies = rows.filter((row) => row.visitorType === "ZOMBIE").length;
  const bots = rows.filter((row) => row.visitorType === "BOT").length;
  const addedToCart = humanRows.filter((row) => row.addedToCart).length;
  const conversions = humanRows.filter((row) => row.converted).length;
  return {
    sessions: rows.length,
    real,
    zombies,
    bots,
    pending: rows.length - real - zombies - bots,
    humanSessions: humanRows.length,
    pageViews: rows.reduce((sum, row) => sum + Number(row.pageViews || 0), 0),
    averageTimeSeconds: humanRows.length
      ? Math.round(
          humanRows.reduce((sum, row) => sum + Number(row.timeOnPage || 0), 0) /
            humanRows.length /
            1000,
        )
      : 0,
    averageScrollDepth: humanRows.length
      ? Math.round(
          humanRows.reduce(
            (sum, row) => sum + Number(row.averageScrollDepth || 0),
            0,
          ) / humanRows.length,
        )
      : 0,
    addedToCart,
    checkoutStarted: humanRows.filter((row) => row.checkoutStarted).length,
    conversions,
    atcRate: channelPercent(addedToCart, humanRows.length),
    conversionRate: channelPercent(conversions, humanRows.length),
    unknownSessions: rows.filter((row) => row.channel === "Unknown").length,
  };
}

export function buildChannelReport(
  rows: ChannelSessionRow[],
  filters: ChannelReportFilters = {},
) {
  const matches = (value: string | null, filter: string | undefined) =>
    !filter || (filter === "__none__" ? !value : value === filter);
  const filtered = rows.filter(
    (row) =>
      matches(row.channel, filters.channel) &&
      matches(row.source, filters.source) &&
      matches(row.campaign, filters.campaign),
  );
  const groups = new Map<string, ChannelSessionRow[]>();
  for (const row of filtered) {
    const key = JSON.stringify([
      row.channel,
      row.source,
      row.medium,
      row.campaign,
    ]);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  const grouped = [...groups.entries()]
    .map(([key, group]) => ({
      key,
      channel: group[0].channel,
      source: group[0].source,
      medium: group[0].medium,
      campaign: group[0].campaign,
      ...summarizeChannelSessions(group),
    }))
    .sort((a, b) => b.sessions - a.sessions || a.key.localeCompare(b.key));
  const optionsFor = (key: "channel" | "source" | "campaign") =>
    [...new Set(rows.map((row) => row[key] || "__none__"))].sort();
  const pageCount = Math.max(1, Math.ceil(grouped.length / CHANNEL_PAGE_SIZE));
  const requestedPage = Number.isFinite(filters.page)
    ? Math.floor(filters.page!)
    : 1;
  const page = Math.min(pageCount, Math.max(1, requestedPage));
  return {
    summary: summarizeChannelSessions(filtered),
    rows: grouped.slice(
      (page - 1) * CHANNEL_PAGE_SIZE,
      page * CHANNEL_PAGE_SIZE,
    ),
    options: {
      channels: optionsFor("channel"),
      sources: optionsFor("source"),
      campaigns: optionsFor("campaign"),
    },
    page,
    pageCount,
    totalRows: grouped.length,
    capturedSessions: rows.length,
  };
}
