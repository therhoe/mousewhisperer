import prisma from "../db.server";
import { cachedValue, clearCacheKey } from "./loader-cache.server";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_DAILY_BUCKETS = 90;
const OVERVIEW_TTL_MS = 45_000;

type OverviewSnapshot = {
  id: string;
  name: string;
  status: string;
  startedAt: Date;
  endsAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
};

export type ChannelOverviewPoint = {
  sessions: number;
  humanSessions: number;
  conversions: number;
  conversionRate: number | null;
};

export type ChannelOverview = {
  snapshot: { id: string; name: string; status: string } | null;
  range: {
    start: string;
    end: string;
    unit: "hour" | "day";
    truncated: boolean;
    timezone: "UTC";
  } | null;
  buckets: string[];
  channels: Array<{
    channel: string;
    humanSessions: number;
    points: ChannelOverviewPoint[];
  }>;
  summary: {
    sessions: number;
    real: number;
    humanSessions: number;
    conversions: number;
    realShare: number | null;
    conversionRate: number | null;
  };
  updatedAt: string;
};

export type ChannelBucketAggregate = {
  bucket: string;
  channel: string;
  sessions: number;
  real: number;
  zombies: number;
  conversions: number;
};

const snapshotSelect = {
  id: true,
  name: true,
  status: true,
  startedAt: true,
  endsAt: true,
  completedAt: true,
  updatedAt: true,
} as const;

export function getOverviewWindow(snapshot: OverviewSnapshot, now: Date) {
  const captureStart = snapshot.startedAt.getTime();
  const captureEnd = Math.max(
    captureStart,
    Math.min(
      now.getTime(),
      snapshot.completedAt?.getTime() ?? Number.POSITIVE_INFINITY,
      snapshot.endsAt?.getTime() ?? Number.POSITIVE_INFINITY,
      snapshot.status === "PAUSED"
        ? snapshot.updatedAt.getTime()
        : Number.POSITIVE_INFINITY,
    ),
  );
  const unit =
    captureEnd - captureStart <= DAY_MS ? ("hour" as const) : ("day" as const);
  const intervalMs = unit === "hour" ? HOUR_MS : DAY_MS;
  const firstCaptureBucket = Math.floor(captureStart / intervalMs) * intervalMs;
  const lastBucket = Math.floor(captureEnd / intervalMs) * intervalMs;
  const firstBucket =
    unit === "day"
      ? Math.max(
          firstCaptureBucket,
          lastBucket - (MAX_DAILY_BUCKETS - 1) * DAY_MS,
        )
      : firstCaptureBucket;
  const buckets: string[] = [];
  for (let bucket = firstBucket; bucket <= lastBucket; bucket += intervalMs) {
    buckets.push(new Date(bucket).toISOString());
  }
  return {
    start: new Date(Math.max(captureStart, firstBucket)),
    end: new Date(captureEnd),
    unit,
    truncated: firstBucket > firstCaptureBucket,
    buckets,
  };
}

export function buildChannelOverview(
  snapshot: OverviewSnapshot | null,
  rows: ChannelBucketAggregate[],
  now = new Date(),
): ChannelOverview {
  const summary: ChannelOverview["summary"] = {
    sessions: 0,
    real: 0,
    humanSessions: 0,
    conversions: 0,
    realShare: null,
    conversionRate: null,
  };
  if (!snapshot) {
    return {
      snapshot: null,
      range: null,
      buckets: [],
      channels: [],
      summary,
      updatedAt: now.toISOString(),
    };
  }
  const window = getOverviewWindow(snapshot, now);
  const bucketIndexes = new Map(
    window.buckets.map((bucket, index) => [bucket, index]),
  );
  const channels = new Map<string, ChannelOverview["channels"][number]>();
  for (const row of rows) {
    const bucketDate = new Date(row.bucket);
    if (!Number.isFinite(bucketDate.getTime())) continue;
    const bucketIndex = bucketIndexes.get(bucketDate.toISOString());
    if (bucketIndex === undefined) continue;
    const channel = channels.get(row.channel) || {
      channel: row.channel,
      humanSessions: 0,
      points: window.buckets.map(() => ({
        sessions: 0,
        humanSessions: 0,
        conversions: 0,
        conversionRate: null,
      })),
    };
    const point = channel.points[bucketIndex];
    const humans = Number(row.real) + Number(row.zombies);
    point.sessions += Number(row.sessions);
    point.humanSessions += humans;
    point.conversions += Number(row.conversions);
    point.conversionRate =
      point.humanSessions > 0
        ? (point.conversions / point.humanSessions) * 100
        : null;
    channel.humanSessions += humans;
    channels.set(row.channel, channel);
    summary.sessions += Number(row.sessions);
    summary.real += Number(row.real);
    summary.humanSessions += humans;
    summary.conversions += Number(row.conversions);
  }
  summary.realShare =
    summary.sessions > 0 ? (summary.real / summary.sessions) * 100 : null;
  summary.conversionRate =
    summary.humanSessions > 0
      ? (summary.conversions / summary.humanSessions) * 100
      : null;
  return {
    snapshot: {
      id: snapshot.id,
      name: snapshot.name,
      status:
        snapshot.endsAt && snapshot.endsAt <= now
          ? "COMPLETED"
          : snapshot.status,
    },
    range: {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      unit: window.unit,
      truncated: window.truncated,
      timezone: "UTC",
    },
    buckets: window.buckets,
    channels: [...channels.values()].sort(
      (a, b) =>
        b.humanSessions - a.humanSessions || a.channel.localeCompare(b.channel),
    ),
    summary,
    updatedAt: now.toISOString(),
  };
}

export async function getChannelOverview(
  shop: string,
  options: { force?: boolean } = {},
) {
  const now = new Date();
  // These two small indexed lookups never mix active/paused/historical captures.
  const snapshot =
    (await prisma.channelSnapshot.findFirst({
      where: {
        shop,
        status: "ACTIVE",
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: snapshotSelect,
    })) ??
    (await prisma.channelSnapshot.findFirst({
      where: { shop },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: snapshotSelect,
    }));
  if (!snapshot) return buildChannelOverview(null, [], now);

  const window = getOverviewWindow(snapshot, now);
  const key = `channel-overview:${shop}:${snapshot.id}:${snapshot.status}:${snapshot.updatedAt.getTime()}:${window.unit}:${window.buckets[0]}:${window.buckets.at(-1)}`;
  if (options.force) clearCacheKey(key);
  return cachedValue(key, OVERVIEW_TTL_MS, async () => {
    // Collapse page views to one traffic classification per acquisition session
    // before counting. Return at most 8 channels × 90 UTC buckets, not raw visits.
    const rows = await prisma.$queryRaw<ChannelBucketAggregate[]>`
      WITH classified AS (
        SELECT
          s.id,
          date_trunc(${window.unit}, s."startedAt") AS bucket,
          CASE WHEN s.channel IN ('Direct', 'Organic Search', 'Paid Search', 'Organic Social', 'Paid Social', 'Email', 'Referral', 'Unknown')
            THEN s.channel ELSE 'Unknown' END AS channel,
          s.converted,
          CASE
            WHEN BOOL_OR(v."visitorType" = 'REAL') THEN 'REAL'
            WHEN BOOL_OR(v."visitorType" = 'ZOMBIE') THEN 'ZOMBIE'
            WHEN BOOL_OR(v."visitorType" = 'PENDING') THEN 'PENDING'
            WHEN BOOL_OR(v."visitorType" = 'BOT') THEN 'BOT'
            ELSE 'PENDING'
          END AS "visitorType"
        FROM "ChannelSnapshotSession" s
        JOIN "ChannelSnapshot" capture ON capture.id = s."channelSnapshotId" AND capture.shop = ${shop}
        LEFT JOIN "ChannelSnapshotVisit" v ON v."sessionId" = s.id
        WHERE s."channelSnapshotId" = ${snapshot.id}
          AND s."startedAt" >= ${window.start}
          AND s."startedAt" <= ${window.end}
        GROUP BY s.id
      )
      SELECT
        to_char(bucket, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bucket,
        channel,
        COUNT(*)::int AS sessions,
        COUNT(*) FILTER (WHERE "visitorType" = 'REAL')::int AS real,
        COUNT(*) FILTER (WHERE "visitorType" = 'ZOMBIE')::int AS zombies,
        COUNT(*) FILTER (WHERE "visitorType" IN ('REAL', 'ZOMBIE') AND converted)::int AS conversions
      FROM classified
      GROUP BY bucket, channel
      ORDER BY bucket, channel
    `;
    return buildChannelOverview(snapshot, rows, now);
  });
}
